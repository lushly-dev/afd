import { describe, expect, it } from 'vitest';
import {
	type CommandDefinition,
	commandsToMcpTools,
	commandToMcpTool,
	createCommandRegistry,
	defaultExpose,
	isMcpExposed,
	validateCommandName,
} from './commands.js';
import { failure, success } from './result.js';

describe('createCommandRegistry', () => {
	describe('listByTags', () => {
		it('returns commands matching ALL tags when mode is "all"', () => {
			const registry = createCommandRegistry();

			const cmd1: CommandDefinition = {
				name: 'cmd1',
				description: 'Command 1',
				parameters: [],
				tags: ['crud', 'read'],
				handler: async () => success(null),
			};

			const cmd2: CommandDefinition = {
				name: 'cmd2',
				description: 'Command 2',
				parameters: [],
				tags: ['crud', 'write'],
				handler: async () => success(null),
			};

			const cmd3: CommandDefinition = {
				name: 'cmd3',
				description: 'Command 3',
				parameters: [],
				tags: ['crud', 'read', 'write'],
				handler: async () => success(null),
			};

			registry.register(cmd1);
			registry.register(cmd2);
			registry.register(cmd3);

			const result = registry.listByTags(['crud', 'read'], 'all');

			expect(result).toHaveLength(2);
			expect(result.map((c) => c.name)).toContain('cmd1');
			expect(result.map((c) => c.name)).toContain('cmd3');
		});

		it('returns commands matching ANY tag when mode is "any"', () => {
			const registry = createCommandRegistry();

			const cmd1: CommandDefinition = {
				name: 'cmd1',
				description: 'Command 1',
				parameters: [],
				tags: ['read'],
				handler: async () => success(null),
			};

			const cmd2: CommandDefinition = {
				name: 'cmd2',
				description: 'Command 2',
				parameters: [],
				tags: ['write'],
				handler: async () => success(null),
			};

			const cmd3: CommandDefinition = {
				name: 'cmd3',
				description: 'Command 3',
				parameters: [],
				tags: ['delete'],
				handler: async () => success(null),
			};

			registry.register(cmd1);
			registry.register(cmd2);
			registry.register(cmd3);

			const result = registry.listByTags(['read', 'write'], 'any');

			expect(result).toHaveLength(2);
			expect(result.map((c) => c.name)).toContain('cmd1');
			expect(result.map((c) => c.name)).toContain('cmd2');
		});

		it('returns empty array when tags array is empty', () => {
			const registry = createCommandRegistry();

			const cmd: CommandDefinition = {
				name: 'cmd1',
				description: 'Command 1',
				parameters: [],
				tags: ['crud'],
				handler: async () => success(null),
			};

			registry.register(cmd);

			expect(registry.listByTags([], 'all')).toEqual([]);
			expect(registry.listByTags([], 'any')).toEqual([]);
		});

		it('excludes commands without tags', () => {
			const registry = createCommandRegistry();

			const cmdWithTags: CommandDefinition = {
				name: 'cmd1',
				description: 'Command with tags',
				parameters: [],
				tags: ['crud'],
				handler: async () => success(null),
			};

			const cmdWithoutTags: CommandDefinition = {
				name: 'cmd2',
				description: 'Command without tags',
				parameters: [],
				handler: async () => success(null),
			};

			const cmdWithEmptyTags: CommandDefinition = {
				name: 'cmd3',
				description: 'Command with empty tags',
				parameters: [],
				tags: [],
				handler: async () => success(null),
			};

			registry.register(cmdWithTags);
			registry.register(cmdWithoutTags);
			registry.register(cmdWithEmptyTags);

			const resultAll = registry.listByTags(['crud'], 'all');
			const resultAny = registry.listByTags(['crud'], 'any');

			expect(resultAll).toHaveLength(1);
			expect(resultAll[0]?.name).toBe('cmd1');

			expect(resultAny).toHaveLength(1);
			expect(resultAny[0]?.name).toBe('cmd1');
		});

		it('returns empty array when no commands match', () => {
			const registry = createCommandRegistry();

			const cmd: CommandDefinition = {
				name: 'cmd1',
				description: 'Command 1',
				parameters: [],
				tags: ['read'],
				handler: async () => success(null),
			};

			registry.register(cmd);

			expect(registry.listByTags(['write'], 'all')).toEqual([]);
			expect(registry.listByTags(['write'], 'any')).toEqual([]);
		});

		it('handles "all" mode requiring every tag to be present', () => {
			const registry = createCommandRegistry();

			const cmd: CommandDefinition = {
				name: 'cmd1',
				description: 'Command 1',
				parameters: [],
				tags: ['read'],
				handler: async () => success(null),
			};

			registry.register(cmd);

			// Command has only 'read', not both 'read' and 'write'
			expect(registry.listByTags(['read', 'write'], 'all')).toEqual([]);
			expect(registry.listByTags(['read'], 'all')).toHaveLength(1);
		});
	});

	describe('listByExposure', () => {
		it('returns commands exposed to specified interface', () => {
			const registry = createCommandRegistry();

			const mcpCmd: CommandDefinition = {
				name: 'mcp.cmd',
				description: 'MCP exposed command',
				parameters: [],
				expose: { mcp: true },
				handler: async () => success(null),
			};

			const cliCmd: CommandDefinition = {
				name: 'cli.cmd',
				description: 'CLI exposed command',
				parameters: [],
				expose: { cli: true },
				handler: async () => success(null),
			};

			const defaultCmd: CommandDefinition = {
				name: 'default.cmd',
				description: 'Default exposed command',
				parameters: [],
				handler: async () => success(null),
			};

			registry.register(mcpCmd);
			registry.register(cliCmd);
			registry.register(defaultCmd);

			const mcpResults = registry.listByExposure('mcp');
			expect(mcpResults).toHaveLength(1);
			expect(mcpResults[0]?.name).toBe('mcp.cmd');

			const cliResults = registry.listByExposure('cli');
			expect(cliResults).toHaveLength(1);
			expect(cliResults[0]?.name).toBe('cli.cmd');

			// Default commands have palette and agent enabled
			const paletteResults = registry.listByExposure('palette');
			expect(paletteResults).toHaveLength(1);
			expect(paletteResults[0]?.name).toBe('default.cmd');

			const agentResults = registry.listByExposure('agent');
			expect(agentResults).toHaveLength(1);
			expect(agentResults[0]?.name).toBe('default.cmd');
		});

		it('uses defaultExpose when expose is not specified', () => {
			const registry = createCommandRegistry();

			const cmd: CommandDefinition = {
				name: 'cmd1',
				description: 'Command without explicit expose',
				parameters: [],
				handler: async () => success(null),
			};

			registry.register(cmd);

			// defaultExpose has palette: true, agent: true, mcp: false, cli: false
			expect(registry.listByExposure('palette')).toHaveLength(1);
			expect(registry.listByExposure('agent')).toHaveLength(1);
			expect(registry.listByExposure('mcp')).toHaveLength(0);
			expect(registry.listByExposure('cli')).toHaveLength(0);
		});
	});

	describe('execute with interface context', () => {
		it('returns COMMAND_NOT_EXPOSED when command not exposed to interface', async () => {
			const registry = createCommandRegistry();

			const cmd: CommandDefinition = {
				name: 'palette.only',
				description: 'Only exposed to palette',
				parameters: [],
				expose: { palette: true, mcp: false },
				handler: async () => success({ done: true }),
			};

			registry.register(cmd);

			const result = await registry.execute('palette.only', {}, { interface: 'mcp' });

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('COMMAND_NOT_EXPOSED');
			expect(result.error?.message).toContain('palette.only');
			expect(result.error?.message).toContain('mcp');
		});

		it('executes command when exposed to interface', async () => {
			const registry = createCommandRegistry();

			const cmd: CommandDefinition = {
				name: 'mcp.exposed',
				description: 'Exposed to MCP',
				parameters: [],
				expose: { mcp: true },
				handler: async () => success({ done: true }),
			};

			registry.register(cmd);

			const result = await registry.execute('mcp.exposed', {}, { interface: 'mcp' });

			expect(result.success).toBe(true);
			expect(result.data).toEqual({ done: true });
		});

		it('executes command without interface check when context.interface is undefined', async () => {
			const registry = createCommandRegistry();

			const cmd: CommandDefinition = {
				name: 'restricted',
				description: 'Not exposed anywhere',
				parameters: [],
				expose: { palette: false, mcp: false, agent: false, cli: false },
				handler: async () => success({ done: true }),
			};

			registry.register(cmd);

			// No interface context = no check
			const result = await registry.execute('restricted', {});

			expect(result.success).toBe(true);
		});
	});
});

