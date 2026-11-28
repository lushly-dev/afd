/**
 * Checks the approver carrier and the approval display rules against
 * `spec/vectors/approver-client.json` (`spec/command-metadata.md`, "Approval evidence from an
 * approver client" and "Approval display"; Loam phase 5, step 0c).
 *
 * The file must equal what its generator builds from the current code, every display verdict
 * must match `approvalDisplay`, and every carrier case runs over MCP 2026-07-28 HTTP against one
 * server per case, whose callers are told apart by `createContext`.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { approvalDisplay, success } from '@lushly-dev/afd-core';
import { canonicalJson } from '@lushly-dev/afd-core/internal/canonical-json';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApprovalMiddleware } from './approval.js';
import { AFD_APPROVAL_META_KEY } from './approver.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';

const VECTORS_DIR = new URL('../../../spec/vectors/', import.meta.url);
const vectors = JSON.parse(
	readFileSync(new URL('approver-client.json', VECTORS_DIR), 'utf8')
) as Vectors;
const generator = (await import(new URL('generate-approver-client.mjs', VECTORS_DIR).href)) as {
	approverClientVectors(
		display: typeof approvalDisplay,
		canonical: typeof canonicalJson
	): Record<string, unknown>;
};

interface Caller {
	approver: boolean;
	credentials: { issuer: string; subject: string; clientId: string };
	actor: { kind: 'agent'; id: string; onBehalfOf: string };
	principal: string;
}

interface Step {
	caller: string;
	tool: string;
	arguments: Record<string, unknown>;
	approval?: string | { token: number };
	elicit: boolean;
	expected: {
		success?: true;
		code?: string;
		token?: boolean;
		reason?: string;
		payload?: Record<string, unknown>;
	};
	runs: number;
}

interface Vectors {
	gaps: Record<string, string>;
	display: { cases: Array<{ description: string; input: unknown; expected: string }> };
	carrier: {
		secret: string;
		now: number;
		ttlMs: number;
		callers: Record<string, Caller>;
		cases: Array<{ description: string; steps: Step[] }>;
	};
}

const MODERN = '2026-07-28';
const { carrier } = vectors;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** One server with the vectors' commands, callers and approval middleware. */
async function serve() {
	const runs = { count: 0 };
	const commands = [
		defineCommand({
			name: 'todo-delete',
			description: 'Delete a todo',
			mutation: true,
			approval: 'required',
			expose: { mcp: true },
			input: z.object({ id: z.number() }),
			handler: async (input) => {
				runs.count += 1;
				return success({ deleted: input.id });
			},
		}),
		defineCommand({
			name: 'todo-list',
			description: 'List todos',
			expose: { mcp: true },
			input: z.object({}),
			handler: async () => {
				runs.count += 1;
				return success([]);
			},
		}),
	];
	const handler = createMcpHandler({
		name: 'approver-client-vectors',
		version: '1.0.0',
		commands,
		host: '127.0.0.1',
		toolStrategy: 'individual',
		createContext: (req) => {
			const caller = carrier.callers[String(req.headers['x-test-caller'])] as Caller;
			return { credentials: caller.credentials, actor: caller.actor };
		},
		approver: (context) => {
			const clientId = (context.credentials as { clientId?: string } | undefined)?.clientId;
			return Object.values(carrier.callers).some(
				(caller) => caller.approver && caller.credentials.clientId === clientId
			);
		},
		middleware: [
			createApprovalMiddleware({
				secret: carrier.secret,
				commands,
				ttlMs: carrier.ttlMs,
				clock: { now: () => carrier.now },
				relay: 'mcp-elicitation',
			}),
		],
	});
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		handler.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, runs };
}

/** One modern `tools/call`; the `CommandResult` it carries. */
async function call(url: string, step: Step, approval: string | undefined) {
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			'MCP-Protocol-Version': MODERN,
			'Mcp-Method': 'tools/call',
			'Mcp-Name': step.tool,
			'X-Test-Caller': step.caller,
		},
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: {
				name: step.tool,
				arguments: step.arguments,
				_meta: {
					'io.modelcontextprotocol/protocolVersion': MODERN,
					'io.modelcontextprotocol/clientCapabilities': step.elicit ? { elicitation: {} } : {},
					'io.modelcontextprotocol/clientInfo': { name: 'vectors', version: '0' },
					...(approval !== undefined && { [AFD_APPROVAL_META_KEY]: approval }),
				},
			},
		}),
	});
	const text = await response.text();
	const message = JSON.parse(/^data: (.*)$/m.exec(text)?.[1] ?? text) as {
		result?: { content?: Array<{ text: string }> };
	};
	const content = message.result?.content?.[0]?.text;
	if (content === undefined) throw new Error(`No CommandResult: ${text}`);
	return JSON.parse(content) as {
		success: boolean;
		error?: { code: string; details?: Record<string, unknown> };
	};
}

function payloadOf(token: string): Record<string, unknown> {
	const encoded = token.split('.')[1] ?? '';
	return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
}

describe('approver-client.json', () => {
	it('matches what its generator builds from the current code', () => {
		expect(generator.approverClientVectors(approvalDisplay, canonicalJson)).toEqual(vectors);
	});

	it('has no remaining language gaps', () => {
		expect(Object.keys(vectors.gaps)).toEqual([]);
	});

	describe('display', () => {
		it.each(vectors.display.cases)('$description', ({ input, expected }) => {
			const verdict = approvalDisplay(input);
			expect(verdict.ok ? 'shown' : verdict.refusal).toBe(expected);
		});
	});

	describe('carrier', () => {
		it.each(carrier.cases)('$description', async ({ steps }) => {
			const { url, runs } = await serve();
			const tokens: Array<string | undefined> = [];
			for (const [index, step] of steps.entries()) {
				const approval =
					typeof step.approval === 'object' ? tokens[step.approval.token] : step.approval;
				if (typeof step.approval === 'object') expect(approval).toBeDefined();
				const result = await call(url, step, approval);
				const where = `step ${index}`;
				const token = result.error?.details?.approvalToken as string | undefined;
				tokens.push(token);
				if (step.expected.success) {
					expect(result.success, where).toBe(true);
				} else {
					expect(result.error?.code, where).toBe(step.expected.code);
					if (step.expected.token !== undefined) {
						expect(token !== undefined, where).toBe(step.expected.token);
					}
					expect(result.error?.details?.reason, where).toBe(step.expected.reason);
				}
				if (step.expected.payload) {
					const { n, ...payload } = payloadOf(token as string);
					expect(payload, where).toEqual(step.expected.payload);
					expect(Buffer.from(n as string, 'base64url'), where).toHaveLength(16);
				}
				expect(runs.count, where).toBe(step.runs);
			}
		});
	});
});
