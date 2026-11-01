/**
 * @fileoverview `createKernel`: two direct registries over the same commands and the same
 * middleware instances, name refusal, the journal options and the view-state hydration
 * (phase 0 specification, 6.1 to 6.5).
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
import { createShellCommands, SHELL_EXPOSE } from './commands.js';
import { LoamKernelError } from './errors.js';
import { keybindingFor } from './keybindings.js';
import { createPaletteIndex, type PaletteIndex } from './palette-index.js';
import { registerShellState } from './shell-state.js';
import type {
	CallOptionsV0,
	CommandSummaryV0,
	KernelEventV0,
	KernelOptionsV0,
	LoamKernelV0,
} from './types.js';

/** The kernel's two interfaces, one registry each. */
export type KernelInterfaceV0 = KernelEventV0['interface'];

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

/**
 * Whether a command's JSON Schema needs input: it has a required property, or every branch of a
 * union does.
 */
function needsInput(schema: unknown): boolean {
	if (typeof schema !== 'object' || schema === null) return false;
	const record = schema as { required?: unknown; anyOf?: unknown; oneOf?: unknown };
	if (Array.isArray(record.required) && record.required.length > 0) return true;
	const branches = Array.isArray(record.anyOf)
		? record.anyOf
		: Array.isArray(record.oneOf)
			? record.oneOf
			: undefined;
	return branches !== undefined && branches.length > 0 && branches.every(needsInput);
}

function summarize(registry: DirectCommandRegistry): CommandSummaryV0[] {
	return registry.listCommands().map((command) => {
		const keybinding = keybindingFor(command.name);
		return {
			name: command.name,
			...(command.title !== undefined ? { title: command.title } : {}),
			description: command.description,
			mutation: command.mutation === true,
			needsInput: needsInput(command.inputSchema),
			...(keybinding !== undefined ? { keybinding } : {}),
		};
	});
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
	kernel: LoamKernelV0;
	registries: Record<KernelInterfaceV0, DirectCommandRegistry>;
}

/** Build a kernel and expose its registries, for replay. Not part of the kernel interface. */
export async function createKernelParts(options: KernelOptionsV0): Promise<KernelParts> {
	const { environment } = options;
	const viewState = new ViewStateRegistry({ adapter: options.store });
	const state = registerShellState(viewState);

	let index: PaletteIndex | undefined;
	const shell = createShellCommands({
		viewState,
		state,
		environment,
		auth: options.auth,
		host: options.host,
		storeKind: options.storeKind,
		search: (query, limit) => {
			index ??= createPaletteIndex(summarize(registries.palette));
			return index.search(query, limit);
		},
	});
	const extra = options.commands ?? [];

	// Name refusal comes first: a bad name never reaches a registry.
	checkNames([...shell, ...extra]);

	const commands: ZodCommandDefinition[] = [
		...shell.map((command) => ({ ...command, expose: { ...SHELL_EXPOSE } })),
		...extra,
	];
	const mutations = new Map(commands.map((command) => [command.name, command.mutation === true]));

	const seqs = new Map<string, number>();
	// One instance of each, shared by both registries, so they share one journal sequence.
	const middleware: CommandMiddleware[] = [
		createAuthMiddleware(options.auth, { exclude: commands.map((command) => command.name) }),
		createJournalMiddleware(seqTrackingSink(options.journal, seqs), kernelJournalOptions()),
	];
	const clock = options.clock ? { now: options.clock } : undefined;
	const random = options.random ? { next: options.random } : undefined;
	const build = (iface: KernelInterfaceV0) =>
		createDirectRegistry(commands, {
			interface: iface,
			middleware,
			...(clock ? { clock } : {}),
			...(random ? { random } : {}),
		});
	const registries: Record<KernelInterfaceV0, DirectCommandRegistry> = {
		palette: build('palette'),
		agent: build('agent'),
	};

	await state.hydrate();

	const listeners = new Set<(event: KernelEventV0) => void>();
	const traceBase = `loam-${Math.floor(options.clock?.() ?? Date.now()).toString(36)}`;
	let calls = 0;
	let disposed = false;

	async function run<T>(
		iface: KernelInterfaceV0,
		name: string,
		input: unknown,
		callOptions: CallOptionsV0 = {}
	): Promise<CommandResult<T>> {
		if (disposed) {
			return failure({
				code: 'KERNEL_DISPOSED',
				message: 'The kernel was disposed',
				suggestion: 'Create a new kernel with createKernel',
				retryable: false,
			});
		}
		const traceId = `${traceBase}-${++calls}`;
		const context: CommandContext = {
			traceId,
			...(callOptions.signal !== undefined ? { signal: callOptions.signal } : {}),
		};
		const result = await registries[iface].execute<T>(name, input ?? {}, context);
		const seq = seqs.get(traceId);
		seqs.delete(traceId);
		const event: KernelEventV0 = {
			command: name,
			interface: iface,
			success: result.success,
			mutation: mutations.get(name) ?? false,
			...(seq !== undefined ? { seq } : {}),
		};
		for (const listener of [...listeners]) {
			try {
				listener(event);
			} catch (error) {
				reportKernelError(error);
			}
		}
		return result;
	}

	const kernel: LoamKernelV0 = {
		version: 0,
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
		async flush() {
			if (!disposed) await viewState.flush();
		},
		async dispose() {
			if (disposed) return;
			disposed = true;
			listeners.clear();
			await viewState.destroy();
		},
	};
	return { kernel, registries };
}

/**
 * Create the kernel: check every command name, build the palette and agent registries over the
 * same commands and middleware, and hydrate the view state from `store` before resolving.
 *
 * @throws LoamKernelError `COMMAND_NAME_INVALID` for a name that is not domain-action kebab-case,
 *   `COMMAND_NAME_DUPLICATE` for a name given twice
 */
export async function createKernel(options: KernelOptionsV0): Promise<LoamKernelV0> {
	return (await createKernelParts(options)).kernel;
}