describe('isMcpExposed', () => {
	it('returns true when expose.mcp is true', () => {
		const cmd: CommandDefinition = {
			name: 'mcp.cmd',
			description: 'MCP command',
			parameters: [],
			expose: { mcp: true },
			handler: async () => success(null),
		};

		expect(isMcpExposed(cmd)).toBe(true);
	});

	it('returns false when expose.mcp is false', () => {
		const cmd: CommandDefinition = {
			name: 'no.mcp',
			description: 'No MCP',
			parameters: [],
			expose: { mcp: false },
			handler: async () => success(null),
		};

		expect(isMcpExposed(cmd)).toBe(false);
	});

	it('returns false when expose is not specified (uses defaultExpose)', () => {
		const cmd: CommandDefinition = {
			name: 'default',
			description: 'Default',
			parameters: [],
			handler: async () => success(null),
		};

		// defaultExpose.mcp is false
		expect(isMcpExposed(cmd)).toBe(false);
	});
});

describe('commandsToMcpTools', () => {
	it('filters commands by MCP exposure and converts to MCP format', () => {
		const mcpCmd: CommandDefinition = {
			name: 'mcp.tool',
			description: 'MCP tool',
			parameters: [{ name: 'input', type: 'string', description: 'Input value', required: true }],
			expose: { mcp: true },
			handler: async () => success(null),
		};

		const nonMcpCmd: CommandDefinition = {
			name: 'palette.only',
			description: 'Palette only',
			parameters: [],
			expose: { palette: true, mcp: false },
			handler: async () => success(null),
		};

		const defaultCmd: CommandDefinition = {
			name: 'default',
			description: 'Default',
			parameters: [],
			handler: async () => success(null),
		};

		const tools = commandsToMcpTools([mcpCmd, nonMcpCmd, defaultCmd]);

		expect(tools).toHaveLength(1);
		expect(tools[0]?.name).toBe('mcp.tool');
		expect(tools[0]?.description).toBe('MCP tool');
		expect(tools[0]?.inputSchema.required).toEqual(['input']);
	});

	it('returns empty array when no commands are MCP exposed', () => {
		const cmd: CommandDefinition = {
			name: 'no.mcp',
			description: 'No MCP',
			parameters: [],
			handler: async () => success(null),
		};

		const tools = commandsToMcpTools([cmd]);

		expect(tools).toHaveLength(0);
	});
});

