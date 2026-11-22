/**
 * @fileoverview The relay's decision (phase 6 specification, 8.1 steps 9 to 11; A3; D105): the effective command, its
 * input and its scope, decided against the server's records and the instance's discovered catalog, through AFD's
 * meta-tools and its `grouped` strategy alike. Pure: the route reads the records and the catalog for each request and
 * hands them here, so nothing is decided on a cache.
 */

import { isAfdBuiltinName } from '@lushly-dev/afd-core';
import {
	type CatalogCommandV1,
	decideAccess,
	type InstanceCatalogV1,
	isMetaTool,
	type MembershipV1,
	type ProjectV1,
	pinMountedInput,
	type ScopeV1,
	unlistedProject,
} from '@lushly-dev/loam-kernel/mounted';
import type { ProjectionAppV1 } from '@lushly-dev/loam-manifest';
import { isRecord, type ParsedMessage, type RpcId } from './message.js';
import { isRefusal, type RelayRefusal, refusal } from './refusals.js';

/** What the route read for this request: the server's records, never the page's. */
export interface DecideContext {
	workspace: string;
	entry: ProjectionAppV1;
	/** The session's person: always the human (8.1 step 3). */
	person: string;
	membership: MembershipV1;
	/** The server's `project` table, read for this request. */
	projects: readonly ProjectV1[];
	/** The instance's catalog as the relay last discovered it, or none yet. */
	catalog: InstanceCatalogV1 | undefined;
}

/** A tool call the relay will forward, decided. */
export type ToolDecision =
	| {
			kind: 'discovery';
			tool: 'afd-help' | 'afd-detail';
			arguments: Record<string, unknown>;
	  }
	| {
			kind: 'command';
			command: CatalogCommandV1;
			/** The decided input: the pin applied (step 11.4). */
			input: Readonly<Record<string, unknown>>;
			/** How the page named it: by its bare first-class name, or through `afd-call`. */
			via: 'first-class' | 'afd-call';
			/** The scope decided (step 11), or none for a call at workspace level (11.0). */
			scope?: ScopeV1;
			/** The project's slug the scope's id names, for the record. */
			slug?: string;
	  };

export type Decision = { kind: 'workspace' } | { kind: 'cancel'; requestId: RpcId } | ToolDecision;

/** A refusal, marked when its cause is a command the catalog does not hold, so the route rediscovers once (8.2). */
export type DecideRefusal = RelayRefusal & { missing?: true };

const AFD_HELP_FORMATS: ReadonlySet<unknown> = new Set(['brief', 'full']);
/** `afd-detail`'s most names in one call, as discovery batches them (`mounted.ts`'s `DETAIL_BATCH`). */
const DETAIL_MAX = 10;

const notExposed = (missing = false): DecideRefusal => {
	const refused: DecideRefusal = refusal(
		'MOUNT_COMMAND_NOT_EXPOSED',
		'This command is not exposed to the shell'
	);
	if (missing) refused.missing = true;
	return refused;
};

/** `decideAccess` version 2 for the session's person, with the server's records (step 11.1). */
function access(context: DecideContext, scope: ScopeV1): RelayRefusal | undefined {
	const project =
		scope.project === undefined
			? undefined
			: context.projects.find((candidate) => candidate.id === scope.project);
	const decided = decideAccess({
		actor: { kind: 'human', id: context.person },
		scope,
		project,
		membership: context.membership,
		agent: undefined,
	});
	if (decided.allowed) return undefined;
	return decided.reason === 'workspace'
		? refusal('WORKSPACE_NOT_MEMBER', 'You are not a member of this workspace')
		: refusal('PROJECT_NOT_FOUND', 'No project with this id exists');
}

/** Whether `slug` names a project the person may enter: the listed-project rule's `visible` (phase 2's 9.2). */
function visible(context: DecideContext, slug: string): boolean {
	const project = context.projects.find((candidate) => candidate.slug === slug);
	return (
		project !== undefined &&
		access(context, { workspace: context.workspace, project: project.id }) === undefined
	);
}

