/**
 * Golden wire fixtures shared by the TypeScript, Python and Rust implementations.
 *
 * These tests drive a real `createMcpHandler` over HTTP and compare what goes on the wire
 * with `spec/wire/*.json`. The Python and Rust test suites round-trip the same files, so a
 * shape change here must be made deliberately in all three languages.
 *
 * Regenerate after an intentional change: `UPDATE_WIRE_FIXTURES=1 pnpm -F @lushly-dev/afd-server test`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
	createCompleteChunk,
	createDataChunk,
	createErrorChunk,
	createProgressChunkWithSteps,
	failure,
	success,
} from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';

const FIXTURE_DIR = new URL('../../../spec/wire/', import.meta.url);
const UPDATE = process.env.UPDATE_WIRE_FIXTURES === '1';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const commands = [
	defineCommand({
		name: 'fixture-minimal',
		description: 'Returns a minimal successful result',
		version: '1.0.0',
		expose: { mcp: true },
		input: z.object({}),
		handler: async () => success({ id: 'todo-1', title: 'Buy milk' }),
	}),
	defineCommand({
		name: 'fixture-full',
		description: 'Returns a result with every optional field set',
		version: '2.1.0',
		expose: { mcp: true },
		input: z.object({ title: z.string() }),
		handler: async (input) =>
			success(
				{ id: 'todo-2', title: input.title, completed: false },
				{
					confidence: 0.92,
					reasoning: `Created todo "${input.title}"`,
					sources: [
						{
							type: 'document',
							id: 'doc-7',
							title: 'Team guidelines',
							url: 'https://example.com/guidelines',
							location: 'section 2',
							accessedAt: '2026-01-01T00:00:00.000Z',
							relevance: 0.8,
						},
					],
					plan: [
						{ id: 'validate', action: 'Validate input', status: 'complete' },
						{
							id: 'store',
							action: 'Store todo',
							status: 'failed',
							description: 'Write to the store',
							dependsOn: ['validate'],
							error: { code: 'STORE_BUSY', message: 'Store was busy; retried' },
							progress: 1,
						},
					],
					alternatives: [
						{
							data: { id: 'todo-3', title: input.title, completed: true },
							reason: 'Could have been created as completed',
							confidence: 0.2,
							label: 'Completed',
						},
					],
					warnings: [
						{
							code: 'DUPLICATE_TITLE',
							message: 'A todo with this title already exists',
							severity: 'caution',
							details: { existingId: 'todo-1' },
						},
					],
					suggestions: ['Use todo-list to review existing todos'],
					metadata: { region: 'test' },
					undoCommand: 'todo-delete',
					undoArgs: { id: 'todo-2' },
				}
			),
	}),
	defineCommand({
		name: 'fixture-failure',
		description: 'Returns a structured failure',
		version: '1.0.0',
		expose: { mcp: true },
		input: z.object({}),
		handler: async () =>
			failure({
				code: 'NOT_FOUND',
				message: 'Todo todo-42 not found',
				suggestion: 'Use todo-list to see available todos',
				retryable: false,
				details: { id: 'todo-42' },
			}),
	}),
];

async function host() {
	const handler = createMcpHandler({
		name: 'wire-fixtures',
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

async function callTool(url: string, name: string, args: unknown): Promise<unknown> {
	const response = await fetch(`${url}/message`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: { name, arguments: args },
		}),
	});
	expect(response.status).toBe(200);
	const body = (await response.json()) as { result: { content: Array<{ text: string }> } };
	const text = body.result.content[0]?.text;
	expect(typeof text).toBe('string');
	return JSON.parse(text ?? 'null');
}

/** Replace run-dependent values (durations, timestamps, trace IDs) with fixed ones. */
function normalize(value: unknown, key = ''): unknown {
	if (Array.isArray(value)) return value.map((item) => normalize(item));
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([childKey, child]) => [childKey, normalize(child, childKey)])
		);
	}
	if (typeof value === 'number' && /(?:Ms|Duration)$/.test(key)) return 0;
	if (typeof value === 'string' && /(?:At|timestamp)$/.test(key)) return '2026-01-01T00:00:00.000Z';
	if (typeof value === 'string' && key === 'traceId') return 'trace-fixture';
	return value;
}

function expectFixture(name: string, actual: unknown) {
	const file = new URL(name, FIXTURE_DIR);
	const normalized = normalize(actual);
	if (UPDATE) {
		writeFileSync(file, `${JSON.stringify(normalized, null, '\t')}\n`);
		return;
	}
	const expected: unknown = JSON.parse(readFileSync(file, 'utf8'));
	expect(normalized).toEqual(expected);
}

describe('golden wire fixtures (spec/wire)', () => {
	it('minimal success result', async () => {
		expectFixture(
			'result-success-minimal.json',
			await callTool(await host(), 'fixture-minimal', {})
		);
	});

	it('success result with every optional field', async () => {
		expectFixture(
			'result-success-full.json',
			await callTool(await host(), 'fixture-full', { title: 'Buy milk' })
		);
	});

	it('failure result', async () => {
		expectFixture('result-failure.json', await callTool(await host(), 'fixture-failure', {}));
	});

	it('batch result with a success and a failure', async () => {
		const result = await callTool(await host(), 'afd-batch', {
			commands: [
				{ id: 'first', command: 'fixture-minimal', input: {} },
				{ id: 'second', command: 'fixture-failure', input: {} },
			],
		});
		expectFixture('batch-result.json', result);
	});

	it('pipeline result with a variable reference', async () => {
		const result = await callTool(await host(), 'afd-pipe', {
			steps: [
				{ command: 'fixture-minimal', input: {}, as: 'first' },
				{ command: 'fixture-full', input: { title: '$prev.title' } },
			],
		});
		expectFixture('pipeline-result.json', result);
	});

	it('stream chunks', () => {
		expectFixture('stream-chunks.json', [
			createProgressChunkWithSteps(0.5, 1, 2, { message: 'Halfway', estimatedTimeRemainingMs: 10 }),
			createDataChunk({ id: 'todo-1' }, 0, false, 'chunk-0'),
			createCompleteChunk(1, 25, {
				data: [{ id: 'todo-1' }],
				reasoning: 'Streamed 1 todo',
				confidence: 1,
			}),
			createErrorChunk({ code: 'STREAM_ERROR', message: 'Upstream closed', retryable: true }, 1),
		]);
	});
});
