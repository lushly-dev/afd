/**
 * @fileoverview The mounted kind (phase 1 specification, section 7): discovery through `afd-help` and
 * `afd-detail`, naming, exposure, pinning, and the commands a discovery registers. A mounted server is
 * untrusted (D65), so what it says sets display and defaults only, every field is read for what it is, and
 * no text it sends reaches an error's message: a refusal's body can name what a page should not hold.
 */

import {
	type CommandContext,
	type CommandError,
	type CommandResult,
	failure,
	type JournalRecord,
	success,
} from '@lushly-dev/afd-core';
import { defineCommand, type ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { ManifestV3, ProjectionAppV1, ProjectionMountedV1 } from '@lushly-dev/loam-manifest';
import { deriveMutation, mountCommandName } from '@lushly-dev/loam-manifest/validate';
import { z } from 'zod';
import type { CommandOwner } from '../apps-runtime.js';
import type { KernelFieldContext } from '../context-fields.js';
import { kernelFailure, type LoamKernelErrorCode, PAGE_DECIDED } from '../errors.js';
import type { KernelPorts, McpToolCallResult, MountTransport } from '../types.js';
import {
	APPROVAL_META_KEY,
	createInstanceHold,
	heldEnded,
	holdsApprovalKey,
	type MountReleaseV1,
	pastLabelWalk,
	previewInput,
	previewSpecOf,
	RELEASING,
	type ReleasingV1,
	releasableRead,
	releaseWarnings,
	takeToken,
	withoutTokens,
} from './mounted-release.js';
import type { AppRecord } from './operations.js';
import type { AppsHost } from './types.js';

export const DISCOVERY_DEADLINE_MS = 10_000;
export const MOUNTED_CALL_DEADLINE_MS = 60_000;
/** At most one automatic discovery per instance in this time (7.3). */
export const AUTO_DISCOVERY_MS = 30_000;
/** A name, as a warning repeats it. The rest of a server's text stays where it was sent. */
const WARNING_NAME_MAX = 256;
const DETAIL_BATCH = 10;

/**
 * What one discovery keeps of what a server says (9.9), so a server cannot make a list, a form or a journal
 * entry as large as it likes, and a catalog always fits the journal's bound and so always replays.
 */
export const DISCOVERY_LIMITS = Object.freeze({
	commands: 1_000,
	titleChars: 200,
	descriptionChars: 4_000,
	schemaBytes: 64 * 1024,
	/** Past this a recursive read of a schema or a result, here or in a browser's JSON, can overflow. */
	depth: 64,
	warnings: 20,
	catalogBytes: 200 * 1024,
});
/** A result nests more than a schema may, and past this `JSON.stringify` can overflow, losing its entry. */
const RESULT_DEPTH_MAX = 256;

export type MountFailureCode = Extract<
	LoamKernelErrorCode,
	| 'MOUNT_UNREACHABLE'
	| 'MOUNT_UNAUTHORIZED'
	| 'MOUNT_NOT_AFD'
	| 'MOUNT_TIMEOUT'
	| 'MOUNT_RESULT_INVALID'
	// The hosted relay's own refusals (phase 6 specification, 8.1), which a transport carries only when the relay marked
	// the answer as its own (`Loam-Relay-Refusal: 1`), each with the kernel's words below and never the relay's.
	| 'REQUEST_NOT_SAME_ORIGIN'
	| 'REQUEST_INVALID'
	| 'REQUEST_TOO_LARGE'
	| 'INSTANCE_UNKNOWN'
	| 'MOUNT_BATCH_REFUSED'
	| 'MOUNT_METHOD_REFUSED'
	| 'MOUNT_COMMAND_NOT_EXPOSED'
	| 'MOUNT_PROJECT_NOT_LISTED'
	| 'MOUNT_SPACE_PINNED'
	| 'MOUNT_SESSION_UNKNOWN'
	| 'MOUNT_LIMIT'
	| 'WORKSPACE_NOT_MEMBER'
	| 'PROJECT_NOT_FOUND'
	| 'PROJECT_ARCHIVED'
	| 'UNAUTHORIZED'
	| 'AGENT_CANNOT_SIGN_IN'
>;

/** The kernel's own words for each failure: never a server's or a transport's. */
const MOUNT_FAILURES: Readonly<
	Record<MountFailureCode, { message: string; suggestion: string; retryable: boolean }>
> = {
	MOUNT_UNREACHABLE: {
		message: 'The instance cannot be reached',
		suggestion: 'Is the instance running? A browser reaches it through the hosted server.',
		retryable: true,
	},
	MOUNT_UNAUTHORIZED: {
		message: 'The instance refused its credential',
		suggestion: "Check the deployment's credential reference; the token itself is never shown.",
		retryable: false,
	},
	MOUNT_NOT_AFD: {
		message: 'This server did not answer `afd-help` with a CommandResult',
		suggestion: 'Phase 1 mounts AFD servers; a plain MCP server arrives in phase 5.',
		retryable: false,
	},
	MOUNT_TIMEOUT: {
		message: 'The instance did not answer in time',
		suggestion: 'Retry, or run app-instance-refresh.',
		retryable: true,
	},
	MOUNT_RESULT_INVALID: {
		message: 'The server did not return a CommandResult',
		suggestion: "Report this to the server's owner.",
		retryable: false,
	},
	REQUEST_NOT_SAME_ORIGIN: {
		message: 'The hosted server refused a request that did not come from the shell',
		suggestion: 'Reload the shell; only its own page calls a mounted instance.',
		retryable: false,
	},
	REQUEST_INVALID: {
		message: 'The hosted server refused the request as malformed',
		suggestion: 'Reload the shell; if it happens again, report it.',
		retryable: false,
	},
	REQUEST_TOO_LARGE: {
		message: 'The request is over the hosted server’s size limit',
		suggestion: 'Send a smaller input.',
		retryable: false,
	},
	INSTANCE_UNKNOWN: {
		message: 'The hosted server serves no such instance',
		suggestion: "Check the deployment's instances, and that this one is enabled.",
		retryable: false,
	},
	MOUNT_BATCH_REFUSED: {
		message: 'The hosted server takes one message per request',
		suggestion: 'Send one message per request.',
		retryable: false,
	},
	MOUNT_METHOD_REFUSED: {
		message: 'The hosted server does not forward this method',
		suggestion: 'The shell sends only the methods a mounted call needs.',
		retryable: false,
	},
	MOUNT_COMMAND_NOT_EXPOSED: {
		message: 'This command is not exposed to the shell',
		suggestion: 'Ask the deployer to expose it.',
		retryable: false,
	},
	MOUNT_PROJECT_NOT_LISTED: {
		message: 'This instance does not serve this project',
		suggestion: 'Switch to a project this instance serves.',
		retryable: false,
	},
	MOUNT_SPACE_PINNED: {
		message: 'This project is pinned to its own space on this instance',
		suggestion: 'Switch project, or leave out `space` and `spaces`.',
		retryable: false,
	},
	MOUNT_SESSION_UNKNOWN: {
		message: 'The hosted server no longer knows this session',
		suggestion: 'Run it again; the shell starts a new session.',
		retryable: true,
	},
	MOUNT_LIMIT: {
		message: 'Too many calls to mounted instances are in flight',
		suggestion: 'Try again shortly.',
		retryable: true,
	},
	WORKSPACE_NOT_MEMBER: {
		message: 'You are not a member of this workspace',
		suggestion: 'Ask an owner to invite you.',
		retryable: false,
	},
	PROJECT_NOT_FOUND: {
		message: 'No project with this id exists',
		suggestion: 'Run project-list to see the projects you can enter.',
		retryable: false,
	},
	PROJECT_ARCHIVED: {
		message: 'This project is archived, so nothing in it changes',
		suggestion: 'Restore the project with project-restore, or work in another project.',
		retryable: false,
	},
	UNAUTHORIZED: {
		message: 'Authentication required',
		suggestion: 'Sign in again.',
		retryable: false,
	},
	AGENT_CANNOT_SIGN_IN: {
		message: 'An agent never signs in as a person',
		suggestion: 'Sign in again as a person; an agent connects over MCP.',
		retryable: false,
	},
};

const mountError = (code: MountFailureCode): CommandError & { code: MountFailureCode } => ({
	code,
	...MOUNT_FAILURES[code],
});

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const CODES: ReadonlySet<string> = new Set(Object.keys(MOUNT_FAILURES));

/** Every `MountFailureCode`: what a transport's rejection may carry, and the web host's `mount.ts` reads under the relay's mark. */
export const MOUNT_FAILURE_CODES: ReadonlySet<MountFailureCode> =
	CODES as ReadonlySet<MountFailureCode>;

/** Whether a JSON value nests past `limit`, by a walk with no recursion, since it may nest past the stack. */
function deeperThan(value: unknown, limit: number): boolean {
	const stack: Array<[unknown, number]> = [[value, 1]];
	while (stack.length > 0) {
		const [item, depth] = stack.pop() as [unknown, number];
		if (typeof item !== 'object' || item === null) continue;
		if (depth > limit) return true;
		for (const child of Object.values(item)) stack.push([child, depth + 1]);
	}
	return false;
}

const lengthOf = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * What a transport's rejection means. A port says so with `code`, and anything else cannot be told from a
 * network that failed. Its message is not read: an HTTP error's can hold the refusal's body.
 */
function failureOf(cause: unknown, signal: AbortSignal | undefined): MountFailureCode {
	if (signal?.aborted) return 'MOUNT_TIMEOUT';
	const code = (cause as { code?: unknown } | null | undefined)?.code;
	return typeof code === 'string' && CODES.has(code)
		? (code as MountFailureCode)
		: 'MOUNT_UNREACHABLE';
}

/** Settle with `signal` as well, so a port that ignores it cannot outlive a deadline. */
function raced<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener('abort', abort, { once: true });
		work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
	});
}

