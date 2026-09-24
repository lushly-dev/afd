/**
 * @lushly-dev/afd-testing - Fixture Loader Tests
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { CommandResult } from '@lushly-dev/afd-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGenericAdapter } from '../adapters/generic.js';
import { registerAdapter, resetGlobalRegistry } from '../adapters/registry.js';
import { createTodoAdapter, todoAdapter } from '../adapters/todo.js';
import { applyFixture, type FixtureData, loadFixture } from './fixture-loader.js';

describe('loadFixture', () => {
	let testDir: string;

	beforeEach(async () => {
		// Create a unique temp directory for each test
		testDir = join(tmpdir(), `afd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		await mkdir(testDir, { recursive: true });
	});

	afterEach(async () => {
		// Clean up temp directory
		await rm(testDir, { recursive: true, force: true });
	});

	describe('basic loading', () => {
		it('loads a simple JSON fixture', async () => {
			const fixture = { app: 'todo', todos: [{ title: 'Test' }] };
			await writeFile(join(testDir, 'fixture.json'), JSON.stringify(fixture));

			const result = await loadFixture({ file: 'fixture.json' }, { basePath: testDir });

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.app).toBe('todo');
				expect(result.data.todos).toEqual([{ title: 'Test' }]);
			}
		});

		it('returns error for non-existent file', async () => {
			const result = await loadFixture({ file: 'missing.json' }, { basePath: testDir });

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('not found');
			}
		});

		it('returns error for invalid JSON', async () => {
			await writeFile(join(testDir, 'invalid.json'), '{ invalid json }');

			const result = await loadFixture({ file: 'invalid.json' }, { basePath: testDir });

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('Invalid JSON');
			}
		});

		it('resolves relative paths from basePath', async () => {
			const subDir = join(testDir, 'fixtures');
			await mkdir(subDir, { recursive: true });
			await writeFile(join(subDir, 'test.json'), JSON.stringify({ app: 'test' }));

			const result = await loadFixture({ file: 'fixtures/test.json' }, { basePath: testDir });

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.app).toBe('test');
				expect(result.path).toContain('fixtures');
			}
		});
	});

	describe('base fixture inheritance', () => {
		it('merges base fixture with main fixture', async () => {
			const baseFixture = {
				app: 'todo',
				version: '1.0.0',
				defaults: { priority: 'medium' },
			};
			const mainFixture = {
				todos: [{ title: 'Test' }],
				defaults: { priority: 'high' },
			};

			await writeFile(join(testDir, 'base.json'), JSON.stringify(baseFixture));
			await writeFile(join(testDir, 'main.json'), JSON.stringify(mainFixture));

			const result = await loadFixture(
				{ file: 'main.json', base: 'base.json' },
				{ basePath: testDir }
			);

			expect(result.success).toBe(true);
			if (result.success) {
				// Main fixture values override base
				expect(result.data.defaults).toEqual({ priority: 'high' });
				// Base values are preserved if not overridden
				expect(result.data.app).toBe('todo');
				expect(result.data.version).toBe('1.0.0');
				// Main-only values are included
				expect(result.data.todos).toEqual([{ title: 'Test' }]);
			}
		});

		it('returns error if base fixture not found', async () => {
			await writeFile(join(testDir, 'main.json'), JSON.stringify({ app: 'test' }));

			const result = await loadFixture(
				{ file: 'main.json', base: 'missing-base.json' },
				{ basePath: testDir }
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('base fixture');
			}
		});

		it('handles nested object merging', async () => {
			const baseFixture = {
				config: {
					api: { url: 'http://base.com', timeout: 5000 },
					debug: false,
				},
			};
			const mainFixture = {
				config: {
					api: { url: 'http://main.com' },
				},
			};

			await writeFile(join(testDir, 'base.json'), JSON.stringify(baseFixture));
			await writeFile(join(testDir, 'main.json'), JSON.stringify(mainFixture));

			const result = await loadFixture(
				{ file: 'main.json', base: 'base.json' },
				{ basePath: testDir }
			);

			expect(result.success).toBe(true);
			if (result.success) {
				const config = result.data.config as Record<string, unknown>;
				const api = config.api as Record<string, unknown>;
				// Nested override
				expect(api.url).toBe('http://main.com');
				// Preserved from base
				expect(api.timeout).toBe(5000);
				expect(config.debug).toBe(false);
			}
		});
	});

	describe('inline overrides', () => {
		it('applies inline overrides to loaded fixture', async () => {
			const fixture = {
				app: 'todo',
				todos: [{ title: 'Original' }],
			};
			await writeFile(join(testDir, 'fixture.json'), JSON.stringify(fixture));

			const result = await loadFixture(
				{
					file: 'fixture.json',
					overrides: { todos: [{ title: 'Overridden' }] },
				},
				{ basePath: testDir }
			);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.todos).toEqual([{ title: 'Overridden' }]);
				expect(result.data.app).toBe('todo');
			}
		});

		it('combines base, main, and overrides correctly', async () => {
			const base = { level: 'base', a: 1, b: 2 };
			const main = { level: 'main', b: 20, c: 3 };
			const overrides = { level: 'override', c: 30, d: 4 };

			await writeFile(join(testDir, 'base.json'), JSON.stringify(base));
			await writeFile(join(testDir, 'main.json'), JSON.stringify(main));

			const result = await loadFixture(
				{ file: 'main.json', base: 'base.json', overrides },
				{ basePath: testDir }
			);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.level).toBe('override'); // Override wins
				expect(result.data.a).toBe(1); // From base
				expect(result.data.b).toBe(20); // Main overrides base
				expect(result.data.c).toBe(30); // Override overrides main
				expect(result.data.d).toBe(4); // Only in override
			}
		});
	});

	describe('array handling', () => {
		it('replaces arrays instead of merging', async () => {
			const baseFixture = {
				todos: [{ title: 'Base 1' }, { title: 'Base 2' }],
			};
			const mainFixture = {
				todos: [{ title: 'Main 1' }],
			};

			await writeFile(join(testDir, 'base.json'), JSON.stringify(baseFixture));
			await writeFile(join(testDir, 'main.json'), JSON.stringify(mainFixture));

			const result = await loadFixture(
				{ file: 'main.json', base: 'base.json' },
				{ basePath: testDir }
			);

			expect(result.success).toBe(true);
			if (result.success) {
				// Arrays are replaced, not concatenated
				expect(result.data.todos).toEqual([{ title: 'Main 1' }]);
			}
		});
	});
});

describe('loadFixture containment and errors', () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), 'afd-fixture-root-'));
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	it('does not echo file contents when the JSON is invalid', async () => {
		await writeFile(join(testDir, 'secret.json'), 'root:x:0:0:root:/root:/bin/bash');

		const result = await loadFixture({ file: 'secret.json' }, { basePath: testDir });

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toContain('Invalid JSON');
			expect(result.error).not.toContain('root:x');
		}
	});

	it('reports the position of a JSON syntax error', async () => {
		await writeFile(join(testDir, 'bad.json'), '{"a": 1, secret}');

		const result = await loadFixture({ file: 'bad.json' }, { basePath: testDir });

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toMatch(/at position \d+/);
			expect(result.error).not.toContain('secret');
		}
	});

	it('rejects fixture files outside rootDir', async () => {
		const outside = await mkdtemp(join(tmpdir(), 'afd-fixture-outside-'));
		try {
			await writeFile(join(outside, 'f.json'), '{}');
			const root = join(testDir, 'root');
			await mkdir(root);

			const escaped = await loadFixture(
				{ file: `../../${basename(outside)}/f.json` },
				{ basePath: root, rootDir: root }
			);
			const absolute = await loadFixture({ file: join(outside, 'f.json') }, { rootDir: root });

			for (const result of [escaped, absolute]) {
				expect(result.success).toBe(false);
				if (!result.success) expect(result.error).toContain('outside the allowed directory');
			}
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	it('rejects a base fixture that escapes rootDir through a symlinked directory', async () => {
		const outside = await mkdtemp(join(tmpdir(), 'afd-fixture-outside-'));
		try {
			await writeFile(join(outside, 'base.json'), '{}');
			await writeFile(join(testDir, 'main.json'), '{}');
			await symlink(outside, join(testDir, 'link'), 'dir');

			const result = await loadFixture(
				{ file: 'main.json', base: 'link/base.json' },
				{ basePath: testDir, rootDir: testDir }
			);

			expect(result.success).toBe(false);
			if (!result.success) expect(result.error).toContain('Fixture base');
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	it('loads fixtures inside rootDir', async () => {
		await writeFile(join(testDir, 'ok.json'), '{"app":"todo"}');

		const result = await loadFixture({ file: 'ok.json' }, { basePath: testDir, rootDir: testDir });

		expect(result.success).toBe(true);
	});

	it('validates the merged fixture with its adapter when asked', async () => {
		await writeFile(join(testDir, 'todo.json'), JSON.stringify({ app: 'todo', todos: [{}] }));
		await writeFile(join(testDir, 'none.json'), JSON.stringify({ app: 'violet' }));
		await writeFile(join(testDir, 'good.json'), JSON.stringify({ app: 'todo', todos: [] }));

		const invalid = await loadFixture({ file: 'todo.json' }, { basePath: testDir, validate: true });
		const noAdapter = await loadFixture(
			{ file: 'none.json' },
			{ basePath: testDir, validate: true }
		);
		const valid = await loadFixture({ file: 'good.json' }, { basePath: testDir, validate: true });

		expect(invalid.success).toBe(false);
		if (!invalid.success) expect(invalid.error).toContain("must have a 'title'");
		expect(noAdapter.success).toBe(false);
		if (!noAdapter.success)
			expect(noAdapter.error).toContain("No fixture adapter for app 'violet'");
		expect(valid.success).toBe(true);
	});
});

describe('applyFixture', () => {
	afterEach(() => {
		resetGlobalRegistry();
	});

	describe('todo app fixtures', () => {
		it('clears every todo and creates new ones with kebab-case commands', async () => {
			const commands: Array<{ command: string; input?: Record<string, unknown> }> = [];

			const handler = async (command: string, input?: Record<string, unknown>) => {
				commands.push({ command, input });
				return { success: true, data: { id: `todo-${commands.length}` } };
			};

			const fixture: FixtureData = {
				app: 'todo',
				clearFirst: true,
				todos: [
					{ title: 'Todo 1', priority: 'high' },
					{ title: 'Todo 2', priority: 'low', completed: true },
				],
			};

			const result = await applyFixture(fixture, handler);

			expect(result.success).toBe(true);
			expect(commands.map((c) => c.command)).toEqual([
				'todo-clear',
				'todo-create',
				'todo-create',
				'todo-toggle',
			]);
			expect(commands[0]?.input).toEqual({ all: true });
			expect(commands[1]?.input).toEqual({ title: 'Todo 1', priority: 'high' });
			expect(commands[3]?.input).toEqual({ id: 'todo-3' });
			expect(result.appliedCommands.map((c) => c.command)).toEqual(commands.map((c) => c.command));
		});

		it('skips clear when clearFirst is false', async () => {
			const commands: string[] = [];

			const handler = async (command: string) => {
				commands.push(command);
				return { success: true };
			};

			await applyFixture({ app: 'todo', clearFirst: false, todos: [{ title: 'Todo 1' }] }, handler);

			expect(commands).toEqual(['todo-create']);
		});

		it('uses default priority when not specified', async () => {
			const inputs: Array<Record<string, unknown>> = [];

			const handler = async (_command: string, input?: Record<string, unknown>) => {
				if (input) inputs.push(input);
				return { success: true };
			};

			await applyFixture({ app: 'todo', todos: [{ title: 'No priority specified' }] }, handler);

			const createInput = inputs.find((i) => i.title);
			expect(createInput?.priority).toBe('medium');
		});

		it('fails, naming the command and error code, when a fixture command fails', async () => {
			// The pre-fix loader wrapped every result in { success: true } and reported success
			const handler = async (command: string): Promise<CommandResult<unknown>> =>
				command === 'todo-create'
					? { success: false, error: { code: 'COMMAND_NOT_FOUND', message: 'Unknown command' } }
					: { success: true, data: { cleared: 0 } };

			const result = await applyFixture(
				{ app: 'todo', todos: [{ title: 'A' }, { title: 'B' }] },
				handler
			);

			expect(result.success).toBe(false);
			expect(result.error).toBe(
				"Fixture command 'todo-create' failed with COMMAND_NOT_FOUND: Unknown command"
			);
			expect(result.appliedCommands.map((c) => c.command)).toEqual(['todo-clear', 'todo-create']);
		});

		it('fails when the handler does not return a CommandResult', async () => {
			const handler = vi.fn().mockResolvedValue('ok');

			const result = await applyFixture({ app: 'todo', todos: [] }, handler);

			expect(result.success).toBe(false);
			expect(result.error).toContain('INVALID_COMMAND_RESULT');
		});
	});

	describe('adapter selection', () => {
		it('fails loudly for an app without an adapter instead of applying nothing', async () => {
			const handler = vi.fn();

			const result = await applyFixture({ app: 'violet', nodes: [{ id: 'global' }] }, handler);

			expect(result.success).toBe(false);
			expect(result.error).toContain("No fixture adapter for app 'violet'");
			expect(handler).not.toHaveBeenCalled();
		});

		it('fails for a fixture with nothing to apply', async () => {
			const result = await applyFixture({ description: 'just data' }, vi.fn());

			expect(result.success).toBe(false);
			expect(result.error).toContain('nothing to apply');
		});

		it('uses a registered adapter for the fixture app', async () => {
			registerAdapter(createGenericAdapter('violet'));
			const handler = vi.fn().mockResolvedValue({ success: true });

			const result = await applyFixture(
				{ app: 'violet', setup: [{ command: 'node-create', input: { id: 'global' } }] },
				handler
			);

			expect(result.success).toBe(true);
			expect(handler).toHaveBeenCalledWith('node-create', { id: 'global' }, { signal: undefined });
		});

		it('returns adapter warnings', async () => {
			const warningAdapter = createTodoAdapter({
				name: 'noisy',
				fixture: {
					...todoAdapter.fixture,
					apply: async (_fixture, context) => {
						const result = await context.handler?.('noisy-seed', {});
						return {
							appliedCommands: [{ command: 'noisy-seed', input: {}, result }],
							warnings: ['seed data is stale'],
						};
					},
				},
			});
			const handler = vi.fn().mockResolvedValue({ success: true });

			const result = await applyFixture({ app: 'noisy' }, handler, { adapter: warningAdapter });

			expect(result).toEqual({
				success: true,
				appliedCommands: [{ command: 'noisy-seed', input: {} }],
				warnings: ['seed data is stale'],
			});
		});

		it('stops before the first command once the signal is aborted', async () => {
			const controller = new AbortController();
			controller.abort(new Error('cancelled'));
			const handler = vi.fn().mockResolvedValue({ success: true });

			const result = await applyFixture({ app: 'todo', todos: [{ title: 'A' }] }, handler, {
				signal: controller.signal,
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe('cancelled');
			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe('generic fixtures', () => {
		it('executes setup commands array', async () => {
			const commands: Array<{ command: string; input?: Record<string, unknown> }> = [];

			const handler = async (command: string, input?: Record<string, unknown>) => {
				commands.push({ command, input });
				return { success: true };
			};

			const fixture: FixtureData = {
				app: 'custom',
				setup: [
					{ command: 'custom-init', input: { name: 'test' } },
					{ command: 'custom-configure', input: { option: true } },
				],
			};

			const result = await applyFixture(fixture, handler);

			expect(result.success).toBe(true);
			expect(commands).toEqual([
				{ command: 'custom-init', input: { name: 'test' } },
				{ command: 'custom-configure', input: { option: true } },
			]);
		});

		it('handles empty setup array', async () => {
			const handler = async () => ({ success: true });

			const result = await applyFixture({ app: 'custom', setup: [] }, handler);

			expect(result.success).toBe(true);
			expect(result.appliedCommands).toHaveLength(0);
		});
	});

	describe('error handling', () => {
		it('returns error when handler throws', async () => {
			const handler = async () => {
				throw new Error('Handler failed');
			};

			const result = await applyFixture({ app: 'todo', todos: [{ title: 'Test' }] }, handler);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Handler failed');
		});

		it('includes applied commands even on failure', async () => {
			let callCount = 0;
			const handler = async () => {
				callCount++;
				if (callCount === 2) {
					throw new Error('Second call failed');
				}
				return { success: true };
			};

			const result = await applyFixture(
				{ app: 'todo', todos: [{ title: 'Todo 1' }, { title: 'Todo 2' }] },
				handler
			);

			expect(result.success).toBe(false);
			expect(result.appliedCommands.map((c) => c.command)).toEqual(['todo-clear']);
		});
	});
});
