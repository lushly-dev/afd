/**
 * @fileoverview The commands `afd validate --surface` evaluates, read from a
 * remote server's tool listing whatever its tool strategy:
 *
 * - individual: one tool per command;
 * - grouped: one tool per group, whose `_meta.actions` lists each command;
 * - lazy: no command tools, so commands are listed with afd-discover and afd-detail.
 *
 * Tools and commands that AFD servers provide themselves (afd-call, afd-batch,
 * afd-help, afd-context-list, ...) are skipped: they are not the application's
 * surface, and flagging them tells the user nothing they can fix.
 */

import type { CommandResult, JsonSchema, McpTool, McpToolAction } from '@lushly-dev/afd-core';
import { isAfdBuiltinName } from '@lushly-dev/afd-core';
import type { SurfaceCommand } from '@lushly-dev/afd-testing';

/** Page size for afd-discover (its maximum). */
const DISCOVER_PAGE_SIZE = 200;
/** Most commands afd-detail describes per call. */
const DETAIL_BATCH_SIZE = 10;
/** Stop paging afd-discover after this many pages (a misbehaving server could page forever). */
const MAX_DISCOVER_PAGES = 50;

/** The client calls surface collection needs (satisfied by `McpClient`). */
export interface SurfaceClient {
	call<T = unknown>(name: string, args?: Record<string, unknown>): Promise<CommandResult<T>>;
}