// ─── A result ───────────────────────────────────────────────────────────────────

function resultBody(result: McpToolCallResult): unknown {
	if (result.structuredContent !== undefined) return result.structuredContent;
	const text = Array.isArray(result.content)
		? result.content.find((part) => part?.type === 'text')?.text
		: undefined;
	if (typeof text !== 'string') return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** The server's metadata and error, without any mark only the kernel may set. */
function withoutLoamMarks(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('dev.loam/')));
}

/** A server's error, each field read for what it is. A shape a reader's `String()` cannot print goes. */
function readError(error: Readonly<Record<string, unknown>>): Record<string, unknown> {
	const { suggestion, retryable, details, ...rest } = error;
	return {
		...rest,
		...(typeof suggestion === 'string' ? { suggestion } : {}),
		...(typeof retryable === 'boolean' ? { retryable } : {}),
		...(isRecord(details) ? { details: withoutLoamMarks(details) } : {}),
	};
}

/**
 * A tool's answer as a `CommandResult`, labeled untrusted (7.3), keeping whatever else the server sent. A
 * server is untrusted, so a `dev.loam/` key of its own never survives: a forged seq or trust label, or
 * `dev.loam/page-decided`, would say something the kernel did not.
 */
export function parseMountedResult(result: McpToolCallResult, instance: string): CommandResult {
	// Every approval token goes first, for every instance and caller (phase 5 specification, 7.2).
	const body = withoutTokens(resultBody(result));
	const invalid = () =>
		kernelFailure(
			'MOUNT_RESULT_INVALID',
			MOUNT_FAILURES.MOUNT_RESULT_INVALID.message,
			MOUNT_FAILURES.MOUNT_RESULT_INVALID.suggestion
		);
	if (!isRecord(body) || typeof body.success !== 'boolean') return invalid();
	// One a journal could not write would lose the entry of a call that ran.
	if (deeperThan(body, RESULT_DEPTH_MAX)) return invalid();
	const { error, metadata } = body;
	if (
		!body.success &&
		!(isRecord(error) && typeof error.code === 'string' && typeof error.message === 'string')
	) {
		return invalid();
	}
	return {
		...body,
		...(isRecord(error) ? { error: readError(error) } : {}),
		metadata: {
			...(isRecord(metadata) ? withoutLoamMarks(metadata) : {}),
			'dev.loam/trust': 'untrusted',
			'dev.loam/instance': instance,
			'dev.loam/replay': 'recorded',
			// Whether the server sent structured data: a result read from its text duplicate is content whole, whatever
			// its entry's `labels` (phase 5 specification, 5.1).
			'dev.loam/structured': result.structuredContent !== undefined,
		},
	} as unknown as CommandResult;
}

/** A journal is not a mounted server's archive (7.6). */
export const RECORDED_RESULT_MAX_BYTES = 256 * 1024;
const RECORDED_TEXT_MAX = 2_000;

/**
 * What the journal keeps of an input the kernel's 256 KiB bound refused: its document's id only when it is one,
 * 1 to 128 characters; a refused value of any other size is left out too.
 */
export function oversizedInput(input: unknown): { document?: string } {
	const { document } = (input ?? {}) as { document?: unknown };
	const id = typeof document === 'string' && document.length > 0 && document.length <= 128;
	return id ? { document } : {};
}

