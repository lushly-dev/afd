/**
 * Regression tests for exceptions thrown during input validation and by
 * observer hooks (H2). Validation callbacks used to run outside the execution
 * `try`, so `/batch` answered HTTP 500 after an earlier mutation had already
 * run, and pipe and stream errors carried the raw exception text.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CommandResult } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createExecutionEngine, type ExecutionDeps } from './execution.js';
import { defineCommand, type ZodCommandDefinition } from './schema.js';
import { createMcpHandler } from './server.js';
import type { McpHandlerOptions } from './server-types.js';

const SECRET = 'db password=hunter2 at /srv/app/db.ts';

function explode(): never {
	throw new Error(SECRET);
}

const throwingSchemas = {
	refine: z.object({ value: z.string() }).refine(explode),
	superRefine: z.object({ value: z.string() }).superRefine(explode),
	transform: z.object({ value: z.string() }).transform(explode),
	preprocess: z.preprocess(explode, z.object({ value: z.string() })),
};

function createWriteCommand(writes: string[]) {
	return defineCommand({
		name: 'item-write',
		description: 'Record a write',
		mutation: true,
		expose: { mcp: true },
		input: z.object({}),
		handler: async () => {
			writes.push('write');
			return success({ written: writes.length });
		},
	});
}

const checkCommand = defineCommand({
	name: 'item-check',
	description: 'Validate with a refinement that throws',
	expose: { mcp: true },
	input: throwingSchemas.refine,
	handler: async () => success({ checked: true }),
});

function engineFor(command: ZodCommandDefinition, deps: Partial<ExecutionDeps> = {}) {
	return createExecutionEngine({
		commandMap: new Map([[command.name, command]]),
		middleware: [],
		devMode: false,
		...deps,
	});
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function host(options: Partial<McpHandlerOptions> = {}) {
	const handler = createMcpHandler({
		name: 'validation-exceptions',
		version: '1',
		host: '127.0.0.1',
		commands: [],
		...options,
	});
	const server = createServer(handler);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	cleanups.push(async () => {
		handler.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve()))
		);
	});
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** POST JSON and return the status and raw body text. */
async function post(url: string, path: string, body: unknown) {
	const response = await fetch(`${url}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	return { status: response.status, text: await response.text() };
}

async function toolCall(url: string, name: string, args: unknown) {
	const { status, text } = await post(url, '/message', {
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/call',
		params: { name, arguments: args },
	});
	return { status, text, body: JSON.parse(JSON.parse(text).result.content[0].text) };
}

function expectValidationError(error: CommandResult['error']) {
	expect(error?.code).toBe('VALIDATION_ERROR');
	expect(error?.message).toBe('Input validation failed');
	expect(error?.suggestion).toContain('afd-detail');
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

describe('exceptions thrown during input validation', () => {
	it.each(Object.entries(throwingSchemas))(
		'turns a throwing %s into a VALIDATION_ERROR result',
		async (_kind, schema) => {
			const onError = vi.fn();
			const handler = vi.fn(async () => success({ ran: true }));
			// Build with a plain schema, then swap in the throwing one: defineCommand
			// cannot derive a JSON Schema from a transform.
			const base: ZodCommandDefinition = defineCommand({
				name: 'item-check',
				description: 'Throwing validator',
				input: z.object({ value: z.string() }),
				handler,
			});
			const command: ZodCommandDefinition = { ...base, inputSchema: schema };
			const result = await engineFor(command, { onError }).executeCommand('item-check', {
				value: 'x',
			});

			expect(result.success).toBe(false);
			expectValidationError(result.error);
			expect(JSON.stringify(result)).not.toContain('hunter2');
			expect(handler).not.toHaveBeenCalled();
			expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: SECRET }));
		}
	);

	it('includes the exception message in the suggestion only in devMode', async () => {
		const result = await engineFor(checkCommand, { devMode: true }).executeCommand('item-check', {
			value: 'x',
		});
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toBe('Input validation failed');
		expect(result.error?.suggestion).toContain(SECRET);
	});

	it('keeps the VALIDATION_ERROR when onError itself throws', async () => {
		const result = await engineFor(checkCommand, {
			onError: () => {
				throw new Error('hook failed');
			},
		}).executeCommand('item-check', { value: 'x' });
		expectValidationError(result.error);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// HOOKS AND HANDLER RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('observer hooks and handler results', () => {
	const okCommand = defineCommand({
		name: 'item-save',
		description: 'Succeeds',
		input: z.object({}),
		handler: async () => success({ saved: true }),
	});

	it('does not flip a success when onCommand throws, and reports the hook error', async () => {
		const hookError = new Error('audit log offline');
		const onError = vi.fn();
		const result = await engineFor(okCommand, {
			onCommand: () => {
				throw hookError;
			},
			onError,
		}).executeCommand('item-save', {});

		expect(result.success).toBe(true);
		expect(result.data).toEqual({ saved: true });
		expect(onError).toHaveBeenCalledWith(hookError);
	});

	it('does not flip a success when onCommand and onError both throw', async () => {
		const result = await engineFor(okCommand, {
			onCommand: () => {
				throw new Error('audit log offline');
			},
			onError: () => {
				throw new Error('error sink offline');
			},
		}).executeCommand('item-save', {});
		expect(result.success).toBe(true);
	});

	it('contains a rejected promise from an async onCommand', async () => {
		const onError = vi.fn();
		const result = await engineFor(okCommand, {
			onCommand: (async () => {
				throw new Error('async audit failure');
			}) as ExecutionDeps['onCommand'],
			onError,
		}).executeCommand('item-save', {});
		expect(result.success).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'async audit failure' })
		);
	});

	it('keeps COMMAND_EXECUTION_ERROR when the handler and onError both throw', async () => {
		const command = defineCommand({
			name: 'item-fail',
			description: 'Throws',
			input: z.object({}),
			handler: async () => {
				throw new Error(SECRET);
			},
		});
		const result = await engineFor(command, {
			onError: () => {
				throw new Error('error sink offline');
			},
		}).executeCommand('item-fail', {});
		expect(result.error?.code).toBe('COMMAND_EXECUTION_ERROR');
		expect(JSON.stringify(result)).not.toContain('hunter2');
	});

	it('accepts a frozen handler result without mutating it', async () => {
		const frozen = Object.freeze({
			success: true as const,
			data: Object.freeze({ id: 1 }),
			metadata: Object.freeze({ warnings: [] }),
		});
		const command = defineCommand({
			name: 'item-frozen',
			description: 'Returns a frozen result',
			version: '2.0.0',
			input: z.object({}),
			handler: async () => frozen,
		});
		const result = await engineFor(command).executeCommand('item-frozen', {}, { traceId: 't-1' });

		expect(result.success).toBe(true);
		expect(result.data).toEqual({ id: 1 });
		expect(result.metadata).toMatchObject({
			warnings: [],
			commandVersion: '2.0.0',
			traceId: 't-1',
		});
		expect(typeof result.metadata?.executionTimeMs).toBe('number');
		expect(result).not.toBe(frozen);
		expect(frozen.metadata).toEqual({ warnings: [] });
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// EVERY REMOTE ROUTE
// ═══════════════════════════════════════════════════════════════════════════════

describe('a throwing validator through every remote route (devMode: false)', () => {
	async function setup(toolStrategy: McpHandlerOptions['toolStrategy'] = 'individual') {
		const writes: string[] = [];
		const onError = vi.fn();
		const url = await host({
			commands: [createWriteCommand(writes), checkCommand],
			toolStrategy,
			onError,
		});
		return { url, writes, onError };
	}
	const input = { value: 'x' };

	it('/rpc', async () => {
		const { url } = await setup();
		const { status, text } = await post(url, '/rpc', { method: 'item-check', params: input });
		expect(status).toBe(200);
		expect(text).not.toContain('hunter2');
		expectValidationError(JSON.parse(text).result.error);
	});

	it('tools/call of the command (individual and grouped)', async () => {
		const { url } = await setup('individual');
		const individual = await toolCall(url, 'item-check', input);
		expect(individual.status).toBe(200);
		expect(individual.text).not.toContain('hunter2');
		expectValidationError(individual.body.error);

		const grouped = await setup('grouped');
		const viaGroup = await toolCall(grouped.url, 'item', { action: 'check', params: input });
		expect(viaGroup.text).not.toContain('hunter2');
		expectValidationError(viaGroup.body.error);
	});

	it('afd-call', async () => {
		const { url, onError } = await setup();
		const { status, text, body } = await toolCall(url, 'afd-call', {
			command: 'item-check',
			input,
		});
		expect(status).toBe(200);
		expect(text).not.toContain('hunter2');
		expectValidationError(body.error);
		expect(onError).toHaveBeenCalledOnce();
	});

	it('afd-batch returns a batch result after the earlier mutation ran', async () => {
		const { url, writes } = await setup();
		const { status, text, body } = await toolCall(url, 'afd-batch', {
			commands: [
				{ command: 'item-write', input: {} },
				{ command: 'item-check', input },
			],
		});
		expect(status).toBe(200);
		expect(text).not.toContain('hunter2');
		expect(writes).toHaveLength(1);
		expect(body.results[0].result.success).toBe(true);
		expectValidationError(body.results[1].result.error);
		expect(body.summary).toMatchObject({ total: 2, successCount: 1, failureCount: 1 });
	});

	it('/batch returns a batch result, not HTTP 500, after the earlier mutation ran', async () => {
		const { url, writes } = await setup();
		const { status, text } = await post(url, '/batch', {
			commands: [
				{ command: 'item-write', input: {} },
				{ command: 'item-check', input },
			],
		});
		expect(status).toBe(200);
		expect(text).not.toContain('hunter2');
		expect(writes).toHaveLength(1);
		const body = JSON.parse(text);
		expect(body.results[0].result.success).toBe(true);
		expectValidationError(body.results[1].result.error);
	});

	it('afd-pipe', async () => {
		const { url, writes } = await setup();
		const { status, text, body } = await toolCall(url, 'afd-pipe', {
			steps: [{ command: 'item-write' }, { command: 'item-check', input }],
		});
		expect(status).toBe(200);
		expect(text).not.toContain('hunter2');
		expect(writes).toHaveLength(1);
		expect(body.steps[0].status).toBe('success');
		expect(body.steps[1].status).toBe('failure');
		expectValidationError(body.steps[1].error);
	});

	it('/stream (GET and POST)', async () => {
		const { url } = await setup();
		const query = encodeURIComponent(JSON.stringify(input));
		const viaGet = await fetch(`${url}/stream/item-check?input=${query}`);
		const viaPost = await post(url, '/stream/item-check', input);
		for (const { status, text } of [
			{ status: viaGet.status, text: await viaGet.text() },
			viaPost,
		]) {
			expect(status).toBe(200);
			expect(text).not.toContain('hunter2');
			const chunk = JSON.parse(text.split('data: ')[1]?.split('\n')[0] ?? '{}');
			expect(chunk.type).toBe('error');
			expectValidationError(chunk.error);
		}
	});
});
