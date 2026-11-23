/**
 * @fileoverview A mounted command only a person may run (Loam phase 5 specification, 7.2; D146), the mounted chunk's
 * part: which of an instance's commands the shell may release, the hold on the instance, the approval token taken out
 * of every result, and the one retry that presents it.
 *
 * **The token.** A server that names Loam an approver (AFD's "Approval evidence from an approver client") answers a
 * held call `APPROVAL_REQUIRED` with `details.approvalToken`. {@link takeToken} reads it from the transport's answer and
 * {@link withoutTokens} removes every `approvalToken` key from the result, for every instance and caller, before
 * anything else sees it, so a token is never in a result, the journal, the store, a log or a port message. It lives in
 * one call's memory: the confirmed run that received it retries once with it in `_meta["dev.afd/approval"]`, and drops
 * it. A token from any other call is dropped unused.
 *
 * **Released.** A command is released when its instance entry says `approvals = "shell"`, the entry gives the command a
 * `preview` that names a read the instance reported, and the instance's lane carries an approval by its transport's own
 * word (the desktop's `stdio` and `http` lanes opened on MCP 2026-07-28, the only era on which AFD accepts the key). Anything else held by its server answers `MOUNT_APPROVAL_UNAVAILABLE`.
 *
 * **The hold.** From a person's confirm until its outcome is stored, every other call to the instance waits; the
 * confirmation's own run and its preview reads pass, known by the confirmation's id on the call, never by a trace. A hold
 * lasts at most {@link HOLD_MS}.
 */

import type { CommandContext } from '@lushly-dev/afd-core';
import type { ProjectionAppV1 } from '@lushly-dev/loam-manifest';
import { kernelFailure } from '../errors.js';

/** The era on which AFD accepts an approver's `_meta` key (its rule 3). */
export const APPROVER_PROTOCOL = '2026-07-28';
/** `_meta` key an approver sets on the retry a person approved (AFD's `AFD_APPROVAL_META_KEY`). */
export const APPROVAL_META_KEY = 'dev.afd/approval';
/** A hold's longest life: a mounted call's deadline (7.2). */
export const HOLD_MS = 60_000;

/**
 * Set on a confirmed run's context by the shell's release (kernel-only, never a context field): the confirmation it
 * runs for, the hold it took, and the deadline the hold sets every call of the run.
 */
export const RELEASING = Symbol.for('dev.loam/releasing');

export interface ReleasingV1 {
	confirmation: string;
	signal: AbortSignal;
}

/** What the entry says of one command: the read that shows the person what it will do (7.2). */
export interface PreviewSpecV1 {
	command: string;
	input: readonly string[];
}

/** One read of a preview, as the kernel shows it. */
export interface PreviewReadV1 {
	command: string;
	/** The held call's input, narrowed to the keys the entry lists. */
	input: Record<string, unknown>;
	/** The preview's data, as its server returned it, for the person alone. */
	data: unknown;
	labels: 'whole' | 'per-part';
}

