/**
 * @fileoverview `createKernel`: two direct registries over the same commands and the same
 * journal, name refusal, the journal options and the view-state hydration (phase 0 specification,
 * 6.1 to 6.5), with the apps a deployment lists (phase 1 specification, 9.1).
 */

import { createAuthMiddleware } from '@lushly-dev/afd-auth';
import {
	type CommandContext,
	type CommandError,
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
import { type BootProjectionV2, readBoot } from '@lushly-dev/loam-manifest';
import {
	type AppsRuntime,
	bootApps,
	deploymentRefused,
	EMPTY_APPS,
	runtimeUnavailable,
} from './apps-runtime.js';
import { createBootCommands } from './boot-commands.js';
import { INTERNAL_COMMANDS, SHELL_EXPOSE } from './commands.js';
import { KERNEL_CONTEXT_FIELDS, type KernelCallFields } from './context-fields.js';
import { LoamKernelError } from './errors.js';
import {
	createKeybindings,
	type KeybindingRegistry,
	needsInput,
	SHELL_KEYBINDINGS_V0,
} from './keybindings.js';
import { firstLayoutOf } from './layout.js';
import type { OverlayStore } from './overlays.js';
import { registerShellState } from './shell-state.js';
import type {
	AppsLoadV2,
	CallOptionsV1,
	CommandSummaryV1,
	KernelEventV1,
	KernelOptionsV2,
	LoamKernelV2,
} from './types.js';

/** The kernel's two interfaces, one registry each. */
export type KernelInterfaceV0 = KernelEventV1['interface'];

/** Suggestion for a refused name (phase 0 specification, 6.1). */
export const COMMAND_NAME_SUGGESTION = 'Rename it domain-action, e.g. notes-create';

/**
 * Commands that answer from what stage B reads, so a call waits for stage B (phase 2 specification,
 * 2.2). Each is a late command, which stage A never registers, so `run`'s wait for a name it does not
 * hold already covers them, and `boot-apps.test.ts` holds that true.
 */
export const NEEDS_STAGE_B: readonly string[] = [
	'app-get',
	'app-command-list',
	'app-instance-list',
	'app-instance-refresh',
	'app-selection-get',
	'app-selection-set',
	'status-item-set',
];

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
	kernel: LoamKernelV2;
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
	/** Boot's own journaled work, with `BOOT_FIELDS`: never queued behind stage B (step 4 calls it). */
	runBoot(name: string, input: unknown): Promise<CommandResult>;
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
	options: KernelOptionsV2,
	internals: KernelPartsInternals = {}
): Promise<KernelParts> {
	const { environment } = options;
	const viewState = new ViewStateRegistry({ adapter: options.store });
	const state = registerShellState(viewState);
	// Only late commands and apps use the store, so it loads with the former.
	let overlays: OverlayStore | undefined;

	let apps: AppsRuntime = EMPTY_APPS;
	let keybindings: KeybindingRegistry = createKeybindings(SHELL_KEYBINDINGS_V0, []);
	let commandSet = 0;

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

	const bootCommands = createBootCommands({
		state,
		environment,
		auth: options.auth,
		apps: () => apps,
	});
	const extra = options.commands ?? [];

	// Name refusal comes first: a bad name never reaches a registry.
	checkNames([...bootCommands, ...extra]);

	const shellExposed = (commands: readonly ZodCommandDefinition[]): ZodCommandDefinition[] =>
		commands.map((command) => ({ ...command, expose: { ...SHELL_EXPOSE } }));
	let fixed: ZodCommandDefinition[] = [...shellExposed(bootCommands), ...extra];
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
		commandSet += 1;
	}

	let lateFailure: CommandError | undefined;
	/** `late/`'s `withBootActions`, once that chunk has loaded. */
	let addBootActions: typeof import('./late/index.js').withBootActions | undefined;
	const lateUnavailable = (): CommandError => ({
		code: 'LATE_COMMANDS_UNAVAILABLE',
		message: 'The late commands did not load',
		suggestion: 'Reload to try again, and check that the deployment serves its assets',
		retryable: true,
	});

	/** The late commands join `fixed`. A chunk that fails is `lateFailure`; a name they repeat rejects. */
	async function loadLate(): Promise<void> {
		let shell: ZodCommandDefinition[];
		try {
			const late = await import('./late/index.js');
			const { createOverlayStore, shellCommandsWithLate } = late;
			addBootActions = late.withBootActions;
			overlays = createOverlayStore();
			shell = shellCommandsWithLate(bootCommands, {
				viewState,
				state,
				environment,
				auth: options.auth,
				host: options.host,
				storeKind: options.storeKind,
				overlays,
				apps: () => apps,
				paletteRows: () => summarize(registries.palette),
				commandSet: () => commandSet,
			});
		} catch (cause) {
			reportKernelError(cause);
			lateFailure = lateUnavailable();
			return;
		}
		checkNames([...shell, ...extra]);
		fixed = [...shellExposed(shell), ...extra];
	}

	let stageB: Promise<void> | undefined;
	let stageBEnded = false;
	/**
	 * The calls queued behind stage B, as a chain: each runs once stage B has ended and the call before
	 * it has finished, so they run and are journaled in the order they were made. Running them together
	 * would not: the journal appends after hashing the context with WebCrypto, which finishes in any order.
	 */
	let queue: Promise<unknown> | undefined;
	/**
	 * The fields of boot's own journaled work, an object no caller can name (phase 2 specification, 2.2).
	 * Step 4 runs `workspace-deployment-apply` with them from inside stage B, so they never join the queue,
	 * which waits for stage B and would never drain.
	 */
	const BOOT_FIELDS: KernelCallFields = {};
	let endStageB: () => void = () => {};
	const appsReady = new Promise<void>((resolve) => {
		endStageB = resolve;
	});
	const { boot } = options;
	/** Stage A has hydrated, so stage B reads only what it registers new, one record at a time. */
	let hydrated = false;
	/** Why stage B ended early, so `createKernel` can reject on a refused name when it ran inside it. */
	let stageBError: unknown;

	/** What stage B reads of the apps: the host's loader with `boot`, else the options themselves. */
	async function readApps(): Promise<AppsLoadV2 | undefined> {
		if (boot) return options.appsLoader?.();
		const listed = options.deployment;
		if (listed === undefined || listed.apps.length === 0) return undefined;
		return {
			deployment: listed,
			...(options.ports !== undefined ? { ports: options.ports } : {}),
		} as AppsLoadV2;
	}

	/** The apps, once the late commands are in. One app's failure, or the runtime's, never stops the shell. */
	async function loadAppsStage(): Promise<void> {
		const listsApps = boot ? boot.apps.length > 0 : (options.deployment?.apps.length ?? 0) > 0;
		if (!listsApps) return;
		// Every entry is listed `failed` with the reason, from its boot record, or from the projection's
		// own entry when the host gave no boot.
		const listed = boot ?? (readBoot(options.deployment) as BootProjectionV2);
		const fallBack = (failure: CommandError) => {
			const listedOnly = bootApps(listed, { failure });
			apps =
				addBootActions?.(
					listedOnly,
					new Map(listed.apps.map((app) => [app.instance, app.parts])),
					state,
					overlays
				) ?? listedOnly;
		};
		if (lateFailure) {
			fallBack(runtimeUnavailable(lateFailure.message));
			return;
		}
		let loaded: AppsLoadV2 | undefined;
		try {
			loaded = await readApps();
		} catch (cause) {
			reportKernelError(cause);
			fallBack(runtimeUnavailable(String((cause as Error)?.message ?? cause)));
			return;
		}
		if (loaded === undefined) {
			fallBack(runtimeUnavailable('no apps loader'));
			return;
		}
		if ('refused' in loaded) {
			fallBack(deploymentRefused(loaded.refused));
			return;
		}
		const { deployment } = loaded;
		try {
			const { loadApps } = await import('./apps/index.js');
			apps = await loadApps({
				deployment,
				...(loaded.ports !== undefined ? { ports: loaded.ports } : {}),
				store: options.store,
				taken: new Set(fixed.map((command) => command.name)),
				state,
				viewState,
				overlays: overlays as OverlayStore,
				owners: () => apps.owners,
				isMutation: (name) => mutations.get(name) === true,
				setCommands: setAppCommands,
				palette: () => ({
					commands: registries.palette.listCommands(),
					rows: summarize(registries.palette),
				}),
				runAs: (name, input, callOptions, fields, unqueued) =>
					unqueued
						? execute('palette', name, input, callOptions ?? {}, fields)
						: run('palette', name, input, callOptions, fields),
				clock: () => options.clock?.() ?? Date.now(),
			});
			keybindings = createKeybindings(SHELL_KEYBINDINGS_V0, apps.keybindings);
		} catch (cause) {
			// A chunk that does not load refuses every app, and never the shell (D66).
			reportKernelError(cause);
			fallBack(runtimeUnavailable(String((cause as Error)?.message ?? cause)));
		}
	}

	/**
	 * Stage B, once (phase 2 specification, 2.2): the late commands, then each package's manifest, read
	 * and validated, and the app commands. After stage A, a manifest that differs from its boot record
	 * wins, keeping what `hydrate` loaded where it still validates. It never rejects.
	 */
	function startApps(): Promise<void> {
		stageB ??= (async () => {
			await loadLate();
			await loadAppsStage();
			if (hydrated) {
				await state.hydrateLate();
				state.forgetUnlisted(new Set(apps.summaries().map((app) => app.instance)));
				apps.reconcileLayouts();
			}
			setAppCommands(apps.commands);
		})()
			.catch((cause: unknown) => {
				stageBError = cause;
				reportKernelError(cause);
				lateFailure = { ...lateUnavailable(), message: String((cause as Error)?.message ?? cause) };
			})
			.finally(() => {
				stageBEnded = true;
				endStageB();
			});
		return stageB;
	}

	const listeners = new Set<(event: KernelEventV1) => void>();
	const traceBase = `loam-${Math.floor(options.clock?.() ?? Date.now()).toString(36)}`;
	let calls = 0;
	let disposed = false;

	/**
	 * A name stage A does not hold waits for stage B, so a chord or an agent's first call runs a moment
	 * later, and so does any call made while one waits, so calls run and are journaled in the order they
	 * were made. `NEEDS_STAGE_B`'s names are all late, so stage A never registers them and they wait here
	 * too. A nested call (an app's, through `runAs`) runs inside its parent, which may hold the queue, so
	 * it never joins it, and nor does boot's own work (`BOOT_FIELDS`), which stage B runs from inside
	 * `startApps`. The trade-off: while the queue drains, one slow call holds every call behind it. Once
	 * stage B has ended and the queue is empty, calls run concurrently again, as before phase 2.
	 */
	function run<T>(
		iface: KernelInterfaceV0,
		name: string,
		input: unknown,
		callOptions: CallOptionsV1 = {},
		fields: KernelCallFields = {}
	): Promise<CommandResult<T>> {
		const go = () => execute<T>(iface, name, input, callOptions, fields);
		if (
			disposed ||
			fields.parent ||
			fields === BOOT_FIELDS ||
			!(queue || (!stageBEnded && !mutations.has(name)))
		)
			return go();
		const mine = (queue ?? startApps()).then(go);
		const drained = () => {
			if (queue === tail) queue = undefined;
		};
		const tail: Promise<unknown> = mine.then(drained, drained);
		queue = tail;
		return mine;
	}

	async function execute<T>(
		iface: KernelInterfaceV0,
		name: string,
		input: unknown,
		callOptions: CallOptionsV1,
		fields: KernelCallFields
	): Promise<CommandResult<T>> {
		if (disposed) {
			return failure({
				code: 'KERNEL_DISPOSED',
				message: 'The kernel was disposed',
				suggestion: 'Create a new kernel with createKernel',
				retryable: false,
			});
		}
		if (lateFailure && !mutations.has(name)) return failure(lateFailure);
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

	setAppCommands([]);
	if (boot) {
		// Stage A: each app's layout record from its boot record, then the persisted state, before the
		// first frame. Nothing but display comes of a record (2.2).
		for (const app of boot.apps) {
			const { initial, declared } = firstLayoutOf(app.parts, app.layout);
			state.registerAppLayout(app.instance, initial, declared);
		}
		await state.hydrate();
		hydrated = true;
		apps = bootApps(boot);
	} else {
		// No boot, as in every test and the test kit: stage B runs before `createKernel` resolves, so
		// `createKernel({ deployment, ports })` keeps phase 1's meaning, and so does a replay.
		await startApps();
		// A refused name rejects `createKernel` here, as phase 0 has it; in the background it is kept.
		if (stageBError instanceof LoamKernelError) throw stageBError;
		await state.hydrate();
		apps.reconcileLayouts();
	}

	const kernel: LoamKernelV2 = {
		version: 2,
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
		startApps,
		appsReady,
		get lateFailure() {
			return lateFailure;
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
			// Stage B will not run now, so nothing waiting on it is left waiting.
			stageB ??= appsReady;
			endStageB();
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
			overlays?.reset();
			apps.resetSession();
		},
		runBoot: (name, input) => run('palette', name, input, {}, BOOT_FIELDS),
	};
}

/**
 * Create the kernel: check every command name, build the palette and agent registries over the same
 * commands and journal, and hydrate the view state from `store` before resolving. With `boot` it resolves
 * after stage A, holding only the boot commands and the boot records, and `startApps` runs stage B: the
 * late commands and the deployment's packages (phase 2 specification, 2.2). With no `boot` it runs stage
 * B first. A bad app never rejects it: it is reported in `app-list`.
 *
 * @throws LoamKernelError `COMMAND_NAME_INVALID` for a name that is not domain-action kebab-case,
 *   `COMMAND_NAME_DUPLICATE` for a name given twice
 */
export async function createKernel(options: KernelOptionsV2): Promise<LoamKernelV2> {
	return (await createKernelParts(options)).kernel;
}
