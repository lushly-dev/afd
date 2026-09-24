import { type CommandDefinition, failure, success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import {
	createFailureCommand,
	createMockCommand,
	createSuccessCommand,
	createTestContext,
	createTestRegistry,
	testCommand,
	testCommandDefinition,
	testCommandMultiple,
} from './test-helpers.js';

describe('test helpers', () => {
	it('creates an isolated context and applies overrides', () => {
		const now = new Date('2026-09-05T00:00:00Z');
		const context = createTestContext({ traceId: 'known', timeout: 20, userId: 'u1', now });

		expect(context).toMatchObject({ traceId: 'known', timeout: 20, userId: 'u1', now });
		expect(createTestContext().traceId).toMatch(/^test-/);
	});

	it('executes and validates a successful handler with the supplied context', async () => {
		const result = await testCommand(
			async (input: { value: number }, context) =>
				success({ value: input.value, traceId: context?.traceId }),
			{ value: 3 },
			{ context: createTestContext({ traceId: 'trace-3' }) }
		);

		expect(result.result.data).toEqual({ value: 3, traceId: 'trace-3' });
		expect(result).toMatchObject({ isValid: true, isSuccess: true, isFailure: false });
		expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
	});

	it('turns thrown handler errors into validated failures', async () => {
		const result = await testCommand(async () => {
			throw new Error('database unavailable');
		}, {});

		expect(result.isFailure).toBe(true);
		expect(result.result.error?.message).toBe('database unavailable');
		expect(result.validation.valid).toBe(true);
	});

	it('validates a full definition and its result', async () => {
		const command: CommandDefinition<{ name: string }, { greeting: string }> = {
			name: 'user-greet',
			description: 'Create a greeting',
			category: 'users',
			parameters: [{ name: 'name', type: 'string', description: 'Person name' }],
			errors: ['INVALID_NAME'],
			handler: async ({ name }) => success({ greeting: `Hello ${name}` }),
		};

		const result = await testCommandDefinition(command, { name: 'Ada' });

		expect(result.definitionValidation.valid).toBe(true);
		expect(result.resultValidation.valid).toBe(true);
		expect(result.result.data).toEqual({ greeting: 'Hello Ada' });
	});

	it('evaluates expected outcomes across multiple cases', async () => {
		const results = await testCommandMultiple(
			async ({ valid }: { valid: boolean }) =>
				valid ? success({ saved: true }) : failure({ code: 'INVALID', message: 'Invalid input' }),
			[
				{ input: { valid: true }, expectSuccess: true, description: 'valid input' },
				{ input: { valid: false }, expectSuccess: false, expectError: 'INVALID' },
				{ input: { valid: false }, expectError: 'OTHER' },
			]
		);

		expect(results.map((result) => result.passed)).toEqual([true, true, false]);
		expect(results[0]?.description).toBe('valid input');
	});

	it('fails a case whose expected error does not occur', async () => {
		const results = await testCommandMultiple(
			async () => success({ saved: true }),
			[
				{ input: {}, expectError: 'INVALID' },
				{ input: {}, expectSuccess: true, expectError: 'INVALID' },
			]
		);

		expect(results.map((result) => result.passed)).toEqual([false, false]);
	});

	it('creates mock commands for success, failure, and thrown errors', async () => {
		const echo = createMockCommand<{ value: number }, number>('test-echo', ({ value }) => value);
		const throws = createMockCommand('test-throw', () => {
			throw new TypeError('bad mock');
		});
		const succeeds = createSuccessCommand('test-success', { id: '1' });
		const fails = createFailureCommand('test-failure', { code: 'EXPECTED', message: 'Expected' });

		expect((await echo.handler({ value: 4 }, createTestContext())).data).toBe(4);
		expect((await throws.handler({}, createTestContext())).error?.message).toBe('bad mock');
		expect((await succeeds.handler({}, createTestContext())).data).toEqual({ id: '1' });
		expect((await fails.handler({}, createTestContext())).error?.code).toBe('EXPECTED');
	});

	it('reports a void command result as a success', async () => {
		const result = await testCommand(async () => success(undefined), {});

		expect(result).toMatchObject({ isSuccess: true, isFailure: false });
	});

	it('exposes mock commands to MCP so MockMcpServer can call them', async () => {
		const commands = [
			createMockCommand('test-echo', () => 1),
			createSuccessCommand('test-success', 1),
			createFailureCommand('test-failure', { code: 'EXPECTED', message: 'Expected' }),
		];

		for (const command of commands) {
			expect(command.expose).toMatchObject({ mcp: true, palette: true, agent: true, cli: false });
		}
		const registry = createTestRegistry(commands);
		expect((await registry.execute('test-echo', {}, { interface: 'mcp' })).data).toBe(1);
	});

	it('wraps thrown system errors without leaking their fields', async () => {
		const result = await testCommand(async () => {
			throw Object.assign(new Error('ENOENT: no such file'), {
				code: 'ENOENT',
				syscall: 'open',
				path: '/srv/app/.env',
			});
		}, {});

		expect(result.isFailure).toBe(true);
		expect(result.result.error?.code).toBe('ENOENT');
		expect(JSON.stringify(result.result)).not.toContain('/srv/app/.env');
	});

	it('registers all mock commands for executable lookup', async () => {
		const registry = createTestRegistry([
			createSuccessCommand('first-run', 1),
			createSuccessCommand('second-run', 2),
		]);

		expect(registry.list().map((command) => command.name)).toEqual(['first-run', 'second-run']);
		expect((await registry.execute('second-run', {})).data).toBe(2);
	});
});