describe('validateCommandName', () => {
	it('accepts valid kebab-case names', () => {
		expect(validateCommandName('todo-create').valid).toBe(true);
		expect(validateCommandName('user-get').valid).toBe(true);
		expect(validateCommandName('todo-create-batch').valid).toBe(true);
		expect(validateCommandName('afd-help').valid).toBe(true);
		expect(validateCommandName('order-list').valid).toBe(true);
	});

	it('rejects empty names', () => {
		const result = validateCommandName('');
		expect(result.valid).toBe(false);
		expect(result.reason).toContain('empty');
	});

	it('rejects single-segment names', () => {
		expect(validateCommandName('create').valid).toBe(false);
		expect(validateCommandName('todo').valid).toBe(false);
	});

	it('rejects camelCase names', () => {
		expect(validateCommandName('todo-createBatch').valid).toBe(false);
		expect(validateCommandName('todoCreate').valid).toBe(false);
	});

	it('rejects uppercase names', () => {
		expect(validateCommandName('TODO-CREATE').valid).toBe(false);
		expect(validateCommandName('Todo-Create').valid).toBe(false);
	});

	it('rejects dot notation names', () => {
		expect(validateCommandName('todo.create').valid).toBe(false);
	});

	it('rejects underscore names', () => {
		expect(validateCommandName('todo_create').valid).toBe(false);
	});

	it('allows numbers in segments', () => {
		expect(validateCommandName('v2-migrate').valid).toBe(true);
		expect(validateCommandName('todo-create2').valid).toBe(true);
	});

	it('rejects names starting with numbers', () => {
		expect(validateCommandName('2todo-create').valid).toBe(false);
	});

	it('rejects names with consecutive hyphens', () => {
		expect(validateCommandName('todo--create').valid).toBe(false);
	});
});

