/**
 * @fileoverview Integration tests for Violet CLI
 *
 * Tests CLI command registration and verifies CLI structure matches registry.
 * Core command logic is tested in @lushly-dev/violet-afd - these tests verify CLI integration.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	type CommandContext,
	buildOpenApiSpec,
	createMemoryDatabase,
	initializeCore,
	registry,
} from '@lushly-dev/violet-afd';
import { generateTools } from '@lushly-dev/violet-server';
import type { Command } from 'commander';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { createCLI, parseSpecimenAssignment } from './cli.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CLI STRUCTURE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Violet CLI Structure', () => {
	let cli: Command;

	beforeAll(() => {
		// Initialize core commands once
		initializeCore();
		// Create CLI without re-initializing
		cli = createCLI(true);
	});

	describe('CLI creation', () => {
		it('creates CLI program with correct name', () => {
			expect(cli.name()).toBe('violet');
		});

		it('has node subcommand', () => {
			const nodeCmd = cli.commands.find((c) => c.name() === 'node');
			expect(nodeCmd).toBeDefined();
		});

		it('has token subcommand', () => {
			const tokenCmd = cli.commands.find((c) => c.name() === 'token');
			expect(tokenCmd).toBeDefined();
		});

		it('has tokens command', () => {
			const tokensCmd = cli.commands.find((c) => c.name() === 'tokens');
			expect(tokensCmd).toBeDefined();
		});

		it('has commands utility', () => {
			const commandsCmd = cli.commands.find((c) => c.name() === 'commands');
			expect(commandsCmd).toBeDefined();
		});

		it('has doctor utility', () => {
			const doctorCmd = cli.commands.find((c) => c.name() === 'doctor');
			expect(doctorCmd).toBeDefined();
		});

		it('has call utility', () => {
			const callCmd = cli.commands.find((c) => c.name() === 'call');
			expect(callCmd).toBeDefined();
		});
	});

	describe('node subcommands', () => {
		it('has create, get, list, update, delete subcommands', () => {
			const nodeCmd = cli.commands.find((c) => c.name() === 'node');
			const subcommands = nodeCmd?.commands.map((c) => c.name()) ?? [];

			expect(subcommands).toContain('create');
			expect(subcommands).toContain('get');
			expect(subcommands).toContain('list');
			expect(subcommands).toContain('update');
			expect(subcommands).toContain('delete');
		});
	});

	describe('token subcommands', () => {
		it('has add, override, subtract, reset, copy, lineage subcommands', () => {
			const tokenCmd = cli.commands.find((c) => c.name() === 'token');
			const subcommands = tokenCmd?.commands.map((c) => c.name()) ?? [];

			expect(subcommands).toContain('add');
			expect(subcommands).toContain('override');
			expect(subcommands).toContain('subtract');
			expect(subcommands).toContain('reset');
			expect(subcommands).toContain('copy');
			expect(subcommands).toContain('lineage');
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRY INTEGRATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('CLI Registry Integration', () => {
	let ctx: CommandContext;

	beforeAll(() => {
		// Core should already be initialized from CLI structure tests
		// But ensure it's available
		if (registry.list().length === 0) {
			initializeCore();
		}
	});

	beforeEach(() => {
		// Fresh database for each test
		ctx = { db: createMemoryDatabase() };
	});

	describe('node commands via registry', () => {
		it('node.create is registered and executable', async () => {
			const result = await registry.execute(
				'node.create',
				{ name: 'test-root', type: 'root' },
				ctx,
			);
			expect(result.success).toBe(true);
			expect(result.data?.node?.name).toBe('test-root');
		});

		it('node.get is registered and executable', async () => {
			// Create first
			await registry.execute('node.create', { name: 'test-node', type: 'root' }, ctx);
			// Get
			const result = await registry.execute('node.get', { id: 'test-node' }, ctx);
			expect(result.success).toBe(true);
			expect(result.data?.node?.id).toBe('test-node');
		});

		it('node.list is registered and executable', async () => {
			await registry.execute('node.create', { name: 'node1', type: 'root' }, ctx);
			await registry.execute('node.create', { name: 'node2', type: 'root' }, ctx);

			const result = await registry.execute('node.list', {}, ctx);
			expect(result.success).toBe(true);
			expect(result.data?.total).toBe(2);
		});

		it('node.update is registered and executable', async () => {
			await registry.execute('node.create', { name: 'old-name', type: 'root' }, ctx);

			const result = await registry.execute(
				'node.update',
				{ id: 'old-name', updates: { name: 'new-name' } },
				ctx,
			);
			expect(result.success).toBe(true);
			expect(result.data?.node?.name).toBe('new-name');
		});

		it('node.delete is registered and executable', async () => {
			await registry.execute('node.create', { name: 'to-delete', type: 'root' }, ctx);

			const result = await registry.execute(
				'node.delete',
				{ id: 'to-delete', reason: 'Test cleanup' },
				ctx,
			);
			expect(result.success).toBe(true);
		});

		it('node.create with tags works', async () => {
			const result = await registry.execute(
				'node.create',
				{ name: 'tagged', type: 'root', tags: ['gaming', 'xbox'] },
				ctx,
			);
			expect(result.success).toBe(true);
			expect(result.data?.node?.tags).toContain('gaming');
			expect(result.data?.node?.tags).toContain('xbox');
		});

		it('node.list with tags filter works', async () => {
			await registry.execute(
				'node.create',
				{ name: 'gaming-node', type: 'root', tags: ['gaming'] },
				ctx,
			);
			await registry.execute(
				'node.create',
				{ name: 'other-node', type: 'root', tags: ['other'] },
				ctx,
			);

			const result = await registry.execute('node.list', { filter: { tags: ['gaming'] } }, ctx);
			expect(result.success).toBe(true);
			expect(result.data?.total).toBe(1);
			expect(result.data?.nodes?.[0]?.name).toBe('gaming-node');
		});
	});

	describe('token commands via registry', () => {
		it('token.add is registered and executable', async () => {
			const createResult = await registry.execute(
				'node.create',
				{ name: 'token-add-test', type: 'root' },
				ctx,
			);
			expect(createResult.success).toBe(true);

			const result = await registry.execute(
				'token.add',
				{
					nodeId: 'token-add-test',
					tokenId: 'color.primary',
					value: '#FF0000',
				},
				ctx,
			);
			expect(result.success).toBe(true);
			expect(result.data?.tokenId).toBe('color.primary');
		});

		it('token.override is registered and executable', async () => {
			await registry.execute('node.create', { name: 'token-override-test', type: 'root' }, ctx);
			await registry.execute(
				'token.add',
				{
					nodeId: 'token-override-test',
					tokenId: 'color.primary',
					value: '#FF0000',
				},
				ctx,
			);

			const result = await registry.execute(
				'token.override',
				{
					nodeId: 'token-override-test',
					tokenId: 'color.primary',
					value: '#00FF00',
				},
				ctx,
			);
			expect(result.success).toBe(true);
			expect(result.data?.newValue).toBe('#00FF00');
		});

		it('token.subtract is registered and executable', async () => {
			await registry.execute('node.create', { name: 'token-subtract-test', type: 'root' }, ctx);
			await registry.execute(
				'token.add',
				{
					nodeId: 'token-subtract-test',
					tokenId: 'color.remove',
					value: '#000000',
				},
				ctx,
			);

			const result = await registry.execute(
				'token.subtract',
				{ nodeId: 'token-subtract-test', tokenId: 'color.remove' },
				ctx,
			);
			expect(result.success).toBe(true);
		});

		it('token.lineage is registered and executable', async () => {
			await registry.execute('node.create', { name: 'token-lineage-test', type: 'root' }, ctx);
			await registry.execute(
				'token.add',
				{
					nodeId: 'token-lineage-test',
					tokenId: 'color.lineage',
					value: '#AABBCC',
				},
				ctx,
			);

			const result = await registry.execute(
				'token.lineage',
				{ nodeId: 'token-lineage-test', tokenId: 'color.lineage' },
				ctx,
			);
			expect(result.success).toBe(true);
			expect(result.data?.chain).toBeDefined();
		});

		it('tokens.resolve command is registered and executable', async () => {
			await registry.execute('node.create', { name: 'token-resolve-test', type: 'root' }, ctx);
			await registry.execute(
				'token.add',
				{
					nodeId: 'token-resolve-test',
					tokenId: 'color.test',
					value: '#123456',
				},
				ctx,
			);

			const result = await registry.execute(
				'tokens.resolve',
				{ nodeId: 'token-resolve-test' },
				ctx,
			);
			expect(result.success).toBe(true);
			expect(result.data?.tokens).toBeDefined();
		});
	});

	describe('error handling via registry', () => {
		it('returns NODE_NOT_FOUND for non-existent node', async () => {
			const result = await registry.execute('node.get', { id: 'does-not-exist' }, ctx);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('NODE_NOT_FOUND');
		});

		it('returns NODE_HAS_CHILDREN when deleting parent', async () => {
			await registry.execute('node.create', { name: 'parent', type: 'root' }, ctx);
			await registry.execute(
				'node.create',
				{ name: 'child', parentId: 'parent', type: 'product' },
				ctx,
			);

			const result = await registry.execute('node.delete', { id: 'parent', reason: 'test' }, ctx);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('NODE_HAS_CHILDREN');
		});

		it('returns error for duplicate node creation', async () => {
			await registry.execute('node.create', { name: 'duplicate', type: 'root' }, ctx);
			const result = await registry.execute(
				'node.create',
				{ name: 'duplicate', type: 'root' },
				ctx,
			);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('NODE_ALREADY_EXISTS');
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// CI/CD COMMANDS STRUCTURE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('CI/CD CLI Commands', () => {
	let cli: Command;

	beforeAll(() => {
		if (registry.list().length === 0) {
			initializeCore();
		}
		cli = createCLI(true);
	});

	describe('cicd subcommand structure', () => {
		it('has cicd subcommand', () => {
			const cicdCmd = cli.commands.find((c) => c.name() === 'cicd');
			expect(cicdCmd).toBeDefined();
		});

		it('cicd has setup subcommand', () => {
			const cicdCmd = cli.commands.find((c) => c.name() === 'cicd');
			const subcommands = cicdCmd?.commands.map((c) => c.name()) ?? [];
			expect(subcommands).toContain('setup');
		});

		it('cicd has validate subcommand', () => {
			const cicdCmd = cli.commands.find((c) => c.name() === 'cicd');
			const subcommands = cicdCmd?.commands.map((c) => c.name()) ?? [];
			expect(subcommands).toContain('validate');
		});

		it('cicd has export subcommand', () => {
			const cicdCmd = cli.commands.find((c) => c.name() === 'cicd');
			const subcommands = cicdCmd?.commands.map((c) => c.name()) ?? [];
			expect(subcommands).toContain('export');
		});

		it('cicd has diff subcommand', () => {
			const cicdCmd = cli.commands.find((c) => c.name() === 'cicd');
			const subcommands = cicdCmd?.commands.map((c) => c.name()) ?? [];
			expect(subcommands).toContain('diff');
		});
	});

	describe('cicd setup command options', () => {
		it('setup has platform option', () => {
			const cicdCmd = cli.commands.find((c) => c.name() === 'cicd');
			const setupCmd = cicdCmd?.commands.find((c) => c.name() === 'setup');
			const options = setupCmd?.options.map((o) => o.long) ?? [];
			expect(options).toContain('--platform');
		});

		it('setup has templates option', () => {
			const cicdCmd = cli.commands.find((c) => c.name() === 'cicd');
			const setupCmd = cicdCmd?.commands.find((c) => c.name() === 'setup');
			const options = setupCmd?.options.map((o) => o.long) ?? [];
			expect(options).toContain('--templates');
		});

		it('setup has output option', () => {
			const cicdCmd = cli.commands.find((c) => c.name() === 'cicd');
			const setupCmd = cicdCmd?.commands.find((c) => c.name() === 'setup');
			const options = setupCmd?.options.map((o) => o.long) ?? [];
			expect(options).toContain('--output');
		});

		it('setup has force option', () => {
			const cicdCmd = cli.commands.find((c) => c.name() === 'cicd');
			const setupCmd = cicdCmd?.commands.find((c) => c.name() === 'setup');
			const options = setupCmd?.options.map((o) => o.long) ?? [];
			expect(options).toContain('--force');
		});
	});

	describe('cicd validate command options', () => {
		it('validate has node option (required)', () => {
			const cicdCmd = cli.commands.find((c) => c.name() === 'cicd');
			const validateCmd = cicdCmd?.commands.find((c) => c.name() === 'validate');
			const options = validateCmd?.options.map((o) => o.long) ?? [];
			expect(options).toContain('--node');
		});

		it('validate has fail-on-warning option', () => {
			const cicdCmd = cli.commands.find((c) => c.name() === 'cicd');
			const validateCmd = cicdCmd?.commands.find((c) => c.name() === 'validate');
			const options = validateCmd?.options.map((o) => o.long) ?? [];
			expect(options).toContain('--fail-on-warning');
		});

		it('validate has filter option', () => {
			const cicdCmd = cli.commands.find((c) => c.name() === 'cicd');
			const validateCmd = cicdCmd?.commands.find((c) => c.name() === 'validate');
			const options = validateCmd?.options.map((o) => o.long) ?? [];
			expect(options).toContain('--filter');
		});
	});

	describe('cicd export command options', () => {
		it('export has node option (required)', () => {
			const cicdCmd = cli.commands.find((c) => c.name() === 'cicd');
			const exportCmd = cicdCmd?.commands.find((c) => c.name() === 'export');
			const options = exportCmd?.options.map((o) => o.long) ?? [];
			expect(options).toContain('--node');
		});

		it('export has formats option', () => {
			const cicdCmd = cli.commands.find((c) => c.name() === 'cicd');
			const exportCmd = cicdCmd?.commands.find((c) => c.name() === 'export');
			const options = exportCmd?.options.map((o) => o.long) ?? [];
			expect(options).toContain('--formats');
		});

		it('export has output option', () => {
			const cicdCmd = cli.commands.find((c) => c.name() === 'cicd');
			const exportCmd = cicdCmd?.commands.find((c) => c.name() === 'export');
			const options = exportCmd?.options.map((o) => o.long) ?? [];
			expect(options).toContain('--output');
		});
	});

	describe('cicd diff command options', () => {
		it('diff has node option (required)', () => {
			const cicdCmd = cli.commands.find((c) => c.name() === 'cicd');
			const diffCmd = cicdCmd?.commands.find((c) => c.name() === 'diff');
			const options = diffCmd?.options.map((o) => o.long) ?? [];
			expect(options).toContain('--node');
		});

		it('diff has base option', () => {
			const cicdCmd = cli.commands.find((c) => c.name() === 'cicd');
			const diffCmd = cicdCmd?.commands.find((c) => c.name() === 'diff');
			const options = diffCmd?.options.map((o) => o.long) ?? [];
			expect(options).toContain('--base');
		});

		it('diff has format option', () => {
			const cicdCmd = cli.commands.find((c) => c.name() === 'cicd');
			const diffCmd = cicdCmd?.commands.find((c) => c.name() === 'diff');
			const options = diffCmd?.options.map((o) => o.long) ?? [];
			expect(options).toContain('--format');
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRY COVERAGE
// ═══════════════════════════════════════════════════════════════════════════════

describe('Registry Command Coverage', () => {
	beforeAll(() => {
		if (registry.list().length === 0) {
			initializeCore();
		}
	});

	it('all expected commands are registered', () => {
		const commands = registry.list();
		const commandNames = commands.map((c) => c.name);

		// Node commands
		expect(commandNames).toContain('node.create');
		expect(commandNames).toContain('node.get');
		expect(commandNames).toContain('node.list');
		expect(commandNames).toContain('node.update');
		expect(commandNames).toContain('node.delete');

		// Token commands
		expect(commandNames).toContain('token.add');
		expect(commandNames).toContain('token.override');
		expect(commandNames).toContain('token.subtract');
		expect(commandNames).toContain('token.reset');
		expect(commandNames).toContain('token.copy');
		expect(commandNames).toContain('token.lineage');
		expect(commandNames).toContain('tokens.resolve');
		expect(commandNames).toContain('tokens.matrix');
		expect(commandNames).toContain('tokens.compare');
		expect(commandNames).toContain('nodes.graph');
		expect(commandNames).toContain('tokens.catalog');
		expect(commandNames).toContain('analyze.violations');
		expect(commandNames).toContain('analyze.health');
		expect(commandNames).toContain('analyze.trends');
		expect(commandNames).toContain('analyze.snapshot');
		expect(commandNames).toContain('specimen.get');
		expect(commandNames).toContain('specimen.set');
		expect(commandNames).toContain('audit.list');
		expect(commandNames).toContain('apikeys.create');
		expect(commandNames).toContain('apikeys.check');
	});

	it('commands have descriptions', () => {
		const commands = registry.list();

		for (const cmd of commands) {
			expect(cmd.description).toBeDefined();
			expect(cmd.description.length).toBeGreaterThan(0);
		}
	});

	it('registry has expected command count', () => {
		const commands = registry.list();
		expect(commands.length).toBe(46);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLI BEHAVIOUR TESTS (end-to-end through commander, SQLite db in a temp dir)
// ═══════════════════════════════════════════════════════════════════════════════

describe('CLI behaviour', () => {
	let tmpDir: string;
	let dbPath: string;
	let logs: string[];
	let errors: string[];

	beforeAll(() => {
		if (registry.list().length === 0) {
			initializeCore();
		}
	});

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'violet-cli-'));
		dbPath = path.join(tmpDir, 'violet.db');
		logs = [];
		errors = [];
		process.exitCode = undefined;
		vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
			logs.push(args.join(' '));
		});
		vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
			errors.push(args.join(' '));
		});
		vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
			throw new Error(`process.exit(${code})`);
		}) as never);

		// Seed: one node with two tokens
		await run('call', 'node.create', '-i', JSON.stringify({ id: 'n1', name: 'N1' }));
		await run(
			'call',
			'token.add',
			'-i',
			JSON.stringify({ nodeId: 'n1', tokenId: 'color.primary', value: '#0078D4' }),
		);
		await run(
			'call',
			'token.add',
			'-i',
			JSON.stringify({ nodeId: 'n1', tokenId: 'color.secondary', value: '#FFFFFF' }),
		);
		logs.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = undefined;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	async function run(...args: string[]): Promise<void> {
		await createCLI(true).parseAsync(['node', 'violet', '--db', dbPath, ...args]);
	}

	describe('call --schema', () => {
		it('prints JSON Schema for webhooks.register, matching the MCP tool', async () => {
			await run('call', 'webhooks.register', '--schema');
			const schema = JSON.parse(logs.join('\n'));
			expect(schema.type).toBe('object');
			expect(Object.keys(schema.properties)).toEqual(
				expect.arrayContaining(['url', 'events', 'secret', 'nodeFilter', 'description', 'active']),
			);
			expect(schema.properties.events.items.enum).toContain('token.updated');
			expect(schema.required).toEqual(expect.arrayContaining(['url', 'events']));
			expect(schema).not.toHaveProperty('_def');

			const tool = generateTools().find((t) => t.name === 'webhooks.register');
			expect(schema).toEqual(tool?.inputSchema);
		});

		it.each(['node.create', 'token.add', 'export'])(
			'%s --schema matches the MCP tool input schema',
			async (name) => {
				await run('call', name, '--schema');
				const tool = generateTools().find((t) => t.name === name);
				expect(JSON.parse(logs.join('\n'))).toEqual(tool?.inputSchema);
			},
		);

		it('exits 1 for an unknown command', async () => {
			await expect(run('call', 'no.such.command', '--schema')).rejects.toThrow('process.exit(1)');
			expect(errors.join('\n')).toContain("Command 'no.such.command' not found");
		});
	});

	describe('commands --json', () => {
		it('lists every command with its JSON Schema input', async () => {
			await run('--json', 'commands');
			const result = JSON.parse(logs.join('\n'));
			expect(result.success).toBe(true);
			expect(result.data.total).toBe(registry.list().length);
			const register = result.data.commands.find(
				(c: { name: string }) => c.name === 'webhooks.register',
			);
			expect(register.category).toBe('webhook');
			expect(register.inputSchema).toEqual(registry.getInputJsonSchema('webhooks.register'));
		});

		it('filters by category', async () => {
			await run('--json', 'commands', '-c', 'webhook');
			const { data } = JSON.parse(logs.join('\n'));
			expect(data.commands.length).toBeGreaterThan(0);
			expect(data.commands.every((c: { category: string }) => c.category === 'webhook')).toBe(true);
		});
	});

	describe('export -o', () => {
		it.each([
			['json', 'json', '#0078D4'],
			['css', 'css', '--color-primary'],
			['scss', 'scss', '$color-primary'],
			['ts', 'ts', 'primary'],
		])('export %s -o writes the generated content to the file', async (cmd, ext, needle) => {
			const out = path.join(tmpDir, 'nested', 'deeper', `tokens.${ext}`);

			await run('export', cmd, 'n1', '-o', out);

			expect(fs.existsSync(out)).toBe(true);
			const written = fs.readFileSync(out, 'utf-8');
			expect(written).toContain(needle);
			// Must be the generated content, not a command result envelope
			expect(written).not.toContain('"success"');
		});

		it('prints content to stdout when no -o is given', async () => {
			await run('export', 'css', 'n1');
			expect(logs.join('\n')).toContain('--color-primary');
		});
	});

	describe('api spec', () => {
		const servers = () => JSON.parse(logs.join('\n')).servers as { url: string }[];

		afterEach(() => {
			vi.unstubAllEnvs();
		});

		it('lists only the local vercel dev server by default, never a placeholder host', async () => {
			vi.stubEnv('VIOLET_API_URL', '');
			await run('api', 'spec');
			expect(servers().map((s) => s.url)).toEqual(['http://localhost:3000']);
			expect(logs.join('\n')).not.toContain('violet.design');
		});

		it('adds the configured deployment URL', async () => {
			vi.stubEnv('VIOLET_API_URL', 'https://violet.example.com/');
			await run('api', 'spec');
			expect(servers().map((s) => s.url)).toEqual([
				'https://violet.example.com',
				'http://localhost:3000',
			]);
		});

		it('prints the hosted API document, built by the same function the API serves', async () => {
			vi.stubEnv('VIOLET_API_URL', '');
			await run('api', 'spec');
			const spec = JSON.parse(logs.join('\n'));
			expect(spec).toEqual(JSON.parse(JSON.stringify(buildOpenApiSpec())));
			expect(Object.keys(spec.paths)).toContain('/api/v1/export/{nodeId}/{format}');
			expect(Object.keys(spec.paths).length).toBeGreaterThan(10);
		});

		it('--yaml emits YAML that parses back to the JSON document', async () => {
			vi.stubEnv('VIOLET_API_URL', 'https://violet.example.com');
			await run('api', 'spec');
			const json = JSON.parse(logs.join('\n'));
			logs.length = 0;

			await run('api', 'spec', '--yaml');
			const yaml = logs.join('\n');
			expect(yaml.startsWith('openapi: 3.1.0\n')).toBe(true);
			expect(parseYaml(yaml)).toEqual(json);
		});

		it('-o writes the spec to a file', async () => {
			vi.stubEnv('VIOLET_API_URL', '');
			const out = path.join(tmpDir, 'openapi.yaml');
			await run('api', 'spec', '--yaml', '-o', out);
			const written = parseYaml(fs.readFileSync(out, 'utf-8'));
			expect(written.info.title).toBe('Violet Design API');
		});

		it('--server wins over VIOLET_API_URL and rejects non-http URLs', async () => {
			vi.stubEnv('VIOLET_API_URL', 'https://env.example.com');
			await run('api', 'spec', '--server', 'https://flag.example.com');
			expect(servers()[0].url).toBe('https://flag.example.com');

			await expect(run('api', 'spec', '--server', 'ftp://bad.example.com')).rejects.toThrow(
				'process.exit(1)',
			);
		});
	});

	describe('cicd export', () => {
		it('writes generated content (not the result envelope) to token files', async () => {
			const outDir = path.join(tmpDir, 'dist');

			await run('cicd', 'export', '-n', 'n1', '-f', 'json,css', '-o', outDir);

			const json = fs.readFileSync(path.join(outDir, 'tokens.json'), 'utf-8');
			const css = fs.readFileSync(path.join(outDir, 'tokens.css'), 'utf-8');
			expect(json).not.toContain('"tokenCount"');
			expect(json).toContain('#0078D4');
			expect(css).toContain(':root');
			expect(css).toContain('--color-primary');
		});
	});

	describe('cicd diff', () => {
		it('keys tokens by id and compares values', async () => {
			const base = path.join(tmpDir, 'base.json');
			fs.writeFileSync(
				base,
				JSON.stringify({
					'color.primary': '#000000', // changed
					'color.secondary': '#FFFFFF', // unchanged
					'color.removed': '#123456', // removed
				}),
			);

			await run('cicd', 'diff', '-n', 'n1', '-b', base, '-f', 'json');

			const diff = JSON.parse(logs.join('\n')).data;
			expect(diff.summary).toEqual({ added: 0, changed: 1, removed: 1, total: 2 });
			expect(diff.changed).toEqual([
				{ id: 'color.primary', oldValue: '#000000', newValue: '#0078D4' },
			]);
			expect(diff.removed.map((t: { id: string }) => t.id)).toEqual(['color.removed']);
		});

		it('treats everything as added without a base file, keyed by token id', async () => {
			await run('cicd', 'diff', '-n', 'n1', '-f', 'json');

			const diff = JSON.parse(logs.join('\n')).data;
			expect(diff.added.map((t: { id: string }) => t.id).sort()).toEqual([
				'color.primary',
				'color.secondary',
			]);
		});

		it('accepts a base file shaped like a tokens.resolve result', async () => {
			const base = path.join(tmpDir, 'base-resolve.json');
			fs.writeFileSync(
				base,
				JSON.stringify({
					success: true,
					data: {
						tokens: [
							{ id: 'color.primary', value: '#0078D4', resolvedValue: '#0078D4' },
							{ id: 'color.secondary', value: '#EEEEEE', resolvedValue: '#EEEEEE' },
						],
					},
				}),
			);

			await run('cicd', 'diff', '-n', 'n1', '-b', base, '-f', 'json');

			const diff = JSON.parse(logs.join('\n')).data;
			expect(diff.summary).toEqual({ added: 0, changed: 1, removed: 0, total: 1 });
			expect(diff.changed[0].id).toBe('color.secondary');
		});
	});

	describe('cicd validate', () => {
		it('prints real summary counts rather than undefined', async () => {
			await run('cicd', 'validate', '-n', 'n1');

			const output = logs.join('\n');
			expect(output).not.toContain('undefined');
			expect(output).toContain('Valid: 2/2');
		});
	});

	describe('import json --mode', () => {
		it('maps --mode merge to core merge so existing tokens are overridden', async () => {
			const file = path.join(tmpDir, 'import.json');
			fs.writeFileSync(file, JSON.stringify({ color: { primary: { value: '#FF0000' } } }));

			await run('import', 'json', 'n1', file, '--mode', 'merge', '--json');

			const result = JSON.parse(logs.join('\n'));
			expect(result.success).toBe(true);
			expect(result.data.conflicts).toEqual([]);
			expect(result.data.tokensImported).toBe(1);
		});
	});

	describe('matrix', () => {
		beforeEach(async () => {
			await run(
				'call',
				'node.create',
				'-i',
				JSON.stringify({ id: 'n2', name: 'N2', parentId: 'n1' }),
			);
			await run('token', 'override', '-n', 'n2', '-t', 'color.primary', '-v', '#107C10');
			logs.length = 0;
		});

		it('prints a token × node grid with markers for local changes', async () => {
			await run('matrix', '--root', 'n1');

			const out = logs.join('\n');
			expect(out).toMatch(/token\s+n1\s+n2/);
			expect(out).toMatch(/color\.primary\s+#0078D4 \+\s+#107C10 ~/);
			expect(out).toMatch(/color\.secondary\s+#FFFFFF \+\s+#FFFFFF/);
		});

		it('passes --nodes, --filter and --varying through to tokens.matrix', async () => {
			await run('--json', 'matrix', '--nodes', 'n2, n1', '--filter', 'color.*', '--varying');

			const result = JSON.parse(logs.join('\n'));
			expect(result.success).toBe(true);
			expect(result.data.nodes.map((node: { id: string }) => node.id)).toEqual(['n2', 'n1']);
			expect(result.data.tokens.map((token: { id: string }) => token.id)).toEqual([
				'color.primary',
			]);
		});

		it('prints per-group counts with --group and --summary', async () => {
			await run('matrix', '--group', 'category', '--summary');

			const out = logs.join('\n');
			expect(out).toMatch(/group\s+tokens\s+varying\s+violations/);
			expect(out).toMatch(/custom\s+2\s+1\s+0/);
		});

		it('pages with --limit and --cursor', async () => {
			await run('--json', 'matrix', '--limit', '1');
			const first = JSON.parse(logs.join('\n'));
			logs.length = 0;
			await run('--json', 'matrix', '--limit', '1', '--cursor', first.data.page.nextCursor);
			const second = JSON.parse(logs.join('\n'));

			expect(first.data.tokens.map((token: { id: string }) => token.id)).toEqual(['color.primary']);
			expect(second.data.tokens.map((token: { id: string }) => token.id)).toEqual([
				'color.secondary',
			]);
			expect(second.data.page.nextCursor).toBeNull();
			expect(second.data.summary.tokens).toBe(2);
		});

		it('sorts token ids in reverse with --sort token-desc', async () => {
			await run('--json', 'matrix', '--sort', 'token-desc');

			const result = JSON.parse(logs.join('\n'));
			expect(result.data.tokens.map((token: { id: string }) => token.id)).toEqual([
				'color.secondary',
				'color.primary',
			]);
		});

		it('tells you how to get the next page', async () => {
			await run('matrix', '--limit', '1');

			expect(logs.join('\n')).toMatch(/More rows: --cursor \S+/);
		});

		it('starts at the page holding a token with --around, and pages back', async () => {
			await run('--json', 'matrix', '--limit', '1', '--around', 'color.secondary');
			const page = JSON.parse(logs.join('\n'));
			logs.length = 0;
			await run('matrix', '--limit', '1', '--cursor', page.data.page.prevCursor);

			expect(page.data.tokens.map((token: { id: string }) => token.id)).toEqual([
				'color.secondary',
			]);
			expect(page.data.page).toMatchObject({ offset: 1, nextCursor: null });
			expect(logs.join('\n')).toMatch(/color\.primary/);
			expect(logs.join('\n')).toMatch(/More rows: --cursor \S+/);
		});
	});

	describe('node get --ops', () => {
		it("lists the node's own operations, as nodes.graph does", async () => {
			await run('token', 'override', '-n', 'n1', '-t', 'color.primary', '-v', '#107C10');
			logs.length = 0;
			await run('--json', 'node', 'get', 'n1', '--ops');

			const result = JSON.parse(logs.join('\n'));
			expect(result.data.operations.map((op: { type: string }) => op.type)).toEqual([
				'add',
				'add',
				'override',
			]);
			expect(result.data.operations[0]).toMatchObject({
				tokenId: 'color.primary',
				supersededBy: 3,
			});
		});
	});

	describe('compare', () => {
		beforeEach(async () => {
			for (const id of ['n2', 'n3']) {
				await run('call', 'node.create', '-i', JSON.stringify({ id, name: id, parentId: 'n1' }));
			}
			await run('token', 'override', '-n', 'n2', '-t', 'color.primary', '-v', '#107C10');
			logs.length = 0;
		});

		it('prints only what differs, marked against the first node, and pair similarity', async () => {
			await run('compare', 'n1', 'n2', 'n3');

			const out = logs.join('\n');
			expect(out).toMatch(/token\s+n1\s+n2\s+n3/);
			expect(out).toMatch(/color\.primary\s+#0078D4 \+\s+#107C10 ~ ≠\s+#0078D4/);
			expect(out).not.toContain('color.secondary');
			expect(out).toContain('1 of 2 token(s) differ');
			expect(out).toContain('n1 ↔ n3: 100% the same (0 differ)');
		});

		it('passes --all, --filter and --category through to tokens.compare', async () => {
			await run('--json', 'compare', 'n1', 'n2', '--all', '--filter', 'color.*');

			const result = JSON.parse(logs.join('\n'));
			expect(result.success).toBe(true);
			expect(result.data.baseline).toBe('n1');
			expect(result.data.tokens.map((token: { id: string }) => token.id)).toEqual([
				'color.primary',
				'color.secondary',
			]);
		});
	});

	describe('tree', () => {
		beforeEach(async () => {
			await run(
				'call',
				'node.create',
				'-i',
				JSON.stringify({ id: 'n2', name: 'N2', parentId: 'n1' }),
			);
			await run('token', 'override', '-n', 'n2', '-t', 'color.primary', '-v', '#107C10');
			await run('token', 'subtract', '-n', 'n2', '-t', 'color.secondary');
			logs.length = 0;
		});

		it('prints the hierarchy with change counts', async () => {
			await run('tree');

			const out = logs.join('\n');
			expect(out).toMatch(/^n1 \(custom\)\s+\+2$/m);
			expect(out).toMatch(/^└─ n2 \(custom\)\s+~1 −1$/m);
		});

		it('traces a token with --token and lists operations with --ops', async () => {
			await run('tree', '--token', 'color.secondary', '--ops');

			const out = logs.join('\n');
			expect(out).toMatch(/^n1 \(custom\)\s+#FFFFFF \+$/m);
			expect(out).toMatch(/^└─ n2 \(custom\)\s+✕ subtracted$/m);
			expect(out).toContain('~ color.primary = #107C10');
			expect(out).toContain('− color.secondary');
		});
	});

	describe('impact', () => {
		beforeEach(async () => {
			for (const id of ['n2', 'n3']) {
				await run('call', 'node.create', '-i', JSON.stringify({ id, name: id, parentId: 'n1' }));
			}
			await run('token', 'override', '-n', 'n3', '-t', 'color.primary', '-v', '#107C10');
			logs.length = 0;
		});

		it('prints the affected tree with before → after, shielded nodes and the apply command', async () => {
			await run('impact', '--node', 'n1', '--override', 'color.primary=#C50F1F');

			const out = logs.join('\n');
			expect(out).toContain('What if n1: override color.primary = #C50F1F');
			expect(out).toMatch(/^n1 \(custom\)\s+#0078D4 → #C50F1F\s+● changes$/m);
			expect(out).toMatch(/^├─ n2 \(custom\)\s+#0078D4 → #C50F1F\s+● changes$/m);
			expect(out).toMatch(/^└─ n3 \(custom\)\s+#107C10\s+◇ shielded by n3$/m);
			expect(out).toContain(
				"violet token override --node n1 --token color.primary --value '#C50F1F'",
			);
			expect(out).toContain('Nothing was written');
		});

		it('passes repeated changes through to changes.impact without writing them', async () => {
			await run(
				'--json',
				'impact',
				'--node',
				'n1',
				'--add',
				'spacing.md=16',
				'--subtract',
				'color.secondary',
				'--no-violations',
			);

			const result = JSON.parse(logs.join('\n'));
			expect(result.success).toBe(true);
			expect(result.data.changes).toEqual([
				{ type: 'add', tokenId: 'spacing.md', value: 16 },
				{ type: 'subtract', tokenId: 'color.secondary' },
			]);
			expect(result.data.summary).toMatchObject({ nodes: 3, violationsChecked: false });

			logs.length = 0;
			await run('--json', 'tokens', 'n1');
			const tokens = JSON.parse(logs.join('\n')).data.tokens.map((t: { id: string }) => t.id);
			expect(tokens.sort()).toEqual(['color.primary', 'color.secondary']);
		});

		it('rejects a malformed change and an empty preview', async () => {
			await expect(run('impact', '--node', 'n1', '--override', 'color.primary')).rejects.toThrow(
				'process.exit(1)',
			);
			expect(errors.join('\n')).toContain('--override expects token=value');
			await expect(run('impact', '--node', 'n1')).rejects.toThrow('process.exit(1)');
			expect(errors.join('\n')).toContain('Nothing to preview');
		});
	});

	describe('catalog', () => {
		it('finds tokens by words and shows where they are customized', async () => {
			await run(
				'call',
				'node.create',
				'-i',
				JSON.stringify({ id: 'n2', name: 'N2', parentId: 'n1' }),
			);
			await run('token', 'override', '-n', 'n2', '-t', 'color.primary', '-v', '#107C10');
			logs.length = 0;

			await run('catalog', 'primary', '--most-customized');

			const out = logs.join('\n');
			expect(out).toMatch(/token\s+category\s+tier/);
			expect(out).toMatch(/color\.primary\s+custom\s+semantic\s+n1\s+1/);
			expect(out).not.toContain('color.secondary');
		});
	});

	describe('violations', () => {
		it('lists violations from the realistic demo system', async () => {
			const demoDb = path.join(tmpDir, 'violations.db');
			await createCLI(true).parseAsync(['node', 'violet', '--db', demoDb, 'demo', 'seed']);
			logs.length = 0;

			await createCLI(true).parseAsync([
				'node',
				'violet',
				'--db',
				demoDb,
				'violations',
				'--root',
				'azure',
				'--severity',
				'error',
			]);

			const out = logs.join('\n');
			expect(out).toMatch(/severity\s+node\s+token\s+rule/);
			expect(out).toMatch(/error\s+azure-mobile\s+color\.text\.primary/);
			expect(out).not.toContain('warning');
		}, 60_000);
	});

	describe('health', () => {
		it('reports drift, violations and risk flags on the realistic demo system', async () => {
			const demoDb = path.join(tmpDir, 'health.db');
			await createCLI(true).parseAsync(['node', 'violet', '--db', demoDb, 'demo', 'seed']);
			logs.length = 0;

			await createCLI(true).parseAsync([
				'node',
				'violet',
				'--db',
				demoDb,
				'health',
				'--root',
				'azure',
				'--sort',
				'drift',
			]);

			const out = logs.join('\n');
			expect(out).toMatch(/node\s+status\s+owner\s+changes\s+subtree\s+drift/);
			expect(out).toMatch(/azure-classic\s+deprecated with children/);
			expect(out).toContain('drift: share of resolved tokens that differ from the parent');
			// Sorted by drift: a dark theme outranks its product
			expect(out.indexOf('azure-dark')).toBeLessThan(out.indexOf('azure-portal '));
		}, 60_000);

		it('returns JSON against a chosen baseline', async () => {
			const demoDb = path.join(tmpDir, 'health-json.db');
			await createCLI(true).parseAsync(['node', 'violet', '--db', demoDb, 'demo', 'seed']);
			logs.length = 0;

			await createCLI(true).parseAsync([
				'node',
				'violet',
				'--db',
				demoDb,
				'--json',
				'health',
				'--root',
				'teams',
				'--baseline',
				'root',
				'--no-violations',
			]);

			const result = JSON.parse(logs.join('\n'));
			expect(result.success).toBe(true);
			expect(result.data.baseline).toBe('root');
			expect(result.data.summary.violations).toBeUndefined();
			const teams = result.data.nodes.find((node: { id: string }) => node.id === 'teams');
			expect(teams.drift.baseline).toBe('global');
			expect(teams.flags).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						kind: 'redundant-override',
						tokenId: 'typography.family.sans',
					}),
				]),
			);
		}, 60_000);
	});

	describe('audit', () => {
		it('lists a node’s history with per-day counts and paging', async () => {
			await run('node', 'create', '--name', 'global');
			await run(
				'token',
				'add',
				'--node',
				'global',
				'--token',
				'color.primary',
				'--value',
				'#0066CC',
			);
			await run('node', 'create', '--name', 'xbox', '--parent', 'global');
			await run(
				'token',
				'override',
				'--node',
				'xbox',
				'--token',
				'color.primary',
				'--value',
				'#107C10',
			);
			logs.length = 0;

			await run('audit', '--node', 'global', '--subtree', '--since', '1d', '--limit', '2');

			const out = logs.join('\n');
			expect(out).toMatch(/time \(UTC\)\s+event\s+actor\s+node\s+token\s+change/);
			expect(out).toContain('Per day');
			expect(out).toContain('Showing 1–2 of 4 · next page: --offset 2');

			logs.length = 0;
			await run('--json', 'audit', '--type', 'token_updated');
			const result = JSON.parse(logs.join('\n'));
			expect(result.data.events).toEqual([
				expect.objectContaining({
					eventType: 'token_updated',
					targetNode: 'xbox',
					targetToken: 'color.primary',
					newValue: '#107C10',
				}),
			]);
		});

		it('rejects an unreadable time', async () => {
			await expect(run('audit', '--since', 'yesterday')).rejects.toThrow('process.exit(1)');
			expect(logs.join('\n')).toContain("Invalid since 'yesterday'");
		});
	});

	describe('trends', () => {
		it('lists changes per day and the open issues', async () => {
			await run('node', 'create', '--name', 'global');
			await run(
				'token',
				'add',
				'--node',
				'global',
				'--token',
				'color.primary',
				'--value',
				'#0066CC',
			);
			logs.length = 0;

			// Query strictly after fixture writes: audit upper bounds are exclusive.
			vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
			await run('trends', '--root', 'global', '--since', '2d');

			const out = logs.join('\n');
			expect(out).toMatch(/Day\s+changes\s+open issues/);
			expect(out).toContain('open issues: 0 now');
			expect(out).toMatch(/2 change\(s\) on 1 node\(s\) over 3 day\(s\)/);

			logs.length = 0;
			await run('--json', 'trends', '--root', 'global', '--since', '1d', '--no-violations');
			const result = JSON.parse(logs.join('\n'));
			expect(result.data.summary).toMatchObject({ changes: 2, tokenChanges: 1 });
			expect(result.data.summary.violations).toBeUndefined();
		});

		it('rejects a range that runs backwards', async () => {
			await expect(run('trends', '--since', '2026-10-02', '--until', '2026-10-01')).rejects.toThrow(
				'process.exit(1)',
			);
			expect(logs.join('\n')).toContain('trends take 1 to 366');
		});
	});

	describe('deprecation plans, snapshots and specimens (#117, #118)', () => {
		beforeEach(async () => {
			await run('node', 'create', '--name', 'global');
			await run('node', 'create', '--name', 'next', '--parent', 'global');
			await run(
				'token',
				'add',
				'--node',
				'global',
				'--token',
				'btn.bg',
				'--value',
				'#0F6CBD',
				'--category',
				'color',
			);
			logs.length = 0;
		});

		it('sets, shows and clears a sunset date and replacement', async () => {
			await run(
				'node',
				'create',
				'--name',
				'old',
				'--parent',
				'global',
				'--status',
				'deprecated',
				'--sunset',
				'2027-03-31',
			);
			expect(logs.join('\n')).toContain('no node replaces it');

			logs.length = 0;
			await run('node', 'update', 'old', '--replaced-by', 'next');
			await run('--json', 'health', '--root', 'global', '--no-violations');
			const health = JSON.parse(logs.at(-1) ?? '{}');
			expect(health.data.summary.sunsets).toEqual([
				expect.objectContaining({ id: 'old', sunsetAt: '2027-03-31', replacedBy: 'next' }),
			]);

			logs.length = 0;
			await run('health', '--root', 'global', '--no-violations');
			expect(logs.join('\n')).toMatch(/Sunsets[\s\S]*old\s+2027-03-31/);

			logs.length = 0;
			await run('--json', 'node', 'update', 'old', '--sunset', 'none', '--replaced-by', 'none');
			expect(JSON.parse(logs.join('\n')).data.changedFields).toEqual(['sunsetAt', 'replacedBy']);
		});

		it('records a rule check and shows it in trends', async () => {
			await run('--json', 'snapshot', '--root', 'global');
			expect(JSON.parse(logs.join('\n')).data.snapshot).toMatchObject({
				rootId: 'global',
				nodes: 2,
			});

			logs.length = 0;
			// Keep the query's exclusive upper bound later than the snapshot.
			vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
			await run('trends', '--root', 'global', '--since', '1d');
			const out = logs.join('\n');
			expect(out).toMatch(/Day\s+changes\s+open issues\s+recorded/);
			expect(out).toContain('recorded checks on 1 day(s): 0 → 0 open');
		});

		it('maps specimen roles to tokens and shows what draws', async () => {
			await run('specimen', 'set', 'next', 'button.background=btn.bg', 'button.border=btn.bg');
			expect(logs.join('\n')).toContain("Stored the specimen map on 'global'");

			logs.length = 0;
			await run('specimen', 'set', 'next', 'button.border=');
			await run('specimen', 'get', 'next');
			const out = logs.join('\n');
			expect(out).toMatch(/button\s+background\s+btn\.bg\s+map\s+#0F6CBD/);
			expect(out).toContain('map stored on global');
			expect(out).toContain('drawn on next: button');

			logs.length = 0;
			await expect(run('specimen', 'set', 'next', 'button.background=nope')).rejects.toThrow(
				'process.exit(1)',
			);
			expect(logs.join('\n')).toContain('No token with these ids');

			const file = path.join(tmpDir, 'map.json');
			fs.writeFileSync(file, JSON.stringify({ card: { background: 'btn.bg' } }));
			logs.length = 0;
			await run('--json', 'specimen', 'set', 'global', '--file', file, '--replace');
			expect(JSON.parse(logs.join('\n')).data.map).toEqual({ card: { background: 'btn.bg' } });
		});

		it('reads role assignments', () => {
			expect(parseSpecimenAssignment('button.padding.x=btn.pad')).toEqual([
				'button',
				'padding.x',
				'btn.pad',
			]);
			expect(parseSpecimenAssignment('button.border=')).toEqual(['button', 'border', null]);
			expect(() => parseSpecimenAssignment('button=btn.bg')).toThrow('component.role=tokenId');
		});
	});

	describe('demo seed', () => {
		it('refuses a database that already has nodes', async () => {
			await expect(run('demo', 'seed')).rejects.toThrow('process.exit(1)');

			expect(logs.join('\n')).toContain('demo data only seeds an empty database');
		});

		it('seeds a realistic system into an empty database', async () => {
			const demoDb = path.join(tmpDir, 'demo.db');

			await createCLI(true).parseAsync(['node', 'violet', '--db', demoDb, 'demo', 'seed']);

			expect(logs.join('\n')).toMatch(/Seeded 37 nodes, \d{4} tokens/);
			logs.length = 0;
			await createCLI(true).parseAsync([
				'node',
				'violet',
				'--db',
				demoDb,
				'tree',
				'--root',
				'xbox',
			]);
			expect(logs.join('\n')).toContain('xbox-ios-dark (theme)');
		}, 60_000);
	});

	describe('apikeys', () => {
		it('create --json returns a token, seed and SQL without touching the database', async () => {
			await run(
				'--json',
				'apikeys',
				'create',
				'--id',
				'lushly-preview',
				'--name',
				'Lushly (preview)',
				'--scopes',
				'tokens:read, export:read',
				'--rate-limit',
				'50',
			);

			const result = JSON.parse(logs.join('\n'));
			expect(result.success).toBe(true);
			expect(result.data.token).toMatch(/^[0-9a-f]{64}$/);
			expect(result.data.seed.data).toMatchObject({
				id: 'lushly-preview',
				scopes: ['tokens:read', 'export:read'],
				rateLimit: 50,
			});
			expect(result.data.sql.insert).toContain(result.data.tokenHash);
		});

		it('create exits 1 on an unknown scope', async () => {
			await expect(
				run('apikeys', 'create', '--id', 'k', '--name', 'K', '--scopes', 'token:read'),
			).rejects.toThrow('process.exit(1)');
			expect(logs.join('\n')).toContain('Unknown scope(s): token:read');
		});

		it('check passes a valid file and exits 1 on errors, without printing tokens', async () => {
			const token = 'c'.repeat(64);
			const entry = (id: string, scopes: string[]) => ({
				token,
				data: { id, name: id, createdAt: '2026-10-26T00:00:00.000Z', scopes },
			});
			const good = path.join(tmpDir, 'good.json');
			const bad = path.join(tmpDir, 'bad.json');
			fs.writeFileSync(good, JSON.stringify([entry('a', ['tokens:read'])]));
			fs.writeFileSync(bad, JSON.stringify([entry('a', ['tokens:read']), entry('b', ['read'])]));

			await run('apikeys', 'check', good);
			expect(process.exitCode).toBeFalsy();
			expect(logs.join('\n')).toContain('1 key(s) would seed cleanly');

			logs.length = 0;
			await run('apikeys', 'check', bad);
			expect(process.exitCode).toBe(1);
			const output = logs.join('\n');
			expect(output).toContain('DUPLICATE_TOKEN entry 2 (b)');
			expect(output).toContain('BROAD_SCOPE');
			expect(output).not.toContain(token);
		});

		it('check reads VIOLET_API_KEYS_JSON when no file is given', async () => {
			vi.stubEnv('VIOLET_API_KEYS_JSON', '[{"token": "x",}]');
			await run('--json', 'apikeys', 'check');
			vi.unstubAllEnvs();

			const result = JSON.parse(logs.join('\n'));
			expect(result.data.issues[0].code).toBe('INVALID_JSON');
			expect(process.exitCode).toBe(1);
		});
	});

	describe('cicd setup', () => {
		it('writes the workflows and reports next steps with --json', async () => {
			const outDir = path.join(tmpDir, 'wf');

			await run(
				'--json',
				'cicd',
				'setup',
				'-t',
				'sync,validate,release',
				'-n',
				'brand',
				'-o',
				outDir,
			);

			const result = JSON.parse(logs.join('\n'));
			expect(result.success).toBe(true);
			expect(result.data.createdFiles).toEqual(
				['sync', 'validate', 'release'].map((t) => path.join(outDir, `tokens-${t}.yml`)),
			);
			expect(fs.readdirSync(outDir).sort()).toEqual([
				'tokens-release.yml',
				'tokens-sync.yml',
				'tokens-validate.yml',
			]);
			const steps = result.data.nextSteps.join('\n');
			expect(steps).toContain('npm install --save-dev @lushly-dev/violet-cli');
			expect(steps).toContain('not on npm yet');
			expect(steps).toContain('VIOLET_API_URL');
			expect(steps).not.toContain('dashboard');
			// No Style Dictionary config or npm scripts the workflows depend on
			expect(fs.existsSync('style-dictionary.config.js')).toBe(false);
		});

		it('skips existing workflows unless --force is given', async () => {
			const outDir = path.join(tmpDir, 'wf');
			fs.mkdirSync(outDir);
			fs.writeFileSync(path.join(outDir, 'tokens-validate.yml'), 'mine');

			await run('--agent', 'cicd', 'setup', '-t', 'validate', '-o', outDir);
			expect(JSON.parse(logs.join('\n')).data.skippedFiles).toHaveLength(1);
			expect(fs.readFileSync(path.join(outDir, 'tokens-validate.yml'), 'utf-8')).toBe('mine');

			await run('--agent', 'cicd', 'setup', '-t', 'validate', '-o', outDir, '--force');
			expect(fs.readFileSync(path.join(outDir, 'tokens-validate.yml'), 'utf-8')).toContain(
				'cicd validate',
			);
		});

		it.each([
			[['-t', 'sync,nope'], 'Unknown template(s): nope'],
			[['-p', 'gitlab'], "Unsupported platform 'gitlab'"],
			[['-n', 'a b: c'], "Invalid --node 'a b: c'"],
			[['--tokens-dir', '/abs/tokens'], "Invalid --tokens-dir '/abs/tokens'"],
		])('exits 1 without writing files for %j', async (args, message) => {
			const outDir = path.join(tmpDir, 'wf');

			await expect(run('--json', 'cicd', 'setup', ...args, '-o', outDir)).rejects.toThrow(
				'process.exit(1)',
			);

			expect(JSON.parse(logs.join('\n')).error.message).toContain(message);
			expect(fs.existsSync(outDir)).toBe(false);
		});

		it("runs the generated validate workflow's violet steps against DTCG files", async () => {
			const tokensDir = path.join(tmpDir, 'tokens');
			fs.mkdirSync(tokensDir);
			fs.writeFileSync(
				path.join(tokensDir, 'brand.tokens.json'),
				JSON.stringify({ color: { $type: 'color', primary: { $value: '#0078D4' } } }),
			);
			fs.writeFileSync(
				path.join(tokensDir, 'brand-dark.tokens.json'),
				JSON.stringify({
					$extensions: { 'dev.lushly.violet': { parent: 'brand' } },
					color: { primary: { $value: '#4CC2FF' }, accent: { $value: '{color.primary}' } },
				}),
			);
			const outDir = path.join(tmpDir, 'wf');
			await run('cicd', 'setup', '-t', 'validate', '-n', 'brand-dark', '-o', outDir);
			const workflow = fs.readFileSync(path.join(outDir, 'tokens-validate.yml'), 'utf-8');

			const env: Record<string, string> = {
				VIOLET_TOKENS_DIR: tokensDir,
				VIOLET_NODE: 'brand-dark',
				RUNNER_TEMP: tmpDir,
			};
			const steps = [...workflow.matchAll(/run: npx --no -- violet (.+)/g)].map((m) =>
				m[1]
					.replace(/"([^"]*)"/g, (_, arg) =>
						arg.replace(/\$(\w+)/g, (_v: string, name: string) => env[name]),
					)
					.split(' '),
			);
			expect(steps).toHaveLength(2);
			for (const argv of steps) {
				await createCLI(true).parseAsync(['node', 'violet', ...argv]);
			}

			expect(errors).toEqual([]);
			expect(logs.join('\n')).toContain('Valid: 2/2');
			const css = fs.readFileSync(path.join(tmpDir, 'violet-tokens', 'tokens.css'), 'utf-8');
			expect(css).toContain('--color-accent: #4CC2FF');
		});
	});

	describe('init', () => {
		it('prints the command result as JSON with --json', async () => {
			await run('--json', 'init', '--name', 'root-a');

			const result = JSON.parse(logs.join('\n'));
			expect(result.success).toBe(true);
			expect(result.data.node.id).toBe('root-a');
			expect(result.data.node.type).toBe('root');
		});

		it('prints one compact JSON line with --agent and exits 1 on a duplicate', async () => {
			await run('--agent', 'init', '--name', 'root-b');
			expect(logs).toHaveLength(1);
			expect(JSON.parse(logs[0]).success).toBe(true);

			logs.length = 0;
			await expect(run('--agent', 'init', '--name', 'root-b')).rejects.toThrow('process.exit(1)');
			expect(JSON.parse(logs[0]).success).toBe(false);
		});
	});

	describe('exit codes with --json', () => {
		it('doctor --json sets a non-zero exit code when unhealthy', async () => {
			vi.spyOn(registry, 'execute').mockResolvedValueOnce({
				success: true,
				data: {
					healthy: false,
					checks: [],
					summary: { passed: 0, warnings: 0, failed: 1, total: 1 },
				},
			});

			await run('--json', 'doctor');

			expect(process.exitCode).toBe(1);
		});

		it('doctor --json leaves the exit code alone when healthy', async () => {
			vi.spyOn(registry, 'execute').mockResolvedValueOnce({
				success: true,
				data: {
					healthy: true,
					checks: [],
					summary: { passed: 1, warnings: 0, failed: 0, total: 1 },
				},
			});

			await run('--json', 'doctor');

			expect(process.exitCode).toBeFalsy();
		});

		it('validate --json sets a non-zero exit code when tests fail', async () => {
			vi.spyOn(registry, 'execute').mockResolvedValueOnce({
				success: true,
				data: {
					passed: false,
					testResults: { total: 2, passed: 1, failed: 1, skipped: 0, duration: 1 },
				},
			});

			await run('--json', 'validate');

			expect(process.exitCode).toBe(1);
		});
	});
});
