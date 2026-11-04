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
import type { ManifestV2, ProjectionAppV1, ProjectionMountedV1 } from '@lushly-dev/loam-manifest';
import { deriveMutation, mountCommandName } from '@lushly-dev/loam-manifest/validate';
import { z } from 'zod';
import type { CommandOwner } from '../apps-runtime.js';
import type { KernelFieldContext } from '../context-fields.js';
import { kernelFailure, type LoamKernelErrorCode, PAGE_DECIDED } from '../errors.js';
import type { KernelPortsV1, McpToolCallResult, MountTransportV2 } from '../types.js';
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
};

const mountError = (code: MountFailureCode): CommandError & { code: MountFailureCode } => ({
	code,
	...MOUNT_FAILURES[code],
});

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const CODES: ReadonlySet<string> = new Set(Object.keys(MOUNT_FAILURES));

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
	const body = resultBody(result);
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
		},
	} as unknown as CommandResult;
}

/** A journal is not a mounted server's archive (7.6). */
export const RECORDED_RESULT_MAX_BYTES = 256 * 1024;
const RECORDED_TEXT_MAX = 2_000;

/** A recorded entry over the bound keeps what a replay and a reader need of it, and no `data`. */
export function boundRecorded(record: JournalRecord, oversized?: Set<string>): JournalRecord {
	// A call the kernel's own 256 KiB bound refused, by the mark it set at that check, is journaled with
	// only its document's id, so a refused save does not itself store what it refused (documents
	// specification, 4.4). The result is never read for it: an app's own refusal keeps its input.
	if (record.traceId !== undefined && oversized?.delete(record.traceId)) {
		const { document } = (record.input ?? {}) as { document?: unknown };
		return { ...record, input: typeof document === 'string' ? { document } : {} };
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

type EntryOverride = NonNullable<ProjectionAppV1['commands']>[string];

export interface CommandFlags {
	mutation: boolean;
	destructive: boolean;
	expose: { palette: boolean; agent: boolean };
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
	const expose = named
		? { palette: named.expose?.palette === true, agent: named.expose?.agent === true }
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
	transport: MountTransportV2,
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
	const result = resultBody(answer);
	if (!isRecord(result) || result.success !== true) throw new MountFailure('MOUNT_NOT_AFD');
	return result;
}

const shown = (name: string): string => name.slice(0, WARNING_NAME_MAX);

/**
 * What a registry advertises, which must say `type: 'object'`, since MCP tool arguments always are. A root
 * with no type keeps its keywords, and the console's form reads them. The server validates either way. A
 * schema too deep or too large is none at all, since the command could not be offered safely (9.9).
 */
function advertisedSchema(reported: unknown): Readonly<Record<string, unknown>> | undefined {
	if (!isRecord(reported) || (reported.type !== undefined && reported.type !== 'object')) {
		return { type: 'object' };
	}
	if (deeperThan(reported, DISCOVERY_LIMITS.depth)) return undefined;
	if (lengthOf(reported) > DISCOVERY_LIMITS.schemaBytes) return undefined;
	return { ...reported, type: 'object' };
}

/** A tool's name for the filter: `AFD-call` and ` afd_help` are `afd-*` too. */
const isMetaTool = (name: string): boolean => /^\s*afd[^a-z0-9]/i.test(name);

/**
 * Connect, read the commands, name them and apply what the deployer said (7.3, steps 1 to 7). It registers
 * nothing: conflicts and the registries are the caller's. It does not call `listTools`: the SDK compiles each
 * listed `outputSchema` and checks later results against it in the page, so a catastrophic `pattern` there
 * stalls the tab at every boot, and `afd-help` already says the strategy and the first-class tools (9.9).
 */
export async function discoverInstance(
	entry: Pick<ProjectionAppV1, 'instance' | 'prefix' | 'expose' | 'commands'>,
	manifest: ManifestV2,
	transport: MountTransportV2,
	signal?: AbortSignal
): Promise<InstanceCatalogV1> {
	const { protocolVersion } = await transport.connect(signal);
	const help = await metaTool(transport, 'afd-help', { format: 'full' }, signal);
	const data = isRecord(help.data) ? help.data : {};
	const rows = Array.isArray(data.commands) ? data.commands : undefined;
	if (!rows) throw new MountFailure('MOUNT_NOT_AFD');
	const firstClass = new Set(
		Array.isArray(data.firstClassTools)
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
		const inputSchema = advertisedSchema(detail.inputSchema);
		if (inputSchema === undefined) {
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
			inputSchema,
			...(detail.undoable === true ? { undoable: true } : {}),
			...(detail.approval === 'required' ? { approval: 'required' as const } : {}),
		};
		catalogBytes += lengthOf(command);
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
		...(typeof data.toolStrategy === 'string' ? { toolStrategy: data.toolStrategy } : {}),
		commands,
		warnings: warnings.slice(0, DISCOVERY_LIMITS.warnings),
	};
}

// ─── The commands of one instance ───────────────────────────────────────────────

/** What `app-instance-list` adds for an instance that has been discovered. */
export interface MountedReading {
	protocolVersion?: string;
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
	dispose(): Promise<void>;
}

export interface MountedHostOptions {
	record: AppRecord;
	entry: ProjectionAppV1;
	manifest: ManifestV2;
	host: AppsHost;
	ports: KernelPortsV1;
	/** The runtime's live list and map, which the kernel's registries read from. */
	commands: ZodCommandDefinition[];
	owners: Map<string, CommandOwner>;
}

const looseInput = z.looseObject({});

export function createMountedHost(options: MountedHostOptions): MountedHost {
	const { record, entry, manifest, host, ports, commands, owners } = options;
	const { instance, app } = record;
	let transport: MountTransportV2 | undefined;
	let running: Promise<CommandResult> | undefined;
	let lastAutomatic = Number.NEGATIVE_INFINITY;
	const approvals = new Map<string, 'required'>();

	const reading: MountedReading = { warnings: [] };

	function failed(error: CommandError): CommandResult<never> {
		record.state = 'failed';
		record.error = error;
		return failure(error);
	}

	async function call(
		command: CatalogCommandV1,
		input: unknown,
		context: CommandContext
	): Promise<CommandResult> {
		// The effective scope, after the middleware's lines 1 to 6: ids, never a name (9.2).
		const { scope } = context as KernelFieldContext;
		const slug = scope?.project && host.scope.projects.get(scope.project)?.slug;
		// Through the runtime, so this chunk imports nothing of first paint's and the bundler parts its
		// shared chunks as before.
		const actor = host.scope.actorKey(context);
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
		const signal = context.signal ? AbortSignal.any([deadline, context.signal]) : deadline;
		// A claim the shell makes on every call of a command, `afd-call` too, and on no discovery. A server
		// that declares the field reads it; one that does not drops it (`spec/context-fields.md`).
		const meta = scope ? { 'dev.loam/scope': scope } : undefined;
		let answer: McpToolCallResult;
		try {
			answer = await raced(
				command.firstClass
					? live.callTool(command.tool, pinned.input, signal, meta)
					: live.callTool('afd-call', { command: command.tool, input: pinned.input }, signal, meta),
				signal
			);
		} catch (cause) {
			if (context.signal?.aborted) {
				return kernelFailure('CALL_ABORTED', 'The call was aborted', 'Run it again', {
					details: { [PAGE_DECIDED]: true },
				});
			}
			const code = failureOf(cause, signal);
			const { message, suggestion, retryable } = MOUNT_FAILURES[code];
			return kernelFailure(code, message, suggestion, { retryable });
		}
		const result = parseMountedResult(answer, instance);
		if (result.error?.code === 'COMMAND_NOT_FOUND') {
			// Once, and then the call's failure as it was: the instance may have restarted with other plugins.
			const now = host.clock();
			if (now - lastAutomatic >= AUTO_DISCOVERY_MS) {
				lastAutomatic = now;
				// Unqueued: this runs inside a call that may itself be queued behind stage B.
				await host.runAs('app-instance-refresh', { instance }, undefined, {}, true);
			}
		}
		return result;
	}

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
			expose: { ...command.expose, mcp: false, cli: false },
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
			owners.set(name, { app, instance, recorded: true });
		}
		commands.push(...definitions);
		record.commands = admitted.map((command) => command.name);
		reading.warnings = warnings;
		host.setCommands(commands);
		return { ...catalog, commands: admitted, warnings };
	}

	async function discover(): Promise<CommandResult> {
		const signal = AbortSignal.timeout(DISCOVERY_DEADLINE_MS);
		let next: MountTransportV2 | undefined;
		try {
			const route = entry.route;
			if (route === undefined) throw new MountFailure('MOUNT_UNREACHABLE');
			const url = new URL(route, ports.baseUrl).href;
			next = await raced(ports.mountTransport(entry as ProjectionMountedV1, url), signal);
			const catalog = install(await raced(discoverInstance(entry, manifest, next, signal), signal));
			const before = transport;
			transport = next;
			await before?.close().catch(() => {});
			record.state = 'ready';
			delete record.error;
			reading.protocolVersion = catalog.protocolVersion;
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

	return {
		reading,
		refresh() {
			// A second call while one runs shares its answer, so two never race over the registries.
			running ??= discover().finally(() => {
				running = undefined;
			});
			return running;
		},
		applyCatalog(catalog) {
			if (isRecord(catalog) && Array.isArray(catalog.commands)) {
				install(catalog as unknown as InstanceCatalogV1);
			}
		},
		approvalOf: (command) => approvals.get(command),
		async dispose() {
			const before = transport;
			transport = undefined;
			await before?.close().catch(() => {});
		},
	};
}
