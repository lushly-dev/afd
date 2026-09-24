/**
 * Todo App Adapter
 *
 * Adapter for the AFD Todo example application (`packages/examples/todo`),
 * whose commands use kebab-case names such as `todo-create`.
 */

import type {
	AdapterContext,
	AppAdapter,
	ApplyFixtureResult,
	FixtureValidationResult,
} from './types.js';

// ============================================================================
// Todo Fixture Types
// ============================================================================

/**
 * Todo fixture format.
 */
export interface TodoFixture {
	/** App identifier */
	app: 'todo';
	/** Fixture version */
	version?: string;
	/** Fixture description */
	description?: string;
	/** Whether to clear all existing todos first (default: true) */
	clearFirst?: boolean;
	/** Todos to seed */
	todos?: TodoSeed[];
}

/**
 * Todo seed data.
 */
export interface TodoSeed {
	/** Todo title */
	title: string;
	/** Todo description */
	description?: string;
	/** Priority level */
	priority?: 'low' | 'medium' | 'high';
	/** Completion status */
	completed?: boolean;
}

// ============================================================================
// JSON Schema (defined before adapter)
// ============================================================================

const todoFixtureSchema = {
	$schema: 'http://json-schema.org/draft-07/schema#',
	title: 'Todo Fixture',
	type: 'object',
	properties: {
		app: { const: 'todo' },
		version: { type: 'string' },
		description: { type: 'string' },
		clearFirst: { type: 'boolean' },
		todos: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					title: { type: 'string', minLength: 1 },
					description: { type: 'string' },
					priority: { type: 'string', enum: ['low', 'medium', 'high'] },
					completed: { type: 'boolean' },
				},
				required: ['title'],
			},
		},
	},
	required: ['app'],
};

// ============================================================================
// Todo Adapter
// ============================================================================

/**
 * Todo app adapter.
 */
export const todoAdapter: AppAdapter = {
	name: 'todo',
	version: '1.0.0',

	cli: {
		command: 'node',
		defaultArgs: ['dist/server.js'],
		inputFormat: 'json-arg',
		outputFormat: 'json',
	},

	fixture: {
		schema: todoFixtureSchema,

		async apply(fixture: unknown, context: AdapterContext): Promise<ApplyFixtureResult> {
			return applyTodoFixture(fixture as TodoFixture, context);
		},

		async reset(context: AdapterContext): Promise<void> {
			await resetTodoState(context);
		},

		async validate(fixture: unknown): Promise<FixtureValidationResult> {
			return validateTodoFixture(fixture);
		},
	},

	commands: {
		list: () => TODO_COMMANDS,
		getDescription: (cmd: string) => TODO_COMMAND_DESCRIPTIONS[cmd] ?? `Execute ${cmd}`,
		getSchema: (cmd: string) => TODO_COMMAND_SCHEMAS[cmd] ?? { type: 'object' },
		mapFileToCommands: mapTodoFileToCommands,
	},

	errors: {
		list: () => TODO_ERROR_CODES,
		getDescription: (code: string) => TODO_ERROR_DESCRIPTIONS[code] ?? `Error: ${code}`,
		isRetryable: (code: string) => ['TIMEOUT', 'NETWORK_ERROR'].includes(code),
	},

	jobs: {
		list: () => TODO_JOBS,
		getDescription: (job: string) => TODO_JOB_DESCRIPTIONS[job] ?? `Job: ${job}`,
		getRelatedCommands: (job: string) => TODO_JOB_COMMANDS[job] ?? [],
	},
};

// ============================================================================
// Fixture Application
// ============================================================================

async function applyTodoFixture(
	fixture: TodoFixture,
	context: AdapterContext
): Promise<ApplyFixtureResult> {
	const appliedCommands: ApplyFixtureResult['appliedCommands'] = [];
	const warnings: string[] = [];

	const { handler } = context;
	if (!handler) {
		warnings.push('No command handler provided, fixture not applied');
		return { appliedCommands, warnings };
	}

	/** Run one command; returns the result, or undefined after a failure. */
	const run = async (command: string, input: Record<string, unknown>) => {
		const result = await handler(command, input);
		appliedCommands.push({ command, input, result });
		return result.success ? result : undefined;
	};

	// Start from a clean slate unless the fixture opts out
	if (fixture.clearFirst !== false && !(await run('todo-clear', { all: true }))) {
		return { appliedCommands, warnings };
	}

	for (const todo of fixture.todos ?? []) {
		const input: Record<string, unknown> = {
			title: todo.title,
			priority: todo.priority ?? 'medium',
		};
		if (todo.description !== undefined) {
			input.description = todo.description;
		}
		const created = await run('todo-create', input);
		if (!created) {
			return { appliedCommands, warnings };
		}

		if (todo.completed) {
			const id = (created.data as { id?: unknown } | undefined)?.id;
			if (typeof id !== 'string') {
				warnings.push(`todo-create returned no id for '${todo.title}', so it was not completed`);
				continue;
			}
			if (!(await run('todo-toggle', { id }))) {
				return { appliedCommands, warnings };
			}
		}
	}

	return { appliedCommands, warnings };
}

