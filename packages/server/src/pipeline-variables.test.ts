/**
 * `afd-pipe` over real HTTP, checked against spec/pipeline-variables.md: reference forms,
 * literals and `$$` escapes, own-key traversal, `$input` from the request (never the server's
 * execution context), unresolved references, the 64-level limit and `when` conditions.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CommandContext, PipelineResult } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const seen: Array<{ command: string; input: unknown; context: CommandContext }> = [];
afterEach(() => {
	seen.length = 0;
});

const anyInput = z.record(z.string(), z.unknown());
const commands = [
	defineCommand({
		name: 'user-get',
		description: 'Returns a fixed user',
		expose: { mcp: true },
		input: anyInput,
		handler: async (input, context) => {
			seen.push({ command: 'user-get', input, context });
			return success({ id: 'u-1', tier: 'premium', tags: ['a', 'b'], profile: { plan: 'pro' } });
		},
	}),
	defineCommand({
		name: 'echo',
		description: 'Returns its input',
		expose: { mcp: true },
		input: anyInput,
		handler: async (input, context) => {
			seen.push({ command: 'echo', input, context });
			return success(input);
		},
	}),
	defineCommand({
		name: 'mutate',
		description: 'Mutates the user object it receives',
		expose: { mcp: true },
		input: anyInput,
		handler: async (input, context) => {
			seen.push({ command: 'mutate', input, context });
			const { user } = input;
			if (typeof user === 'object' && user !== null) Object.assign(user, { tier: 'mutated' });
			return success(input);
		},
	}),
];

async function host(): Promise<string> {
	const handler = createMcpHandler({
		name: 'pipeline-variables',
		version: '1',
		host: '127.0.0.1',
		commands,
		toolStrategy: 'individual',
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

/** Call `afd-pipe` with a raw JSON body so the request is exactly what a remote client sends. */
async function pipe(body: string): Promise<{ isError: boolean; result: PipelineResult }> {
	const response = await fetch(`${await host()}/message`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"afd-pipe","arguments":${body}}}`,
	});
	expect(response.status).toBe(200);
	const json = (await response.json()) as {
		result: { isError: boolean; content: Array<{ text: string }> };
	};
	return {
		isError: json.result.isError,
		result: JSON.parse(json.result.content[0]?.text ?? 'null') as PipelineResult,
	};
}

function nestedJson(levels: number): string {
	return `${'{"next":'.repeat(levels - 1)}{"leaf":"$prev"}${'}'.repeat(levels - 1)}`;
}

describe('afd-pipe variable references over HTTP', () => {
	it('resolves every reference form', async () => {
		const { isError, result } = await pipe(
			JSON.stringify({
				input: { tenant: 'acme', ids: [10, 20] },
				steps: [
					{ command: 'user-get', input: {}, as: 'user' },
					{
						command: 'echo',
						input: {
							prev: '$prev.id',
							first: '$first.tags[1]',
							index: '$steps[0].profile.plan',
							alias: '$steps.user.tier',
							numeric: '$steps.user.tags.0',
							input: '$input.tenant',
							inputIndex: '$input.ids[1]',
						},
					},
				],
			})
		);
		expect(isError).toBe(false);
		expect(result.data).toEqual({
			prev: 'u-1',
			first: 'b',
			index: 'pro',
			alias: 'premium',
			numeric: 'a',
			input: 'acme',
			inputIndex: 20,
		});
	});

	it('passes literals through and unescapes $$', async () => {
		const long = `$prev.${'a'.repeat(1100)}`;
		const { result } = await pipe(
			JSON.stringify({
				steps: [
					{ command: 'user-get', input: {} },
					{
						command: 'echo',
						input: { price: '$9.99', home: '$HOME', escaped: '$$prev', prevx: '$prevx', long },
					},
				],
			})
		);
		expect(result.data).toEqual({
			price: '$9.99',
			home: '$HOME',
			escaped: '$prev',
			prevx: '$prevx',
			long,
		});
	});

	it('never reaches prototypes or __-prefixed keys', async () => {
		const { result } = await pipe(`{
			"input": {"__proto__": {"polluted": true}, "safe": 1},
			"steps": [
				{"command": "user-get", "input": {}},
				{"command": "echo", "input": {
					"fn": "$prev.constructor.constructor",
					"proto": "$input.__proto__",
					"polluted": "$input.__proto__.polluted",
					"cls": "$prev.__class__",
					"length": "$prev.tags.length",
					"safe": "$input.safe"
				}}
			]
		}`);
		expect(result.data).toEqual({ safe: 1 });
		expect(seen[1]?.input).toEqual({ safe: 1 });
	});

	it('resolves $input only from the request input, never the execution context', async () => {
		const without = await pipe(
			JSON.stringify({
				steps: [{ command: 'echo', input: { all: '$input', trace: '$input.traceId' } }],
			})
		);
		expect(without.result.data).toEqual({});
		expect(seen[0]?.context.traceId).toEqual(expect.any(String));

		const withInput = await pipe(
			JSON.stringify({ input: 'text', steps: [{ command: 'echo', input: { all: '$input' } }] })
		);
		expect(withInput.result.data).toEqual({ all: 'text' });
	});

	it('omits unresolved references and uses null in arrays', async () => {
		const { result } = await pipe(
			JSON.stringify({
				steps: [
					{ command: 'user-get', input: {}, as: 'user' },
					{
						command: 'echo',
						input: {
							alias: '$steps.nope.id',
							outOfBounds: '$steps.user.tags[5]',
							list: ['$steps.nope', '$steps.user.tags[0]', '$steps[7]'],
						},
					},
				],
			})
		);
		expect(result.data).toEqual({ list: [null, 'a', null] });
	});

	it('rejects 65-level nesting with VALIDATION_ERROR before any step runs', async () => {
		const { isError, result } = await pipe(
			`{"steps":[{"command":"user-get","input":{}},{"command":"echo","input":${nestedJson(65)}}]}`
		);
		expect(isError).toBe(true);
		expect(seen).toHaveLength(0);
		expect(result.steps).toHaveLength(1);
		expect(result.steps[0]?.error).toMatchObject({
			code: 'VALIDATION_ERROR',
			suggestion: expect.any(String),
			details: { stepIndex: 1, maxDepth: 64 },
		});
	});

	it('answers very deep bodies with a result instead of a stack overflow', async () => {
		const { isError, result } = await pipe(
			`{"input":${nestedJson(5000)},"steps":[{"command":"echo","input":${nestedJson(5000)}}]}`
		);
		expect(isError).toBe(true);
		expect(seen).toHaveLength(0);
		expect(result.steps[0]?.error?.code).toBe('VALIDATION_ERROR');
	});

	it('runs 64-level nesting', async () => {
		const { isError } = await pipe(
			`{"steps":[{"command":"user-get","input":{}},{"command":"echo","input":${nestedJson(64)}}]}`
		);
		expect(isError).toBe(false);
		expect(seen).toHaveLength(2);
	});

	it('skips steps whose when condition reads an unresolved path', async () => {
		const { result } = await pipe(
			JSON.stringify({
				steps: [
					{ command: 'user-get', input: {} },
					{ command: 'echo', input: {}, when: { $exists: '$prev.missing.path' } },
					{ command: 'echo', input: {}, when: { $ne: ['$steps.nope', 'x'] } },
					{ command: 'echo', input: {}, when: { $gt: ['$input.count', 0] } },
				],
			})
		);
		expect(result.steps.map((step) => step.status)).toEqual([
			'success',
			'skipped',
			'skipped',
			'skipped',
		]);
	});

	it('does not share step data by reference between steps', async () => {
		const { result } = await pipe(
			JSON.stringify({
				steps: [
					{ command: 'user-get', input: {}, as: 'source' },
					{ command: 'mutate', input: { user: '$prev' } },
					{ command: 'echo', input: { tier: '$steps.source.tier' } },
				],
			})
		);
		expect(result.steps[0]?.data).toMatchObject({ tier: 'premium' });
		expect(result.steps[1]?.data).toMatchObject({ user: { tier: 'mutated' } });
		expect(result.data).toEqual({ tier: 'premium' });
	});
});
