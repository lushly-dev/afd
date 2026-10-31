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
	return mode === 'enforce' && !!cmd.confirmPrompt && !declaresConfirmInput(cmd);
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

/**
 * One consolidated tool for a group of commands.
 *
 * `_meta.actions` lists, for every action, the full command name, its input schema
 * and its metadata, so agents can build `params` without trial and error. When the
 * schemas are small, `params` also carries them as `anyOf` branches (one per action,
 * titled with the action). Branches sit under `params` rather than at the top level
 * because some MCP hosts reject top-level `oneOf`/`anyOf`/`allOf`, and `anyOf` is used
 * rather than `oneOf` because actions often share a params shape (a `oneOf` would then
 * reject valid calls).
 */
function groupedTool(
	groupName: string,
	groupCmds: ZodCommandDefinition[],
	mode: ConfirmationMode | undefined
): McpToolDefinition {
	const actions = [...new Set(groupCmds.map(commandAction))];
	const actionEntries = groupCmds.map(
		(cmd): GroupedToolAction => ({
			action: commandAction(cmd),
			command: cmd.name,
			description: cmd.description,
			inputSchema: commandInputSchema(cmd),
			...commandToolMeta(cmd, cmd.outputJsonSchema),
		})
	);

	const branches = groupCmds.map((cmd) => ({
		...commandInputSchema(cmd),
		title: commandAction(cmd),
		description: `Parameters for action '${commandAction(cmd)}' (${cmd.name})`,
	}));
	const serialized = JSON.stringify(branches);
	const inlineBranches =
		serialized.length <= GROUPED_PARAMS_SCHEMA_BUDGET && !serialized.includes('"$ref"');

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
				...(groupCmds.some((cmd) => acceptsConfirm(cmd, mode)) && {
					confirm: CONFIRM_PROPERTY,
				}),
			},
			required: ['action'],
		},
		_meta: { actions: actionEntries },
	};
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
		description: cmd.description,
		inputSchema: individualInputSchema(cmd, options.confirmations),
		...(annotations && { annotations }),
		...(outputSchema && { outputSchema }),
		...(meta && { _meta: meta }),
	};
}

/**
 * The hybrid list (`spec/tool-strategies.md`, H3): the five meta-tools, the context tools when
 * the server registered them, then the first-class command tools in configured order. It
 * depends on the server's configuration only, never on the active context (H4).
 */
function hybridToolsList(
	commands: ZodCommandDefinition[],
	options: ToolsListOptions
): McpToolDefinition[] {
	const byName = new Map(commands.map((cmd) => [cmd.name, cmd]));
	const named = (names: readonly string[]) =>
		names.flatMap((name) => {
			const cmd = byName.get(name);
			return cmd && isMcpExposed(cmd) ? [commandTool(cmd, options)] : [];
		});
	return [
		discoverTool,
		detailTool,
		callTool,
		batchTool,
		pipeTool,
		...named(CONTEXT_COMMAND_NAMES),
		...named(options.firstClassTools ?? []),
	];
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
	const builtInTools = [batchTool, pipeTool, callTool];

	// Lazy strategy: meta-tools + built-ins only
	if (toolStrategy === 'lazy') {
		return [discoverTool, detailTool, ...builtInTools];
	}

	// Hybrid strategy: a fixed list that ignores the active context
	if (toolStrategy === 'hybrid') {
		return hybridToolsList(commands, options);
	}

	// Filter by active context before strategy-specific generation
	const filtered = filterByContext(
		commands.filter((cmd) => isMcpExposed(cmd)),
		activeContext
	);

	// Individual strategy: each command is its own tool + built-ins
	if (toolStrategy === 'individual') {
		return [...builtInTools, ...filtered.map((cmd) => commandTool(cmd, options))];
	}

	// Grouped strategy: commands grouped by category/entity. afd-detail is listed
	// because grouped tools only carry per-action schemas in _meta (or inline when small).
	const groups = new Map<string, ZodCommandDefinition[]>();
	for (const cmd of filtered) {
		const group = commandGroup(cmd, groupByFn);
		const members = groups.get(group);
		if (members) members.push(cmd);
		else groups.set(group, [cmd]);
	}

	const groupedTools = Array.from(groups, ([groupName, groupCmds]) =>
		groupedTool(groupName, groupCmds, options.confirmations)
	);

	return [...builtInTools, detailTool, ...groupedTools];
}
