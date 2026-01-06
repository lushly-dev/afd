import { describe, expect, it } from 'vitest';
import { createCommandRegistry, type CommandDefinition } from './commands.js';
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
});