/**
 * Step 10: discovery and the session's own messages, at workspace level. No scope, membership, and for an instance
 * whose entry lists `projects`, at least one listed project the person may enter.
 */
export function decideWorkspaceLevel(
	context: DecideContext,
	scope: ScopeV1 | undefined
): RelayRefusal | undefined {
	if (scope !== undefined)
		return refusal('REQUEST_INVALID', 'Discovery and session messages carry no scope');
	const refused = access(context, { workspace: context.workspace });
	if (refused) return refused;
	const listed = context.entry.projects;
	if (listed !== undefined && !listed.some((slug) => visible(context, slug)))
		return refusal('MOUNT_PROJECT_NOT_LISTED', 'This instance serves only its projects');
	return undefined;
}

// ─── The pin's allow-list (step 11.4) ─────────────────────────────────────────

/** The root keywords a pinned command's schema may hold: anything else (`oneOf`, `if`, `$ref`, …) fails closed. */
const ROOT_KEYWORDS: ReadonlySet<string> = new Set([
	'type',
	'properties',
	'required',
	'additionalProperties',
	'title',
	'description',
	'$schema',
	'$defs',
	'definitions',
	'examples',
	'default',
]);

const isSpaceName = (key: string) => /^spaces?$/i.test(key);

/**
 * Whether any key of `value` at any depth is `space` or `spaces` in any case, but the top-level `space` the pin set: one
 * holding exactly the pinned space, in a schema that declares it. A top-level `space` the pin did not set, since the
 * schema names none, is refused. `space` is `undefined` when the pin set none.
 */
function holdsOtherSpace(
	value: Readonly<Record<string, unknown>>,
	space: string | undefined
): boolean {
	const stack: Array<[unknown, boolean]> = [[value, true]];
	while (stack.length > 0) {
		const [item, top] = stack.pop() as [unknown, boolean];
		if (typeof item !== 'object' || item === null) continue;
		for (const [key, child] of Object.entries(item)) {
			const theirs = space !== undefined && top && key === 'space' && child === space;
			if (isSpaceName(key) && !theirs) return true;
			stack.push([child, false]);
		}
	}
	return false;
}

/**
 * Whether a schema declares a property named `space` or `spaces`, in any case, anywhere but its top-level
 * `properties.space` and a `properties.spaces` beside it: under `properties` or `patternProperties` at any depth, or as
 * a `$defs` or `definitions` entry. A top-level `spaces` with no `space` is another space, since no pin applies to it.
 */
function declaresOtherSpace(schema: unknown): boolean {
	const top = isRecord(schema) && isRecord(schema.properties) ? schema.properties : {};
	const pinnable = Object.hasOwn(top, 'space');
	const stack: Array<[unknown, boolean]> = [[schema, true]];
	while (stack.length > 0) {
		const [node, root] = stack.pop() as [unknown, boolean];
		if (typeof node !== 'object' || node === null) continue;
		if (!Array.isArray(node)) {
			for (const container of ['properties', 'patternProperties', '$defs', 'definitions']) {
				const held = (node as Record<string, unknown>)[container];
				if (!isRecord(held)) continue;
				for (const key of Object.keys(held)) {
					const allowed =
						root &&
						container === 'properties' &&
						(key === 'space' || (key === 'spaces' && pinnable));
					if (isSpaceName(key) && !allowed) return true;
				}
			}
		}
		for (const child of Object.values(node)) stack.push([child, false]);
	}
	return false;
}

/**
 * Whether a schema holds a part whose property names cannot be read as names: `patternProperties`, a `$ref` or a
 * `$dynamicRef`, at any depth. A pattern may match `space`, and a reference may name a schema that declares it, so a
 * pinned command with either fails closed (the trust review, Astra).
 */
function uninspectable(schema: unknown): boolean {
	const stack: unknown[] = [schema];
	while (stack.length > 0) {
		const node = stack.pop();
		if (typeof node !== 'object' || node === null) continue;
		if (!Array.isArray(node))
			for (const key of ['patternProperties', '$ref', '$dynamicRef', '$recursiveRef'])
				if (Object.hasOwn(node, key)) return true;
		stack.push(...Object.values(node));
	}
	return false;
}

