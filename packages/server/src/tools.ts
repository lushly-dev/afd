/**
 * @fileoverview MCP tool list generation — individual, grouped, lazy and hybrid strategies.
 */

import {
	commandResultOutputSchema,
	commandToolAnnotations,
	commandToolMeta,
	isMcpExposed,
} from '@lushly-dev/afd-core';
import { CONTEXT_COMMAND_NAMES } from './bootstrap/registry.js';
import { commandAction, commandGroup, filterByContext, type GroupByFn } from './command-routing.js';
import { type ConfirmationMode, declaresConfirmInput } from './confirmations.js';
import {
	batchTool,
	callTool,
	detailTool,
	discoverTool,
	type GroupedToolAction,
	type McpToolDefinition,
	pipeTool,
	type ToolInputSchema,
} from './meta-tools.js';
import type { ZodCommandDefinition } from './schema.js';
import type { ToolStrategy } from './server-types.js';

/**
 * Largest serialized size (in characters) of a grouped tool's per-action parameter
 * schemas that is inlined into `inputSchema.properties.params.anyOf`. Larger groups
 * advertise only the generic `params` object; their schemas stay in `_meta.actions`
 * and `afd-detail`, which keeps `tools/list` small.
 */
export const GROUPED_PARAMS_SCHEMA_BUDGET = 8_192;

// ═══════════════════════════════════════════════════════════════════════════════
// PER-COMMAND METADATA
// ═══════════════════════════════════════════════════════════════════════════════

function commandInputSchema(cmd: ZodCommandDefinition): ToolInputSchema {
	const { type: _type, ...restSchema } = cmd.jsonSchema;
	return { type: 'object', ...restSchema };
}

/** The `confirm` argument a server that enforces confirmations accepts. */
const CONFIRM_PROPERTY = {
	type: 'boolean',
	description:
		'Set to true to confirm this command, once the user intends it. The server asks for confirmation when it is missing.',
};

/**
 * Whether a tool for `cmd` advertises the `confirm` acknowledgement: only under `enforce`, for a
 * command with `confirmPrompt` whose own schema has no `confirm` (`spec/command-metadata.md`).
 */
function acceptsConfirm(cmd: ZodCommandDefinition, mode: ConfirmationMode | undefined): boolean {
	return (
		mode === 'enforce' &&
		cmd.confirmationMode !== 'host-verified' &&
		!!cmd.confirmPrompt &&
		!declaresConfirmInput(cmd)
	);
}