describe('defaultExpose', () => {
	it('has expected default values', () => {
		expect(defaultExpose.palette).toBe(true);
		expect(defaultExpose.agent).toBe(true);
		expect(defaultExpose.mcp).toBe(false);
		expect(defaultExpose.cli).toBe(false);
	});

	it('is frozen', () => {
		expect(Object.isFrozen(defaultExpose)).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEW TESTS: Registry CRUD, execute error paths, batch, stream, commandToMcpTool
// ═══════════════════════════════════════════════════════════════════════════════

describe('createCommandRegistry - register', () => {
	it('throws on duplicate registration', () => {
		const registry = createCommandRegistry();
		const cmd: CommandDefinition = {
			name: 'dup-cmd',
			description: 'First',
			parameters: [],
			handler: async () => success(null),
		};
		registry.register(cmd);
		expect(() => registry.register(cmd)).toThrow("Command 'dup-cmd' is already registered");
	});
});

describe('createCommandRegistry - get/has/list/listByCategory', () => {
	it('get returns command by name', () => {
		const registry = createCommandRegistry();
		const cmd: CommandDefinition = {
			name: 'my-cmd',
			description: 'test',
			parameters: [],
			handler: async () => success(null),
		};
		registry.register(cmd);
		expect(registry.get('my-cmd')).toBe(cmd);
	});

	it('get returns undefined for unknown command', () => {
		const registry = createCommandRegistry();
		expect(registry.get('nonexistent-cmd')).toBeUndefined();
	});

	it('has returns true for registered commands', () => {
		const registry = createCommandRegistry();
		const cmd: CommandDefinition = {
			name: 'exists-cmd',
			description: 'test',
			parameters: [],
			handler: async () => success(null),
		};
		registry.register(cmd);
		expect(registry.has('exists-cmd')).toBe(true);
		expect(registry.has('nope-cmd')).toBe(false);
	});

	it('list returns all registered commands', () => {
		const registry = createCommandRegistry();
		const cmd1: CommandDefinition = {
			name: 'cmd-one',
			description: 'one',
			parameters: [],
			handler: async () => success(null),
		};
		const cmd2: CommandDefinition = {
			name: 'cmd-two',
			description: 'two',
			parameters: [],
			handler: async () => success(null),
		};
		registry.register(cmd1);
		registry.register(cmd2);
		expect(registry.list()).toHaveLength(2);
	});

	it('listByCategory filters by category', () => {
		const registry = createCommandRegistry();
		const cmd1: CommandDefinition = {
			name: 'cat-one',
			description: 'one',
			category: 'alpha',
			parameters: [],
			handler: async () => success(null),
		};
		const cmd2: CommandDefinition = {
			name: 'cat-two',
			description: 'two',
			category: 'beta',
			parameters: [],
			handler: async () => success(null),
		};
		registry.register(cmd1);
		registry.register(cmd2);
		expect(registry.listByCategory('alpha')).toHaveLength(1);
		expect(registry.listByCategory('alpha')[0]?.name).toBe('cat-one');
		expect(registry.listByCategory('gamma')).toHaveLength(0);
	});
});

describe('createCommandRegistry - execute error paths', () => {
	it('returns COMMAND_NOT_FOUND for missing command', async () => {
		const registry = createCommandRegistry();
		const result = await registry.execute('not-found', {});
		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('COMMAND_NOT_FOUND');
	});

	it('catches handler exceptions and returns COMMAND_EXECUTION_ERROR', async () => {
		const registry = createCommandRegistry();
		const cmd: CommandDefinition = {
			name: 'throw-cmd',
			description: 'throws',
			parameters: [],
			handler: async () => {
				throw new Error('handler exploded');
			},
		};
		registry.register(cmd);
		const result = await registry.execute('throw-cmd', {});
		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('COMMAND_EXECUTION_ERROR');
		expect(result.error?.message).toContain('handler exploded');
	});

	it('catches non-Error throws', async () => {
		const registry = createCommandRegistry();
		const cmd: CommandDefinition = {
			name: 'throw-string',
			description: 'throws string',
			parameters: [],
			handler: async () => {
				throw 'string error';
			},
		};
		registry.register(cmd);
		const result = await registry.execute('throw-string', {});
		expect(result.success).toBe(false);
		expect(result.error?.message).toBe('string error');
	});
});

describe('createCommandRegistry - executeBatch', () => {
	function makeRegistry() {
		const registry = createCommandRegistry();
		registry.register({
			name: 'pass-cmd',
			description: 'passes',
			parameters: [],
			handler: async (input) => success(input),
		});
		registry.register({
			name: 'fail-cmd',
			description: 'fails',
			parameters: [],
			handler: async () => failure({ code: 'FAIL', message: 'intentional' }),
		});
		return registry;
	}

	it('rejects empty batch', async () => {
		const registry = makeRegistry();
		const result = await registry.executeBatch({ commands: [] });
		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('INVALID_BATCH_REQUEST');
	});

	it('executes sequential batch successfully', async () => {
		const registry = makeRegistry();
		const result = await registry.executeBatch({
			commands: [
				{ command: 'pass-cmd', input: { a: 1 } },
				{ command: 'pass-cmd', input: { b: 2 } },
			],
		});
		expect(result.success).toBe(true);
		expect(result.results).toHaveLength(2);
		expect(result.summary.successCount).toBe(2);
		expect(result.timing.totalMs).toBeGreaterThanOrEqual(0);
	});

	it('stopOnError skips remaining commands', async () => {
		const registry = makeRegistry();
		const result = await registry.executeBatch({
			commands: [
				{ command: 'fail-cmd', input: {} },
				{ command: 'pass-cmd', input: {} },
			],
			options: { stopOnError: true },
		});
		expect(result.results).toHaveLength(2);
		expect(result.results[0]?.result.success).toBe(false);
		expect(result.results[1]?.result.error?.code).toBe('COMMAND_SKIPPED');
	});

	it('uses custom IDs when provided', async () => {
		const registry = makeRegistry();
		const result = await registry.executeBatch({
			commands: [{ id: 'custom-1', command: 'pass-cmd', input: {} }],
		});
		expect(result.results[0]?.id).toBe('custom-1');
	});

	it('generates default IDs when not provided', async () => {
		const registry = makeRegistry();
		const result = await registry.executeBatch({
			commands: [{ command: 'pass-cmd', input: {} }],
		});
		expect(result.results[0]?.id).toBe('cmd-0');
	});

	it('executes parallel batch', async () => {
		const registry = makeRegistry();
		const result = await registry.executeBatch({
			commands: [
				{ command: 'pass-cmd', input: { a: 1 } },
				{ command: 'pass-cmd', input: { b: 2 } },
				{ command: 'pass-cmd', input: { c: 3 } },
			],
			options: { parallelism: 2 },
		});
		expect(result.success).toBe(true);
		expect(result.results).toHaveLength(3);
		expect(result.summary.successCount).toBe(3);
	});

	it('parallel batch stopOnError skips remaining', async () => {
		const registry = makeRegistry();
		const result = await registry.executeBatch({
			commands: [
				{ command: 'fail-cmd', input: {} },
				{ command: 'pass-cmd', input: {} },
				{ command: 'pass-cmd', input: {} },
				{ command: 'pass-cmd', input: {} },
			],
			options: { parallelism: 2, stopOnError: true },
		});
		// First batch of 2 runs (fail + pass), then remaining skipped
		const skipped = result.results.filter((r) => r.result.error?.code === 'COMMAND_SKIPPED');
		expect(skipped.length).toBe(2);
	});

	it('timeout skips remaining commands', async () => {
		const registry = createCommandRegistry();
		registry.register({
			name: 'slow-cmd',
			description: 'slow',
			parameters: [],
			handler: async () => {
				await new Promise((r) => setTimeout(r, 50));
				return success('done');
			},
		});
		const result = await registry.executeBatch({
			commands: [
				{ command: 'slow-cmd', input: {} },
				{ command: 'slow-cmd', input: {} },
				{ command: 'slow-cmd', input: {} },
			],
			options: { timeout: 10 },
		});
		const timeouts = result.results.filter((r) => r.result.error?.code === 'BATCH_TIMEOUT');
		expect(timeouts.length).toBeGreaterThan(0);
	});
});

describe('createCommandRegistry - executeStream', () => {
	it('streams single result as one data chunk + complete', async () => {
		const registry = createCommandRegistry();
		registry.register({
			name: 'single-cmd',
			description: 'single',
			parameters: [],
			handler: async () => success({ value: 42 }),
		});

		const chunks = [];
		for await (const chunk of registry.executeStream('single-cmd', {})) {
			chunks.push(chunk);
		}
		expect(chunks).toHaveLength(2);
		expect(chunks[0]?.type).toBe('data');
		expect(chunks[1]?.type).toBe('complete');
	});

	it('streams array results as multiple data chunks', async () => {
		const registry = createCommandRegistry();
		registry.register({
			name: 'array-cmd',
			description: 'array',
			parameters: [],
			handler: async () => success([1, 2, 3]),
		});

		const chunks = [];
		for await (const chunk of registry.executeStream('array-cmd', {})) {
			chunks.push(chunk);
		}
		// 3 data chunks + 1 complete
		expect(chunks).toHaveLength(4);
		expect(chunks[0]?.type).toBe('data');
		expect(chunks[1]?.type).toBe('data');
		expect(chunks[2]?.type).toBe('data');
		expect(chunks[3]?.type).toBe('complete');
	});

	it('emits error chunk for missing command', async () => {
		const registry = createCommandRegistry();
		const chunks = [];
		for await (const chunk of registry.executeStream('missing-cmd', {})) {
			chunks.push(chunk);
		}
		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.type).toBe('error');
	});

	it('emits error chunk when already aborted', async () => {
		const registry = createCommandRegistry();
		registry.register({
			name: 'abort-test',
			description: 'test',
			parameters: [],
			handler: async () => success('ok'),
		});

		const controller = new AbortController();
		controller.abort();

		const chunks = [];
		for await (const chunk of registry.executeStream(
			'abort-test',
			{},
			{
				signal: controller.signal,
			}
		)) {
			chunks.push(chunk);
		}
		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.type).toBe('error');
		if (chunks[0]?.type === 'error') {
			expect(chunks[0].error.code).toBe('STREAM_ABORTED');
		}
	});

	it('emits error chunk for handler exceptions', async () => {
		const registry = createCommandRegistry();
		registry.register({
			name: 'throw-stream',
			description: 'throws',
			parameters: [],
			handler: async () => {
				throw new Error('stream error');
			},
		});

		const chunks = [];
		for await (const chunk of registry.executeStream('throw-stream', {})) {
			chunks.push(chunk);
		}
		// The execute method catches the error, so it comes back as command error,
		// then stream emits error chunk
		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.type).toBe('error');
	});
});

describe('commandToMcpTool', () => {
	it('converts parameters to inputSchema', () => {
		const cmd: CommandDefinition = {
			name: 'test-tool',
			description: 'A test tool',
			parameters: [
				{ name: 'title', type: 'string', description: 'The title', required: true },
				{ name: 'count', type: 'number', description: 'A count', required: false },
			],
			handler: async () => success(null),
		};

		const tool = commandToMcpTool(cmd);
		expect(tool.name).toBe('test-tool');
		expect(tool.description).toBe('A test tool');
		expect(tool.inputSchema.type).toBe('object');
		expect(tool.inputSchema.required).toEqual(['title']);
		expect(tool.inputSchema.properties.title).toEqual({
			type: 'string',
			description: 'The title',
		});
		expect(tool.inputSchema.properties.count).toEqual({
			type: 'number',
			description: 'A count',
		});
	});

	it('uses custom schema when provided', () => {
		const customSchema = { type: 'string' as const, description: 'custom', minLength: 1 };
		const cmd: CommandDefinition = {
			name: 'custom-schema',
			description: 'test',
			parameters: [
				{
					name: 'input',
					type: 'string',
					description: 'Input',
					required: true,
					schema: customSchema,
				},
			],
			handler: async () => success(null),
		};

		const tool = commandToMcpTool(cmd);
		expect(tool.inputSchema.properties.input).toBe(customSchema);
	});

	it('includes default and enum in schema', () => {
		const cmd: CommandDefinition = {
			name: 'enum-cmd',
			description: 'test',
			parameters: [
				{
					name: 'format',
					type: 'string',
					description: 'Output format',
					required: false,
					default: 'json',
					enum: ['json', 'csv'],
				},
			],
			handler: async () => success(null),
		};

		const tool = commandToMcpTool(cmd);
		const prop = tool.inputSchema.properties.format;
		expect(prop.default).toBe('json');
		expect(prop.enum).toEqual(['json', 'csv']);
	});
});
