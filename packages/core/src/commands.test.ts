import { describe, expect, it } from 'vitest';
import {
	createCommandRegistry,
	type CommandDefinition,
	defaultExpose,
	isMcpExposed,
	commandsToMcpTools,
} from './commands.js';
import { success } from './result.js';

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
			parameters: [
				{ name: 'input', type: 'string', description: 'Input value', required: true },
			],
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
