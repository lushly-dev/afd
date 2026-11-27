/**
 * @fileoverview Labels per part (phase 5 specification, 5.1; D144): what of a command's result is content written by
 * someone other than the person or the server, and so taints a copilot session (5.3), and what is the server's own
 * claim. The instance entry decides, never the server: a mounted result is `content` whole unless its entry says
 * `labels = "per-part"`, and then only when the server sent structured data the walk can read whole. A server's label
 * only narrows: nothing it sends makes a part `trusted`.
 *
 * And 4.5's tools: what the model is told of a mounted instance's commands. A `per-part` instance's descriptions are
 * its claims; a `whole` instance says nothing of its own, its schema cut to structural keywords whose every string is
 * a plain identifier.
 *
 * In the `late-copilot` chunk; it imports types alone.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { LoamKernelErrorCode } from '../errors.js';

/** The walk's bounds (5.1): past them a result is `content` whole. */
export const WALK_DEPTH = 32;
export const WALK_NODES = 10_000;

/** How a result is given to the model (5.2): as the shell's, as a vouched server's claims, or as content whole. */
export type LabelModeV1 = 'trusted' | 'per-part' | 'whole';

/** A result's labels, as the turn's call records them (3.4) and taint reads them (5.3). */
export interface ResultLabelsV1 {
	mode: LabelModeV1;
	/** The instance, or `shell`, whose value this is. */
	source: string;
	/** Parts by label (3.4's `labels`). */
	counts: { content: number; server: number; trusted: number };
	/** The sources whose content entered: the session is tainted from each (5.3). */
	sources: string[];
	/** A unit's result (7.3), which the parent is never given, so its content taints nothing. */
	unit?: true;
}