/** A recorded entry over the bound keeps what a replay and a reader need of it, and no `data`. */
export function boundRecorded(record: JournalRecord, oversized?: Set<string>): JournalRecord {
	// A call the kernel's own 256 KiB bound refused, by the mark it set at that check, is journaled with
	// only its document's id, so a refused save does not itself store what it refused (documents
	// specification, 4.4). The result is never read for it: an app's own refusal keeps its input.
	if (record.traceId !== undefined && oversized?.delete(record.traceId)) {
		return { ...record, input: oversizedInput(record.input) };
	}
	if (record.context?.replay !== 'recorded') return record;
	const bytes = lengthOf(record.result);
	if (bytes <= RECORDED_RESULT_MAX_BYTES) return record;
	const { success: ok, error, metadata } = record.result;
	return {
		...record,
		result: {
			success: ok,
			...(error
				? {
						error: {
							code: String(error.code).slice(0, WARNING_NAME_MAX),
							message: String(error.message).slice(0, RECORDED_TEXT_MAX),
							...(typeof error.suggestion === 'string'
								? { suggestion: error.suggestion.slice(0, RECORDED_TEXT_MAX) }
								: {}),
						},
					}
				: {}),
			// The kernel's own marks: the rest is the server's, and may be what made this too large.
			metadata: Object.fromEntries(
				Object.entries(metadata ?? {}).filter(([key]) => key.startsWith('dev.loam/'))
			),
			data: { truncated: true, bytes },
		},
	};
}

// ─── A mapped space ─────────────────────────────────────────────────────────────

export type PinnedInput =
	| { ok: true; input: unknown }
	| { ok: false; result: CommandResult<never> };

/**
 * A project's mapped space, set on the input (7.5). Loam's policy on its own calls, not a boundary inside
 * the server. Phase 1 has no project, so its call site passes `null` and phase 2 only supplies the scope.
 */
export function pinMountedInput(
	entry: Pick<ProjectionAppV1, 'space'>,
	scope: { project: string } | null,
	schema: unknown,
	input: unknown
): PinnedInput {
	if (scope === null || !entry.space || !Object.hasOwn(entry.space, scope.project)) {
		return { ok: true, input };
	}
	const space = entry.space[scope.project];
	const properties = isRecord(schema) ? schema.properties : undefined;
	if (!isRecord(properties) || !Object.hasOwn(properties, 'space')) return { ok: true, input };
	const given = isRecord(input) ? input : {};
	if ((given.space !== undefined && given.space !== space) || given.spaces !== undefined) {
		return {
			ok: false,
			result: kernelFailure(
				'MOUNT_SPACE_PINNED',
				`Project \`${scope.project}\` is pinned to the space \`${space}\``,
				'Switch project, or drop `spaces`.',
				{ details: { project: scope.project, space } }
			),
		};
	}
	return { ok: true, input: { ...given, space } };
}

/**
 * 3.4's line 7, first (phase 2 specification, 9.2): an instance whose entry lists `projects` serves those
 * projects alone, by slug, and nothing at workspace level. The kernel's `opensIn` reads the same list
 * against the same slug, so an app that cannot open in a project has every call refused there too. This is
 * the instance's own refusal, before any request: a call the kernel did not open, an agent's, still stops.
 * Its suggestion names only the listed projects `visible` lets the caller enter, so a non-member learns of
 * no restricted project, as `PROJECT_NOT_FOUND` keeps it (3.4).
 */
export function unlistedProject(
	entry: Pick<ProjectionAppV1, 'projects'>,
	slug: string | undefined,
	visible: (slug: string) => boolean
): CommandResult<never> | undefined {
	const listed = entry.projects;
	if (listed === undefined || (slug !== undefined && listed.includes(slug))) return undefined;
	const shown = listed.filter(visible);
	return kernelFailure(
		'MOUNT_PROJECT_NOT_LISTED',
		slug === undefined
			? 'This instance serves only its projects'
			: `This instance does not serve the project \`${slug}\``,
		`Switch to a project this instance serves${shown.length > 0 ? `: ${shown.join(', ')}` : ''}`
	);
}

// ─── Exposure ───────────────────────────────────────────────────────────────────

/** An entry's `labels` (phase 5 specification, 5.1): `per-part` only when it says so exactly. */
export const labelsOf = (entry: object): 'whole' | 'per-part' =>
	(entry as { labels?: unknown }).labels === 'per-part' ? 'per-part' : 'whole';

type EntryOverride = NonNullable<ProjectionAppV1['commands']>[string];

export interface CommandFlags {
	mutation: boolean;
	destructive: boolean;
	/**
	 * `apps` only from the entry's `commands."<name>".expose.apps` (phase 5 specification, 7.5): the instance entry is a
	 * mounted callee's declaration (D65), and nothing else sets it.
	 */
	expose: { palette: boolean; agent: boolean; apps?: true };
}

/** 7.4's table. A server's claim sets display and defaults, and never widens what a deployer said. */
export function flagsOf(
	reported: { mutation?: boolean; destructive?: boolean },
	manifestEffects: readonly string[] | undefined,
	entry: Pick<ProjectionAppV1, 'expose'>,
	named: EntryOverride | undefined
): CommandFlags {
	const deployerMutation = [manifestEffects, named?.effects].some(
		(effects) => effects !== undefined && deriveMutation(effects)
	);
	const mutation =
		deployerMutation ||
		(reported.mutation ??
			(manifestEffects
				? deriveMutation(manifestEffects)
				: named?.effects
					? deriveMutation(named.effects)
					: true));
	const destructive = reported.destructive === true || named?.destructive === true;
	const apps = (named?.expose as { apps?: unknown } | undefined)?.apps === true;
	const expose = named
		? {
				palette: named.expose?.palette === true,
				agent: named.expose?.agent === true,
				...(apps ? { apps: true as const } : {}),
			}
		: mutation || destructive
			? { palette: false, agent: false }
			: { palette: entry.expose?.palette ?? true, agent: entry.expose?.agent ?? true };
	return { mutation, destructive, expose };
}

// ─── Discovery ──────────────────────────────────────────────────────────────────

/** One command of a catalog: what discovery built, journaled so a replay rebuilds it (7.6). */
export interface CatalogCommandV1 extends CommandFlags {
	name: string;
	/** The server's own name for it. */
	tool: string;
	firstClass: boolean;
	title?: string;
	description: string;
	inputSchema: unknown;
	/**
	 * Discovery replaced the server's schema, omitted or with a root not an object's, with `{ type: 'object' }`: whether
	 * `{}` meets the server's own is not known, so no chord runs it (step 7's R11; the sixth and seventh rounds' 1).
	 * Discovery always says, so a journaled command that does not predates the flag (#1673; {@link journaledReplaced}).
	 */
	replaced?: boolean;
	undoable?: boolean;
	approval?: 'required';
}

