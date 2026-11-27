/**
 * The language-neutral vectors in `spec/vectors/journal-seams.json`: the dispatch id
 * (`spec/dispatch.md`, "The dispatch id") and the approval summary (`spec/command-metadata.md`,
 * "The approval summary").
 *
 * The dispatch id cases run on the execution engine `createMcpServer` and `createDirectRegistry`
 * share. The approval summary cases run where each kind of evidence arrives: a token on that
 * engine, `direct` through a DirectClient, and `relay` and `elicitation` over MCP HTTP.
 *
 * A language the file still lists in `gaps` skips every case; TypeScript is no longer listed, so a
 * listing put back would skip these cases and the first test below would fail.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createDirectClient } from '@lushly-dev/afd-client';
import {
	type CommandContext,
	type CommandMiddleware,
	type CommandResult,
	createCommandRegistry,
	failure,
	fixedClock,
	MemoryJournalSink,
	type RandomSource,
	success,
} from '@lushly-dev/afd-core';
import { canonicalJson } from '@lushly-dev/afd-core/internal/canonical-json';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAppCallRegistry } from './app-call-registry.js';
import {
	type ApprovalMiddlewareOptions,
	type ApprovalNonceStore,
	type ApprovalRequest,
	type ApprovalSummary,
	createApprovalMiddleware,
} from './approval.js';
import { checkContextFields } from './context-fields.js';
import { createDirectRegistry } from './direct-registry.js';
import { createExecutionEngine } from './execution.js';
import type { HumanRelay, RelayBeginResult, RelayCall, RelayOutcome } from './human-relay.js';
import { createJournalMiddleware } from './journal.js';
import { composeMiddleware } from './middleware.js';
import { defineCommand, type ZodCommandDefinition } from './schema.js';
import { createMcpHandler } from './server.js';

interface Case {
	description: string;
	rule: string;
	run: Record<string, unknown>;
	expect: Record<string, unknown>;
}

interface Vectors {
	gaps: Record<string, string>;
	dispatchId: { format: { length: number; pattern: string }; cases: Case[] };
	approvalSummary: { cases: Case[] };
}

interface Binding {
	description: string;
	command: string;
	input: Record<string, unknown>;
	actor: string;
	inputDigest: string;
	nonce: string;
	approvalId: string;
	payload: string;
	token: string;
}

interface Tokens {
	secrets: Record<string, string>;
	now: number;
	ttlMs: number;
	commands: string[];
	actors: Record<string, NonNullable<CommandContext['actor']>>;
	bindings: Binding[];
	approvalIds: { description: string; via: string; singleUseKey: string; approvalId: string }[];
}

const VECTORS_DIR = new URL('../../../spec/vectors/', import.meta.url);
const vectors = JSON.parse(
	readFileSync(new URL('journal-seams.json', VECTORS_DIR), 'utf8')
) as Vectors;
const tokens = JSON.parse(
	readFileSync(new URL('approval-tokens.json', VECTORS_DIR), 'utf8')
) as Tokens;
const GAP = vectors.gaps.typescript;
const REASON = GAP === undefined ? '' : ` (documented TypeScript gap, ${GAP})`;
const ID_PATTERN = new RegExp(vectors.dispatchId.format.pattern);

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function sha256Base64url(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('base64url');
}

/** Whether `value` has a member named `dispatchId` at any depth, or a string equal to one of `ids`. */
function carriesId(value: unknown, ids: ReadonlySet<unknown>): boolean {
	if (typeof value === 'string') return ids.has(value);
	if (value === null || typeof value !== 'object') return false;
	return Object.entries(value).some(
		([key, member]) => key === 'dispatchId' || carriesId(member, ids)
	);
}