/** What labelling needs to know of the command that answered. */
export interface LabelledCommandV1 {
	/** The owning instance, or undefined for the shell's. */
	instance?: string | undefined;
	mounted: boolean;
	/** A mounted instance's entry: `whole` by default. */
	labels?: 'whole' | 'per-part' | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The parts labelled `"trust": "content"` in `value`, by a walk with no recursion, at most {@link WALK_DEPTH} levels
 * and {@link WALK_NODES} nodes. A labelled object is one part with everything beneath it. `overflow` when the walk
 * could not read it whole.
 */
export function contentParts(value: unknown): { parts: number; overflow: boolean } {
	const stack: Array<[unknown, number]> = [[value, 0]];
	let nodes = 0;
	let parts = 0;
	while (stack.length > 0) {
		const [item, depth] = stack.pop() as [unknown, number];
		nodes += 1;
		if (nodes > WALK_NODES || depth > WALK_DEPTH) return { parts, overflow: true };
		if (typeof item !== 'object' || item === null) continue;
		if (isRecord(item) && item.trust === 'content') {
			parts += 1;
			continue;
		}
		for (const child of Object.values(item)) stack.push([child, depth + 1]);
	}
	return { parts, overflow: false };
}

/** A code the kernel answers in its own words: its own, or AFD's registry's refusal of an unexposed command. */
export type KernelAnswerCode = LoamKernelErrorCode | 'COMMAND_NOT_EXPOSED';

/**
 * The kernel's own refusals and answers for a mounted command, which say nothing of its server's (the review's B9): any
 * other result of a mounted command is the server's, a stored outcome answered again or a cached one included. Typed to
 * the kernel's codes, so a code no kernel path answers cannot join it (#2137).
 */
export const KERNEL_ANSWERS: ReadonlySet<KernelAnswerCode> = new Set<KernelAnswerCode>([
	'CONFIRMATION_PENDING',
	'CONFIRMATION_DECLINED',
	'AUTONOMY_SUGGEST_ONLY',
	'AUTONOMY_UNAVAILABLE',
	'HUMAN_REQUIRED',
	'OWNER_REQUIRED',
	'PROJECT_NOT_FOUND',
	'CALL_NOT_GRANTED',
	'CALL_ABORTED',
	'RATE_LIMITED',
	'INPUT_TOO_LARGE',
	'VALIDATION_ERROR',
	'COMMAND_NOT_FOUND',
	'COMMAND_NOT_EXPOSED',
	'MOUNT_UNREACHABLE',
	// The kernel's own answer to an instance's 401 or 403, in its words alone (phase 6's step 6 follow-up, #2137).
	'MOUNT_UNAUTHORIZED',
	'MOUNT_KEYCHAIN_MISSING',
	'MOUNT_TIMEOUT',
	'MOUNT_RESULT_INVALID',
	'MOUNT_NOT_AFD',
	'MOUNT_PROJECT_NOT_LISTED',
	'MOUNT_SPACE_PINNED',
	'SCOPE_PROJECT_REQUIRED',
	'SESSION_CHANGED',
	'KERNEL_DISPOSED',
	'CONFIRMATION_EXPIRED',
	'AUTONOMY_ABOVE_CEILING',
	// The hosted relay's own refusals (phase 6 specification, 8.1): `mount.ts` carries only their code, under the relay's
	// mark, and the kernel answers each in its own words, so none is the server's. An instance's own result with one of
	// these codes carries `parseMountedResult`'s marks and stays the server's.
	'REQUEST_NOT_SAME_ORIGIN',
	'REQUEST_INVALID',
	'REQUEST_TOO_LARGE',
	'INSTANCE_UNKNOWN',
	'MOUNT_BATCH_REFUSED',
	'MOUNT_METHOD_REFUSED',
	'MOUNT_COMMAND_NOT_EXPOSED',
	'MOUNT_SESSION_UNKNOWN',
	'MOUNT_LIMIT',
	'WORKSPACE_NOT_MEMBER',
	'PROJECT_ARCHIVED',
	'UNAUTHORIZED',
	'AGENT_CANNOT_SIGN_IN',
]);

/** Set by phase 4's confirmations on a stored outcome answered again (`confirmation-parts.ts`'s `STORED`). */
const STORED = Symbol.for('dev.loam/stored');

/** The instance a mounted result names as its server, as only `parseMountedResult` sets it, or undefined. */
const serverOf = (result: CommandResult): string | undefined => {
	const metadata = (result as { metadata?: unknown }).metadata;
	return isRecord(metadata) &&
		metadata['dev.loam/trust'] === 'untrusted' &&
		typeof metadata['dev.loam/instance'] === 'string'
		? metadata['dev.loam/instance']
		: undefined;
};

/**
 * Whether a mounted command's result is its server's answer: it says so, or it is no kernel refusal of the command
 * (a stored outcome answered again carries no server's marks, the review's B9).
 */
const fromServer = (result: CommandResult, instance: string | undefined): boolean =>
	instance !== undefined &&
	(serverOf(result) === instance ||
		typeof (result as unknown as Record<symbol, unknown>)[STORED] === 'string' ||
		result.success === true ||
		!(KERNEL_ANSWERS as ReadonlySet<string>).has(String(result.error?.code ?? '')));

/**
 * The parts of a result the model is given: its data and error, never a server's metadata, which the agent port's half
 * never sends on (the review's B4).
 */
const shownOf = (result: CommandResult): unknown => ({
	data: (result as { data?: unknown }).data,
	error: result.error,
});

/** A result a server labelled `content` at its root, beside its data: every part of it is content. */
const rootContent = (result: CommandResult): boolean =>
	(result as { trust?: unknown }).trust === 'content';

/** 5.1's table for one result. */
export function labelResult(result: CommandResult, command: LabelledCommandV1): ResultLabelsV1 {
	const named = serverOf(result);
	// A server's answer names its instance, whatever the catalog holds by the time it returns (the review's B3).
	const mounted = command.mounted || named !== undefined;
	const instance = named ?? command.instance;
	const source = instance ?? 'shell';
	if (mounted && fromServer(result, instance)) {
		const structured =
			(result.metadata as Record<string, unknown> | undefined)?.['dev.loam/structured'] === true;
		const walked = contentParts(shownOf(result));
		// Read by the entry of the instance that answered: one the catalog swapped meanwhile is `whole` (the re-check).
		const vouched =
			command.labels === 'per-part' && (named === undefined || named === command.instance);
		if (vouched && structured && !walked.overflow && !rootContent(result)) {
			return {
				mode: 'per-part',
				source,
				counts: { content: walked.parts, server: 1, trusted: 0 },
				sources: walked.parts > 0 ? [source] : [],
			};
		}
		// The default: a mounted result is content whole (D41, D144), a text duplicate or a walk past its bounds too.
		return {
			mode: 'whole',
			source,
			counts: { content: 1, server: 0, trusted: 0 },
			sources: [source],
		};
	}
	const walked = contentParts(shownOf(result));
	if (walked.overflow || rootContent(result)) {
		return {
			mode: 'whole',
			source,
			counts: { content: 1, server: 0, trusted: 0 },
			sources: [source],
		};
	}
	return {
		mode: 'trusted',
		source,
		counts: { content: walked.parts, server: 0, trusted: 1 },
		sources: walked.parts > 0 ? [source] : [],
	};
}

/**
 * A result as the runtime is given it (5.2): its `success`, `data` and `error` alone, which is what the labels cover,
 * and the kernel's labels under a key set last. Nothing else a server sent (metadata, its own top-level keys) crosses
 * the agent port (the review's B4).
 */
export function forRuntime(
	result: CommandResult,
	labels: Pick<ResultLabelsV1, 'mode' | 'source'> | undefined
): CommandResult {
	const data = (result as { data?: unknown }).data;
	return {
		success: result.success,
		...(data !== undefined ? { data } : {}),
		...(result.error !== undefined ? { error: result.error } : {}),
		'dev.loam/labels': labels
			? { mode: labels.mode, source: labels.source }
			: { mode: 'trusted', source: 'shell' },
	} as CommandResult;
}

/** Several labels as one: a call and the calls nested in it (5.3), or a stored outcome with its run's. */
export function mergeLabels(base: ResultLabelsV1, more: readonly string[]): ResultLabelsV1 {
	const sources = [...new Set([...base.sources, ...more])];
	return { ...base, sources };
}

// ─── 4.5's tools ─────────────────────────────────────────────────────────────────

/** Every string a `whole` server supplies that is kept matches this (4.5's identifier rule). */
export const IDENTIFIER = /^[A-Za-z0-9_.-]{1,64}$/;

const STRUCTURAL = new Set([
	'type',
	'properties',
	'required',
	'items',
	'enum',
	'additionalProperties',
	'minimum',
	'maximum',
	'exclusiveMinimum',
	'exclusiveMaximum',
	'multipleOf',
	'minLength',
	'maxLength',
	'minItems',
	'maxItems',
	'uniqueItems',
	'minProperties',
	'maxProperties',
	'$defs',
	'$ref',
]);
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const LOCAL_REF = /^#\/\$defs\/([A-Za-z0-9_.-]{1,64})$/;

class NotPlain extends Error {}

/**
 * A schema node with only 4.5's structural keywords, or {@link NotPlain} when a string kept is not an identifier. Not
 * `strict` (a `per-part` server's schema, whose words are its claims), its names and values are kept as sent, and only
 * its prose keywords go, since they would reach the model outside the claim's block (the review's I9).
 */
function structural(node: unknown, depth: number, strict = true): unknown {
	const plain = (value: string) => !strict || IDENTIFIER.test(value);
	if (depth > WALK_DEPTH) throw new NotPlain();
	if (typeof node === 'boolean') return node;
	if (!isRecord(node)) throw new NotPlain();
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(node)) {
		if (!STRUCTURAL.has(key)) continue;
		switch (key) {
			case 'type': {
				const types = Array.isArray(value) ? value : [value];
				if (!types.every((each) => typeof each === 'string' && TYPES.has(each)))
					throw new NotPlain();
				out.type = value;
				break;
			}
			case 'properties':
			case '$defs': {
				if (!isRecord(value)) throw new NotPlain();
				const kept: Record<string, unknown> = {};
				for (const [name, child] of Object.entries(value)) {
					if (!plain(name)) throw new NotPlain();
					kept[name] = structural(child, depth + 1, strict);
				}
				out[key] = kept;
				break;
			}
			case 'required': {
				if (
					!Array.isArray(value) ||
					!value.every((each) => typeof each === 'string' && plain(each))
				)
					throw new NotPlain();
				out.required = [...value];
				break;
			}
			case 'enum': {
				if (
					!Array.isArray(value) ||
					!value.every(
						(each) =>
							each === null ||
							typeof each === 'boolean' ||
							(typeof each === 'number' && Number.isFinite(each)) ||
							(typeof each === 'string' && plain(each))
					)
				)
					throw new NotPlain();
				out.enum = [...value];
				break;
			}
			case 'items':
			case 'additionalProperties':
				out[key] = structural(value, depth + 1, strict);
				break;
			case '$ref': {
				// Only a local `#/$defs/<identifier>`; a remote reference is dropped (4.5).
				if (typeof value === 'string' && LOCAL_REF.test(value)) out.$ref = value;
				else if (typeof value === 'string' && value.startsWith('#')) throw new NotPlain();
				break;
			}
			default:
				if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
				else if (typeof value === 'boolean' && key === 'uniqueItems') out[key] = value;
				break;
		}
	}
	return out;
}

