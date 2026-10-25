/**
 * @fileoverview MCP tool list generation — individual, grouped, and lazy strategies.
 */

import {
	commandResultOutputSchema,
	commandToolAnnotations,
	commandToolMeta,
	isMcpExposed,
} from '@lushly-dev/afd-core';
import { commandAction, commandGroup, filterByContext, type GroupByFn } from './command-routing.js';
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
function groupedTool(groupName: string, groupCmds: ZodCommandDefinition[]): McpToolDefinition {
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
			},
			required: ['action'],
		},
		_meta: { actions: actionEntries },
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOLS LIST
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the tools list based on toolStrategy.
 */
export function getToolsList(
	commands: ZodCommandDefinition[],
	toolStrategy: 'individual' | 'grouped' | 'lazy',
	groupByFn?: GroupByFn,
	activeContext?: string | null,
	options: { outputSchema?: boolean } = {}
): McpToolDefinition[] {
	const builtInTools = [batchTool, pipeTool, callTool];

	// Lazy strategy: meta-tools + built-ins only
	if (toolStrategy === 'lazy') {
		return [discoverTool, detailTool, ...builtInTools];
	}

	// Filter by active context before strategy-specific generation
	const filtered = filterByContext(
		commands.filter((cmd) => isMcpExposed(cmd)),
		activeContext
	);

	// Individual strategy: each command is its own tool + built-ins
	if (toolStrategy === 'individual') {
		return [
			...builtInTools,
			...filtered.map((cmd) => {
				const meta = commandToolMeta(cmd, cmd.outputJsonSchema);
				const annotations = commandToolAnnotations(cmd);
				const outputSchema =
					options.outputSchema !== false && cmd.outputJsonSchema
						? (commandResultOutputSchema(cmd.outputJsonSchema) as unknown as Record<
								string,
								unknown
							>)
						: undefined;
				return {
					name: cmd.name,
					description: cmd.description,
					inputSchema: commandInputSchema(cmd),
					...(annotations && { annotations }),
					...(outputSchema && { outputSchema }),
					...(meta && { _meta: meta }),
				};
			}),
		];
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
		groupedTool(groupName, groupCmds)
	);

	return [...builtInTools, detailTool, ...groupedTools];
}
