/**
 * @fileoverview `createKernel`: two direct registries over the same commands and the same
 * journal, name refusal, the journal options and the view-state hydration (phase 0 specification,
 * 6.1 to 6.5), with the apps a deployment lists (phase 1 specification, 9.1).
 */

import { createAuthMiddleware } from '@lushly-dev/afd-auth';
import {
	type CommandContext,
	type CommandMiddleware,
	type CommandResult,
	failure,
	type JournalRecord,
	type JournalSink,
	validateCommandName,
} from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import {
	createDirectRegistry,
	createJournalMiddleware,
	type DirectCommandRegistry,
	type JournalMiddlewareOptions,
} from '@lushly-dev/afd-server/direct';
import { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import { createAppCommands } from './app-commands.js';
import {
	type AppCommandRowV1,
	type AppsRuntime,
	EMPTY_APPS,
	unavailableApps,
} from './apps-runtime.js';
import { createShellCommands, INTERNAL_COMMANDS, SHELL_EXPOSE } from './commands.js';
import { KERNEL_CONTEXT_FIELDS, type KernelCallFields } from './context-fields.js';
import { LoamKernelError } from './errors.js';
import {
	createKeybindings,
	type KeybindingRegistry,
	needsInput,
	SHELL_KEYBINDINGS_V0,
} from './keybindings.js';
import { createOverlayCommands, createOverlayStore } from './overlays.js';
import { createPaletteIndex, type PaletteIndex } from './palette-index.js';
import { registerShellState } from './shell-state.js';
import type {
	CallOptionsV1,
	CommandSummaryV1,
	KernelEventV1,
	KernelOptionsV1,
	LoamKernelV1,
} from './types.js';

/** The kernel's two interfaces, one registry each. */
export type KernelInterfaceV0 = KernelEventV1['interface'];

/** Suggestion for a refused name (phase 0 specification, 6.1). */
export const COMMAND_NAME_SUGGESTION = 'Rename it domain-action, e.g. notes-create';

/** Commands the one journal middleware leaves out: `palette-search` runs per keystroke. */
export const UNJOURNALED_COMMANDS: readonly string[] = Object.freeze(['palette-search']);

/**
 * The journal options (phase 0 specification, 6.4): failures recorded, every command but
 * `palette-search` (so `auth-*` is journaled and replayable), and `input.password` removed from
 * `auth-sign-in` entries. The clock and random tape stay on.
 */
export function kernelJournalOptions(
	onError: (error: Error) => void = reportKernelError
): JournalMiddlewareOptions {
	return {
		recordFailures: true,
		onError,
		filter: (command) => !UNJOURNALED_COMMANDS.includes(command),
		redact: redactJournalRecord,
	};
}

/** Remove `input.password` from an `auth-sign-in` record. */
export function redactJournalRecord(record: JournalRecord): JournalRecord {
	if (record.command !== 'auth-sign-in') return record;
	const input = record.input;
	if (typeof input !== 'object' || input === null || !('password' in input)) return record;
	const { password: _password, ...rest } = input as Record<string, unknown>;
	return { ...record, input: rest };
}

/** Refuse a bad or repeated name before any registry is built. */
function checkNames(commands: readonly ZodCommandDefinition[]): void {
	const seen = new Set<string>();
	for (const command of commands) {
		const check = validateCommandName(command.name);
		if (!check.valid) {
			const reason = check.reason ?? 'Command names are domain-action kebab-case';
			throw new LoamKernelError({
				code: 'COMMAND_NAME_INVALID',
				message: `Command name '${command.name}' is refused: ${reason}`,
				suggestion: COMMAND_NAME_SUGGESTION,
				details: { name: command.name, reason },
			});
		}
		if (seen.has(command.name)) {
			throw new LoamKernelError({
				code: 'COMMAND_NAME_DUPLICATE',
				message: `Command name '${command.name}' is registered twice`,
				suggestion: 'Give each command its own name; the shell commands are in SHELL_COMMAND_NAMES',
				details: { name: command.name, reason: 'Each command needs its own name' },
			});
		}
		seen.add(command.name);
	}
}

/**
 * A sink that passes every call through and remembers the `seq` it assigned to each trace ID,
 * so a kernel call learns whether, and where, it was journaled.
 */
function seqTrackingSink(sink: JournalSink, seqs: Map<string, number>): JournalSink {
	return {
		async append(record) {
			const entry = await sink.append(record);
			if (record.traceId !== undefined) seqs.set(record.traceId, entry.seq);
			return entry;
		},
		read: (range) => sink.read(range),
	};
}

/**
 * Report an error that must not change a call's result (a throwing listener, a failed journal
 * append) through the host's `reportError`, which a page shows as an `error` event.
 */
function reportKernelError(error: unknown): void {
	const report = (globalThis as { reportError?: (error: unknown) => void }).reportError;
	report?.(error);
}

/** What {@link createKernelParts} builds; `createKernel` and `replayKernel` share it. */
export interface KernelParts {
	kernel: LoamKernelV1;
	/** The current registries; {@link KernelParts.setAppCommands} replaces them. */
	readonly registries: Record<KernelInterfaceV0, DirectCommandRegistry>;
	/**
	 * Build two new registries with `commands` as the apps' commands, over the same journal. In-flight
	 * calls finish on the old ones. Mounted discovery is what changes the set (phase 1 specification,
	 * 9.1).
	 */
	setAppCommands(commands: readonly ZodCommandDefinition[]): void;
	/** Register a mounted instance's catalog from a journal: a replay's discovery, with no network (7.6). */
	applyCatalog(instance: string, catalog: unknown): void;
	/** Forget what a page holds only in memory, as a reload does: overlays, selections, status values. */
	resetSession(): void;
}

/** What only `replayKernel` asks of a kernel. */
export interface KernelPartsInternals {
	/**
	 * A nested call's answer from the journal, in place of running it (7.6). Undefined runs it: a refusal
	 * before the middleware leaves no entry, and answers the same again.
	 */
	answerNested?(parent: string, name: string, input: unknown): CommandResult | undefined;
	/** A nested call ran and reached the journal, so the record has no answer for what it did. */
	nestedUnrecorded?(parent: string, name: string): void;
}

/** Build a kernel and expose its registries, for replay. Not part of the kernel interface. */
export async function createKernelParts(
	options: KernelOptionsV1,
	internals: KernelPartsInternals = {}
): Promise<KernelParts> {
	const { environment } = options;
	const viewState = new ViewStateRegistry({ adapter: options.store });
	const state = registerShellState(viewState);
	const overlays = createOverlayStore();

	let apps: AppsRuntime = EMPTY_APPS;
	let keybindings: KeybindingRegistry = createKeybindings(SHELL_KEYBINDINGS_V0, []);
	let index: { active: string | null; index: PaletteIndex } | undefined;

	const summarize = (registry: DirectCommandRegistry): CommandSummaryV1[] =>
		registry
			.listCommands()
			.filter((command) => !INTERNAL_COMMANDS.includes(command.name))
			.map((command) => {
				const keybinding = keybindings.keybindingFor(command.name);
				const instance = apps.owners.get(command.name)?.instance;
				return {
					name: command.name,
					...(command.title !== undefined ? { title: command.title } : {}),
					description: command.description,
					mutation: command.mutation === true,
					needsInput: needsInput(command.inputSchema),
					...(keybinding !== undefined ? { keybinding } : {}),
					...(instance !== undefined ? { instance } : {}),
				};
			});

	const shell = [
		...createShellCommands({
			viewState,
			state,
			environment,
			auth: options.auth,
			host: options.host,
			storeKind: options.storeKind,
			overlays,
			search: (query, limit) => {
				// Shell commands and the active app's: an inactive app's stay callable by name (9.1).
				const active = state.activeApp();
				if (index?.active !== active) {
					const shown = summarize(registries.palette).filter(
						(command) => command.instance === undefined || command.instance === active
					);
					index = { active, index: createPaletteIndex(shown) };
				}
				return index.index.search(query, limit);
			},
		}),
		...createAppCommands({ apps: () => apps, state }),
		...createOverlayCommands({ overlays, activeApp: () => state.activeApp() }),
	];
	const extra = options.commands ?? [];

	// Name refusal comes first: a bad name never reaches a registry.
	checkNames([...shell, ...extra]);

	const fixed: ZodCommandDefinition[] = [
		...shell.map((command) => ({ ...command, expose: { ...SHELL_EXPOSE } })),
		...extra,
	];
	const seqs = new Map<string, number>();
	// One journal middleware, shared by every registry, so they share one journal sequence.
	const journal = createJournalMiddleware(seqTrackingSink(options.journal, seqs), {
		...kernelJournalOptions(),
		redact: (record) => apps.redact(redactJournalRecord(record)),
	});
	const clock = options.clock ? { now: options.clock } : undefined;
	const random = options.random ? { next: options.random } : undefined;

	let registries: Record<KernelInterfaceV0, DirectCommandRegistry>;
	let mutations: Map<string, boolean>;
	function setAppCommands(appCommands: readonly ZodCommandDefinition[]): void {
		const commands = [...fixed, ...appCommands];
		mutations = new Map(commands.map((command) => [command.name, command.mutation === true]));
		// The auth middleware closes over its `exclude` list, so it is a new instance each time.
		const middleware: CommandMiddleware[] = [
			createAuthMiddleware(options.auth, { exclude: commands.map((command) => command.name) }),
			journal,
		];
		const build = (iface: KernelInterfaceV0) =>
			createDirectRegistry(commands, {
				interface: iface,
				middleware,
				contextFields: KERNEL_CONTEXT_FIELDS,
				...(clock ? { clock } : {}),
				...(random ? { random } : {}),
			});
		registries = { palette: build('palette'), agent: build('agent') };
		index = undefined;
	}

	const listeners = new Set<(event: KernelEventV1) => void>();
	const traceBase = `loam-${Math.floor(options.clock?.() ?? Date.now()).toString(36)}`;
	let calls = 0;
	let disposed = false;

	async function run<T>(
		iface: KernelInterfaceV0,
		name: string,
		input: unknown,
		callOptions: CallOptionsV1 = {},
		fields: KernelCallFields = {}
	): Promise<CommandResult<T>> {
		if (disposed) {
			return failure({
				code: 'KERNEL_DISPOSED',
				message: 'The kernel was disposed',
				suggestion: 'Create a new kernel with createKernel',
				retryable: false,
			});
		}
		if (fields.parent !== undefined) {
			const answered = internals.answerNested?.(fields.parent, name, input);
			if (answered) return answered as CommandResult<T>;
		}
		const traceId = `${traceBase}-${++calls}`;
		const owned = apps.contextOf(name, input);
		const context: CommandContext & KernelCallFields = {
			traceId,
			...(callOptions.signal !== undefined ? { signal: callOptions.signal } : {}),
			...owned,
			...fields,
		};
		const result = await registries[iface].execute<T>(name, input ?? {}, context);
		const seq = seqs.get(traceId);
		seqs.delete(traceId);
		if (fields.parent !== undefined && seq !== undefined) {
			internals.nestedUnrecorded?.(fields.parent, name);
		}
		const event: KernelEventV1 = {
			command: name,
			interface: iface,
			success: result.success,
			mutation: mutations.get(name) ?? false,
			...(seq !== undefined ? { seq } : {}),
			...(fields.caller !== undefined ? { caller: fields.caller } : {}),
			...(owned.instance !== undefined ? { instance: owned.instance } : {}),
		};
		for (const listener of [...listeners]) {
			try {
				listener(event);
			} catch (error) {
				reportKernelError(error);
			}
		}
		// After journaling, and never in the journal's copy. A person's or agent's call only: a seq counts
		// every app's calls, which a view must not see, and a handler may return a nested result as its own.
		return seq === undefined || fields.caller !== undefined
			? result
			: { ...result, metadata: { ...result.metadata, 'dev.loam/seq': seq } };
	}

	// `apps/` loads only for a deployment that lists an app, so the empty shell never fetches it.
	const listed = options.deployment as NonNullable<KernelOptionsV1['deployment']> | undefined;
	if (options.appsUnavailable !== undefined) {
		apps = unavailableApps(listed, state, options.appsUnavailable);
	} else if (listed && listed.apps.length > 0) {
		try {
			const { loadApps } = await import('./apps/index.js');
			apps = await loadApps({
				deployment: listed,
				...(options.ports !== undefined ? { ports: options.ports } : {}),
				store: options.store,
				taken: new Set(fixed.map((command) => command.name)),
				state,
				viewState,
				overlays,
				owners: () => apps.owners,
				isMutation: (name) => mutations.get(name) === true,
				setCommands: setAppCommands,
				commandRows(instance) {
					const summaries = new Map(summarize(registries.palette).map((row) => [row.name, row]));
					return registries.palette
						.listCommands()
						.filter((command) => apps.owners.get(command.name)?.instance === instance)
						.map(
							(command): AppCommandRowV1 => ({
								...(summaries.get(command.name) as CommandSummaryV1),
								inputSchema: command.inputSchema,
								...(command.destructive !== undefined ? { destructive: command.destructive } : {}),
							})
						);
				},
				runAs: (name, input, callOptions, fields) =>
					run('palette', name, input, callOptions, fields),
				clock: () => options.clock?.() ?? Date.now(),
			});
			keybindings = createKeybindings(SHELL_KEYBINDINGS_V0, apps.keybindings);
		} catch (cause) {
			// A chunk that does not load refuses every app, and never the shell (D66).
			reportKernelError(cause);
			apps = unavailableApps(listed, state, String((cause as Error)?.message ?? cause));
		}
	}
	setAppCommands(apps.commands);

	await state.hydrate();
	apps.reconcileLayouts();

	const kernel: LoamKernelV1 = {
		version: 1,
		call: (name, input, callOptions) => run('palette', name, input, callOptions),
		listCommands: () => summarize(registries.palette),
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		agent: {
			call: (name, input, callOptions) => run('agent', name, input, callOptions),
			listCommands: () => summarize(registries.agent),
		},
		appPort: (instance) => apps.port(instance),
		listKeybindings: () => keybindings.list(state.activeApp()),
		async startInstances() {
			await Promise.all(
				apps
					.mountedInstances()
					.map((instance) => run('palette', 'app-instance-refresh', { instance }))
			);
		},
		async flush() {
			if (!disposed) await viewState.flush();
		},
		async dispose() {
			if (disposed) return;
			disposed = true;
			listeners.clear();
			await apps.dispose();
			await viewState.destroy();
		},
	};
	return {
		kernel,
		get registries() {
			return registries;
		},
		setAppCommands,
		applyCatalog: (instance, catalog) => apps.applyCatalog(instance, catalog),
		resetSession() {
			overlays.reset();
			apps.resetSession();
		},
	};
}

/**
 * Create the kernel: check every command name, read the deployment's packages, build the palette and
 * agent registries over the same commands and journal, and hydrate the view state from `store` before
 * resolving. A bad app never rejects it: it is reported in `app-list`.
 *
 * @throws LoamKernelError `COMMAND_NAME_INVALID` for a name that is not domain-action kebab-case,
 *   `COMMAND_NAME_DUPLICATE` for a name given twice
 */
export async function createKernel(options: KernelOptionsV1): Promise<LoamKernelV1> {
	return (await createKernelParts(options)).kernel;
}