async function resetTodoState(context: AdapterContext): Promise<void> {
	await context.handler?.('todo-clear', { all: true });
}

// ============================================================================
// Fixture Validation
// ============================================================================

function validateTodoFixture(fixture: unknown): FixtureValidationResult {
	const errors: string[] = [];

	if (typeof fixture !== 'object' || fixture === null) {
		errors.push('Fixture must be an object');
		return { valid: false, errors };
	}

	const obj = fixture as Record<string, unknown>;

	// Check app identifier
	if (obj.app !== 'todo') {
		errors.push(`Fixture 'app' must be 'todo', got '${obj.app}'`);
	}

	// Validate todos array
	if (obj.todos !== undefined) {
		if (!Array.isArray(obj.todos)) {
			errors.push("Fixture 'todos' must be an array");
		} else {
			for (let i = 0; i < obj.todos.length; i++) {
				const todo = obj.todos[i] as Record<string, unknown>;
				if (!todo.title || typeof todo.title !== 'string') {
					errors.push(`todos[${i}] must have a 'title' string`);
				}
				if (
					todo.priority !== undefined &&
					!['low', 'medium', 'high'].includes(todo.priority as string)
				) {
					errors.push(`todos[${i}].priority must be 'low', 'medium', or 'high'`);
				}
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors: errors.length > 0 ? errors : undefined,
	};
}

// ============================================================================
// Commands Configuration
// ============================================================================

const TODO_COMMANDS = [
	'todo-create',
	'todo-list',
	'todo-get',
	'todo-update',
	'todo-toggle',
	'todo-delete',
	'todo-clear',
	'todo-stats',
	'todo-create-batch',
	'todo-delete-batch',
	'todo-toggle-batch',
];

const TODO_COMMAND_DESCRIPTIONS: Record<string, string> = {
	'todo-create': 'Create a new todo item',
	'todo-list': 'List todos with optional filtering',
	'todo-get': 'Get a specific todo by ID',
	'todo-update': 'Update an existing todo',
	'todo-toggle': 'Toggle completion status of a todo',
	'todo-delete': 'Delete a todo by ID',
	'todo-clear': 'Clear completed todos, or every todo with { all: true }',
	'todo-stats': 'Get statistics about todos',
	'todo-create-batch': 'Create multiple todos at once',
	'todo-delete-batch': 'Delete multiple todos at once',
	'todo-toggle-batch': 'Toggle multiple todos at once',
};

const TODO_COMMAND_SCHEMAS: Record<string, object> = {
	'todo-create': {
		type: 'object',
		properties: {
			title: { type: 'string', minLength: 1, maxLength: 200 },
			description: { type: 'string', maxLength: 1000 },
			priority: { type: 'string', enum: ['low', 'medium', 'high'] },
		},
		required: ['title'],
	},
	'todo-list': {
		type: 'object',
		properties: {
			completed: { type: 'boolean' },
			priority: { type: 'string', enum: ['low', 'medium', 'high'] },
			search: { type: 'string' },
			sortBy: { type: 'string', enum: ['createdAt', 'updatedAt', 'priority', 'title'] },
			sortOrder: { type: 'string', enum: ['asc', 'desc'] },
			limit: { type: 'integer', minimum: 1, maximum: 100 },
			offset: { type: 'integer', minimum: 0 },
		},
	},
	'todo-get': {
		type: 'object',
		properties: { id: { type: 'string' } },
		required: ['id'],
	},
	'todo-update': {
		type: 'object',
		properties: {
			id: { type: 'string' },
			title: { type: 'string', minLength: 1, maxLength: 200 },
			description: { type: 'string', maxLength: 1000 },
			priority: { type: 'string', enum: ['low', 'medium', 'high'] },
			completed: { type: 'boolean' },
		},
		required: ['id'],
	},
	'todo-toggle': {
		type: 'object',
		properties: { id: { type: 'string' } },
		required: ['id'],
	},
	'todo-delete': {
		type: 'object',
		properties: { id: { type: 'string' } },
		required: ['id'],
	},
	'todo-clear': {
		type: 'object',
		properties: { all: { type: 'boolean' } },
	},
	'todo-stats': { type: 'object' },
	'todo-create-batch': {
		type: 'object',
		properties: {
			todos: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						title: { type: 'string' },
						description: { type: 'string' },
						priority: { type: 'string', enum: ['low', 'medium', 'high'] },
					},
					required: ['title'],
				},
			},
		},
		required: ['todos'],
	},
	'todo-delete-batch': {
		type: 'object',
		properties: { ids: { type: 'array', items: { type: 'string' } } },
		required: ['ids'],
	},
	'todo-toggle-batch': {
		type: 'object',
		properties: {
			ids: { type: 'array', items: { type: 'string' } },
			completed: { type: 'boolean' },
		},
		required: ['ids'],
	},
};