export interface MountWarningV1 {
	code: string;
	message: string;
	suggestion: string;
}

export interface InstanceCatalogV1 {
	protocolVersion: string;
	/** The transport's word that its lane carries a person's approval (phase 5 specification, 7.2). */
	approvals?: true;
	toolStrategy?: string;
	commands: CatalogCommandV1[];
	warnings: MountWarningV1[];
}

class MountFailure extends Error {
	constructor(readonly failure: MountFailureCode) {
		super(failure);
	}
}

/** A meta-tool's result. A tool error or anything else is `MOUNT_NOT_AFD`: 7.3's third step. */
async function metaTool(
	transport: MountTransport,
	name: string,
	args: unknown,
	signal: AbortSignal | undefined
): Promise<Readonly<Record<string, unknown>>> {
	let answer: McpToolCallResult;
	try {
		answer = await transport.callTool(name, args, signal);
	} catch (cause) {
		const code = failureOf(cause, signal);
		throw new MountFailure(code === 'MOUNT_RESULT_INVALID' ? 'MOUNT_NOT_AFD' : code);
	}
	// No approval token is kept from discovery either, so none reaches a catalog or its journal entry (7.2).
	const result = withoutTokens(resultBody(answer));
	if (!isRecord(result) || result.success !== true) throw new MountFailure('MOUNT_NOT_AFD');
	return result;
}

const shown = (name: string): string => name.slice(0, WARNING_NAME_MAX);

/**
 * What a registry advertises, which must say `type: 'object'`, since MCP tool arguments always are. A root
 * with no type keeps its keywords, and the console's form reads them. The server validates either way. A
 * schema too deep or too large is none at all, since the command could not be offered safely (9.9). One
 * omitted, or whose root is not an object's, becomes `{ type: 'object' }`, `replaced`: whether `{}` meets
 * the server's own is not known, so no chord runs it (step 7's R11; the sixth and seventh rounds' 1).
 */
function advertisedSchema(
	reported: unknown
): { schema: Readonly<Record<string, unknown>>; replaced: boolean } | undefined {
	if (!isRecord(reported) || (reported.type !== undefined && reported.type !== 'object')) {
		return { schema: { type: 'object' }, replaced: true };
	}
	if (deeperThan(reported, DISCOVERY_LIMITS.depth)) return undefined;
	if (lengthOf(reported) > DISCOVERY_LIMITS.schemaBytes) return undefined;
	return { schema: { ...reported, type: 'object' }, replaced: false };
}

/**
 * A journaled command as discovery would mark it now (#1673). One journaled before step 7 carries no `replaced`, and its
 * omitted schema, or a root not an object's, became `{ type: 'object' }` alone: such a schema is taken as replaced, since
 * whether `{}` meets the server's own cannot be decided from the journal, and no chord runs it until a refresh.
 */
function journaledReplaced(command: unknown): unknown {
	if (!isRecord(command) || typeof command.replaced === 'boolean') return command;
	const schema = command.inputSchema;
	const bare = isRecord(schema) && Object.keys(schema).length === 1 && schema.type === 'object';
	return bare ? { ...command, replaced: true } : command;
}

/** A tool's name for the filter: `AFD-call` and ` afd_help` are `afd-*` too. The hosted relay refuses by it (8.1). */
export const isMetaTool = (name: string): boolean => /^\s*afd[^a-z0-9]/i.test(name);

/**
 * Connect, read the commands, name them and apply what the deployer said (7.3, steps 1 to 7). It registers
 * nothing: conflicts and the registries are the caller's. It does not call `listTools`: the SDK compiles each
 * listed `outputSchema` and checks later results against it in the page, so a catastrophic `pattern` there
 * stalls the tab at every boot, and `afd-help` already says the strategy and the first-class tools (9.9).
 */
