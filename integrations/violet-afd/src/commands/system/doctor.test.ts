import { createMemoryDatabase } from '@lushly-dev/violet-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { registry } from '../registry.js';
import type { CommandContext } from '../registry.js';
import { doctorCommand, registerSystemCommands } from './index.js';

describe('Doctor Command', () => {
	let context: CommandContext;

	beforeEach(() => {
		// Clear registry and re-register
		const commands = registry.list();
		for (const cmd of commands) {
			// Unregister by accessing private map (for testing)
			(registry as unknown as { commands: Map<string, unknown> }).commands.delete(cmd.name);
		}
		registerSystemCommands();

		const db = createMemoryDatabase();
		context = {
			db,
			actor: 'test',
			traceId: 'test-trace',
		};
	});

	it('returns healthy status with valid configuration', async () => {
		const result = await doctorCommand.handler({}, context);

		expect(result.success).toBe(true);
		expect(result.data).toBeDefined();
		// Healthy only on Violet's supported runtime; AFD's CI also runs Node 22, which doctor rightly flags.
		const supportedNode = Number.parseInt(process.versions.node.split('.')[0], 10) >= 24;
		expect(result.data?.healthy).toBe(supportedNode);
		expect(result.data?.checks).toBeInstanceOf(Array);
		expect(result.data?.checks.length).toBeGreaterThan(0);
	});

	it('includes summary with check counts', async () => {
		const result = await doctorCommand.handler({}, context);

		expect(result.success).toBe(true);
		expect(result.data?.summary).toBeDefined();
		const summary = result.data?.summary;
		expect(summary?.total).toBeGreaterThan(0);
		expect(summary?.passed).toBeGreaterThanOrEqual(0);
		expect(summary?.warnings).toBeGreaterThanOrEqual(0);
		expect(summary?.failed).toBeGreaterThanOrEqual(0);
		if (summary) {
			expect(summary.passed + summary.warnings + summary.failed).toBe(summary.total);
		}
	});

	it('checks Node.js version', async () => {
		const result = await doctorCommand.handler({}, context);

		expect(result.success).toBe(true);
		const nodeCheck = result.data?.checks.find(
			(c: { name: string }) => c.name === 'Node.js version',
		);
		expect(nodeCheck).toBeDefined();
		expect(['pass', 'warn', 'fail']).toContain(nodeCheck?.status);
	});

	it('checks database connectivity', async () => {
		const result = await doctorCommand.handler({}, context);

		expect(result.success).toBe(true);
		const dbCheck = result.data?.checks.find(
			(c: { name: string }) => c.name === 'Database connectivity',
		);
		expect(dbCheck).toBeDefined();
		expect(dbCheck?.status).toBe('pass');
	});

	it('checks command registry', async () => {
		const result = await doctorCommand.handler({}, context);

		expect(result.success).toBe(true);
		const registryCheck = result.data?.checks.find(
			(c: { name: string }) => c.name === 'Command registry',
		);
		expect(registryCheck).toBeDefined();
		// With only system commands registered, we expect a warning
		expect(['pass', 'warn']).toContain(registryCheck?.status);
	});

	it('checks write capability', async () => {
		const result = await doctorCommand.handler({}, context);

		expect(result.success).toBe(true);
		const writeCheck = result.data?.checks.find(
			(c: { name: string }) => c.name === 'Write capability',
		);
		expect(writeCheck).toBeDefined();
		expect(writeCheck?.status).toBe('pass');
	});

	it('includes environment info when verbose', async () => {
		const result = await doctorCommand.handler({ verbose: true }, context);

		expect(result.success).toBe(true);
		expect(result.data?.environment).toBeDefined();
		expect(result.data?.environment?.nodeVersion).toBeDefined();
		expect(result.data?.environment?.platform).toBeDefined();
		expect(result.data?.environment?.arch).toBeDefined();
		expect(result.data?.environment?.cwd).toBeDefined();
	});

	it('excludes environment info when not verbose', async () => {
		const result = await doctorCommand.handler({ verbose: false }, context);

		expect(result.success).toBe(true);
		expect(result.data?.environment).toBeUndefined();
	});

	it('includes reasoning in result', async () => {
		const result = await doctorCommand.handler({}, context);

		expect(result.success).toBe(true);
		expect(result.reasoning).toBeDefined();
		expect(typeof result.reasoning).toBe('string');
	});

	it('includes confidence in result', async () => {
		const result = await doctorCommand.handler({}, context);

		expect(result.success).toBe(true);
		expect(result.confidence).toBe(1.0);
	});
});