// ============================================================================
// Errors Configuration
// ============================================================================

const TODO_ERROR_CODES = [
	'NOT_FOUND',
	'VALIDATION_ERROR',
	'TITLE_REQUIRED',
	'TITLE_TOO_LONG',
	'INVALID_PRIORITY',
	'INVALID_ID',
];

const TODO_ERROR_DESCRIPTIONS: Record<string, string> = {
	NOT_FOUND: 'Todo item not found',
	VALIDATION_ERROR: 'Input validation failed',
	TITLE_REQUIRED: 'Title is required',
	TITLE_TOO_LONG: 'Title exceeds maximum length',
	INVALID_PRIORITY: 'Priority must be low, medium, or high',
	INVALID_ID: 'Invalid todo ID format',
};

// ============================================================================
// Jobs Configuration
// ============================================================================

const TODO_JOBS = ['manage-daily-tasks', 'track-progress', 'batch-operations', 'prioritize-work'];

const TODO_JOB_DESCRIPTIONS: Record<string, string> = {
	'manage-daily-tasks': 'Create, update, and complete daily tasks',
	'track-progress': 'View statistics and completion rates',
	'batch-operations': 'Perform bulk actions on multiple todos',
	'prioritize-work': 'Organize todos by priority level',
};

const TODO_JOB_COMMANDS: Record<string, string[]> = {
	'manage-daily-tasks': ['todo-create', 'todo-update', 'todo-toggle', 'todo-delete'],
	'track-progress': ['todo-stats', 'todo-list'],
	'batch-operations': ['todo-create-batch', 'todo-delete-batch', 'todo-toggle-batch', 'todo-clear'],
	'prioritize-work': ['todo-list', 'todo-update'],
};

// ============================================================================
// File Mapping
// ============================================================================

function mapTodoFileToCommands(filePath: string): string[] {
	const fileName = filePath.split('/').pop() ?? filePath;

	// Map source files to commands
	const mappings: Record<string, string[]> = {
		'create.ts': ['todo-create'],
		'list.ts': ['todo-list'],
		'get.ts': ['todo-get'],
		'update.ts': ['todo-update'],
		'toggle.ts': ['todo-toggle'],
		'delete.ts': ['todo-delete'],
		'clear.ts': ['todo-clear'],
		'stats.ts': ['todo-stats'],
		'batch.ts': ['todo-create-batch', 'todo-delete-batch', 'todo-toggle-batch'],
		'store.ts': TODO_COMMANDS,
		'types.ts': TODO_COMMANDS,
		'index.ts': TODO_COMMANDS,
	};

	// Check for direct file match
	if (mappings[fileName]) {
		return mappings[fileName];
	}

	// Check for partial matches
	for (const [pattern, commands] of Object.entries(mappings)) {
		if (fileName.includes(pattern.replace('.ts', ''))) {
			return commands;
		}
	}

	// Default to all commands for unknown files
	return [];
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a todo adapter with custom configuration.
 */
export function createTodoAdapter(options: Partial<typeof todoAdapter> = {}): AppAdapter {
	return {
		...todoAdapter,
		...options,
		cli: { ...todoAdapter.cli, ...options.cli },
		fixture: { ...todoAdapter.fixture, ...options.fixture },
		commands: { ...todoAdapter.commands, ...options.commands },
		errors: { ...todoAdapter.errors, ...options.errors },
		jobs: { ...todoAdapter.jobs, ...options.jobs },
	};
}