describe('journal-seams.json', () => {
	it('no longer lists TypeScript as a documented gap', () => {
		expect(GAP).toBeUndefined();
	});

	it('has cases in both sections and a usable id pattern', () => {
		expect(vectors.dispatchId.cases.length).toBeGreaterThan(0);
		expect(vectors.approvalSummary.cases.length).toBeGreaterThan(0);
		expect(ID_PATTERN.test('A'.repeat(22))).toBe(true);
		// Sixteen bytes leave two bits for the last character, so most letters cannot end an id.
		expect(ID_PATTERN.test('B'.repeat(22))).toBe(false);
		expect(vectors.dispatchId.format.length).toBe(22);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// THE DISPATCH ID
// ═══════════════════════════════════════════════════════════════════════════════

interface Note {
	reader: string;
	id: unknown;
}

/** A random source that returns `values` in order. */
function sequence(values: readonly number[]): RandomSource {
	let at = 0;
	return { next: () => values[at++] ?? 0 };
}

function dispatchHarness(vector: Case) {
	const run = vector.run;
	const notes: Note[] = [];
	const draws: number[] = [];
	let handlerRuns = 0;
	let flaky = 0;
	let handlerKeys: string[] = [];
	const note = (reader: string, context: CommandContext) => {
		notes.push({ reader, id: context.dispatchId });
	};
	const handlerSaw = (context: CommandContext) => {
		handlerRuns += 1;
		note('handler', context);
		handlerKeys = Object.keys(context);
	};
	let engine: ReturnType<typeof createExecutionEngine> | undefined;
	const commands: ZodCommandDefinition[] = [
		defineCommand({
			name: 'item-echo',
			description: 'Returns its input as data.',
			input: z.object({ id: z.number() }),
			handler: async (input, context) => {
				handlerSaw(context);
				return success(input);
			},
		}),
		defineCommand({
			name: 'item-flaky',
			description: 'Fails the first time it runs.',
			input: z.object({}),
			handler: async (_input, context) => {
				handlerSaw(context);
				flaky += 1;
				return flaky === 1
					? failure({ code: 'TRANSIENT_ERROR', message: 'Try again', suggestion: 'Retry' })
					: success({ ran: flaky });
			},
		}),
		defineCommand({
			name: 'item-outer',
			description: 'Runs item-echo through the registry with its own context.',
			input: z.object({}),
			handler: async (_input, context) => {
				handlerSaw(context);
				const before = context.dispatchId;
				const inner = await engine?.executeCommand('item-echo', { id: 1 }, context);
				// The nested call leaves this call's id as it was, on the same context object.
				expect(context.dispatchId).toBe(before);
				return success({ inner: inner?.success });
			},
		}),
		defineCommand({
			name: 'item-draw',
			description: 'Reads one value from context.random.',
			input: z.object({}),
			handler: async (_input, context) => {
				handlerSaw(context);
				draws.push(context.random?.next() ?? Number.NaN);
				return success({});
			},
		}),
	];
	const observer =
		(reader: string): CommandMiddleware =>
		(_name, _input, context, next) => {
			note(reader, context);
			return next();
		};
	const mw1: CommandMiddleware =
		run.middleware === 'overwrite'
			? (_name, _input, context, next) => {
					(context as Record<string, unknown>).dispatchId = 'overwritten-by-mw1-0000';
					return next();
				}
			: run.middleware === 'retry-once'
				? async (_name, _input, context, next) => {
						note('mw1', context);
						const first = await next();
						return first.success ? first : next();
					}
				: observer('mw1');
	const sink = new MemoryJournalSink();
	engine = createExecutionEngine({
		commandMap: new Map(commands.map((command) => [command.name, command])),
		middleware: [...(run.journal ? [createJournalMiddleware(sink)] : []), mw1, observer('mw2')],
		devMode: false,
		metaTools: false,
	});
	const callerContext = (): CommandContext => ({
		...(run.context as Record<string, unknown> | undefined),
		...(typeof run.traceId === 'string' && { traceId: run.traceId }),
		...(Array.isArray(run.random) && { random: sequence(run.random as number[]) }),
	});
	return {
		engine,
		notes,
		draws,
		sink,
		callerContext,
		handlerRuns: () => handlerRuns,
		handlerKeys: () => handlerKeys,
	};
}

type Steps = Array<{ command: string; input: Record<string, unknown> }>;

async function runDispatch(harness: ReturnType<typeof dispatchHarness>, run: Case['run']) {
	const { engine, callerContext } = harness;
	const steps = (run.commands ?? run.steps) as Steps | undefined;
	switch (run.kind) {
		case 'call':
			return engine.executeCommand(run.command as string, run.input, callerContext());
		case 'calls': {
			let last: CommandResult | undefined;
			for (let at = 0; at < (run.count as number); at++) {
				last = await engine.executeCommand(run.command as string, run.input, callerContext());
			}
			return last as CommandResult;
		}
		case 'batch':
			return engine.executeBatch(
				{ commands: (steps ?? []).map(({ command, input }) => ({ command, input })) },
				callerContext()
			);
		case 'pipeline':
			return engine.executePipeline(
				{ steps: (steps ?? []).map(({ command, input }) => ({ command, input })) },
				callerContext()
			);
		default:
			throw new Error(`unknown run.kind ${String(run.kind)}`);
	}
}

/** The context digest's hash, from `spec/journal.md`'s formula, for a call with no actor. */
function digestHash(keys: readonly string[]): string {
	const hash = createHash('sha256')
		.update(canonicalJson({ actor: null, interface: null, keys, traceId: null }), 'utf8')
		.digest('hex');
	return `sha256:${hash}`;
}

describe('dispatchId', () => {
	it.skipIf(GAP !== undefined).each(vectors.dispatchId.cases)(
		`$description${REASON}`,
		async (vector) => {
			const harness = dispatchHarness(vector);
			const result = (await runDispatch(harness, vector.run)) as CommandResult;
			const want = vector.expect;
			const readers = want.readers as string[] | undefined;
			const read = harness.notes.filter((item) => !readers || readers.includes(item.reader));
			const ids = new Set(read.map((item) => item.id));

			if (want.handlerRuns !== undefined) expect(harness.handlerRuns()).toBe(want.handlerRuns);
			if (want.distinctIds !== undefined) expect(ids.size).toBe(want.distinctIds);
			if (want.wellFormed) {
				for (const item of harness.notes) {
					expect(typeof item.id).toBe('string');
					expect(item.id as string).toMatch(ID_PATTERN);
				}
			}
			for (const value of (want.never as string[] | undefined) ?? []) {
				expect(harness.notes.map((item) => item.id)).not.toContain(value);
			}
			if (want.success !== undefined) expect(result.success).toBe(want.success);
			if (want.data !== undefined) expect(result.data).toEqual(want.data);
			const allIds = new Set(harness.notes.map((item) => item.id));
			if (want.resultHasId === false) expect(carriesId(result, allIds)).toBe(false);
			if (want.entries !== undefined) {
				const entries = await harness.sink.read();
				expect(entries).toHaveLength(want.entries as number);
				if (want.entryHasId === false) {
					for (const entry of entries) expect(carriesId(entry, allIds)).toBe(false);
				}
				if (want.digestHashOmitsId) {
					const keys = harness
						.handlerKeys()
						.filter((key) => key !== 'dispatchId' && key !== 'traceId' && key !== 'actor')
						.sort();
					expect(entries[0]?.contextDigest.hash).toBe(digestHash(keys));
					// The name never entered the hash: with it, the hash differs.
					expect(entries[0]?.contextDigest.hash).not.toBe(
						digestHash([...keys, 'dispatchId'].sort())
					);
				}
			}
			if (want.handlerDraws !== undefined) expect(harness.draws).toEqual(want.handlerDraws);
		}
	);
});

describe('the dispatch id, beyond the vectors', () => {
	it('is set by the core registry on the handler’s own copy of the context', async () => {
		const seen: unknown[] = [];
		const registry = createCommandRegistry();
		registry.register({
			name: 'item-echo',
			description: 'Echo',
			parameters: [],
			handler: async (_input, context) => {
				seen.push(context?.dispatchId);
				return success({});
			},
		});
		const context: CommandContext = { dispatchId: 'caller-chosen-id-000000' } as CommandContext;
		await registry.execute('item-echo', {}, context);
		await registry.execute('item-echo', {}, context);
		expect(seen).toHaveLength(2);
		for (const id of seen) expect(id).toMatch(ID_PATTERN);
		expect(new Set(seen).size).toBe(2);
		// The caller's object is not changed.
		expect(context.dispatchId).toBe('caller-chosen-id-000000');
	});

	it('is not enumerable, so copies and JSON leave it out', async () => {
		let context: CommandContext | undefined;
		const registry = createDirectRegistry([
			defineCommand({
				name: 'item-echo',
				description: 'Echo',
				input: z.object({}),
				handler: async (_input, ctx) => {
					context = ctx;
					return success({});
				},
			}),
		]);
		await registry.execute('item-echo', {});
		expect(context?.dispatchId).toMatch(ID_PATTERN);
		expect(Object.keys(context ?? {})).not.toContain('dispatchId');
		expect({ ...context }).not.toHaveProperty('dispatchId');
		expect(JSON.stringify(context)).not.toContain(context?.dispatchId);
	});

	it('reads the same in every part of a composed middleware, whatever a part writes', async () => {
		const seen: unknown[] = [];
		const note: CommandMiddleware = async (_name, _input, context, next) => {
			seen.push(context.dispatchId);
			await Promise.resolve();
			seen.push(context.dispatchId);
			return next();
		};
		const overwrite: CommandMiddleware = (_name, _input, context, next) => {
			(context as Record<string, unknown>).dispatchId = 'overwritten-by-a-part-00';
			expect(() => Object.defineProperty(context, 'dispatchId', { value: 'x' })).toThrow();
			return next();
		};
		const registry = createDirectRegistry(
			[
				defineCommand({
					name: 'item-echo',
					description: 'Echo',
					input: z.object({}),
					handler: async (_input, context) => {
						seen.push(context.dispatchId);
						return success({});
					},
				}),
			],
			{ middleware: [composeMiddleware(note, overwrite, note)] }
		);
		await registry.execute('item-echo', {});
		expect(seen).toHaveLength(5);
		expect(new Set(seen).size).toBe(1);
		expect(seen[0]).toMatch(ID_PATTERN);
	});

	it('gives an app call’s grant the id its handler reads', async () => {
		const grants: unknown[] = [];
		const handlers: unknown[] = [];
		const command = defineCommand({
			name: 'item-echo',
			description: 'Echo',
			expose: { apps: true },
			input: z.object({}),
			handler: async (_input, context) => {
				handlers.push(context.dispatchId);
				return success({});
			},
		});
		const grant = (_name: string, context: CommandContext) => {
			grants.push(context.dispatchId);
			// Host code is never handed what carries the id to the engine.
			expect(Object.getOwnPropertySymbols(context).map(String)).not.toContain(
				'Symbol(afd.presetDispatchId)'
			);
			return true;
		};
		const forged = { dispatchId: 'caller-chosen-id-000000' } as CommandContext;
		const apps = createAppCallRegistry([command], { callGrant: grant });
		await apps.execute('item-echo', {}, forged);
		const core = createCommandRegistry({ callGrant: grant });
		core.register({
			name: 'item-echo',
			description: 'Echo',
			parameters: [],
			expose: { apps: true },
			handler: async (_input, context) => {
				handlers.push(context?.dispatchId);
				return success({});
			},
		});
		await core.execute('item-echo', {}, { ...forged, interface: 'apps' });
		expect(grants).toHaveLength(2);
		expect(grants).toEqual(handlers);
		for (const id of grants) expect(id).toMatch(ID_PATTERN);
		expect(new Set(grants).size).toBe(2);
	});

	it('is a reserved context field name', () => {
		expect(() =>
			checkContextFields([
				{ name: 'dispatchId', meta: 'example.com/dispatch-id', schema: z.string() },
			])
		).toThrow(/name AFD sets itself/);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// THE APPROVAL SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

interface Observed {
	results: CommandResult[];
	hooks: Array<{ summary: ApprovalSummary; dispatchId: string | undefined }>;
	order: string[];
	handlerIds: unknown[];
	consumed: string[];
	/** The requests `onApprovalRequired` was given. */
	requests: ApprovalRequest[];
	/** The `approvalId` of each request DirectClient's `onApprovalNeeded` was given. */
	clientRequestIds: Array<string | undefined>;
}

function observed(): Observed {
	return {
		results: [],
		hooks: [],
		order: [],
		handlerIds: [],
		consumed: [],
		requests: [],
		clientRequestIds: [],
	};
}

/** A nonce store that notes every key it is asked to consume. */
function notingStore(seen: Observed): ApprovalNonceStore {
	const spent = new Set<string>();
	return {
		consume(key) {
			seen.consumed.push(key);
			if (spent.has(key)) return false;
			spent.add(key);
			return true;
		},
	};
}

/** The hook and nonce store every approval summary case installs. */
function approvalOptions(
	seen: Observed,
	run: Case['run']
): Pick<ApprovalMiddlewareOptions, 'onApprovalAccepted' | 'nonceStore' | 'onApprovalRequired'> & {
	replay?: 'within-ttl';
} {
	return {
		nonceStore: notingStore(seen),
		...(run.replay === 'within-ttl' && { replay: 'within-ttl' as const }),
		onApprovalAccepted: async (summary, dispatchId) => {
			seen.order.push('hook');
			seen.hooks.push({ summary, dispatchId });
			if (run.hook === 'fail') throw new Error('the host could not record the approval');
		},
		onApprovalRequired: (request: ApprovalRequest) => {
			seen.requests.push(request);
		},
	};
}

/** The commands every approval summary surface serves. */
function approvalCommands(seen: Observed, mcp: boolean, hostVerified = false) {
	const handler = async (input: unknown, context: CommandContext) => {
		seen.order.push('handler');
		seen.handlerIds.push(context.dispatchId);
		return success({ ran: input });
	};
	return [
		...tokens.commands.map((name) =>
			defineCommand({
				name,
				description: `Vector command ${name}`,
				mutation: true,
				approval: 'required',
				...(mcp && { expose: { mcp: true } }),
				...(name === 'todo-delete' &&
					hostVerified && { confirmationMode: 'host-verified' as const }),
				input: z.object({ id: z.number() }),
				handler,
			})
		),
		defineCommand({
			name: 'item-echo',
			description: 'No approval policy',
			...(mcp && { expose: { mcp: true } }),
			input: z.object({ id: z.number() }),
			handler,
		}),
	];
}

function bindingOf(run: Case['run']): Binding | undefined {
	if (typeof run.binding !== 'string') return undefined;
	const binding = tokens.bindings.find((item) => item.description === run.binding);
	if (!binding) throw new Error(`no binding ${run.binding}`);
	return binding;
}

/** Replace the token's last character with another base64url character. */
function tamperSignature(token: string): string {
	const last = token.at(-1);
	return `${token.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
}

/** `token` and `none`: the engine, with the token on the call's context. */
async function viaEngine(vector: Case, seen: Observed): Promise<void> {
	const run = vector.run;
	const binding = bindingOf(run);
	const commands = approvalCommands(seen, false);
	const engine = createExecutionEngine({
		commandMap: new Map(commands.map((command) => [command.name, command])),
		middleware: [
			createApprovalMiddleware({
				secret: tokens.secrets.current as string,
				clock: fixedClock(tokens.now),
				// The token reaches the host only through onApprovalRequired.
				includeToken: false,
				...approvalOptions(seen, run),
			}),
		],
		devMode: false,
		metaTools: false,
	});
	const command = binding?.command ?? (run.command as string);
	const input = binding?.input ?? run.input;
	const actor = tokens.actors[binding?.actor ?? 'agent'];
	const call = (approval?: string) =>
		engine.executeCommand(command, input, {
			...(actor && { actor: { ...actor } }),
			...(approval !== undefined && { approval }),
		});
	if (run.holdFirst) {
		const held = await call();
		expect(held.error?.code).toBe('APPROVAL_REQUIRED');
		expect(held.error?.details).not.toHaveProperty('approvalToken');
		const token = seen.requests.at(-1)?.approvalToken;
		expect(typeof token).toBe('string');
		seen.results.push(await call(token));
		return;
	}
	const token =
		binding && run.via === 'token'
			? run.tamper === 'signature'
				? tamperSignature(binding.token)
				: binding.token
			: undefined;
	const count = (run.count as number | undefined) ?? (run.thenRetry ? 2 : 1);
	for (let at = 0; at < count; at++) seen.results.push(await call(token));
}

/** `direct`: a DirectClient whose `onApprovalNeeded` approves. */
async function viaDirect(vector: Case, seen: Observed): Promise<void> {
	const run = vector.run;
	const registry = createDirectRegistry(approvalCommands(seen, false), {
		middleware: [
			createApprovalMiddleware({
				secret: tokens.secrets.current as string,
				...approvalOptions(seen, run),
			}),
		],
	});
	const client = createDirectClient(registry, {
		onApprovalNeeded: (request) => {
			seen.clientRequestIds.push(request.approvalId);
			return true;
		},
	});
	seen.results.push(
		(await client.call(
			run.command as string,
			run.input as Record<string, unknown>
		)) as CommandResult
	);
}

const MODERN = '2026-07-28';

/** A HumanRelay that approves every call it resumes with `decisionId`. */
class ApprovingRelay implements HumanRelay {
	constructor(private readonly decisionId: string) {}
	async begin(_call: RelayCall): Promise<RelayBeginResult> {
		return {
			ok: true,
			prompt: { url: 'https://person.example.com/decide', message: 'Review', state: 'state-1' },
		};
	}
	async resume(): Promise<RelayOutcome> {
		return { kind: 'approved', decisionId: this.decisionId };
	}
}

async function serveMcp(vector: Case, seen: Observed) {
	const run = vector.run;
	const handler = createMcpHandler({
		name: 'journal-seams-vectors',
		version: '1.0.0',
		host: '127.0.0.1',
		toolStrategy: 'individual',
		commands: approvalCommands(seen, true, run.via === 'relay'),
		middleware: [
			createApprovalMiddleware({
				secret: tokens.secrets.current as string,
				...(run.via === 'elicitation' && { relay: 'mcp-elicitation' as const }),
				...approvalOptions(seen, run),
			}),
		],
		...(run.via === 'relay' && { humanRelay: new ApprovingRelay(run.decisionId as string) }),
	});
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		handler.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}

function toolResult(result: unknown): CommandResult {
	const content = (result as { content?: Array<{ text: string }> }).content;
	return JSON.parse(content?.[0]?.text ?? '{}') as CommandResult;
}

/** `elicitation`: an MCP client whose person accepts every form. */
async function viaElicitation(vector: Case, seen: Observed): Promise<void> {
	const run = vector.run;
	const url = await serveMcp(vector, seen);
	const client = new Client(
		{ name: 'journal-seams', version: '0' },
		{ versionNegotiation: { mode: 'auto' }, capabilities: { elicitation: { form: {} } } }
	);
	client.setRequestHandler('elicitation/create', async (request) => {
		const params = request.params as { requestedSchema?: { properties?: Record<string, unknown> } };
		const field = Object.keys(params.requestedSchema?.properties ?? {})[0] ?? '';
		return { action: 'accept', content: { [field]: true } };
	});
	await client.connect(new StreamableHTTPClientTransport(new URL(url)));
	cleanups.push(() => client.close());
	const result =
		run.kind === 'batch'
			? await client.callTool({ name: 'afd-batch', arguments: { commands: run.commands } })
			: run.kind === 'pipeline'
				? await client.callTool({ name: 'afd-pipe', arguments: { steps: run.steps } })
				: await client.callTool({
						name: run.command as string,
						arguments: run.input as Record<string, unknown>,
					});
	seen.results.push(toolResult(result));
}

async function postMcp(url: string, name: string, params: Record<string, unknown>) {
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			'mcp-protocol-version': MODERN,
			'mcp-method': 'tools/call',
			'mcp-name': name,
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params }),
	});
	const text = await response.text();
	const data = /^data: (.*)$/m.exec(text)?.[1];
	return JSON.parse(data ?? text) as { result: Record<string, unknown> };
}

/** `relay`: a HumanRelay that approves over a URL elicitation, giving relay evidence. */
async function viaRelay(vector: Case, seen: Observed): Promise<void> {
	const run = vector.run;
	const url = await serveMcp(vector, seen);
	const name = run.command as string;
	const meta = {
		'io.modelcontextprotocol/protocolVersion': MODERN,
		'io.modelcontextprotocol/clientCapabilities': { elicitation: { url: {} } },
	};
	const first = await postMcp(url, name, { name, arguments: run.input, _meta: meta });
	expect(first.result.resultType).toBe('input_required');
	const second = await postMcp(url, name, {
		name,
		arguments: run.input,
		_meta: meta,
		inputResponses: { relay: { action: 'accept' } },
		requestState: first.result.requestState,
	});
	seen.results.push(toolResult(second.result));
}

const SURFACES: Record<string, (vector: Case, seen: Observed) => Promise<void>> = {
	token: viaEngine,
	none: viaEngine,
	direct: viaDirect,
	relay: viaRelay,
	elicitation: viaElicitation,
};

function distinct(values: readonly unknown[]): number {
	return new Set(values).size;
}

describe('the approval summary, beyond the vectors', () => {
	it('gives each gated step of an afd-pipe approved up front its own summary', async () => {
		const seen = observed();
		const steps = [
			{ command: 'todo-delete', input: { id: 1 } },
			{ command: 'todo-delete', input: { id: 2 } },
		];
		const vector: Case = {
			description: 'afd-pipe',
			rule: '4',
			run: { via: 'elicitation', kind: 'pipeline', steps },
			expect: {},
		};
		await viaElicitation(vector, seen);
		const pipe = seen.results[0] as unknown as { steps: Array<{ status: string }> };
		expect(pipe.steps.map((step) => step.status)).toEqual(['success', 'success']);
		expect(seen.hooks).toHaveLength(2);
		expect(seen.hooks.map((hook) => hook.summary.via)).toEqual(['elicitation', 'elicitation']);
		expect(distinct(seen.hooks.map((hook) => hook.summary.approvalId))).toBe(2);
		expect(distinct(seen.hooks.map((hook) => hook.dispatchId))).toBe(2);
		expect(seen.hooks.map((hook) => hook.dispatchId)).toEqual(seen.handlerIds);
	});

	it('reports a refusing hook to onError and does not call onCommand (rule 2)', async () => {
		const seen = observed();
		const errors: Error[] = [];
		const commandsSeen: string[] = [];
		const commands = approvalCommands(seen, false);
		const binding = tokens.bindings[0] as Binding;
		const engine = createExecutionEngine({
			commandMap: new Map(commands.map((command) => [command.name, command])),
			middleware: [
				createApprovalMiddleware({
					secret: tokens.secrets.current as string,
					clock: fixedClock(tokens.now),
					...approvalOptions(seen, { hook: 'fail' }),
				}),
			],
			devMode: false,
			metaTools: false,
			onError: (error) => {
				errors.push(error);
			},
			onCommand: (name) => {
				commandsSeen.push(name);
			},
		});
		const result = await engine.executeCommand(binding.command, binding.input, {
			actor: { ...(tokens.actors[binding.actor] as NonNullable<CommandContext['actor']>) },
			approval: binding.token,
		});
		expect(result.error?.code).toBe('COMMAND_EXECUTION_ERROR');
		expect(result.error?.suggestion).toBeTruthy();
		expect(errors.map((error) => error.message)).toEqual([
			'the host could not record the approval',
		]);
		expect(commandsSeen).toEqual([]);
		expect(seen.order).toEqual(['hook']);
	});
});

describe('approvalSummary', () => {
	it.skipIf(GAP !== undefined).each(vectors.approvalSummary.cases)(
		`$description${REASON}`,
		async (vector) => {
			const seen = observed();
			const surface = SURFACES[vector.run.via as string];
			if (!surface) throw new Error(`unknown via ${String(vector.run.via)}`);
			await surface(vector, seen);
			const want = vector.expect;
			const binding = bindingOf(vector.run);
			const result = seen.results[0] as CommandResult;
			const summaries = seen.hooks.map((hook) => hook.summary);
			const handlerRuns = seen.order.filter((step) => step === 'handler').length;

			if (want.success !== undefined) expect(result.success).toBe(want.success);
			if (want.code !== undefined) expect(result.error?.code).toBe(want.code);
			if (want.hookCalls !== undefined) expect(seen.hooks).toHaveLength(want.hookCalls as number);
			if (want.order !== undefined) expect(seen.order).toEqual(want.order);
			if (want.handlerRuns !== undefined && !want.retry) expect(handlerRuns).toBe(want.handlerRuns);
			if (want.retry) {
				const retryWant = want.retry as { code: string; reason: string; handlerRuns: number };
				const retry = seen.results[1] as CommandResult;
				expect(retry.error?.code).toBe(retryWant.code);
				expect((retry.error?.details as { reason?: string } | undefined)?.reason).toBe(
					retryWant.reason
				);
				expect(handlerRuns).toBe(retryWant.handlerRuns);
			}
			for (const summary of summaries) {
				if (want.members !== undefined) expect(Object.keys(summary).sort()).toEqual(want.members);
				if (want.via !== undefined) expect(summary.via).toBe(want.via);
				for (const member of (want.fromBinding as string[] | undefined) ?? []) {
					expect(summary[member as keyof ApprovalSummary]).toBe(binding?.[member as keyof Binding]);
				}
				if (want.issuedAt === 'now') expect(summary.issuedAt).toBe(tokens.now);
				if (want.expiresAt === 'now + ttlMs') {
					expect(summary.expiresAt).toBe(tokens.now + tokens.ttlMs);
				}
				const json = JSON.stringify(summary);
				for (const item of (want.summaryNeverHolds as string[] | undefined) ?? []) {
					const value = binding?.[item as keyof Binding] ?? item;
					expect(json).not.toContain(value);
				}
				if (typeof want.approvalIdIs === 'string') {
					const entry = tokens.approvalIds.find((item) => item.description === want.approvalIdIs);
					expect(summary.approvalId).toBe(entry?.approvalId);
				}
				if (want.approvalIdFromSpentKey) {
					const spent = seen.consumed.map((key) => sha256Base64url(`approval\0${key}`));
					expect(spent).toContain(summary.approvalId);
				}
			}
			if (want.dispatchIdIsHandlers) {
				expect(seen.handlerIds).toHaveLength(1);
				expect(seen.hooks[0]?.dispatchId).toMatch(ID_PATTERN);
				expect(seen.hooks[0]?.dispatchId).toBe(seen.handlerIds[0]);
			}
			if (want.distinctApprovalIds !== undefined) {
				expect(distinct(summaries.map((summary) => summary.approvalId))).toBe(
					want.distinctApprovalIds
				);
			}
			if (want.distinctDispatchIds !== undefined) {
				expect(distinct(seen.hooks.map((hook) => hook.dispatchId))).toBe(want.distinctDispatchIds);
			}
			if (want.requestApprovalIdIsSummarys) {
				// DirectClient's own request for `direct`; the request onApprovalRequired is given
				// otherwise.
				const asked =
					vector.run.via === 'direct'
						? seen.clientRequestIds
						: seen.requests.map((request) => request.approvalId);
				expect(asked).toHaveLength(1);
				expect(asked[0]).toBe(summaries[0]?.approvalId);
			}
		}
	);
});