/** A tool as 4.5 gives it to the model, with whose word its description is. */
export interface CopilotToolV1 {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	/** A `per-part` instance's description: the server's claim, which the runtime blocks as such (5.2). */
	claim?: { source: string };
}

/** What 4.5 needs of a mounted command. */
export interface MountedToolV1 {
	name: string;
	instance: string;
	labels: 'whole' | 'per-part';
	/** The entry names it under `commands`: the deployer chose it. */
	named: boolean;
	/** The server's own description. */
	description: string;
	inputSchema: unknown;
	/** The deployer's words for the instance: its entry's or manifest's title and description. */
	deployerText: string;
}

/**
 * 4.5's listing of a mounted command, or undefined when it is not listed: a `per-part` instance's own description as
 * its claim and its schema's structural keywords, its names and values as sent; a `whole` instance's deployer text alone, with the schema cut to structural
 * keywords. A `whole` tool the deployer does not name and whose kept strings are not all identifiers is not listed;
 * one it names keeps its listing with `{ type: 'object' }`.
 */
export function mountedTool(tool: MountedToolV1): CopilotToolV1 | undefined {
	const schema = isRecord(tool.inputSchema) ? tool.inputSchema : { type: 'object' };
	if (tool.labels === 'per-part') {
		let kept: Record<string, unknown>;
		try {
			kept = structural(schema, 0, false) as Record<string, unknown>;
		} catch (cause) {
			if (!(cause instanceof NotPlain)) throw cause;
			kept = {};
		}
		return {
			name: tool.name,
			description: tool.description,
			inputSchema: { ...kept, type: 'object' },
			claim: { source: tool.instance },
		};
	}
	const plain = IDENTIFIER.test(tool.name);
	let cut: Record<string, unknown> | undefined;
	try {
		cut = plain ? (structural(schema, 0) as Record<string, unknown>) : undefined;
	} catch (cause) {
		if (!(cause instanceof NotPlain)) throw cause;
		cut = undefined;
	}
	if (cut === undefined && !tool.named) return undefined;
	return {
		name: tool.name,
		description: tool.deployerText || tool.name,
		inputSchema: cut ? { ...cut, type: 'object' } : { type: 'object' },
	};
}

/**
 * 4.5's list: `commands` less those `excluded`, each mounted one (`mountOf` gives its entry, `null` for one the kernel
 * cannot read, undefined for any other command) as {@link mountedTool} gives it, at most `max`.
 */
export function listTools(
	commands: ReadonlyArray<{ name: string; description: string; inputSchema?: unknown }>,
	excluded: (name: string) => boolean,
	mountOf: (
		name: string
	) => Omit<MountedToolV1, 'name' | 'description' | 'inputSchema'> | null | undefined,
	max: number
): CopilotToolV1[] {
	const tools: CopilotToolV1[] = [];
	for (const command of commands) {
		if (excluded(command.name)) continue;
		const inputSchema =
			command.inputSchema && typeof command.inputSchema === 'object'
				? (command.inputSchema as Record<string, unknown>)
				: { type: 'object' };
		const mount = mountOf(command.name);
		if (mount === null) continue;
		const listed = mount
			? mountedTool({ name: command.name, ...mount, description: command.description, inputSchema })
			: { name: command.name, description: command.description, inputSchema };
		if (listed) tools.push(listed);
		if (tools.length >= max) break;
	}
	return tools;
}