/** The individual tool `inputSchema`, with `confirm` when the command accepts it. */
function individualInputSchema(
	cmd: ZodCommandDefinition,
	mode: ConfirmationMode | undefined
): ToolInputSchema {
	const schema = commandInputSchema(cmd);
	if (!acceptsConfirm(cmd, mode)) return schema;
	const properties = (schema.properties as Record<string, unknown> | undefined) ?? {};
	return { ...schema, properties: { ...properties, confirm: CONFIRM_PROPERTY } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GROUPED STRATEGY
// ═══════════════════════════════════════════════════════════════════════════════

/** What one command contributes to the grouped tool of its group, built once per command. */
interface GroupedPiece {
	action: string;
	/** Its entry in `_meta.actions`. */
	entry: GroupedToolAction;
	/** Its `params` branch. */
	branch: Record<string, unknown>;
	/** The length of the branch's JSON, which counts toward the inline budget. */
	branchLength: number;
	/** Whether the branch's JSON holds a `$ref`, which keeps every branch out of `params`. */
	hasRef: boolean;
	acceptsConfirm: boolean;
}

function groupedPiece(cmd: ZodCommandDefinition, mode: ConfirmationMode | undefined): GroupedPiece {
	const action = commandAction(cmd);
	const branch = {
		...commandInputSchema(cmd),
		title: action,
		description: `Parameters for action '${action}' (${cmd.name})`,
	};
	const branchJson = JSON.stringify(branch);
	return {
		action,
		entry: {
			action,
			command: cmd.name,
			description: cmd.description,
			inputSchema: commandInputSchema(cmd),
			...commandToolMeta(cmd, cmd.outputJsonSchema),
		},
		branch,
		branchLength: branchJson.length,
		hasRef: branchJson.includes('"$ref"'),
		acceptsConfirm: acceptsConfirm(cmd, mode),
	};
}

/**
 * One consolidated tool for a group of commands, from its members' pieces in list order.
 *
 * `_meta.actions` lists, for every action, the full command name, its input schema
 * and its metadata, so agents can build `params` without trial and error. When the
 * schemas are small, `params` also carries them as `anyOf` branches (one per action,
 * titled with the action). Branches sit under `params` rather than at the top level
 * because some MCP hosts reject top-level `oneOf`/`anyOf`/`allOf`, and `anyOf` is used
 * rather than `oneOf` because actions often share a params shape (a `oneOf` would then
 * reject valid calls).
 */
function groupedTool(groupName: string, pieces: readonly GroupedPiece[]): McpToolDefinition {
	const actions = [...new Set(pieces.map((piece) => piece.action))];
	const branches = pieces.map((piece) => piece.branch);
	// The length of `JSON.stringify(branches)`: each branch's JSON, comma-separated, in brackets.
	const serializedLength =
		2 + Math.max(pieces.length - 1, 0) + pieces.reduce((sum, piece) => sum + piece.branchLength, 0);
	const inlineBranches =
		serializedLength <= GROUPED_PARAMS_SCHEMA_BUDGET && !pieces.some((piece) => piece.hasRef);

	return {
		name: groupName,
		description: `${groupName} operations: ${actions.join(', ')}`,
		inputSchema: {
			type: 'object',
			properties: {
				action: {
					type: 'string',
					enum: actions,
					description: `Action to perform: ${actions.join(' | ')}`,
				},
				params: {
					type: 'object',
					description: inlineBranches
						? 'Parameters for the action: the anyOf branch titled with the action'
						: "Parameters for the action: see _meta.actions[].inputSchema, or call afd-detail with the action's command name",
					...(inlineBranches && { anyOf: branches }),
				},
				...(pieces.some((piece) => piece.acceptsConfirm) && {
					confirm: CONFIRM_PROPERTY,
				}),
			},
			required: ['action'],
		},
		_meta: { actions: pieces.map((piece) => piece.entry) },
	};
}

/** `cmds` in groups, by first appearance, each in list order. */
function groupCommands(
	cmds: readonly ZodCommandDefinition[],
	groupOf: (cmd: ZodCommandDefinition) => string
): Map<string, ZodCommandDefinition[]> {
	const groups = new Map<string, ZodCommandDefinition[]>();
	for (const cmd of cmds) {
		const group = groupOf(cmd);
		const members = groups.get(group);
		if (members) members.push(cmd);
		else groups.set(group, [cmd]);
	}
	return groups;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOLS LIST
// ═══════════════════════════════════════════════════════════════════════════════

/** Options that shape the tools a list advertises. */
export interface ToolsListOptions {
	outputSchema?: boolean;
	confirmations?: ConfirmationMode;
	/** The hybrid strategy's first-class command names, in list order. */
	firstClassTools?: readonly string[];
}

/**
 * The tool for one command, as the individual strategy lists it. The hybrid strategy lists its
 * first-class commands and context tools the same way.
 */
function commandTool(
	cmd: ZodCommandDefinition,
	options: Pick<ToolsListOptions, 'outputSchema' | 'confirmations'>
): McpToolDefinition {
	const meta = commandToolMeta(cmd, cmd.outputJsonSchema);
	const annotations = commandToolAnnotations(cmd);
	const outputSchema =
		options.outputSchema !== false && cmd.outputJsonSchema
			? (commandResultOutputSchema(cmd.outputJsonSchema) as unknown as Record<string, unknown>)
			: undefined;
	return {
		name: cmd.name,
		...(cmd.title !== undefined && { title: cmd.title }),
		description: cmd.description,
		inputSchema: individualInputSchema(cmd, options.confirmations),
		...(annotations && { annotations }),
		...(outputSchema && { outputSchema }),
		...(meta && { _meta: meta }),
	};
}

/** The five meta-tools, in the order every strategy lists them (`spec/tool-strategies.md`, #533). */
const META_TOOLS = [discoverTool, detailTool, callTool, batchTool, pipeTool];

/**
 * The hybrid list (`spec/tool-strategies.md`, H3): the five meta-tools, the context tools when
 * the server registered them, then the first-class command tools in configured order. It
 * depends on the server's configuration only, never on the active context (H4). With no
 * first-class tools it is the lazy list.
 */
function hybridToolsList(
	commands: readonly ZodCommandDefinition[],
	firstClassTools: readonly string[],
	tool: (cmd: ZodCommandDefinition) => McpToolDefinition
): McpToolDefinition[] {
	const byName = new Map(commands.map((cmd) => [cmd.name, cmd]));
	const named = (names: readonly string[]) =>
		names.flatMap((name) => {
			const cmd = byName.get(name);
			return cmd && isMcpExposed(cmd) ? [tool(cmd)] : [];
		});
	return [...META_TOOLS, ...named(CONTEXT_COMMAND_NAMES), ...named(firstClassTools)];
}

/**
 * Get the tools list based on toolStrategy.
 */
export function getToolsList(
	commands: ZodCommandDefinition[],
	toolStrategy: ToolStrategy,
	groupByFn?: GroupByFn,
	activeContext?: string | null,
	options: ToolsListOptions = {}
): McpToolDefinition[] {
	const tool = (cmd: ZodCommandDefinition) => commandTool(cmd, options);

	// Lazy strategy: the meta-tools and the context tools, the same in every context
	if (toolStrategy === 'lazy') {
		return hybridToolsList(commands, [], tool);
	}

	// Hybrid strategy: a fixed list that ignores the active context
	if (toolStrategy === 'hybrid') {
		return hybridToolsList(commands, options.firstClassTools ?? [], tool);
	}

	// Filter by active context before strategy-specific generation
	const filtered = filterByContext(
		commands.filter((cmd) => isMcpExposed(cmd)),
		activeContext
	);

	// Individual strategy: the meta-tools, then each command as its own tool
	if (toolStrategy === 'individual') {
		return [...META_TOOLS, ...filtered.map(tool)];
	}

	// Grouped strategy: the meta-tools, then the commands grouped by category or entity.
	const groups = groupCommands(filtered, (cmd) => commandGroup(cmd, groupByFn));
	const groupedTools = Array.from(groups, ([groupName, groupCmds]) =>
		groupedTool(
			groupName,
			groupCmds.map((cmd) => groupedPiece(cmd, options.confirmations))
		)
	);

	return [...META_TOOLS, ...groupedTools];
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEMOISED TOOLS LIST
// ═══════════════════════════════════════════════════════════════════════════════

/** A server's configuration for {@link createToolsList}: fixed for the server's life. */
export interface ToolsListSource {
	/**
	 * Every command the server can list, before a scope view or the active context filters it. A
	 * list asked for with this very array is cached whole for each active context.
	 */
	commands: ZodCommandDefinition[];
	toolStrategy: ToolStrategy;
	groupByFn?: GroupByFn;
	options?: ToolsListOptions;
	/** The configured context names: a whole list is cached only for these, or for none. */
	contexts?: readonly string[];
}

/**
 * Lists one server's tools as {@link getToolsList} does, from pieces built once (#1746).
 *
 * The configuration is fixed, so each command's tool, each grouped tool's per-command pieces and
 * each group's tool are built once and reused. A list asked for with `source.commands` itself (no
 * scope view narrowed it) is cached whole, by the active context; a list a scope view narrowed is
 * assembled from the cached pieces, and a group whose members it changed is rebuilt from them.
 * A command a view copied (to narrow its `requires`) is a different object, so its pieces are
 * built for it, never taken from the original's.
 *
 * Callers share what this returns and must not change it (hence `readonly`). The server's callers
 * only read it: the MCP SDK copies a result before changing it, and the `/message` lane serialises
 * it. It is not frozen: V8 serialises a frozen object off its fast path, which at 1,000 tools
 * costs several times what building the list does.
 *
 * Each command is read once: a command object changed after the server was built is listed as it
 * was, and `groupByFn` is called once per command, so it must answer the same for the same command.
 */
export function createToolsList(
	source: ToolsListSource
): (listed: ZodCommandDefinition[], activeContext?: string | null) => readonly McpToolDefinition[] {
	const { toolStrategy, groupByFn } = source;
	const options = source.options ?? {};
	const contexts = new Set(source.contexts ?? []);

	const tools = new WeakMap<ZodCommandDefinition, McpToolDefinition>();
	const tool = (cmd: ZodCommandDefinition): McpToolDefinition => {
		let built = tools.get(cmd);
		if (!built) {
			built = commandTool(cmd, options);
			tools.set(cmd, built);
		}
		return built;
	};

	const groupNames = new WeakMap<ZodCommandDefinition, string>();
	const groupOf = (cmd: ZodCommandDefinition): string => {
		let group = groupNames.get(cmd);
		if (group === undefined) {
			group = commandGroup(cmd, groupByFn);
			groupNames.set(cmd, group);
		}
		return group;
	};
	const pieces = new WeakMap<ZodCommandDefinition, GroupedPiece>();
	const pieceOf = (cmd: ZodCommandDefinition): GroupedPiece => {
		let piece = pieces.get(cmd);
		if (!piece) {
			piece = groupedPiece(cmd, options.confirmations);
			pieces.set(cmd, piece);
		}
		return piece;
	};
	/** The last tool built for each group, with the members it was built from. */
	const groupTools = new Map<
		string,
		{ members: ZodCommandDefinition[]; tool: McpToolDefinition }
	>();
	const groupTool = (groupName: string, members: ZodCommandDefinition[]): McpToolDefinition => {
		const last = groupTools.get(groupName);
		if (
			last &&
			last.members.length === members.length &&
			last.members.every((member, index) => member === members[index])
		) {
			return last.tool;
		}
		const built = groupedTool(groupName, members.map(pieceOf));
		groupTools.set(groupName, { members, tool: built });
		return built;
	};

	const build = (
		listed: ZodCommandDefinition[],
		activeContext: string | null | undefined
	): readonly McpToolDefinition[] => {
		if (toolStrategy === 'lazy') return hybridToolsList(listed, [], tool);
		if (toolStrategy === 'hybrid') {
			return hybridToolsList(listed, options.firstClassTools ?? [], tool);
		}
		const filtered = filterByContext(
			listed.filter((cmd) => isMcpExposed(cmd)),
			activeContext
		);
		if (toolStrategy === 'individual') return [...META_TOOLS, ...filtered.map(tool)];
		const groups = groupCommands(filtered, groupOf);
		return [...META_TOOLS, ...Array.from(groups, ([name, members]) => groupTool(name, members))];
	};

	/**
	 * Whether `listed` is the server's own list: that array, or one a scope view filtered nothing
	 * from (a server with `auth` binds a view to every request, so its lists are always copies).
	 */
	const isSourceList = (listed: ZodCommandDefinition[]): boolean =>
		listed === source.commands ||
		(listed.length === source.commands.length &&
			listed.every((cmd, index) => cmd === source.commands[index]));
	const whole = new Map<string, readonly McpToolDefinition[]>();
	return (listed, activeContext) => {
		// The lazy and hybrid lists never vary by context (H4).
		const key = toolStrategy === 'lazy' || toolStrategy === 'hybrid' ? '' : (activeContext ?? '');
		const cacheable = isSourceList(listed) && (key === '' || contexts.has(key));
		const cached = cacheable ? whole.get(key) : undefined;
		if (cached) return cached;
		const list = build(listed, activeContext);
		if (cacheable) whole.set(key, list);
		return list;
	};
}