export async function discoverInstance(
	entry: Pick<ProjectionAppV1, 'instance' | 'prefix' | 'expose' | 'commands'>,
	manifest: ManifestV3,
	transport: MountTransport,
	signal?: AbortSignal
): Promise<InstanceCatalogV1> {
	const { protocolVersion, approvals } = await transport.connect(signal);
	const help = await metaTool(transport, 'afd-help', { format: 'full' }, signal);
	const data = isRecord(help.data) ? help.data : {};
	const rows = Array.isArray(data.commands) ? data.commands : undefined;
	if (!rows) throw new MountFailure('MOUNT_NOT_AFD');
	// A tool is first-class only on a `hybrid` server, the only strategy whose `afd-help` reports such tools and routes
	// them by name: the hosted relay forwards a bare name on the same rule, so the two agree (phase 6 specification, 8.2).
	const firstClass = new Set(
		data.toolStrategy === 'hybrid' && Array.isArray(data.firstClassTools)
			? data.firstClassTools.filter((name) => typeof name === 'string')
			: []
	);
	const { mount } = manifest;
	const only = mount?.only ? new Set(mount.only) : undefined;
	const names = [
		...new Set(
			rows.flatMap((row): string[] => {
				const name = isRecord(row) ? row.name : undefined;
				if (typeof name !== 'string' || name === '' || isMetaTool(name)) return [];
				return only && !only.has(name) ? [] : [name];
			})
		),
	];

	const warnings: MountWarningV1[] = [];
	if (names.length > DISCOVERY_LIMITS.commands) {
		warnings.push({
			code: 'MOUNT_CATALOG_TOO_LARGE',
			message: `This instance reports ${names.length} commands, and only the first ${DISCOVERY_LIMITS.commands} are read.`,
			suggestion: 'Name the ones you want under `mount.only`.',
		});
		names.length = DISCOVERY_LIMITS.commands;
	}
	const details = new Map<string, Readonly<Record<string, unknown>>>();
	for (let start = 0; start < names.length; start += DETAIL_BATCH) {
		const batch = names.slice(start, start + DETAIL_BATCH);
		const detail = await metaTool(transport, 'afd-detail', { command: batch }, signal);
		const answered = Array.isArray(detail.data) ? detail.data : [];
		for (const item of answered) {
			if (isRecord(item) && typeof item.name === 'string' && batch.includes(item.name)) {
				details.set(item.name, item);
			}
		}
	}

	const manifestPrefix = mount?.prefix ?? manifest.plugin.id;
	const prefix = entry.prefix ?? manifestPrefix;
	// By the name the rule gives, so a case variant of `wipe` is not a tool the deployer never named.
	const nameOf = (tool: string, override?: string) =>
		mountCommandName(manifestPrefix, prefix, tool, override);
	const overrides = new Map((mount?.tools ?? []).map((tool) => [nameOf(tool.tool), tool]));
	const overrideOf = (tool: string) => {
		const base = nameOf(tool);
		return typeof base === 'string' ? overrides.get(base) : undefined;
	};
	// Two tools that come to one name: the server may not choose which a deployer's words apply to.
	const taken = new Map<string, number>();
	for (const tool of names) {
		const named = nameOf(tool, overrideOf(tool)?.name);
		if (typeof named === 'string') taken.set(named, (taken.get(named) ?? 0) + 1);
	}
	const commands: CatalogCommandV1[] = [];
	let catalogBytes = 0;
	for (const tool of names) {
		const detail = details.get(tool);
		if (!detail || detail.found === false) {
			warnings.push({
				code: 'MOUNT_TOOL_UNNAMEABLE',
				message: `\`afd-help\` lists \`${shown(tool)}\`, and \`afd-detail\` does not find it.`,
				suggestion: "Report this to the server's owner.",
			});
			continue;
		}
		if (detail.callable === false) continue;
		const override = overrideOf(tool);
		const named = nameOf(tool, override?.name);
		if (typeof named !== 'string') {
			warnings.push({
				code: 'MOUNT_TOOL_UNNAMEABLE',
				message: `The tool \`${shown(tool)}\` has no valid command name.`,
				suggestion: 'Add an override with a `name` under `mount.tools`.',
			});
			continue;
		}
		if ((taken.get(named) ?? 0) > 1) {
			warnings.push({
				code: 'APP_COMMAND_CONFLICT',
				message: `More than one tool comes to the name \`${shown(named)}\`, so \`${shown(tool)}\` is not registered.`,
				suggestion:
					'Report this to the server, or name them apart with `name` under `mount.tools`.',
			});
			continue;
		}
		const advertised = advertisedSchema(detail.inputSchema);
		if (advertised === undefined) {
			warnings.push({
				code: 'MOUNT_SCHEMA_UNUSABLE',
				message: `The input schema of \`${shown(named)}\` is too deep or too large, so it is not registered.`,
				suggestion: "Report this to the server's owner.",
			});
			continue;
		}
		const listedOverride =
			entry.commands && Object.hasOwn(entry.commands, named) ? entry.commands[named] : undefined;
		const flags = flagsOf(
			{
				...(typeof detail.mutation === 'boolean' ? { mutation: detail.mutation } : {}),
				...(typeof detail.destructive === 'boolean' ? { destructive: detail.destructive } : {}),
			},
			override?.effects,
			entry,
			listedOverride
		);
		const command: CatalogCommandV1 = {
			...flags,
			name: named,
			tool,
			firstClass: firstClass.has(tool),
			...(typeof detail.title === 'string' && detail.title !== ''
				? { title: detail.title.slice(0, DISCOVERY_LIMITS.titleChars) }
				: {}),
			description:
				typeof detail.description === 'string'
					? detail.description.slice(0, DISCOVERY_LIMITS.descriptionChars)
					: '',
			inputSchema: advertised.schema,
			replaced: advertised.replaced,
			...(detail.undoable === true ? { undoable: true } : {}),
			...(detail.approval === 'required' ? { approval: 'required' as const } : {}),
		};
		// Counted as step 7 wrote it, so the explicit `replaced: false` takes no room from the cap (#1673).
		const { replaced: _replaced, ...counted } = command;
		catalogBytes += lengthOf(advertised.replaced ? command : counted);
		if (catalogBytes > DISCOVERY_LIMITS.catalogBytes) {
			warnings.push({
				code: 'MOUNT_CATALOG_TOO_LARGE',
				message:
					'This instance reports more than a catalog holds, so its later commands are not registered.',
				suggestion: 'Name the ones you want under `mount.only`.',
			});
			break;
		}
		commands.push(command);
	}
	for (const name of Object.keys(entry.commands ?? {})) {
		if (!commands.some((command) => command.name === name)) {
			warnings.push({
				code: 'INSTANCE_OVERRIDE_UNKNOWN',
				message: `\`commands."${name}"\` names no command this instance reported.`,
				suggestion: 'Add an override with the final name, or remove this one.',
			});
		}
	}
	return {
		protocolVersion,
		...(approvals === true ? { approvals: true as const } : {}),
		...(typeof data.toolStrategy === 'string' ? { toolStrategy: data.toolStrategy } : {}),
		commands,
		warnings: warnings.slice(0, DISCOVERY_LIMITS.warnings),
	};
}

// ─── The commands of one instance ───────────────────────────────────────────────

/** What `app-instance-list` adds for an instance that has been discovered. */
export interface MountedReading {
	protocolVersion?: string;
	/** The transport's word that this lane carries a person's approval (7.2); never listed. */
	approvals?: true;
	toolStrategy?: string;
	discoveredAt?: string;
	warnings: readonly MountWarningV1[];
}

export interface MountedHost {
	reading: MountedReading;
	/** `app-instance-refresh`: discover again, or keep the last good commands and say why not. */
	refresh(): Promise<CommandResult>;
	/** Register what a journal recorded, with no network (7.6). */
	applyCatalog(catalog: unknown): void;
	approvalOf(command: string): 'required' | undefined;
	/** A `ui://` view for `shell-open` (phase 5 specification, 9.3), read within its bounds; never a tool call. */
	view(uri: string): Promise<CommandResult>;
	dispose(): Promise<void>;
}

/** `shell-open`'s bounds on a mounted view (9.3): its HTML at most 2 MiB, read within 10 seconds, as HTML alone. */
export const MOUNTED_VIEW_LIMITS = Object.freeze({
	bytes: 2 * 1024 * 1024,
	ms: 10_000,
	mime: Object.freeze(['text/html', 'text/html;profile=mcp-app']),
});

export interface MountedHostOptions {
	record: AppRecord;
	entry: ProjectionAppV1;
	manifest: ManifestV3;
	host: AppsHost;
	ports: KernelPorts;
	/** The runtime's live list and map, which the kernel's registries read from. */
	commands: ZodCommandDefinition[];
	owners: Map<string, CommandOwner>;
}

/**
 * A mounted command's input, which its server validates; the kernel refuses only `dev.afd/approval` at any depth, since
 * approval evidence is never input (phase 5 specification, 7.2).
 */