/** What a mounted owner carries for a command the shell may release (7.2). */
export interface MountReleaseV1 {
	preview: PreviewSpecV1;
	/**
	 * Why it cannot be released now, or undefined when it can: `preview`, the preview names no read the instance
	 * reported that is callable on its own; `era`, the instance's lane does not carry an approval (only the desktop's
	 * `stdio` and `http` lanes opened on MCP 2026-07-28 do, by the transport's own word, never the server's).
	 */
	blocked(): 'preview' | 'era' | undefined;
	/**
	 * Read the preview as the call's person, now, passing a hold `holder` holds, within `signal` when given. A held input
	 * missing one of the preview's keys reads nothing (`preview-input`): the person would see another target.
	 */
	read(
		input: unknown,
		context: CommandContext,
		holder?: string,
		signal?: AbortSignal
	): Promise<{ ok: true; read: PreviewReadV1 } | { ok: false; code: string }>;
	/** Hold the instance for `confirmation`, at most {@link HOLD_MS}: every other call waits until `release`. */
	hold(confirmation: string): Promise<{ release(): void; signal: AbortSignal }>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** The preview an entry names for `command`, when the entry says `approvals = "shell"` (7.2). */
export function previewSpecOf(entry: ProjectionAppV1, command: string): PreviewSpecV1 | undefined {
	if ((entry as { approvals?: unknown }).approvals !== 'shell') return undefined;
	const named = entry.commands?.[command] as { preview?: unknown } | undefined;
	const preview = named?.preview;
	if (!isRecord(preview) || typeof preview.command !== 'string' || !Array.isArray(preview.input))
		return undefined;
	const input = preview.input.filter((key): key is string => typeof key === 'string');
	return input.length > 0 ? { command: preview.command, input } : undefined;
}

/** The held call's input narrowed to the preview's keys, or undefined when it lacks one of them. */
export function previewInput(
	spec: PreviewSpecV1,
	input: unknown
): Record<string, unknown> | undefined {
	const given = isRecord(input) ? input : {};
	if (!spec.input.every((key) => Object.hasOwn(given, key))) return undefined;
	return Object.fromEntries(spec.input.map((key) => [key, given[key]]));
}

/**
 * The token of an approver's held answer: a string at `error.details.approvalToken` of a failed `APPROVAL_REQUIRED`
 * body. Read from the transport's answer, which nothing keeps.
 */
export function takeToken(body: unknown): string | undefined {
	if (!isRecord(body) || body.success !== false || !isRecord(body.error)) return undefined;
	if (body.error.code !== 'APPROVAL_REQUIRED' || !isRecord(body.error.details)) return undefined;
	const token = body.error.details.approvalToken;
	return typeof token === 'string' && token.length > 0 && token.length <= 8_192 ? token : undefined;
}

/**
 * `value` with every `approvalToken` key removed at any depth, by a walk with no recursion (a result may nest past the
 * stack). Copies only what holds one, so a result with none is returned as it is.
 */
export function withoutTokens<T>(value: T): T {
	if (!holdsToken(value)) return value;
	const copy = structuredClone(value) as unknown;
	const stack: unknown[] = [copy];
	while (stack.length > 0) {
		const item = stack.pop();
		if (typeof item !== 'object' || item === null) continue;
		if (!Array.isArray(item)) delete (item as Record<string, unknown>).approvalToken;
		for (const child of Object.values(item)) stack.push(child);
	}
	return copy as T;
}

function holdsToken(value: unknown): boolean {
	const stack: unknown[] = [value];
	while (stack.length > 0) {
		const item = stack.pop();
		if (typeof item !== 'object' || item === null) continue;
		if (!Array.isArray(item) && Object.hasOwn(item, 'approvalToken')) return true;
		for (const child of Object.values(item)) stack.push(child);
	}
	return false;
}

/** 5.1's walk bounds (`copilot/labels.ts`'s `WALK_DEPTH` and `WALK_NODES`), which this chunk does not import. */
const LABEL_WALK_DEPTH = 32;
const LABEL_WALK_NODES = 10_000;

/**
 * Whether 5.1's walk could not read a preview's `data` whole, read as the label check reads a result: from the result's
 * shown parts, so `data` and `error` are at level 1, every node counted and none past {@link LABEL_WALK_DEPTH}, and a part labelled
 * `"trust": "content"` one node with everything beneath it (#2137: the bound is the label check's exactly).
 */
export function pastLabelWalk(data: unknown, error?: unknown): boolean {
	// The shown parts' wrapper at level 0, its `data` and its `error`, as `labels.ts`'s `shownOf` gives them: a successful
	// result may carry an `error` too.
	const stack: Array<[unknown, number]> = [
		[data, 1],
		[error, 1],
	];
	let nodes = 1;
	while (stack.length > 0) {
		const [item, depth] = stack.pop() as [unknown, number];
		nodes += 1;
		if (nodes > LABEL_WALK_NODES || depth > LABEL_WALK_DEPTH) return true;
		if (typeof item !== 'object' || item === null) continue;
		if (isRecord(item) && item.trust === 'content') continue;
		for (const child of Object.values(item)) stack.push([child, depth + 1]);
	}
	return false;
}

/** Whether a call is the hold's own: its confirmed run, or a preview read for it, by the confirmation's id. */
export function holdsFor(context: CommandContext | undefined, confirmation: string): boolean {
	const call = context as (CommandContext & { confirmation?: unknown }) | undefined;
	const releasing = (call as Record<symbol, unknown> | undefined)?.[RELEASING] as
		| ReleasingV1
		| undefined;
	return call?.confirmation === confirmation || releasing?.confirmation === confirmation;
}

/** Wait for `done`, or reject when `signal` ends first. */
function until(done: Promise<void>, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<void>((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener('abort', abort, { once: true });
		void done.then(() => {
			signal.removeEventListener('abort', abort);
			resolve();
		});
	});
}

/**
 * One instance's hold (7.2): one confirmation at a time, claimed with no await between its check and its claim; every
 * other call waits for its end, and the calls admitted before it are drained before it is given, so nothing another
 * caller sent can land between the preview's second read and the send.
 */
export function createInstanceHold(
	clockTimeout: (ms: number) => AbortSignal = AbortSignal.timeout
) {
	let current:
		| { confirmation: string; done: Promise<void>; end(): void; signal: AbortSignal }
		| undefined;
	/** The calls admitted while no hold was held, still running. */
	let inflight = 0;
	let drained: { promise: Promise<void>; resolve(): void } | undefined;

	const own = (context: CommandContext | undefined, holder: string | undefined): boolean =>
		current !== undefined &&
		(holder === current.confirmation || holdsFor(context, current.confirmation));

	/**
	 * Admit one call, waiting while another confirmation holds the instance, within the call's `signal`. Returns its
	 * leave, called once it ends; the hold's own calls are never counted.
	 */
	async function enter(
		context: CommandContext | undefined,
		signal: AbortSignal,
		holder?: string
	): Promise<() => void> {
		for (;;) {
			if (own(context, holder)) return () => {};
			if (!current) break;
			await until(current.done, signal);
		}
		inflight += 1;
		let left = false;
		return () => {
			if (left) return;
			left = true;
			inflight -= 1;
			if (inflight === 0 && drained) {
				drained.resolve();
				drained = undefined;
			}
		};
	}

	return {
		enter,
		/** Whether `confirmation` holds the instance now. */
		holds: (confirmation: string): boolean => current?.confirmation === confirmation,
		/** Wait until no hold is held, within `signal`: a rediscovery never replaces a held connection. */
		async idle(signal: AbortSignal): Promise<void> {
			while (current) await until(current.done, signal);
		},
		async hold(confirmation: string): Promise<{ release(): void; signal: AbortSignal }> {
			const signal = clockTimeout(HOLD_MS);
			// Another confirmation's hold first: one decision at a time, each within its own deadline.
			while (current && current.confirmation !== confirmation) await until(current.done, signal);
			if (signal.aborted) throw signal.reason;
			let end = () => {};
			const done = new Promise<void>((resolve) => {
				end = resolve;
			});
			const mine = { confirmation, done, end, signal };
			current = mine;
			const release = () => {
				if (current === mine) current = undefined;
				mine.end();
			};
			// At most HOLD_MS: the hold ends with its deadline, whatever the run is doing.
			signal.addEventListener('abort', release, { once: true });
			// The calls admitted before the claim finish first.
			if (inflight > 0) {
				if (!drained) {
					let resolve = () => {};
					const promise = new Promise<void>((done) => {
						resolve = done;
					});
					drained = { promise, resolve };
				}
				try {
					await until(drained.promise, signal);
				} catch (cause) {
					release();
					throw cause;
				}
			}
			return { release, signal };
		},
	};
}

export type InstanceHold = ReturnType<typeof createInstanceHold>;

/** A read a preview may name: reported, no mutation, not destructive, and not itself held for approval. */
export function releasableRead(
	read: { mutation: boolean; destructive: boolean; approval?: 'required' } | undefined
): boolean {
	return read !== undefined && !read.mutation && !read.destructive && read.approval !== 'required';
}

/**
 * The version a server answered, in the kernel's words only when it is a version's shape (`YYYY-MM-DD`): a server
 * chooses the string, so any other is never quoted (#2137's re-review).
 */
function laneVersion(version: string): string {
	return /^\d{4}-\d{2}-\d{2}$/.test(version)
		? `MCP ${version}`
		: 'an MCP version Loam does not know';
}

/** What discovery tells the deployer of an entry's releases (7.2): each is the instance's warning, with a fix. */
export function releaseWarnings(
	entry: ProjectionAppV1,
	commands: ReadonlyArray<{
		name: string;
		mutation: boolean;
		destructive: boolean;
		approval?: 'required';
		inputSchema?: unknown;
	}>,
	protocolVersion: string,
	/** Whether the instance's lane carries an approval, by its transport's word. */
	carries: boolean
): Array<{ code: string; message: string; suggestion: string }> {
	if ((entry as { approvals?: unknown }).approvals !== 'shell') return [];
	const found: Array<{ code: string; message: string; suggestion: string }> = [];
	const byName = new Map(commands.map((command) => [command.name, command]));
	for (const command of commands) {
		const spec = previewSpecOf(entry, command.name);
		if (command.approval === 'required' && !spec) {
			found.push({
				code: 'INSTANCE_APPROVAL_UNRELEASED',
				message: `\`${command.name.slice(0, 256)}\` needs a person's approval, and its entry names no preview, so Loam never releases it.`,
				suggestion: `Give it \`commands."${command.name.slice(0, 256)}".preview = { command = "<a read of this instance>", input = ["<key>"] }\`.`,
			});
		}
		const target = spec ? byName.get(spec.command) : undefined;
		const properties = (command.inputSchema as { properties?: unknown } | undefined)?.properties;
		const missing = spec?.input.filter(
			(key) => !isRecord(properties) || !Object.hasOwn(properties, key)
		);
		if (spec && missing && missing.length > 0) {
			found.push({
				code: 'INSTANCE_PREVIEW_INVALID',
				message: `The preview of \`${command.name.slice(0, 256)}\` reads \`${missing.join(', ').slice(0, 256)}\`, which its input does not name, so Loam refuses it before asking.`,
				suggestion:
					"List under `preview.input` only keys of the command's own input, as its server reports it.",
			});
		}
		if (spec && !releasableRead(target)) {
			found.push({
				code: 'INSTANCE_PREVIEW_INVALID',
				message: `The preview of \`${command.name.slice(0, 256)}\` names \`${spec.command.slice(0, 256)}\`, which is not a read this instance reported.`,
				suggestion:
					'Name a read of the same instance, by its final name, that shows what the command will do.',
			});
		}
	}
	if (!carries) {
		found.push({
			code: 'INSTANCE_APPROVALS_UNAVAILABLE',
			message: `This instance's lane (${laneVersion(protocolVersion)}) carries no person's approval: only the desktop's \`stdio\` and \`http\` lanes on ${APPROVER_PROTOCOL} do, so no command is released.`,
			suggestion:
				'Mount it on the desktop, whose `stdio` and `http` lanes speak MCP 2026-07-28 for an `approvals = "shell"` instance, or set `approvals = "none"`.',
		});
	}
	return found;
}

/**
 * Whether an input holds the key `dev.afd/approval` at any depth (7.2's "Nothing else sets the key"): the kernel builds
 * every message to a mount, and an agent, a view, an app or the console gives an input, never `_meta`. Iterative, as
 * AFD's own check is, so deep input cannot overflow the stack.
 */
export function holdsApprovalKey(input: unknown): boolean {
	const stack: unknown[] = [input];
	const seen = new Set<object>();
	while (stack.length > 0) {
		const item = stack.pop();
		if (typeof item !== 'object' || item === null || seen.has(item)) continue;
		seen.add(item);
		if (!Array.isArray(item) && Object.hasOwn(item, APPROVAL_META_KEY)) return true;
		for (const child of Object.values(item)) stack.push(child);
		// A parser that builds objects by assignment makes a `__proto__` member the prototype, as AFD's check walks too.
		const prototype: unknown = Object.getPrototypeOf(item);
		if (prototype !== null && prototype !== Object.prototype && prototype !== Array.prototype)
			stack.push(prototype);
	}
	return false;
}

/**
 * A confirmed run whose hold ended before its outcome (7.2's 60 s): what was sent may have run at the server, so the
 * person is told to look before asking again, never offered a retry (the trust review's B8, I5).
 */
export function heldEnded() {
	return kernelFailure(
		'MOUNT_UNREACHABLE',
		'The instance did not answer within the 60 seconds a held call may take: it may or may not have run at the server',
		'Check at the server what happened (for mail, its sent list) before you ask for it again; Loam does not retry it.',
		{ retryable: false }
	);
}
