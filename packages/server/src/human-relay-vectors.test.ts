/**
 * `spec/vectors/human-relay.json`: the relay's pending list (`spec/command-metadata.md`, "The
 * pending list"). Each `pending` case is answered over MCP 2026-07-28 HTTP, from a client without
 * URL-mode elicitation, with exactly its `error`; each `invalid` case is an internal error
 * (`-32603`) and runs nothing.
 */

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { success } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { HumanRelay, PendingListOutcome, RelayPending } from './human-relay.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';

interface PendingCase {
	name: string;
	command: string;
	relay: RelayPending;
	error: Record<string, unknown>;
}

interface InvalidCase {
	name: string;
	relay: RelayPending;
}

const vectors = JSON.parse(
	readFileSync(new URL('../../../spec/vectors/human-relay.json', import.meta.url), 'utf8')
) as {
	gaps: Record<string, string>;
	pending: PendingCase[];
	invalid: InvalidCase[];
};

const MODERN = '2026-07-28';
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

async function callWithoutUrlElicitation(
	commandName: string,
	pending: RelayPending
): Promise<{ status: number; json: Record<string, unknown>; runs: number }> {
	let runs = 0;
	const cmd = defineCommand({
		name: commandName,
		description: 'A command only the host confirms',
		mutation: true,
		confirmationMode: 'host-verified',
		expose: { mcp: true },
		input: z.object({ id: z.string().optional() }),
		handler: async () => {
			runs += 1;
			return success({ ran: true });
		},
	});
	const relay: HumanRelay = {
		begin: () => ({
			ok: false,
			error: { code: 'UNEXPECTED', message: 'begin is never asked here' },
		}),
		resume: () => ({ kind: 'invalid' }),
		pendingList: (): PendingListOutcome => ({ kind: 'pending', ...pending }),
	};
	const handler = createMcpHandler({
		name: 'human-relay-vectors',
		version: '1.0.0',
		host: '127.0.0.1',
		commands: [cmd],
		humanRelay: relay,
		toolStrategy: 'individual',
	});
	const httpServer = createServer(handler);
	await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		handler.dispose();
		httpServer.closeAllConnections();
		await new Promise<void>((resolve) => httpServer.close(() => resolve()));
	});
	const url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			'mcp-protocol-version': MODERN,
			'mcp-method': 'tools/call',
			'mcp-name': commandName,
		},
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: {
				name: commandName,
				arguments: {},
				_meta: {
					'io.modelcontextprotocol/protocolVersion': MODERN,
					'io.modelcontextprotocol/clientCapabilities': { elicitation: { form: {} } },
				},
			},
		}),
	});
	const text = await res.text();
	let json: Record<string, unknown>;
	try {
		json = JSON.parse(text) as Record<string, unknown>;
	} catch {
		const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
		json = JSON.parse(dataLine ? dataLine.slice(6) : '{}') as Record<string, unknown>;
	}
	return { status: res.status, json, runs };
}

function commandResult(response: Record<string, unknown>): Record<string, unknown> {
	const result = response.result as {
		content?: Array<{ text: string }>;
		structuredContent?: unknown;
	};
	if (result.structuredContent && typeof result.structuredContent === 'object') {
		return result.structuredContent as Record<string, unknown>;
	}
	return JSON.parse(result.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('human-relay.json', () => {
	it('does not list TypeScript as a gap', () => {
		expect(vectors.gaps.typescript).toBeUndefined();
		expect(vectors.pending.length).toBeGreaterThan(0);
		expect(vectors.invalid.length).toBeGreaterThan(0);
	});

	it('refuses each pending case with its exact error', async () => {
		for (const testCase of vectors.pending) {
			const { status, json, runs } = await callWithoutUrlElicitation(
				testCase.command,
				testCase.relay
			);
			expect(status, testCase.name).toBe(200);
			const refused = commandResult(json);
			expect(refused.success, testCase.name).toBe(false);
			expect(refused.error, testCase.name).toEqual(testCase.error);
			expect(runs, testCase.name).toBe(0);
		}
	});

	it('turns each invalid case into an internal error and runs nothing', async () => {
		for (const testCase of vectors.invalid) {
			const { status, json, runs } = await callWithoutUrlElicitation(
				'memory-erase',
				testCase.relay
			);
			expect(status, testCase.name).toBe(200);
			expect((json.error as { code: number }).code, testCase.name).toBe(-32603);
			expect(runs, testCase.name).toBe(0);
		}
	});
});