const looseInput = z.looseObject({}).refine((input) => !holdsApprovalKey(input), {
	message:
		'Input may not hold the key "dev.afd/approval": approval evidence is never input. Remove it; Loam presents a person\'s approval itself, after they confirm in the shell.',
});

export function createMountedHost(options: MountedHostOptions): MountedHost {
	const { record, entry, manifest, host, ports, commands, owners } = options;
	const { instance, app } = record;
	let transport: MountTransport | undefined;
	let running: Promise<CommandResult> | undefined;
	/** Set by `dispose`: a refresh that waited behind a hold opens nothing after it (#2137). */
	let disposed = false;
	let lastAutomatic = Number.NEGATIVE_INFINITY;
	const approvals = new Map<string, 'required'>();
	/** The instance's hold, and each command the shell may release with the read that previews it (7.2). */
	const held = createInstanceHold();
	const releases = new Map<string, MountReleaseV1>();

	const reading: MountedReading = { warnings: [] };

	/** The kernel's own answer for a held command it cannot release (7.2), in words for the person and the deployer. */
	function unreleased(
		why: 'entry' | 'preview' | 'era' | 'approver' | 'refused' | 'unconfirmed'
	): CommandResult<never> {
		const because = {
			entry:
				'its entry does not say `approvals = "shell"` and give the command a preview, so Loam does not present it',
			preview:
				"its entry's preview names no read of this instance callable on its own, or reads by a key the command's input does not name",
			era: "this instance's lane carries no person's approval: only the desktop's `stdio` and `http` lanes on MCP 2026-07-28 do",
			approver: 'the server does not accept Loam as an approver, so it sent no approval to present',
			refused: 'the server refused the approval Loam presented',
			unconfirmed: 'no person confirmed this call in the shell, so Loam presents nothing',
		}[why];
		return kernelFailure(
			'MOUNT_APPROVAL_UNAVAILABLE',
			`This command needs a person's approval at its server, and ${because}`,
			why === 'entry' || why === 'preview'
				? 'Run the command at the server\'s own terminal, or give its instance entry `approvals = "shell"` and the command a `preview` naming a read of the same instance, for a server that accepts Loam as an approver.'
				: "Run the command at the server's own terminal, or ask the server's owner to accept Loam as an approver over MCP 2026-07-28.",
			{ retryable: false }
		);
	}

	/** The release of `command`, from the entry's preview (7.2): its read, its hold and whether it is ready. */
	function releaseOf(name: string): MountReleaseV1 | undefined {
		const preview = previewSpecOf(entry, name);
		if (!preview) return undefined;
		const target = () => catalogCommands.find((each) => each.name === preview.command);
		return {
			preview,
			blocked() {
				if (!releasableRead(target())) return 'preview';
				// Every key the preview reads by is one the held command's own input names (the re-check's I2).
				const held = catalogCommands.find((each) => each.name === name);
				const properties = (held?.inputSchema as { properties?: unknown } | undefined)?.properties;
				if (!isRecord(properties) || !preview.input.every((key) => Object.hasOwn(properties, key)))
					return 'preview';
				// The transport's own word, never the version the server answered (the trust review's B4).
				return reading.approvals === true ? undefined : 'era';
			},
			async read(input, context, holder, signal) {
				const read = target();
				if (!releasableRead(read) || !read) return { ok: false, code: 'preview' };
				const narrowed = previewInput(preview, input);
				if (!narrowed) return { ok: false, code: 'preview-input' };
				// A read for this confirmation alone: no release rides on it, and its hold lets it through.
				const own = { ...context, ...(signal ? { signal } : {}) } as unknown as Record<
					symbol,
					unknown
				>;
				delete own[RELEASING];
				const result = await call(read, narrowed, own as unknown as CommandContext, holder);
				// Only a kernel code is quoted in the kernel's words (#2137): a code the server answered is its choice, so it
				// is named only as the server's refusal.
				if (!result.success)
					return {
						ok: false,
						code:
							result.metadata?.['dev.loam/trust'] === 'untrusted'
								? 'server'
								: (result.error?.code ?? 'MOUNT_RESULT_INVALID'),
					};
				// Labelled as 5.1 reads the answer: content whole unless the entry vouches, the data is structured, nothing at
				// its top is labelled content, and the walk reads it whole (the re-check's I1).
				const top = result as unknown as { trust?: unknown; data?: { trust?: unknown } };
				const structured =
					result.metadata?.['dev.loam/structured'] === true &&
					top.trust !== 'content' &&
					top.data?.trust !== 'content' &&
					!pastLabelWalk(result.data, result.error);
				return {
					ok: true,
					read: {
						command: read.name,
						input: narrowed,
						data: result.data,
						labels: structured ? labelsOf(entry) : 'whole',
					},
				};
			},
			hold: (confirmation) => held.hold(confirmation),
		};
	}
	/** The commands discovery admitted, for a preview's read. */
	let catalogCommands: CatalogCommandV1[] = [];

	function failed(error: CommandError): CommandResult<never> {
		record.state = 'failed';
		record.error = error;
		return failure(error);
	}

	async function call(
		command: CatalogCommandV1,
		input: unknown,
		context: CommandContext,
		/** A preview read for this confirmation, which its hold lets through (7.2). */
		holder?: string
	): Promise<CommandResult> {
		// The effective scope, after the middleware's lines 1 to 6: ids, never a name (9.2).
		const { scope } = context as KernelFieldContext;
		const slug = scope?.project && host.scope.projects.get(scope.project)?.slug;
		// Through the runtime, so this chunk imports nothing of first paint's and the bundler parts its
		// shared chunks as before. The call's whole actor: the person it is for, and its agent member (3.3).
		const { actor } = context;
		const refused = unlistedProject(entry, slug, (listed) => {
			const project = host.scope.projects.all().find((candidate) => candidate.slug === listed);
			return (
				project !== undefined &&
				host.scope.allows(actor, { workspace: scope?.workspace ?? '', project: project.id })
			);
		});
		if (refused) return refused;
		const live = transport;
		if (record.state === 'failed' || !live) {
			const { message, suggestion, retryable } = MOUNT_FAILURES.MOUNT_UNREACHABLE;
			return kernelFailure('MOUNT_UNREACHABLE', message, suggestion, {
				retryable,
				details: {
					...(record.error !== undefined ? { cause: record.error.code } : {}),
					[PAGE_DECIDED]: true,
				},
			});
		}
		const pinned = pinMountedInput(
			entry,
			slug ? { project: slug } : null,
			command.inputSchema,
			input
		);
		if (!pinned.ok) return pinned.result;
		const deadline = AbortSignal.timeout(MOUNTED_CALL_DEADLINE_MS);
		// A confirmed run's hold ends every call of it at the hold's deadline (7.2).
		const releasing = (context as unknown as Record<symbol, unknown>)[RELEASING] as
			| ReleasingV1
			| undefined;
		const signal = AbortSignal.any([
			deadline,
			...(context.signal ? [context.signal] : []),
			...(releasing ? [releasing.signal] : []),
		]);
		// A claim the shell makes on every call of a command, `afd-call` too, and on no discovery. A server
		// that declares the field reads it; one that does not drops it (`spec/context-fields.md`).
		const meta = scope ? { 'dev.loam/scope': scope } : undefined;
		const send = (extra?: Record<string, unknown>): Promise<McpToolCallResult> => {
			const sent = extra ? { ...meta, ...extra } : meta;
			return raced(
				command.firstClass
					? live.callTool(command.tool, pinned.input, signal, sent)
					: live.callTool('afd-call', { command: command.tool, input: pinned.input }, signal, sent),
				signal
			);
		};
		const failed = (cause: unknown): CommandResult<never> => {
			if (context.signal?.aborted) {
				return kernelFailure('CALL_ABORTED', 'The call was aborted', 'Run it again', {
					details: { [PAGE_DECIDED]: true },
				});
			}
			// A confirmed run whose hold ended: what was sent may have run at the server, so it is never offered again.
			if (releasing?.signal.aborted) return heldEnded();
			const code = failureOf(cause, signal);
			const { message, suggestion, retryable } = MOUNT_FAILURES[code];
			return kernelFailure(code, message, suggestion, { retryable });
		};
		let leave: () => void = () => {};
		let result: CommandResult;
		try {
			let answer: McpToolCallResult;
			try {
				// Held by another confirmation (7.2): this call waits for its outcome, within its own deadline, and a hold
				// claimed while it runs waits for it to end.
				leave = await held.enter(context, signal, holder);
				answer = await send();
			} catch (cause) {
				return failed(cause);
			}
			// The token, from the answer alone: the result below has none, and nothing keeps the answer.
			const token = takeToken(resultBody(answer));
			result = parseMountedResult(answer, instance);
			if (result.error?.code === 'APPROVAL_REQUIRED') {
				const release = releases.get(command.name);
				const blocked = release ? release.blocked() : 'entry';
				if (blocked) return unreleased(blocked);
				// Never retried without a person's confirm: a released command is asked before it is sent (the late
				// gate's `askedFor`), so only its confirmed run holds a release.
				if (!releasing) return unreleased('unconfirmed');
				// No token: the server does not name Loam an approver.
				if (!token || !held.holds(releasing.confirmation)) return unreleased('approver');
				// The one retry a person's confirm covers (7.2's step 5): this confirmation's run, holding the instance.
				let retried: McpToolCallResult;
				try {
					retried = await send({ [APPROVAL_META_KEY]: token });
				} catch (cause) {
					return failed(cause);
				}
				const again = parseMountedResult(retried, instance);
				return again.error?.code === 'APPROVAL_REQUIRED' ? unreleased('refused') : again;
			}
		} finally {
			leave();
		}
		// Not from a confirmed run or a preview read for one: its own rediscovery would wait for the hold it holds (#2137).
		if (result.error?.code === 'COMMAND_NOT_FOUND' && !releasing && holder === undefined) {
			// Once, and then the call's failure as it was: the instance may have restarted with other plugins.
			const now = host.clock();
			if (now - lastAutomatic >= AUTO_DISCOVERY_MS) {
				lastAutomatic = now;
				// Unqueued: this runs inside a call that may itself be queued behind stage B. As the call's own
				// actor, copied, so an agent's call re-discovers as that agent (phase 3 specification, 3.1).
				await host.runAs(
					'app-instance-refresh',
					{ instance },
					undefined,
					context.actor ? { actor: context.actor } : {},
					true
				);
			}
		}
		return result;
	}

	/**
	 * A command the entry lets apps call (7.5) sets `expose.apps` (phase 5 specification, 9.1), so only AFD's
	 * `createAppCallRegistry` runs another app's call to it, after `call-grant.ts`'s rule: the person's palette and the
	 * agent keep the entry's own exposure.
	 */
	function define(command: CatalogCommandV1): ZodCommandDefinition {
		return defineCommand({
			name: command.name,
			description: command.description,
			mutation: command.mutation,
			input: looseInput,
			advertisedInputSchema: command.inputSchema as never,
			...(command.title !== undefined ? { title: command.title } : {}),
			...(command.destructive ? { destructive: true } : {}),
			...(command.undoable ? { undoable: true } : {}),
			expose: {
				palette: command.expose.palette,
				agent: command.expose.agent,
				mcp: false,
				cli: false,
				...(command.expose.apps === true ? { apps: true } : {}),
			},
			handler: (input: unknown, context: CommandContext) => call(command, input, context),
		}) as unknown as ZodCommandDefinition;
	}

	/** Conflicts, then the registries (7.3, step 8). What conflicts becomes a warning, and is unregistered. */
	function install(catalog: InstanceCatalogV1): InstanceCatalogV1 {
		for (const name of record.commands) owners.delete(name);
		const previous = new Set(record.commands);
		const kept = commands.filter((command) => !previous.has(command.name));
		commands.splice(0, commands.length, ...kept);
		const warnings = [...catalog.warnings];
		const admitted: CatalogCommandV1[] = [];
		const definitions: ZodCommandDefinition[] = [];
		const seen = new Set<string>();
		approvals.clear();
		releases.clear();
		for (const command of catalog.commands) {
			const { name } = command;
			const conflict = host.taken.has(name) || owners.has(name) || seen.has(name);
			let definition: ZodCommandDefinition | undefined;
			try {
				definition = conflict ? undefined : define(command);
			} catch {
				warnings.push({
					code: 'MOUNT_TOOL_UNNAMEABLE',
					message: `The command \`${shown(name)}\` cannot be registered.`,
					suggestion: 'Add an override with a `name` under `mount.tools`.',
				});
				continue;
			}
			if (!definition) {
				warnings.push({
					code: 'APP_COMMAND_CONFLICT',
					message: `Another command already holds the name \`${shown(name)}\`, so this one is not registered.`,
					suggestion: 'Rename the command or the prefix.',
				});
				continue;
			}
			seen.add(name);
			definitions.push(definition);
			admitted.push(command);
			if (command.approval) approvals.set(name, command.approval);
			const release = releaseOf(name);
			if (release) releases.set(name, release);
			owners.set(name, {
				app,
				instance,
				recorded: true,
				tool: command.tool,
				...(command.replaced ? { replaced: true as const } : {}),
				// Whose word decides its result's labels: the entry's, `whole` by default (phase 5 specification, 5.1).
				labels: labelsOf(entry),
				...(entry.commands && Object.hasOwn(entry.commands, name) ? { named: true as const } : {}),
				...(command.expose.apps === true ? { apps: true as const } : {}),
				...(command.approval ? { approval: command.approval } : {}),
				// A command the shell may release for a person, by the entry's preview (phase 5 specification, 7.2).
				...(release ? { release } : {}),
			});
		}
		catalogCommands = admitted;
		warnings.push(
			...releaseWarnings(
				entry,
				admitted,
				catalog.protocolVersion,
				catalog.approvals === true
			).slice(0, 5)
		);
		commands.push(...definitions);
		record.commands = admitted.map((command) => command.name);
		reading.warnings = warnings;
		host.setCommands(commands);
		return { ...catalog, commands: admitted, warnings };
	}

	/** A refresh's answer once the host is disposed: it opened and installed nothing. */
	const closedAnswer = (): CommandResult<never> =>
		kernelFailure(
			'MOUNT_UNREACHABLE',
			'The instance was closed while it waited to be discovered again',
			'Open the deployment again to mount it.',
			{ retryable: false }
		);

	async function discover(): Promise<CommandResult> {
		const signal = AbortSignal.timeout(DISCOVERY_DEADLINE_MS);
		let next: MountTransport | undefined;
		try {
			const route = entry.route;
			if (route === undefined) throw new MountFailure('MOUNT_UNREACHABLE');
			const url = new URL(route, ports.baseUrl).href;
			next = await raced(ports.mountTransport(entry as ProjectionMountedV1, url), signal);
			// Disposed while the transport was made: it is closed before it connects (#2137's re-review).
			if (disposed) {
				await next.close().catch(() => {});
				return closedAnswer();
			}
			const found = await raced(discoverInstance(entry, manifest, next, signal), signal);
			// Disposed while it discovered: nothing is installed, and the new connection is closed (#2137).
			if (disposed) {
				await next.close().catch(() => {});
				return closedAnswer();
			}
			const catalog = install(found);
			const before = transport;
			transport = next;
			await before?.close().catch(() => {});
			record.state = 'ready';
			delete record.error;
			reading.protocolVersion = catalog.protocolVersion;
			// Replaced whole: a lane that no longer carries an approval releases nothing.
			if (catalog.approvals === true) reading.approvals = true;
			else delete reading.approvals;
			if (catalog.toolStrategy !== undefined) reading.toolStrategy = catalog.toolStrategy;
			reading.discoveredAt = new Date(host.clock()).toISOString();
			return success({
				instance,
				commands: catalog.commands.length,
				hidden: catalog.commands.length - host.commandRows(instance).length,
				catalog,
			});
		} catch (cause) {
			await next?.close().catch(() => {});
			const before = transport;
			transport = undefined;
			await before?.close().catch(() => {});
			return failed(
				mountError(cause instanceof MountFailure ? cause.failure : failureOf(cause, signal))
			);
		}
	}

	/** A view of this instance (9.3): the deployer's opt-in, the sandbox origin, a listed URI and the fetch's bounds. */
	async function view(uri: string): Promise<CommandResult> {
		// One refusal whatever failed (not listed, not HTML, too large, unreadable), so no caller probes a server's
		// resources by the words: `why` stays in this function.
		const unavailable = (_why: string) =>
			kernelFailure(
				'VIEW_RESOURCE_UNAVAILABLE',
				`'${instance}' serves no such view`,
				'Open a ui:// resource this instance lists'
			);
		if ((entry as { views?: unknown }).views !== true)
			return kernelFailure(
				'MOUNT_VIEWS_DISABLED',
				`'${instance}' does not let the shell render its views`,
				'Ask the deployer to set views = true on its entry in loam.deployment.toml'
			);
		if (!host.deployment.sandbox_origin)
			return kernelFailure(
				'VIEW_SANDBOX_ORIGIN_INVALID',
				'This deployment has no sandbox origin, so no view can render',
				'Set sandbox_origin in loam.deployment.toml'
			);
		if (record.state !== 'ready' || !transport?.listResources || !transport.readResource)
			return unavailable('it is not connected, or its lane reads no resources');
		const signal = AbortSignal.timeout(MOUNTED_VIEW_LIMITS.ms);
		try {
			const listed = await transport.listResources(signal);
			if (!listed.some((resource) => resource.uri === uri))
				return unavailable('it does not list it');
			const read = await transport.readResource(uri, signal);
			const content = read.contents.find((each) => each.uri === uri);
			const mime = content?.mimeType?.replace(/\s+/g, '').toLowerCase();
			if (content?.text === undefined || !MOUNTED_VIEW_LIMITS.mime.includes(mime ?? ''))
				return unavailable('it is not HTML');
			const bytes = new TextEncoder().encode(content.text).length;
			if (bytes > MOUNTED_VIEW_LIMITS.bytes) return unavailable('it is larger than 2 MiB');
			return success({ instance, uri, bytes });
		} catch {
			return unavailable('it could not be read within 10 seconds');
		}
	}

	return {
		reading,
		view,
		refresh() {
			// A second call while one runs shares its answer, so two never race over the registries.
			// Never while a confirmation holds the instance: its preview and its send go to one connection (7.2).
			// A discovery is a call of its own to the hold: one claimed while it runs waits for it (the re-check's B1).
			running ??= held
				.enter(undefined, AbortSignal.timeout(DISCOVERY_DEADLINE_MS))
				.then(
					async (leave) => {
						try {
							if (disposed) return closedAnswer();
							return await discover();
						} finally {
							leave();
						}
					},
					() =>
						kernelFailure(
							'MOUNT_TIMEOUT',
							"The instance is held for a person's approval, so it is not discovered again now",
							'Refresh it again once the confirmation in the inbox has ended.',
							{ retryable: true }
						)
				)
				.finally(() => {
					running = undefined;
				});
			return running;
		},
		applyCatalog(catalog) {
			if (isRecord(catalog) && Array.isArray(catalog.commands)) {
				install({
					...catalog,
					commands: catalog.commands.map(journaledReplaced),
				} as unknown as InstanceCatalogV1);
			}
		},
		approvalOf: (command) => approvals.get(command),
		async dispose() {
			disposed = true;
			const before = transport;
			transport = undefined;
			await before?.close().catch(() => {});
		},
	};
}