/** The commands to validate, and how they were found. */
export interface SurfaceCommandSet {
	commands: SurfaceCommand[];
	/** Built-in AFD tools and grouped actions that were skipped */
	skippedBuiltins: string[];
	/** Grouped tools whose actions were validated as commands */
	expandedGroups: string[];
	/** Whether commands were listed with afd-discover and afd-detail */
	discovered: boolean;
	/** Problems that made the result less complete, for the user */
	warnings: string[];
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A JSON Schema object sent by the server, or undefined when it is not an object. */
function schemaOf(value: unknown): JsonSchema | undefined {
	// SAFETY: the surface rules read schemas defensively; only the object shape is checked here.
	return isRecord(value) ? (value as unknown as JsonSchema) : undefined;
}

function optionalArray<T>(value: unknown): T[] | undefined {
	return Array.isArray(value) ? (value as T[]) : undefined;
}

/** A command tool (individual strategy) as a surface command. */
function toolToSurfaceCommand(tool: McpTool): SurfaceCommand {
	return {
		name: tool.name,
		description: tool.description ?? '',
		category: tool._meta?.category,
		jsonSchema: tool.inputSchema as SurfaceCommand['jsonSchema'],
		requires: tool._meta?.requires,
		examples: tool._meta?.examples,
		outputJsonSchema: tool._meta?.outputSchema as SurfaceCommand['outputJsonSchema'],
		contexts: tool._meta?.contexts,
	};
}

/** One action of a grouped tool as the command it runs. */
function actionToSurfaceCommand(action: McpToolAction): SurfaceCommand {
	return {
		name: action.command,
		description: action.description ?? '',
		category: action.category,
		jsonSchema: action.inputSchema as SurfaceCommand['jsonSchema'],
		requires: action.requires,
		examples: action.examples,
		outputJsonSchema: action.outputSchema as SurfaceCommand['outputJsonSchema'],
		contexts: action.contexts,
	};
}

/** The well-formed `_meta.actions` entries of a grouped tool, or undefined for other tools. */
function groupedActions(tool: McpTool): McpToolAction[] | undefined {
	const actions: unknown = tool._meta?.actions;
	if (!Array.isArray(actions)) return undefined;
	return actions.filter(
		(action): action is McpToolAction =>
			isRecord(action) && typeof action.command === 'string' && action.command !== ''
	);
}

/**
 * Whether a tool looks like a grouped tool that does not list its actions
 * (servers that advertise only `{ action: enum, params: object }`). Its commands
 * can only be found with afd-discover.
 */
export function isOpaqueGroupedTool(tool: McpTool): boolean {
	if (groupedActions(tool)) return false;
	const properties = tool.inputSchema?.properties;
	if (!isRecord(properties)) return false;
	const action = properties.action;
	return (
		isRecord(action) &&
		Array.isArray(action.enum) &&
		isRecord(properties.params) &&
		Array.isArray(tool.inputSchema.required) &&
		tool.inputSchema.required.includes('action')
	);
}

/**
 * Map a tool listing to surface commands without calling the server: built-in
 * AFD tools are skipped, and grouped tools are replaced by one command per
 * `_meta.actions` entry.
 */
export function mapToolsToSurfaceCommands(tools: McpTool[]): SurfaceCommand[] {
	return collectFromListing(tools).commands;
}

function collectFromListing(tools: McpTool[]): SurfaceCommandSet {
	const set: SurfaceCommandSet = {
		commands: [],
		skippedBuiltins: [],
		expandedGroups: [],
		discovered: false,
		warnings: [],
	};
	for (const tool of tools) {
		if (isAfdBuiltinName(tool.name)) {
			set.skippedBuiltins.push(tool.name);
			continue;
		}
		const actions = groupedActions(tool);
		if (!actions) {
			set.commands.push(toolToSurfaceCommand(tool));
			continue;
		}
		const userActions = actions.filter((action) => !isAfdBuiltinName(action.command));
		set.skippedBuiltins.push(
			...actions.filter((action) => isAfdBuiltinName(action.command)).map((a) => a.command)
		);
		if (userActions.length > 0) set.expandedGroups.push(tool.name);
		set.commands.push(...userActions.map(actionToSurfaceCommand));
	}
	return set;
}

/**
 * Collect the commands to validate from a server's tool listing, calling
 * afd-discover and afd-detail when the listing does not carry them: a lazy
 * server (only built-in tools, including afd-discover), or grouped tools that
 * do not list their actions. If discovery fails, the listed tools are
 * validated as they are and a warning says why.
 */
export async function collectSurfaceCommands(
	tools: McpTool[],
	client: SurfaceClient
): Promise<SurfaceCommandSet> {
	const set = collectFromListing(tools);
	const opaque = set.commands.filter((command) =>
		tools.some((tool) => tool.name === command.name && isOpaqueGroupedTool(tool))
	);
	const lazy = set.commands.length === 0 && tools.some((tool) => tool.name === 'afd-discover');
	if (!lazy && opaque.length === 0) return set;

	try {
		// A tool that only looks grouped may be a real command; discovery then lists it again.
		const listed = set.commands.filter((command) => !opaque.includes(command));
		const known = new Set(listed.map((command) => command.name));
		const discovered = await discoverCommands(client);
		for (const name of discovered.builtins) {
			if (!set.skippedBuiltins.includes(name)) set.skippedBuiltins.push(name);
		}
		const added = discovered.commands.filter((command) => !known.has(command.name));
		// The grouped tools' commands are now listed individually.
		set.commands = listed.concat(added);
		set.expandedGroups.push(
			...opaque
				.map((command) => command.name)
				.filter((name) => !added.some((command) => command.name === name))
		);
		set.discovered = true;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		set.warnings.push(
			lazy
				? `Could not list commands with afd-discover (${reason}); no commands were validated.`
				: `Could not list the commands of grouped tools ${opaque.map((c) => c.name).join(', ')} with afd-discover (${reason}); they were validated as tools.`
		);
	}
	return set;
}

async function callData<T>(client: SurfaceClient, name: string, args: Json): Promise<T> {
	const result = await client.call<T>(name, args);
	if (!result.success) {
		throw new Error(`${name} failed: ${result.error?.message ?? 'unknown error'}`);
	}
	return result.data as T;
}

/**
 * List every command with afd-discover, then describe each one that is not an
 * AFD built-in with afd-detail.
 */
async function discoverCommands(
	client: SurfaceClient
): Promise<{ commands: SurfaceCommand[]; builtins: string[] }> {
	const names: string[] = [];
	for (let page = 0, offset = 0; page < MAX_DISCOVER_PAGES; page++) {
		const data = await callData<unknown>(client, 'afd-discover', {
			limit: DISCOVER_PAGE_SIZE,
			offset,
		});
		if (!isRecord(data) || !Array.isArray(data.commands)) {
			throw new Error('afd-discover returned no commands list');
		}
		for (const entry of data.commands) {
			if (isRecord(entry) && typeof entry.name === 'string') names.push(entry.name);
		}
		if (data.hasMore !== true || data.commands.length === 0) break;
		offset += data.commands.length;
	}

	const unique = [...new Set(names)];
	const wanted = unique.filter((name) => !isAfdBuiltinName(name));
	const commands: SurfaceCommand[] = [];
	for (let i = 0; i < wanted.length; i += DETAIL_BATCH_SIZE) {
		const batch = wanted.slice(i, i + DETAIL_BATCH_SIZE);
		const entries = await callData<unknown>(client, 'afd-detail', { command: batch });
		if (!Array.isArray(entries)) throw new Error('afd-detail returned no command list');
		for (const entry of entries) {
			if (!isRecord(entry) || entry.found !== true || typeof entry.name !== 'string') continue;
			commands.push(detailToSurfaceCommand(entry));
		}
	}
	return { commands, builtins: unique.filter(isAfdBuiltinName) };
}

/** An afd-detail entry as a surface command. */
function detailToSurfaceCommand(entry: Json): SurfaceCommand {
	return {
		name: entry.name as string,
		description: typeof entry.description === 'string' ? entry.description : '',
		category: typeof entry.category === 'string' ? entry.category : undefined,
		jsonSchema: schemaOf(entry.inputSchema),
		outputJsonSchema: schemaOf(entry.outputSchema),
		// afd-detail does not currently return these; use them when a server does.
		requires: optionalArray<string>(entry.requires),
		examples: optionalArray<NonNullable<SurfaceCommand['examples']>[number]>(entry.examples),
		contexts: optionalArray<string>(entry.contexts),
	};
}