/** Whether `pinMountedInput` sets the space on this schema: a top-level `properties.space`. */
const pinSet = (schema: unknown) =>
	isRecord(schema) && isRecord(schema.properties) && Object.hasOwn(schema.properties, 'space');

/** The pinned space, by allow-list, after `pinMountedInput` (step 11.4). */
function pinned(
	context: DecideContext,
	command: CatalogCommandV1,
	slug: string | undefined,
	input: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> | RelayRefusal {
	const { entry } = context;
	const pin = pinMountedInput(entry, slug ? { project: slug } : null, command.inputSchema, input);
	if (!pin.ok)
		return refusal(
			'MOUNT_SPACE_PINNED',
			pin.result.error?.message ?? 'This project is pinned to its own space'
		);
	const decided = (isRecord(pin.input) ? pin.input : {}) as Readonly<Record<string, unknown>>;
	const inPinnedProject =
		slug !== undefined && entry.space !== undefined && Object.hasOwn(entry.space, slug);
	if (!inPinnedProject) return decided;
	const schema = command.inputSchema;
	const rootKeywords = isRecord(schema) ? Object.keys(schema) : [];
	const failsClosed =
		!isRecord(schema) ||
		// Discovery replaced a schema it could not read: what the server takes is not known (the trust review, Astra).
		command.replaced === true ||
		uninspectable(schema) ||
		rootKeywords.some((keyword) => !ROOT_KEYWORDS.has(keyword)) ||
		declaresOtherSpace(schema) ||
		holdsOtherSpace(
			decided,
			pinSet(schema) ? (entry.space as Record<string, string>)[slug] : undefined
		);
	return failsClosed
		? refusal(
				'MOUNT_SPACE_PINNED',
				'This project is pinned to its own space, and this command or input could name another'
			)
		: decided;
}

// ─── The effective command (step 9) ───────────────────────────────────────────

/** `afd-help`'s and `afd-detail`'s arguments, rebuilt from their schemas (step 12). */
function discoveryArguments(
	tool: 'afd-help' | 'afd-detail',
	args: Readonly<Record<string, unknown>>
): Record<string, unknown> | RelayRefusal {
	if (tool === 'afd-help') {
		const rebuilt: Record<string, unknown> = {};
		if (args.filter !== undefined) {
			if (typeof args.filter !== 'string')
				return refusal('REQUEST_INVALID', '`filter` is not a string');
			rebuilt.filter = args.filter;
		}
		if (args.format !== undefined) {
			if (!AFD_HELP_FORMATS.has(args.format))
				return refusal('REQUEST_INVALID', '`format` is not `brief` or `full`');
			rebuilt.format = args.format;
		}
		return rebuilt;
	}
	const { command } = args;
	const names =
		typeof command === 'string'
			? command
			: Array.isArray(command) &&
					command.length <= DETAIL_MAX &&
					command.every((name) => typeof name === 'string')
				? [...command]
				: undefined;
	if (names === undefined)
		return refusal('REQUEST_INVALID', '`command` is not a name or a list of at most 10');
	return { command: names };
}

/** The catalog command whose server name is `tool`, or none. */
const commandOf = (catalog: InstanceCatalogV1 | undefined, tool: string) =>
	catalog?.commands.find((command) => command.tool === tool);

/**
 * Steps 9 to 11 for a `tools/call`: the effective command (the meta-tools and the `grouped` strategy closed), its
 * exposure from the catalog, access, the instance's projects and the pinned space, each on the server's records.
 */
function decideToolCall(
	message: ParsedMessage,
	context: DecideContext
): ToolDecision | DecideRefusal {
	const name = message.name as string;
	const args = message.arguments ?? {};
	// Discovery: `afd-help` and `afd-detail`, by exact name only, at workspace level (step 10).
	if (name === 'afd-help' || name === 'afd-detail') {
		const refused = decideWorkspaceLevel(context, message.scope);
		if (refused) return refused;
		const rebuilt = discoveryArguments(name, args);
		if (isRefusal(rebuilt)) return rebuilt;
		return { kind: 'discovery', tool: name, arguments: rebuilt };
	}
	let command: CatalogCommandV1 | undefined;
	let input: Readonly<Record<string, unknown>>;
	let via: 'first-class' | 'afd-call';
	if (name === 'afd-call') {
		const { command: named, input: given } = args;
		if (typeof named !== 'string')
			return refusal('REQUEST_INVALID', "`afd-call`'s `command` is not a string");
		if (given !== undefined && !isRecord(given))
			return refusal('REQUEST_INVALID', "`afd-call`'s `input` is not an object");
		// No meta-tool or AFD built-in through `afd-call`: `afd-batch`, `afd-pipe`, `afd-context-enter`, …
		if (isMetaTool(named) || isAfdBuiltinName(named)) return notExposed();
		command = commandOf(context.catalog, named);
		if (!command) return notExposed(true);
		input = given ?? {};
		via = 'afd-call';
	} else {
		// Any other name is a first-class tool of a `hybrid` catalog, or nothing: so AFD's `grouped` strategy, whose group
		// tools route `arguments.action` to another command before any name is read, cannot be reached (A3).
		if (isMetaTool(name) || isAfdBuiltinName(name)) return notExposed();
		const found = commandOf(context.catalog, name);
		if (!found) return notExposed(true);
		if (!found.firstClass || context.catalog?.toolStrategy !== 'hybrid') return notExposed();
		command = found;
		input = args;
		via = 'first-class';
	}
	// Exposure, as discovery computed it: never recomputed from annotations (D65). A command the entry lets apps alone
	// call (`expose.apps`, phase 5's 7.5) is not reachable here: the relay cannot see an app's grant, and phase 5 keeps
	// app calls to mounts off the hosted lane until its milestone C (step 6's merge with phase 5's step 4, its review).
	if (!command.expose.palette && !command.expose.agent) return notExposed();
	// Step 11: the command at the message's scope, or at workspace level (11.0); no step skipped for want of a scope.
	const scope = message.scope;
	const refused = access(context, scope ?? { workspace: context.workspace });
	if (refused) return refused;
	const project =
		scope?.project === undefined
			? undefined
			: context.projects.find((candidate) => candidate.id === scope.project);
	const slug = project?.slug;
	// The kernel's line 6 (phase 2's 3.4): no mutation under an archived project, read from the server's record (the
	// trust review, Opus).
	if (project?.status === 'archived' && command.mutation)
		return refusal('PROJECT_ARCHIVED', 'This project is archived, so nothing in it changes');
	const unlisted = unlistedProject(context.entry, slug, (listed) => visible(context, listed));
	if (unlisted)
		return refusal(
			'MOUNT_PROJECT_NOT_LISTED',
			unlisted.error?.message ?? 'This instance does not serve this project',
			unlisted.error?.suggestion
		);
	const decided = pinned(context, command, slug, input);
	if (isRefusal(decided)) return decided;
	return {
		kind: 'command',
		command,
		input: decided as Readonly<Record<string, unknown>>,
		via,
		...(scope ? { scope } : {}),
		...(slug ? { slug } : {}),
	};
}

/**
 * Steps 9 to 11 for one parsed `POST` message. Membership is decided before anything else, so a person outside the
 * workspace learns nothing of the instance's catalog.
 */
export function decideMessage(
	message: ParsedMessage,
	context: DecideContext
): Decision | DecideRefusal {
	const member = access(context, { workspace: context.workspace });
	if (member) return member;
	if (message.method === 'tools/call') return decideToolCall(message, context);
	const refused = decideWorkspaceLevel(context, message.scope);
	if (refused) return refused;
	if (message.method === 'notifications/cancelled')
		return { kind: 'cancel', requestId: message.cancelled as RpcId };
	return { kind: 'workspace' };
}
