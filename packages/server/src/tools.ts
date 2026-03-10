/**
 * @fileoverview MCP tool list generation — individual and grouped strategies.
 */

import type { ZodCommandDefinition } from './schema.js';

// ═══════════════════════════════════════════════════════════════════════════════
// BUILT-IN TOOL SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════════

const batchToolSchema = {
	name: 'afd-batch',
	description: 'Execute multiple commands in a single batch request with partial success semantics',
	inputSchema: {
		type: 'object' as const,
		properties: {
			commands: {
				type: 'array',
				description: 'Array of commands to execute',
				items: {
					type: 'object',
					properties: {
						id: {
							type: 'string',
							description: 'Optional client-provided ID for correlating results',
						},
						command: { type: 'string', description: 'The command name to execute' },
						input: { type: 'object', description: 'Input parameters for the command' },
					},
					required: ['command'],
				},
			},
			options: {
				type: 'object',
				description: 'Batch execution options',
				properties: {
					stopOnError: { type: 'boolean', description: 'Stop execution on first error' },
					timeout: {
						type: 'number',
						description: 'Timeout in milliseconds for entire batch',
					},
				},
			},
		},
		required: ['commands'],
	},
};

const pipeToolSchema = {
	name: 'afd-pipe',
	description:
		'Execute a pipeline of chained commands where the output of one becomes the input of the next',
	inputSchema: {
		type: 'object' as const,
		properties: {
			steps: {
				type: 'array',
				description: 'Ordered list of pipeline steps to execute',
				items: {
					type: 'object',
					properties: {
						command: { type: 'string', description: 'Command name to execute' },
						input: {
							type: 'object',
							description:
								'Input parameters, can reference $prev, $first, $steps[n], or $steps.alias',
						},
						as: {
							type: 'string',
							description: "Optional alias for referencing this step's output",
						},
						when: {
							type: 'object',
							description:
								"Optional condition for running this step (e.g., { $exists: '$prev.id' })",
						},
					},
					required: ['command'],
				},
			},
			options: {
				type: 'object',
				description: 'Pipeline execution options',
				properties: {
					continueOnFailure: {
						type: 'boolean',
						description: 'Continue on failure or stop immediately',
					},
					timeoutMs: {
						type: 'number',
						description: 'Timeout for entire pipeline in milliseconds',
					},
				},
			},
		},
		required: ['steps'],
	},
};

// ═══════════════════════════════════════════════════════════════════════════════
// TOOLS LIST
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the tools list based on toolStrategy.
 */
export function getToolsList(
	commands: ZodCommandDefinition[],
	toolStrategy: 'individual' | 'grouped',
	groupByFn?: (command: ZodCommandDefinition) => string | undefined
) {
	// Individual strategy: each command is its own tool
	if (toolStrategy === 'individual') {
		return [
			batchToolSchema,
			pipeToolSchema,
			...commands.map((cmd) => {
				const { type: _type, ...restSchema } = cmd.jsonSchema;
				const hasMeta =
					(cmd.requires && cmd.requires.length > 0) ||
					cmd.mutation != null ||
					(cmd.examples && cmd.examples.length > 0);
				return {
					name: cmd.name,
					description: cmd.description,
					inputSchema: {
						type: 'object' as const,
						...restSchema,
					},
					...(hasMeta && {
						_meta: {
							...(cmd.requires?.length && { requires: cmd.requires }),
							...(cmd.mutation != null && { mutation: cmd.mutation }),
							...(cmd.examples?.length && { examples: cmd.examples }),
						},
					}),
				};
			}),
		];
	}

	// Grouped strategy: commands grouped by category/entity
	const defaultGroupFn = (cmd: ZodCommandDefinition): string => {
		return cmd.category || cmd.name.split('-')[0] || 'general';
	};
	const getGroup = groupByFn || defaultGroupFn;

	// Group commands by their group key
	const groups: Record<string, ZodCommandDefinition[]> = {};
	for (const cmd of commands) {
		const group = getGroup(cmd) || 'general';
		if (!groups[group]) {
			groups[group] = [];
		}
		groups[group].push(cmd);
	}

	// Create a consolidated tool for each group
	const groupedTools = Object.entries(groups).map(([groupName, groupCmds]) => {
		// Build action enum from command names
		const actions = groupCmds.map((cmd) => {
			// Extract action from command name (e.g., "todo-create" -> "create")
			const parts = cmd.name.split('-');
			return parts.length > 1 ? parts.slice(1).join('-') : cmd.name;
		});

		return {
			name: groupName,
			description: `${groupName} operations: ${actions.join(', ')}`,
			inputSchema: {
				type: 'object' as const,
				properties: {
					action: {
						type: 'string',
						enum: actions,
						description: `Action to perform: ${actions.join(' | ')}`,
					},
					// Note: Full discriminated union would require merging all command schemas
					// For now, we use a generic "params" object
					params: {
						type: 'object',
						description: 'Parameters for the action (varies by action)',
					},
				},
				required: ['action'],
			},
		};
	});

	return [batchToolSchema, pipeToolSchema, ...groupedTools];
}
