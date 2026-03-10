/**
 * @fileoverview MCP tool list generation — individual, grouped, and lazy strategies.
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

const callToolSchema = {
	name: 'afd-call',
	description:
		'Invoke any command by name with runtime input validation. Works in all server strategies.',
	inputSchema: {
		type: 'object' as const,
		properties: {
			command: { type: 'string', description: 'Command name to invoke' },
			input: {
				type: 'object',
				description: "Command input (validated against the command's own schema at runtime)",
			},
		},
		required: ['command'],
	},
};

const discoverToolSchema = {
	name: 'afd-discover',
	description:
		'List available commands with optional filtering by category, tag, or search text. Returns compact summaries.',
	inputSchema: {
		type: 'object' as const,
		properties: {
			category: { type: 'string', description: 'Filter commands by category' },
			tag: {
				description: 'Filter by tag(s). String for single, array for multiple.',
			},
			tagMode: {
				type: 'string',
				enum: ['all', 'any'],
				description: 'Tag matching mode (default: any)',
			},
			search: { type: 'string', description: 'Text search across names and descriptions' },
			includeMutation: { type: 'boolean', description: 'Include mutation classification' },
			limit: { type: 'number', description: 'Max results (1-200, default 50)' },
			offset: { type: 'number', description: 'Results to skip for pagination' },
		},
	},
};

const detailToolSchema = {
	name: 'afd-detail',
	description: 'Get the full input schema and metadata for one or more commands by name.',
	inputSchema: {
		type: 'object' as const,
		properties: {
			command: {
				description:
					'Command name or names (exact match, kebab-case). String or array of strings (max 10).',
			},
		},
		required: ['command'],
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
	toolStrategy: 'individual' | 'grouped' | 'lazy',
	groupByFn?: (command: ZodCommandDefinition) => string | undefined
) {
	const builtInTools = [batchToolSchema, pipeToolSchema, callToolSchema];

	// Lazy strategy: meta-tools + built-ins only
	if (toolStrategy === 'lazy') {
		return [discoverToolSchema, detailToolSchema, ...builtInTools];
	}

	// Individual strategy: each command is its own tool + built-ins
	if (toolStrategy === 'individual') {
		return [
			...builtInTools,
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

	return [...builtInTools, ...groupedTools];
}
