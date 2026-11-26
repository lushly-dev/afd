/**
 * @fileoverview Host-verified confirmation, `HumanRelay`, private relay evidence and `inputDigest`
 * (`spec/command-metadata.md`, "Host-verified confirmation" and "Relay evidence").
 */

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inspect } from 'node:util';
import {
	type Actor,
	type CommandContext,
	type CommandError,
	type CommandMiddleware,
	commandToMcpTool,
	createCommandRegistry,
	ErrorCodes,
	failure,
	fixedClock,
	success,
} from '@lushly-dev/afd-core';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type ApprovalNonceStore, createApprovalMiddleware } from './approval.js';
import { actorJson } from './approval-crypto.js';
import { bindApprover } from './approver.js';
import { createDirectRegistry } from './direct-registry.js';
import { createExecutionEngine } from './execution.js';
import {
	createHumanRelayGate,
	type HumanRelay,
	inputDigest,
	isRelayUrl,
	type RelayBeginResult,
	type RelayCall,
	type RelayOutcome,
	type RelayPrompt,
} from './human-relay.js';
import type { TokenVerifier } from './mcp-auth-jwt.js';
import type { Credentials } from './mcp-auth-rules.js';
import type { ScopeResolver } from './mcp-auth-scopes.js';
import { serveModernStdio } from './mcp-modern.js';
import { createRetryMiddleware } from './middleware.js';
import { credentialsBinding } from './principal-binding.js';
import {
	bindRelayEvidence,
	installRelayEvidenceRecords,
	type RelayEvidence,
	relayEvidenceOf,
} from './relay-evidence.js';
import { defineCommand } from './schema.js';
import { createMcpHandler, createMcpServer } from './server.js';
import type { McpHandlerOptions, ToolStrategy } from './server-types.js';
import { createToolRouter } from './tool-router.js';
import { getToolsList } from './tools.js';

const SECRET = 'test-approval-secret-0123456789abcdef';
const PERSON_URL = 'https://person.example.com/decide/d-1';
const MODERN = '2026-07-28';
const RESOURCE = 'https://todo.example.com/mcp';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

class FakeRelay implements HumanRelay {
	begins = 0;
	resumes = 0;
	calls: RelayCall[] = [];
	states: string[] = [];
	outcomes: RelayOutcome[] = [];
	refusal?: CommandError;
	prompt?: RelayPrompt;
	extra?: Record<string, unknown>;
	annotated: string[] = [];

	answer(outcome: RelayOutcome): void {
		this.outcomes.push(outcome);
	}

	lastCall(): RelayCall {
		const last = this.calls.at(-1);
		if (!last) throw new Error('no relay calls recorded');
		return last;
	}

	async begin(call: RelayCall): Promise<RelayBeginResult> {
		this.begins += 1;
		this.calls.push(call);
		if (this.refusal) return { ok: false, error: this.refusal };
		return {
			ok: true,
			prompt: this.prompt ?? {
				url: PERSON_URL,
				message: 'Open the link to review memory-erase',
				state: `state-${this.begins}`,
			},
		};
	}

	async resume(state: string, call: RelayCall): Promise<RelayOutcome> {
		this.resumes += 1;
		this.calls.push(call);
		this.states.push(state);
		return this.outcomes.shift() ?? { kind: 'invalid' };
	}

	async approvedContext(decisionId: string): Promise<Record<string, unknown>> {
		this.annotated.push(decisionId);
		return this.extra ? { ...this.extra } : {};
	}
}

interface HarnessOptions {
	relay?: FakeRelay | null;
	confirmations?: 'off' | 'enforce' | 'require-human';
	replay?: 'single-use' | 'within-ttl';
	formRelay?: boolean;
	toolStrategy?: ToolStrategy;
	nonceStore?: ApprovalNonceStore;
	clock?: ReturnType<typeof fixedClock>;
	extraOptions?: Partial<McpHandlerOptions>;
}

async function createHarness(options: HarnessOptions = {}) {
	const runs = { erase: 0, show: 0, purge: 0, list: 0, dynamic: 0 };
	const seenEvidenceInHandler: Array<boolean> = [];
	let dynamicCounter = 0;

	const memoryErase = defineCommand({
		name: 'memory-erase',
		description: 'Erase a memory',
		category: 'memory',
		mutation: true,
		confirmPrompt: 'Erase this memory?',
		approval: 'required',
		confirmationMode: 'host-verified',
		expose: { mcp: true },
		input: z.object({
			id: z.string(),
			mode: z.string().default('soft'),
		}),
		handler: async (input, context) => {
			runs.erase += 1;
			seenEvidenceInHandler.push(relayEvidenceOf(context) !== undefined);
			return success({
				input,
				actor: context.actor,
				person: context['host.example/person'],
				credentials: context.credentials
					? { subject: (context.credentials as Credentials).subject }
					: undefined,
				reserved: {
					timeout: context.timeout,
					auth: context.auth,
					session: context.session,
					source: context.source,
				},
			});
		},
	});

	const memoryShow = defineCommand({
		name: 'memory-show',
		description: 'Show a memory',
		category: 'memory',
		confirmationMode: 'host-verified',
		expose: { mcp: true },
		input: z.object({ id: z.string() }),
		handler: async (input) => {
			runs.show += 1;
			return success({ id: input.id });
		},
	});

	const memoryPurge = defineCommand({
		name: 'memory-purge',
		description: 'Purge a memory',
		category: 'memory',
		mutation: true,
		approval: 'required',
		expose: { mcp: true },
		input: z.object({ id: z.string() }),
		handler: async (input) => {
			runs.purge += 1;
			return success({ id: input.id });
		},
	});

	const memoryDynamic = defineCommand({
		name: 'memory-dynamic',
		description: 'Erase with a dynamic default',
		category: 'memory',
		mutation: true,
		approval: 'required',
		confirmationMode: 'host-verified',
		expose: { mcp: true },
		input: z.object({
			id: z.string(),
			nonce: z.string().default(() => `gen-${++dynamicCounter}`),
		}),
		handler: async (input) => {
			runs.dynamic += 1;
			return success(input);
		},
	});

	const todoList = defineCommand({
		name: 'todo-list',
		description: 'List todos',
		category: 'todo',
		expose: { mcp: true },
		input: z.object({}),
		handler: async () => {
			runs.list += 1;
			return success([]);
		},
	});

	let serverRef: ReturnType<typeof createMcpServer> | undefined;
	const memorySweep = defineCommand({
		name: 'memory-sweep',
		description: 'Sweep memories and invoke nested commands',
		category: 'memory',
		approval: 'required',
		confirmationMode: 'host-verified',
		expose: { mcp: true },
		input: z.object({}),
		handler: async (input, context) => {
			seenEvidenceInHandler.push(relayEvidenceOf(context) !== undefined);
			if (!serverRef) throw new Error('serverRef not initialized');
			const purge = await serverRef.execute('memory-purge', { id: '42' }, context);
			const again = await serverRef.execute('memory-sweep', input, context);
			const listed = await serverRef.execute('todo-list', {}, context);
			return success({ purge, again, listed });
		},
	});

	const commands = [memoryErase, memoryShow, memoryPurge, memoryDynamic, memorySweep, todoList];
	const relay = options.relay ?? new FakeRelay();
	const installRelay = options.relay !== null;
	const approval = createApprovalMiddleware({
		secret: SECRET,
		replay: options.replay ?? 'single-use',
		...(options.formRelay && { relay: 'mcp-elicitation' }),
		...(options.nonceStore && { nonceStore: options.nonceStore }),
		...(options.clock && { clock: options.clock }),
	});
	const strategy = options.toolStrategy ?? 'grouped';
	const handlerOptions: McpHandlerOptions = {
		name: 'relay-test',
		version: '1.0.0',
		host: '127.0.0.1',
		commands,
		middleware: [approval],
		confirmations: options.confirmations ?? 'off',
		toolStrategy: strategy,
		...(strategy === 'hybrid' && { firstClassTools: ['memory-erase'] }),
		...(installRelay && { humanRelay: relay }),
		...(options.clock && { clock: options.clock }),
		...options.extraOptions,
	};
	serverRef = createMcpServer({ ...handlerOptions, transport: 'http', port: 0 });
	const handler = createMcpHandler(handlerOptions);
	const httpServer = createServer(handler);
	await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		handler.dispose();
		httpServer.closeAllConnections();
		await new Promise<void>((resolve) => httpServer.close(() => resolve()));
	});
	const base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
	return {
		base,
		url: `${base}/mcp`,
		relay,
		runs,
		seenEvidenceInHandler,
		server: serverRef,
		commands,
	};
}

function urlCaps() {
	return { elicitation: { url: {} } };
}

function makeCall(
	name: string,
	args: Record<string, unknown>,
	capabilities: Record<string, unknown> = urlCaps(),
	extra: Record<string, unknown> = {}
) {
	const { _meta: extraMeta, ...restExtra } = extra;
	return {
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/call',
		params: {
			name,
			arguments: args,
			_meta: {
				'io.modelcontextprotocol/protocolVersion': MODERN,
				'io.modelcontextprotocol/clientCapabilities': capabilities,
				...(extraMeta as Record<string, unknown> | undefined),
			},
			...restExtra,
		},
	};
}

function retryExtra(action: string, state: string, meta?: Record<string, unknown>) {
	return {
		inputResponses: { relay: { action } },
		requestState: state,
		...(meta && { _meta: meta }),
	};
}

async function postMcp(
	url: string,
	body: Record<string, unknown>,
	headers: Record<string, string> = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
	const name = (body.params as { name?: string } | undefined)?.name;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			'mcp-protocol-version': MODERN,
			'mcp-method': String(body.method ?? 'tools/call'),
			...(name ? { 'mcp-name': name } : {}),
			...headers,
		},
		body: JSON.stringify(body),
	});
	const text = await res.text();
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(text) as Record<string, unknown>;
	} catch {
		const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
		parsed = JSON.parse(dataLine ? dataLine.slice(6) : '{}') as Record<string, unknown>;
	}
	return { status: res.status, json: parsed };
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

function expectUrlElicitation(response: Record<string, unknown>): {
	params: Record<string, unknown>;
	state: string;
} {
	const result = response.result as Record<string, unknown>;
	expect(result.resultType).toBe('input_required');
	const requests = result.inputRequests as Record<
		string,
		{ method: string; params: Record<string, unknown> }
	>;
	expect(Object.keys(requests)).toEqual(['relay']);
	expect(requests.relay?.method).toBe('elicitation/create');
	if (!requests.relay) throw new Error('expected relay inputRequest');
	return {
		params: requests.relay.params,
		state: result.requestState as string,
	};
}

function sha256Base64urlSync(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('base64url');
}

describe('isRelayUrl', () => {
	it('accepts absolute https URLs without userinfo or control chars', () => {
		for (const valid of [
			'https://umbel.example.com/person/abc',
			'HTTPS://umbel.example.com',
			'https://umbel.example.com:8443/p?d=1#x',
		]) {
			expect(isRelayUrl(valid), valid).toBe(true);
		}
		for (const invalid of [
			'http://umbel.example.com/person',
			'https://',
			'https:///path',
			'https://user@umbel.example.com/',
			'https://:pass@umbel.example.com/',
			'https://umbel.example.com/a b',
			'https://umbel.example.com/\n',
			'javascript:alert(1)',
			'',
			'https:/umbel.example.com',
			'person.example.com/decide',
		]) {
			expect(isRelayUrl(invalid), invalid).toBe(false);
		}
	});
});

describe('metadata and registration validation', () => {
	it('surfaces confirmationMode on core CommandDefinition, _meta, grouped _meta.actions and afd-detail', async () => {
		const coreRegistry = createCommandRegistry();
		const coreCmd = {
			name: 'core-erase',
			description: 'Core erase',
			parameters: [],
			confirmationMode: 'host-verified' as const,
			handler: async () => success({}),
		};
		coreRegistry.register(coreCmd);
		expect(commandToMcpTool(coreCmd)._meta?.confirmationMode).toBe('host-verified');

		// Invalid confirmationMode refused in core registry and defineCommand
		expect(() =>
			coreRegistry.register({
				name: 'bad-mode',
				description: 'Bad',
				parameters: [],
				confirmationMode: 'form' as never,
				handler: async () => success({}),
			})
		).toThrow(/confirmationMode/);
		expect(() =>
			defineCommand({
				name: 'bad-mode',
				description: 'Bad',
				confirmationMode: 'form' as never,
				input: z.object({}),
				handler: async () => success({}),
			})
		).toThrow(/confirmationMode/);

		// Refused beside task: 'optional' or 'required'
		for (const task of ['optional', 'required'] as const) {
			expect(() =>
				coreRegistry.register({
					name: `bad-task-${task}`,
					description: 'Bad',
					parameters: [],
					confirmationMode: 'host-verified',
					task,
					handler: async () => success({}),
				})
			).toThrow(/confirmationMode/);

			const conflicted = defineCommand({
				name: `bad-task-${task}`,
				description: 'Bad',
				confirmationMode: 'host-verified',
				task,
				expose: { mcp: true },
				input: z.object({}),
				handler: async () => success({}),
			});
			expect(() =>
				createMcpHandler({
					name: 'conflict',
					version: '1.0.0',
					commands: [conflicted],
				})
			).toThrow(/confirmationMode/);
		}

		// tools/list never advertises `confirm` for host-verified commands even under enforce
		for (const strategy of ['individual', 'grouped', 'hybrid'] as const) {
			const h = await createHarness({ confirmations: 'enforce', toolStrategy: strategy });
			const { json } = await postMcp(h.url, {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list',
				params: {
					_meta: {
						'io.modelcontextprotocol/protocolVersion': MODERN,
						'io.modelcontextprotocol/clientCapabilities': {},
					},
				},
			});
			const tools = (json.result as { tools: Array<Record<string, unknown>> }).tools;
			if (strategy === 'individual' || strategy === 'hybrid') {
				const erase = tools.find((t) => t.name === 'memory-erase');
				expect(erase).toBeDefined();
				expect(
					(erase?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties
						?.confirm
				).toBeUndefined();
				expect((erase?._meta as Record<string, unknown> | undefined)?.confirmationMode).toBe(
					'host-verified'
				);
				if (strategy === 'individual') {
					const purge = tools.find((t) => t.name === 'memory-purge');
					expect(purge).toBeDefined();
					expect(
						(purge?._meta as Record<string, unknown> | undefined)?.confirmationMode
					).toBeUndefined();
				}
			} else {
				const group = tools.find((t) => t.name === 'memory');
				expect(group).toBeDefined();
				expect(
					(group?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties
						?.confirm
				).toBeUndefined();
				const actions = (group?._meta as { actions?: Array<Record<string, unknown>> } | undefined)
					?.actions;
				expect(actions?.find((a) => a.action === 'erase')?.confirmationMode).toBe('host-verified');
				expect(actions?.find((a) => a.action === 'purge')?.confirmationMode).toBeUndefined();
			}
		}

		// afd-detail reports confirmationMode only when set
		const h = await createHarness();
		const { json } = await postMcp(
			h.url,
			makeCall('afd-detail', { command: ['memory-erase', 'memory-purge'] })
		);
		const detail = commandResult(json).data as Array<Record<string, unknown>>;
		expect(detail[0]?.confirmationMode).toBe('host-verified');
		expect(detail[1]?.confirmationMode).toBeUndefined();
	});
});

describe('HumanRelay end-to-end flow', () => {
	it('begins with one URL elicitation after validation and defaults', async () => {
		const { url, relay, runs } = await createHarness();
		const { status, json } = await postMcp(url, makeCall('memory-erase', { id: '42' }));
		expect(status).toBe(200);
		const { params, state } = expectUrlElicitation(json);
		expect(params).toEqual({
			mode: 'url',
			message: 'Open the link to review memory-erase',
			url: PERSON_URL,
			elicitationId: sha256Base64urlSync(PERSON_URL),
		});
		expect(state).toBe('state-1');
		expect(relay.begins).toBe(1);
		expect(runs.erase).toBe(0);

		const call = relay.lastCall();
		expect(call.command).toBe('memory-erase');
		expect(call.input).toEqual({ id: '42', mode: 'soft' });
		expect(call.inputDigest).toBe(inputDigest({ id: '42', mode: 'soft' }));
		expect(call.inputDigest).not.toBe(inputDigest({ id: '42' }));
		expect(call.actor?.kind).toBe('agent');
		expect(call.credentials).toBeUndefined();
		expect(call.supportsUrlElicitation()).toBe(true);
		expect(call.principalBinding()).toBe('{"actor":{"kind":"agent"},"credentials":null}');
	});

	it('fails invalid input before asking the relay', async () => {
		const { url, relay, runs } = await createHarness();
		const { json } = await postMcp(url, makeCall('memory-erase', { mode: 'hard' }));
		expect((commandResult(json).error as { code: string }).code).toBe(ErrorCodes.VALIDATION_ERROR);
		expect(relay.begins).toBe(0);
		expect(runs.erase).toBe(0);
	});

	it('runs an approved decision once and spends relay:<decisionId> even under within-ttl', async () => {
		for (const replay of ['single-use', 'within-ttl'] as const) {
			const { url, relay, runs, seenEvidenceInHandler } = await createHarness({ replay });
			const first = await postMcp(url, makeCall('memory-erase', { id: '42' }));
			const { state } = expectUrlElicitation(first.json);

			relay.answer({ kind: 'approved', decisionId: 'd-1' });
			const ran = commandResult(
				(
					await postMcp(
						url,
						makeCall('memory-erase', { id: '42' }, urlCaps(), retryExtra('accept', state))
					)
				).json
			);
			expect(ran.success).toBe(true);
			expect((ran.data as { input: unknown }).input).toEqual({ id: '42', mode: 'soft' });
			expect(runs.erase).toBe(1);
			expect(seenEvidenceInHandler).toEqual([false]);

			// Second approval with same decisionId is rejected as already-used without a token
			relay.answer({ kind: 'approved', decisionId: 'd-1' });
			const spent = commandResult(
				(
					await postMcp(
						url,
						makeCall('memory-erase', { id: '42' }, urlCaps(), retryExtra('accept', state))
					)
				).json
			);
			expect(spent.success).toBe(false);
			const err = spent.error as { code: string; details: Record<string, unknown> };
			expect(err.code).toBe(ErrorCodes.APPROVAL_REQUIRED);
			expect(err.details.reason).toBe('already-used');
			expect(err.details.approvalToken).toBeUndefined();
			expect(runs.erase).toBe(1);

			// Fresh decisionId runs again
			relay.answer({ kind: 'approved', decisionId: 'd-2' });
			const again = commandResult(
				(
					await postMcp(
						url,
						makeCall('memory-erase', { id: '42' }, urlCaps(), retryExtra('accept', state))
					)
				).json
			);
			expect(again.success).toBe(true);
			expect(runs.erase).toBe(2);
		}
	});

	it('handles dynamic Zod defaults consistently across begin, digest-binding resume, and execution', async () => {
		// Real relay contract: binds `state` to the `begin` inputDigest + principal and returns
		// `invalid` if `resume` delivers a different digest.
		const pending = new Map<string, { digest: string; principal: string; input: unknown }>();
		let seq = 0;
		const digestBindingRelay: HumanRelay = {
			begin(call) {
				const state = `state-dyn-${++seq}`;
				pending.set(state, {
					digest: call.inputDigest,
					principal: call.principalBinding(),
					input: call.input,
				});
				return { ok: true, prompt: { url: PERSON_URL, message: 'Approve dynamic', state } };
			},
			resume(state, call) {
				const bound = pending.get(state);
				if (
					!bound ||
					bound.digest !== call.inputDigest ||
					bound.principal !== call.principalBinding()
				) {
					return { kind: 'invalid' };
				}
				pending.delete(state);
				return { kind: 'approved', decisionId: `d-${state}` };
			},
		};
		const { url, runs } = await createHarness({
			extraOptions: { humanRelay: digestBindingRelay },
		});
		const first = await postMcp(url, makeCall('memory-dynamic', { id: '42' }));
		const { state } = expectUrlElicitation(first.json);
		const begunInput = pending.get(state)?.input as { id: string; nonce: string } | undefined;
		expect(begunInput).toMatchObject({ id: '42', nonce: expect.stringMatching(/^gen-\d+$/) });

		// Retry with changed raw input does NOT reuse cached input -> digest mismatch -> begins again
		const changed = await postMcp(
			url,
			makeCall('memory-dynamic', { id: '99' }, urlCaps(), retryExtra('accept', state))
		);
		const changedPrompt = expectUrlElicitation(changed.json);
		expect(changedPrompt.state).not.toBe(state);
		expect(
			(pending.get(changedPrompt.state)?.input as { nonce?: string } | undefined)?.nonce
		).not.toBe(begunInput?.nonce);
		expect(runs.dynamic).toBe(0);

		// Retry of the original raw input on the original state preserves the initial default across resume & handler
		const ran = commandResult(
			(
				await postMcp(
					url,
					makeCall('memory-dynamic', { id: '42' }, urlCaps(), retryExtra('accept', state))
				)
			).json
		);
		expect(ran.success).toBe(true);
		expect(ran.data).toEqual(begunInput);
		expect(runs.dynamic).toBe(1);
	});

	it('handles decline, cancel, pending, invalid, and malformed answers', async () => {
		const { url, relay, runs } = await createHarness();
		for (const action of ['decline', 'cancel']) {
			const res = commandResult(
				(
					await postMcp(
						url,
						makeCall('memory-erase', { id: '42' }, urlCaps(), retryExtra(action, 'state-1'))
					)
				).json
			);
			expect((res.error as { code: string; retryable: boolean }).code).toBe(
				ErrorCodes.CONFIRMATION_DECLINED
			);
			expect((res.error as { retryable: boolean }).retryable).toBe(false);
		}
		expect(relay.resumes).toBe(0);
		expect(relay.begins).toBe(0);

		// resume -> Declined
		relay.answer({ kind: 'declined' });
		const declined = commandResult(
			(
				await postMcp(
					url,
					makeCall('memory-erase', { id: '42' }, urlCaps(), retryExtra('accept', 'state-1'))
				)
			).json
		);
		expect((declined.error as { code: string; retryable: boolean }).code).toBe(
			ErrorCodes.CONFIRMATION_DECLINED
		);
		expect((declined.error as { retryable: boolean }).retryable).toBe(false);
		// spec/recovery.md, "Engine errors": a decline is a stop.
		expect((declined.error as { recovery?: unknown }).recovery).toEqual({ kind: 'stop' });

		// resume -> Pending (keeps elicitationId for same URL, does not call begin)
		relay.answer({
			kind: 'pending',
			prompt: { url: PERSON_URL, message: 'Still waiting', state: 'state-fresh' },
		});
		const pending = expectUrlElicitation(
			(
				await postMcp(
					url,
					makeCall('memory-erase', { id: '42' }, urlCaps(), retryExtra('accept', 'state-1'))
				)
			).json
		);
		expect(pending.params.elicitationId).toBe(sha256Base64urlSync(PERSON_URL));
		expect(pending.params.message).toBe('Still waiting');
		expect(pending.state).toBe('state-fresh');
		expect(relay.begins).toBe(0);

		// resume -> Invalid (begins again)
		relay.answer({ kind: 'invalid' });
		const restarted = expectUrlElicitation(
			(
				await postMcp(
					url,
					makeCall('memory-erase', { id: '42' }, urlCaps(), retryExtra('accept', 'forged'))
				)
			).json
		);
		expect(restarted.state).toBe('state-1');
		expect(relay.begins).toBe(1);

		// Missing state or unknown action begins again without calling resume
		for (const extra of [
			{ inputResponses: { relay: { action: 'accept' } } },
			{ inputResponses: { relay: { action: 'maybe' } }, requestState: 'state-1' },
			{ inputResponses: { relay: {} }, requestState: 'state-1' },
			{ requestState: 'state-1' },
		]) {
			expectUrlElicitation(
				(await postMcp(url, makeCall('memory-erase', { id: '42' }, urlCaps(), extra))).json
			);
		}
		expect(relay.begins).toBe(5);
		expect(relay.resumes).toBe(3);
		expect(runs.erase).toBe(0);
	});

	it('refuses clients without URL-mode elicitation and forwards relay refusals', async () => {
		const { url, relay, runs } = await createHarness();
		for (const caps of [{}, { elicitation: {} }, { elicitation: { form: {} } }]) {
			const { json } = await postMcp(url, makeCall('memory-erase', { id: '42' }, caps));
			expect((json.result as Record<string, unknown>).resultType).not.toBe('input_required');
			const err = commandResult(json).error as { code: string; suggestion: string };
			expect(err.code).toBe(ErrorCodes.CONFIRMATION_REQUIRED);
			expect(err.suggestion).toContain('URL-mode elicitation');
			// A person confirms through the host.
			expect((err as { recovery?: unknown }).recovery).toEqual({ kind: 'external' });
			expect(relay.lastCall().supportsUrlElicitation()).toBe(false);
		}
		// Pending also held to URL-mode capability
		relay.answer({ kind: 'pending', prompt: { url: PERSON_URL, message: 'Waiting', state: 's' } });
		const pendingRefused = commandResult(
			(
				await postMcp(
					url,
					makeCall(
						'memory-erase',
						{ id: '42' },
						{ elicitation: { form: {} } },
						retryExtra('accept', 's')
					)
				)
			).json
		);
		expect((pendingRefused.error as { code: string }).code).toBe(ErrorCodes.CONFIRMATION_REQUIRED);

		// Relay refusal from begin is returned verbatim
		relay.refusal = {
			code: ErrorCodes.APPROVAL_REQUIRED,
			message: 'Open from a client that can',
			details: { reason: 'url-elicitation-required' },
		};
		const refused = commandResult(
			(await postMcp(url, makeCall('memory-erase', { id: '42' }))).json
		);
		expect((refused.error as { code: string; details: Record<string, unknown> }).code).toBe(
			ErrorCodes.APPROVAL_REQUIRED
		);
		expect((refused.error as { details: Record<string, unknown> }).details.reason).toBe(
			'url-elicitation-required'
		);
		expect(runs.erase).toBe(0);
	});

	it('returns JSON-RPC -32603 when relay breaks URL, state, or decisionId contract', async () => {
		for (const badUrl of [
			'http://person.example.com/decide',
			'https://alice@person.example.com/decide',
			'not-a-url',
		]) {
			const { url, relay, runs } = await createHarness();
			relay.prompt = { url: badUrl, message: 'Open', state: 's' };
			const { json } = await postMcp(url, makeCall('memory-erase', { id: '42' }));
			expect((json.error as { code: number; message: string }).code).toBe(-32603);
			expect((json.error as { message: string }).message).toBe('Internal error');
			expect(runs.erase).toBe(0);
		}
		// Empty state
		const h1 = await createHarness();
		h1.relay.prompt = { url: PERSON_URL, message: 'Open', state: '' };
		const r1 = (await postMcp(h1.url, makeCall('memory-erase', { id: '42' }))).json;
		expect((r1.error as { code: number }).code).toBe(-32603);

		// Empty decisionId
		const h2 = await createHarness();
		h2.relay.answer({ kind: 'approved', decisionId: '' });
		const r2 = (
			await postMcp(
				h2.url,
				makeCall('memory-erase', { id: '42' }, urlCaps(), retryExtra('accept', 's'))
			)
		).json;
		expect((r2.error as { code: number }).code).toBe(-32603);
		expect(h2.runs.erase).toBe(0);
	});

	it('merges approvedContext onto approved calls only and blocks reserved key overrides', async () => {
		const { url, relay, runs } = await createHarness();
		relay.extra = {
			'host.example/person': { decision: 'd-ctx' },
			actor: { kind: 'human', id: 'spoofed' },
			credentials: { issuer: 'https://evil', subject: 'x', clientId: 'y' },
			timeout: 1,
			auth: { spoofed: true },
			session: { spoofed: true },
			source: 'spoofed',
		};
		const { state } = expectUrlElicitation(
			(await postMcp(url, makeCall('memory-erase', { id: '42' }))).json
		);
		expect(relay.annotated).toEqual([]);

		relay.answer({ kind: 'approved', decisionId: 'd-ctx' });
		const ran = commandResult(
			(
				await postMcp(
					url,
					makeCall('memory-erase', { id: '42' }, urlCaps(), retryExtra('accept', state))
				)
			).json
		);
		expect(ran.success).toBe(true);
		const data = ran.data as {
			person: unknown;
			actor: Actor;
			credentials: unknown;
			reserved: { timeout?: unknown; auth?: unknown; session?: unknown; source?: unknown };
		};
		expect(data.person).toEqual({ decision: 'd-ctx' });
		expect(data.actor).toEqual({ kind: 'agent' });
		expect(data.credentials).toBeUndefined();
		expect(data.reserved).toEqual({
			timeout: undefined,
			auth: undefined,
			session: undefined,
			source: undefined,
		});
		expect(relay.annotated).toEqual(['d-ctx']);
		expect(runs.erase).toBe(1);

		// Caller cannot forge the field via _meta
		relay.extra = undefined;
		relay.answer({ kind: 'approved', decisionId: 'd-ctx-2' });
		const forged = commandResult(
			(
				await postMcp(
					url,
					makeCall(
						'memory-erase',
						{ id: '42' },
						urlCaps(),
						retryExtra('accept', state, { 'host.example/person': { decision: 'forged' } })
					)
				)
			).json
		);
		expect((forged.data as { person: unknown }).person).toBeUndefined();
	});

	it('relays every single-command MCP 2026-07-28 route and blocks confirmations:off without prompt', async () => {
		// Without confirmPrompt, confirmations: off still gates memory-show
		const hShow = await createHarness({ confirmations: 'off' });
		expectUrlElicitation((await postMcp(hShow.url, makeCall('memory-show', { id: '42' }))).json);
		hShow.relay.answer({ kind: 'approved', decisionId: 'd-show' });
		const showRan = commandResult(
			(
				await postMcp(
					hShow.url,
					makeCall('memory-show', { id: '42' }, urlCaps(), retryExtra('accept', 's'))
				)
			).json
		);
		expect(showRan.success).toBe(true);
		expect(hShow.runs.show).toBe(1);

		// Individual, hybrid, grouped, afd-call
		const cases: Array<[ToolStrategy, string, Record<string, unknown>]> = [
			['individual', 'memory-erase', { id: '42' }],
			['hybrid', 'memory-erase', { id: '42' }],
			['grouped', 'memory', { action: 'erase', params: { id: '42' } }],
			['grouped', 'afd-call', { command: 'memory-erase', input: { id: '42' } }],
		];
		for (const [strategy, tool, args] of cases) {
			const h = await createHarness({ toolStrategy: strategy });
			expectUrlElicitation((await postMcp(h.url, makeCall(tool, args))).json);
			h.relay.answer({ kind: 'approved', decisionId: 'd-1' });
			const ran = commandResult(
				(await postMcp(h.url, makeCall(tool, args, urlCaps(), retryExtra('accept', 'state-1'))))
					.json
			);
			expect(ran.success, `${strategy}:${tool}`).toBe(true);
			expect(h.runs.erase).toBe(1);
		}
	});

	it('never accepts acknowledgements, form answers, or form-mode approval relay for host-verified commands', async () => {
		for (const mode of ['enforce', 'require-human'] as const) {
			const { url, relay, runs } = await createHarness({ confirmations: mode, formRelay: true });
			const both = { elicitation: { form: {}, url: {} } };
			// Ordinary approval command still uses form relay
			const purgeRes = (await postMcp(url, makeCall('memory-purge', { id: '42' }, both))).json;
			expect(
				((purgeRes.result as Record<string, unknown>).inputRequests as Record<string, unknown>)
					.approval
			).toBeDefined();

			// Host-verified ignores confirm: true, _meta["dev.afd/confirm"], and form answers
			for (const [args, extra] of [
				[{ id: '42', confirm: true }, {}],
				[{ id: '42' }, { _meta: { 'dev.afd/confirm': true } }],
				[
					{ id: '42' },
					{
						inputResponses: { confirm: { action: 'accept', content: { confirm: true } } },
						requestState: 's',
					},
				],
			] as Array<[Record<string, unknown>, Record<string, unknown>]>) {
				expectUrlElicitation(
					(await postMcp(url, makeCall('memory-erase', args, both, extra))).json
				);
			}
			expect(relay.begins).toBe(3);
			expect(runs.erase).toBe(0);
		}
	});

	it('refuses batch, pipe, 2025-era requests, /rpc, /batch, /stream, and servers without a relay', async () => {
		const { base, url, relay, runs } = await createHarness({ confirmations: 'enforce' });
		const steps = [
			{ command: 'todo-list', input: {} },
			{ command: 'memory-erase', input: { id: '42' } },
		];

		// afd-batch
		const batch = commandResult(
			(
				await postMcp(
					url,
					makeCall(
						'afd-batch',
						{ commands: steps, confirm: ['memory-erase'] },
						urlCaps(),
						retryExtra('accept', 's')
					)
				)
			).json
		);
		expect(batch.success).toBe(false);
		expect((batch.error as { code: string; suggestion: string }).code).toBe(
			ErrorCodes.CONFIRMATION_REQUIRED
		);
		expect((batch.error as { suggestion: string }).suggestion).toContain('on its own');

		// afd-pipe
		const pipe = commandResult(
			(await postMcp(url, makeCall('afd-pipe', { steps, confirm: ['memory-erase'] }))).json
		);
		const pipeSteps = pipe.steps as Array<{ index: number; error: { code: string } }>;
		expect(pipeSteps[0]?.index).toBe(-1);
		expect(pipeSteps[0]?.error.code).toBe(ErrorCodes.CONFIRMATION_REQUIRED);

		// 2025-era /mcp and /message
		const legacyMcp = await fetch(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
				'mcp-protocol-version': '2025-11-25',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: 'memory-erase', arguments: { id: '42' } },
			}),
		});
		const legacyText = await legacyMcp.text();
		const legacyDataLine = legacyText.split('\n').find((l) => l.startsWith('data: '));
		const legacyJson = JSON.parse(legacyDataLine ? legacyDataLine.slice(6) : legacyText) as Record<
			string,
			unknown
		>;
		expect((commandResult(legacyJson).error as { code: string }).code).toBe(
			ErrorCodes.CONFIRMATION_REQUIRED
		);

		const msgRes = await fetch(`${base}/message`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: 'memory-erase', arguments: { id: '42' } },
			}),
		});
		const msgJson = (await msgRes.json()) as Record<string, unknown>;
		expect((commandResult(msgJson).error as { code: string }).code).toBe(
			ErrorCodes.CONFIRMATION_REQUIRED
		);

		// /rpc, /batch, /stream (even with Afd-Confirm header)
		const rpcRes = await fetch(`${base}/rpc`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'afd-confirm': 'memory-erase' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'memory-erase', params: { id: '42' } }),
		});
		const rpcJson = (await rpcRes.json()) as { result: { error: { code: string } } };
		expect(rpcJson.result.error.code).toBe(ErrorCodes.CONFIRMATION_REQUIRED);

		const httpBatchRes = await fetch(`${base}/batch`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'afd-confirm': 'memory-erase' },
			body: JSON.stringify({ commands: steps }),
		});
		const httpBatchJson = (await httpBatchRes.json()) as { error: { code: string } };
		expect(httpBatchJson.error.code).toBe(ErrorCodes.CONFIRMATION_REQUIRED);

		const streamRes = await fetch(`${base}/stream/memory-erase`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'afd-confirm': 'memory-erase' },
			body: JSON.stringify({ id: '42' }),
		});
		const streamText = await streamRes.text();
		expect(streamText).toContain(ErrorCodes.CONFIRMATION_REQUIRED);

		expect(runs.list).toBe(0);
		expect(runs.erase).toBe(0);
		expect(relay.begins).toBe(0);
		expect(relay.resumes).toBe(0);

		// No relay configured -> refuses with "cannot confirm ... over MCP"
		const noRelay = await createHarness({ relay: null });
		for (const cmd of ['memory-erase', 'memory-show']) {
			const res = commandResult((await postMcp(noRelay.url, makeCall(cmd, { id: '42' }))).json);
			const err = res.error as { code: string; suggestion: string };
			expect(err.code).toBe(ErrorCodes.CONFIRMATION_REQUIRED);
			expect(err.suggestion).toContain('cannot confirm');
			expect(err.suggestion).toContain('over MCP');
		}
		expect(noRelay.runs.erase).toBe(0);
		expect(noRelay.runs.show).toBe(0);
	});

	it('leaves in-process execution ungated by HumanRelay and clears evidence before nested handler calls', async () => {
		const { url, relay, runs, commands } = await createHarness();

		// DirectRegistry is unaffected by confirmationMode
		const showCmd = commands.find((c) => c.name === 'memory-show');
		if (!showCmd) throw new Error('expected memory-show command');
		const directReg = createDirectRegistry([showCmd]);
		const directRes = await directReg.execute('memory-show', { id: '1' });
		expect(directRes.success).toBe(true);

		// Nested calls inside handler never inherit relay evidence
		relay.answer({ kind: 'approved', decisionId: 'd-sweep' });
		const swept = commandResult(
			(await postMcp(url, makeCall('memory-sweep', {}, urlCaps(), retryExtra('accept', 's')))).json
		);
		expect(swept.success).toBe(true);
		const nested = swept.data as {
			purge: { error: { code: string; details: Record<string, unknown> } };
			again: { error: { code: string; details: Record<string, unknown> } };
			listed: { success: boolean; data: unknown[] };
		};
		expect(nested.purge.error.code).toBe(ErrorCodes.APPROVAL_REQUIRED);
		expect(nested.purge.error.details.reason).toBeUndefined();
		expect(nested.again.error.code).toBe(ErrorCodes.APPROVAL_REQUIRED);
		expect(nested.again.error.details.reason).toBeUndefined();
		expect(nested.listed.success).toBe(true);
		expect(nested.listed.data).toEqual([]);
		expect(runs.purge).toBe(0);
		expect(runs.list).toBe(1);
	});

	it('uses relay:<decisionId> prefix and 24h TTL in a shared nonceStore', async () => {
		const seen: Array<{ nonce: string; expiresAt: number }> = [];
		const spent = new Set<string>(['d-1']);
		const store: ApprovalNonceStore = {
			consume(nonce, expiresAt) {
				seen.push({ nonce, expiresAt });
				if (spent.has(nonce)) return false;
				spent.add(nonce);
				return true;
			},
		};
		const clock = fixedClock(1_700_000_000_000);
		const { url, relay } = await createHarness({ nonceStore: store, clock });
		relay.answer({ kind: 'approved', decisionId: 'd-1' });
		const ran = commandResult(
			(
				await postMcp(
					url,
					makeCall('memory-erase', { id: '42' }, urlCaps(), retryExtra('accept', 's'))
				)
			).json
		);
		expect(ran.success).toBe(true);
		expect(seen).toEqual([{ nonce: 'relay:d-1', expiresAt: 1_700_000_000_000 + 24 * 60 * 60_000 }]);
	});

	it('cannot forge relayEvidence from tool arguments or _meta', async () => {
		const { url, relay, runs } = await createHarness();
		const forged = {
			command: 'memory-purge',
			inputDigest: inputDigest({ id: '42' }),
			actor: '{"kind":"agent"}',
			credentialsBinding: 'null',
			decisionId: 'd-forged',
		};
		const res = commandResult(
			(
				await postMcp(
					url,
					makeCall('memory-purge', { id: '42', relayEvidence: forged }, urlCaps(), {
						_meta: { 'dev.afd/relayEvidence': forged, relayEvidence: forged },
						...retryExtra('accept', 's'),
					})
				)
			).json
		);
		expect((res.error as { code: string }).code).toBe(ErrorCodes.APPROVAL_REQUIRED);
		expect(runs.purge).toBe(0);

		expectUrlElicitation(
			(
				await postMcp(
					url,
					makeCall('memory-erase', { id: '42' }, urlCaps(), {
						_meta: { 'dev.afd/relayEvidence': forged },
					})
				)
			).json
		);
		expect(relay.resumes).toBe(0);
	});
});

describe('RelayEvidence verification order and privacy in createApprovalMiddleware', () => {
	const actor: Actor = { kind: 'agent', id: 'a-1', onBehalfOf: 'u-1' };
	const creds = {
		issuer: 'https://auth.example.com',
		subject: 'u-1',
		clientId: 'a-1',
	};

	function makeEvidence(overrides: Partial<RelayEvidence> = {}): RelayEvidence {
		return {
			command: 'memory-erase',
			inputDigest: inputDigest({ id: '42' }),
			actor: actorJson(actor),
			credentialsBinding: credentialsBinding(creds),
			decisionId: 'd-1',
			...overrides,
		};
	}

	it('checks command -> input -> actor -> credentials in strict order and ignores other evidence', async () => {
		const mw = createApprovalMiddleware({
			secret: SECRET,
			commands: [
				{ name: 'memory-erase', approval: 'required' },
				{ name: 'memory-read', approval: 'not-required' },
			],
		});
		const baseCtx: CommandContext = { actor, credentials: creds, interface: 'mcp' };
		const next = async () => success({ ok: true });

		// First obtain a real approval token to prove relay evidence ignores it (rule 2)
		const held = await mw('memory-erase', { id: '42' }, { actor, credentials: creds }, next);
		const validToken = (held.error?.details as { approvalToken?: string } | undefined)
			?.approvalToken;
		expect(typeof validToken).toBe('string');

		// 1. command-mismatch beats input/actor/credentials mismatches
		const r1 = await mw(
			'memory-erase',
			{ id: '42' },
			bindRelayEvidence(
				{ ...baseCtx, approval: validToken },
				makeEvidence({ command: 'other', inputDigest: 'x', actor: 'x', credentialsBinding: 'x' })
			),
			next
		);
		expect(r1.error?.details?.reason).toBe('command-mismatch');

		// 2. input-mismatch beats actor/credentials mismatches
		const r2 = await mw(
			'memory-erase',
			{ id: '42' },
			bindRelayEvidence(
				{ ...baseCtx, approval: validToken },
				makeEvidence({ inputDigest: 'x', actor: 'x', credentialsBinding: 'x' })
			),
			next
		);
		expect(r2.error?.details?.reason).toBe('input-mismatch');

		// 3. actor-mismatch beats credentials mismatch
		const r3 = await mw(
			'memory-erase',
			{ id: '42' },
			bindRelayEvidence(baseCtx, makeEvidence({ actor: 'null', credentialsBinding: 'x' })),
			next
		);
		expect(r3.error?.details?.reason).toBe('actor-mismatch');

		// 4. credentials-mismatch (including incomplete credentials on call)
		const r4 = await mw(
			'memory-erase',
			{ id: '42' },
			bindRelayEvidence(baseCtx, makeEvidence({ credentialsBinding: 'null' })),
			next
		);
		expect(r4.error?.details?.reason).toBe('credentials-mismatch');

		const r4b = await mw(
			'memory-erase',
			{ id: '42' },
			bindRelayEvidence(
				{ actor, credentials: { issuer: '', subject: 'u', clientId: 'c' }, interface: 'mcp' },
				makeEvidence()
			),
			next
		);
		expect(r4b.error?.details?.reason).toBe('credentials-mismatch');

		// 5. Empty decisionId is refused
		const rEmpty = await mw(
			'memory-erase',
			{ id: '42' },
			bindRelayEvidence(baseCtx, makeEvidence({ decisionId: '' })),
			next
		);
		expect(rEmpty.error?.details?.reason).toBe('already-used');

		// 6. Ungated command ignores relay evidence without spending it
		const ungated = await mw(
			'memory-read',
			{ id: '42' },
			bindRelayEvidence(baseCtx, makeEvidence({ command: 'memory-erase' })),
			next
		);
		expect(ungated.success).toBe(true);

		// 7. Valid relay evidence runs once and is never serialized or printed (even with showHidden)
		const ctxWithEv = bindRelayEvidence(baseCtx, makeEvidence());
		expect(JSON.stringify(ctxWithEv)).not.toContain('d-1');
		expect(inspect(ctxWithEv)).not.toContain('d-1');
		expect(inspect(ctxWithEv, { showHidden: true })).not.toContain('d-1');
		expect(inspect(ctxWithEv, { showHidden: true })).not.toContain('relayEvidence');
		expect(Object.getOwnPropertySymbols(ctxWithEv)).toEqual([]);
		const ok = await mw('memory-erase', { id: '42' }, ctxWithEv, next);
		expect(ok.success).toBe(true);
		const dup = await mw(
			'memory-erase',
			{ id: '42' },
			bindRelayEvidence(baseCtx, makeEvidence()),
			next
		);
		expect(dup.error?.details?.reason).toBe('already-used');

		// 8. Split-copy WeakMap sharing honors valid non-writable installation and ignores tampered holders
		const cleanHolder = {};
		const mapA = installRelayEvidenceRecords(cleanHolder);
		const mapB = installRelayEvidenceRecords(cleanHolder);
		expect(mapB).toBe(mapA);
		const tamperedHolder = { [Symbol.for('dev.afd/relay-evidence')]: new WeakMap() };
		expect(installRelayEvidenceRecords(tamperedHolder)).not.toBe(
			tamperedHolder[Symbol.for('dev.afd/relay-evidence')]
		);

		// 9. Marked approver with incomplete credentials still checks relay evidence in spec order
		//    and omits approvalToken on failure
		const approverCtx = bindRelayEvidence(
			bindApprover(
				{ actor, credentials: { issuer: '', subject: 'u', clientId: 'c' }, interface: 'mcp' },
				{ evidence: validToken }
			),
			makeEvidence({ command: 'other-command' })
		);
		const approverMismatch = await mw('memory-erase', { id: '42' }, approverCtx, next);
		expect(approverMismatch.success).toBe(false);
		expect(approverMismatch.error?.code).toBe(ErrorCodes.APPROVAL_REQUIRED);
		expect(approverMismatch.error?.details?.reason).toBe('command-mismatch');
		expect(approverMismatch.error?.details?.approvalToken).toBeUndefined();
	});
});

describe('HumanRelay with MCP authorization, scopes, hidden commands and M8', () => {
	const byToken: TokenVerifier = {
		async verify(token) {
			const [issuer, subject, clientId] = token.split('.');
			if (issuer === undefined || subject === undefined || clientId === undefined) {
				return { ok: false, rule: 'unknown-issuer' };
			}
			const credentials: Credentials = {
				issuer: issuer === '-' ? '' : `https://${issuer}.example.com`,
				subject,
				clientId,
				scopes: [],
				resource: RESOURCE,
				issuedAt: 1_700_000_000,
				expiresAt: 4_000_000_000,
			};
			return { ok: true, credentials };
		},
	};

	it('passes verified credentials to HumanRelay and refuses incomplete credentials with -32603', async () => {
		const { url, relay, runs } = await createHarness({
			extraOptions: {
				auth: {
					resource: RESOURCE,
					authorizationServers: ['https://auth.example.com'],
					verifier: byToken,
				},
			},
		});
		expectUrlElicitation(
			(
				await postMcp(url, makeCall('memory-erase', { id: '42' }), {
					authorization: 'Bearer auth.user-1.todo-agent',
				})
			).json
		);
		const seen = relay.lastCall();
		expect(seen.credentials?.subject).toBe('user-1');
		expect(seen.credentials?.clientId).toBe('todo-agent');
		expect(seen.principalBinding()).toBe(
			'{"actor":{"id":"todo-agent","kind":"agent","onBehalfOf":"user-1"},"credentials":{"clientId":"todo-agent","issuer":"https://auth.example.com","subject":"user-1"}}'
		);

		relay.answer({ kind: 'approved', decisionId: 'd-auth' });
		const ran = commandResult(
			(
				await postMcp(
					url,
					makeCall('memory-erase', { id: '42' }, urlCaps(), retryExtra('accept', 'state-1')),
					{ authorization: 'Bearer auth.user-1.todo-agent' }
				)
			).json
		);
		expect(ran.success).toBe(true);
		expect(runs.erase).toBe(1);

		// Incomplete credentials via createContext fail closed with -32603 before relay is called
		const bad = await createHarness({
			extraOptions: {
				createContext: () => ({
					credentials: { issuer: '', subject: 'u', clientId: 'c' },
				}),
			},
		});
		bad.relay.answer({ kind: 'approved', decisionId: 'd-1' });
		for (const extra of [{}, retryExtra('accept', 's')]) {
			const { json } = await postMcp(
				bad.url,
				makeCall('memory-erase', { id: '42' }, urlCaps(), extra)
			);
			expect((json.error as { code: number; message: string }).code).toBe(-32603);
			expect((json.error as { message: string }).message).toBe('Internal error');
		}
		expect(bad.relay.begins).toBe(0);
		expect(bad.relay.resumes).toBe(0);
	});

	it('re-checks ScopeResolver on validated input before calling relay and hides unknown commands', async () => {
		const resolver: ScopeResolver = {
			resolve(command, input) {
				if (command === 'memory-erase' && (input as { mode?: string }).mode === 'soft') {
					return { missing: ['memory:soft'] };
				}
				return 'allowed';
			},
			visible(command) {
				return command !== 'memory-show';
			},
		};
		const { url, relay, runs } = await createHarness({
			extraOptions: {
				auth: {
					resource: RESOURCE,
					authorizationServers: ['https://auth.example.com'],
					verifier: byToken,
					resolver,
					filterToolsByScope: true,
				},
			},
		});
		const authHeaders = { authorization: 'Bearer auth.user-1.todo-agent' };

		// Omitted mode defaults to 'soft', which fails ScopeResolver after validation and before relay
		for (const extra of [{}, retryExtra('accept', 'state-1')]) {
			relay.answer({ kind: 'approved', decisionId: 'd-1' });
			const refused = commandResult(
				(await postMcp(url, makeCall('memory-erase', { id: '42' }, urlCaps(), extra), authHeaders))
					.json
			);
			const err = refused.error as { code: string; details: { scopes: string[] } };
			expect(err.code).toBe(ErrorCodes.INSUFFICIENT_SCOPE);
			expect(err.details.scopes).toEqual(['memory:soft']);
		}
		expect(relay.begins).toBe(0);
		expect(relay.resumes).toBe(0);

		// Hard mode passes ScopeResolver and reaches relay
		expectUrlElicitation(
			(await postMcp(url, makeCall('memory-erase', { id: '42', mode: 'hard' }), authHeaders)).json
		);
		expect(relay.begins).toBe(1);

		// Hidden host-verified command (memory-show) answers COMMAND_NOT_FOUND, never CONFIRMATION_REQUIRED
		const hidden = commandResult(
			(await postMcp(url, makeCall('memory-show', { id: '42' }), authHeaders)).json
		);
		expect((hidden.error as { code: string }).code).toBe('COMMAND_NOT_FOUND');

		// Hidden host-verified command in afd-batch does not fail the batch as host-verified
		const batchWithHidden = commandResult(
			(
				await postMcp(
					url,
					makeCall('afd-batch', {
						commands: [
							{ command: 'todo-list', input: {} },
							{ command: 'memory-show', input: { id: '42' } },
						],
					}),
					authHeaders
				)
			).json
		);
		expect(runs.list).toBe(1);
		const results = batchWithHidden.results as Array<{
			result: { success: boolean; error?: { code: string } };
		}>;
		expect(results[0]?.result.success).toBe(true);
		expect(results[1]?.result.error?.code).toBe('COMMAND_NOT_FOUND');
	});

	it('guards non-approval host-verified commands against input mutation and retry middleware', async () => {
		// 1. Middleware mutating validated input after HumanRelay confirmation fails closed
		const mutateInput: CommandMiddleware = async (_name, input, _ctx, next) => {
			(input as { id: string }).id = 'tampered';
			return next();
		};
		const mutated = await createHarness({
			extraOptions: { middleware: [mutateInput] },
		});
		mutated.relay.answer({ kind: 'approved', decisionId: 'd-mut' });
		const mutRes = commandResult(
			(
				await postMcp(
					mutated.url,
					makeCall('memory-show', { id: '42' }, urlCaps(), retryExtra('accept', 's'))
				)
			).json
		);
		expect(mutRes.success).toBe(false);
		expect((mutRes.error as { code: string }).code).toBe(ErrorCodes.CONFIRMATION_REQUIRED);
		expect((mutRes.error as { details?: { reason?: string } }).details?.reason).toBe(
			'admission-mismatch'
		);
		// The operator fixes the middleware order.
		expect((mutRes.error as { recovery?: unknown }).recovery).toEqual({ kind: 'external' });
		expect(mutated.runs.show).toBe(0);

		// 2. Retry middleware cannot re-invoke a non-approval host-verified handler under one
		//    decision, even when the handler makes a nested server.execute(..., context) call first
		let flakyCalls = 0;
		let nestedCalls = 0;
		const nestedHelper = defineCommand({
			name: 'memory-helper',
			description: 'Ungated helper command',
			expose: { mcp: true },
			input: z.object({}),
			handler: async () => {
				nestedCalls += 1;
				return success({ ok: true });
			},
		});
		let retryServerRef: ReturnType<typeof createMcpServer> | undefined;
		const flakyShow = defineCommand({
			name: 'memory-flaky',
			description: 'Host-verified without approval that returns a retryable failure once',
			category: 'memory',
			confirmationMode: 'host-verified',
			expose: { mcp: true },
			input: z.object({ id: z.string() }),
			handler: async (_input, context) => {
				flakyCalls += 1;
				if (!retryServerRef) throw new Error('retryServerRef not initialized');
				const helperRes = await retryServerRef.execute('memory-helper', {}, context);
				expect(helperRes.success).toBe(true);
				return failure({
					code: 'TRANSIENT_ERROR',
					message: 'temporary failure',
					suggestion: 'retry',
					retryable: true,
				});
			},
		});
		const relay = new FakeRelay();
		relay.answer({ kind: 'approved', decisionId: 'd-retry' });
		const retryOptions: McpHandlerOptions = {
			name: 'retry-test',
			version: '1.0.0',
			host: '127.0.0.1',
			commands: [flakyShow, nestedHelper],
			middleware: [createRetryMiddleware({ maxRetries: 2, retryDelay: 1 })],
			humanRelay: relay,
		};
		retryServerRef = createMcpServer({ ...retryOptions, transport: 'http', port: 0 });
		const handler = createMcpHandler(retryOptions);
		const httpServer = createServer(handler);
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
		cleanups.push(async () => {
			handler.dispose();
			httpServer.closeAllConnections();
			await new Promise<void>((resolve) => httpServer.close(() => resolve()));
		});
		const url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`;
		const retried = commandResult(
			(
				await postMcp(
					url,
					makeCall('memory-flaky', { id: '42' }, urlCaps(), retryExtra('accept', 's'))
				)
			).json
		);
		expect(flakyCalls).toBe(1);
		expect(nestedCalls).toBe(1);
		expect(retried.success).toBe(false);
		expect((retried.error as { code: string }).code).toBe(ErrorCodes.CONFIRMATION_REQUIRED);
		expect((retried.error as { details?: { reason?: string } }).details?.reason).toBe(
			'admission-mismatch'
		);
	});

	it('requires shared nonceStore under instances: multiple with humanRelay even for within-ttl', () => {
		const cmd = defineCommand({
			name: 'memory-erase',
			description: 'Erase',
			approval: 'required',
			confirmationMode: 'host-verified',
			expose: { mcp: true },
			input: z.object({ id: z.string() }),
			handler: async () => success({}),
		});
		const relay = new FakeRelay();
		expect(() =>
			createMcpHandler({
				name: 'multi-within-ttl',
				version: '1.0.0',
				commands: [cmd],
				instances: 'multiple',
				humanRelay: relay,
				middleware: [createApprovalMiddleware({ secret: SECRET, replay: 'within-ttl' })],
			})
		).toThrow(/nonceStore/);

		const sharedStore: ApprovalNonceStore = { consume: () => true };
		const ok = createMcpHandler({
			name: 'multi-within-ttl-ok',
			version: '1.0.0',
			commands: [cmd],
			instances: 'multiple',
			humanRelay: relay,
			middleware: [
				createApprovalMiddleware({
					secret: SECRET,
					replay: 'within-ttl',
					nonceStore: sharedStore,
				}),
			],
		});
		ok.dispose();
	});

	it('fails closed without approval middleware, validates contextFields before relay, and refuses 2025 stdio', async () => {
		// 1. Host-verified + approval: required without createApprovalMiddleware -> APPROVAL_UNAVAILABLE
		const noMw = await createHarness({ extraOptions: { middleware: [] } });
		noMw.relay.answer({ kind: 'approved', decisionId: 'd-nomw' });
		const noMwRes = commandResult(
			(
				await postMcp(
					noMw.url,
					makeCall('memory-erase', { id: '42' }, urlCaps(), retryExtra('accept', 's'))
				)
			).json
		);
		expect(noMwRes.success).toBe(false);
		expect((noMwRes.error as { code: string }).code).toBe('APPROVAL_UNAVAILABLE');
		expect(noMw.runs.erase).toBe(0);

		// 2. Declared required contextFields fail fast before relay.begin, and coerced values reach call.context
		const seenContext: Array<Record<string, unknown>> = [];
		const ctxRelay: HumanRelay = {
			begin(call) {
				seenContext.push({ tenant: call.context.tenant });
				return { ok: true, prompt: { url: PERSON_URL, message: 'Open', state: 's-ctx' } };
			},
			resume() {
				return { kind: 'declined' };
			},
		};
		const withFields = await createHarness({
			extraOptions: {
				humanRelay: ctxRelay,
				contextFields: [
					{
						name: 'tenant',
						meta: 'dev.example/tenant',
						schema: z.string().trim().min(1),
						required: true,
					},
				],
			},
		});
		const missingField = commandResult(
			(await postMcp(withFields.url, makeCall('memory-erase', { id: '42' }))).json
		);
		expect((missingField.error as { code: string }).code).toBe(ErrorCodes.VALIDATION_ERROR);
		expect(seenContext).toEqual([]);

		expectUrlElicitation(
			(
				await postMcp(
					withFields.url,
					makeCall('memory-erase', { id: '42' }, urlCaps(), {
						_meta: { 'dev.example/tenant': '  acme  ' },
					})
				)
			).json
		);
		expect(seenContext).toEqual([{ tenant: 'acme' }]);

		// A field schema that throws is reported to onError, and its text stays on the server (#2141).
		const relayErrors: Error[] = [];
		const throwingFields = await createHarness({
			extraOptions: {
				humanRelay: ctxRelay,
				// An async hook that rejects must not escape as an unhandled rejection.
				onError: async (error: Error) => {
					relayErrors.push(error);
					throw new Error('async hook failed');
				},
				contextFields: [
					{
						name: 'tenant',
						meta: 'dev.example/tenant',
						schema: z.string().transform(() => {
							throw new Error('tenant-sentinel');
						}),
					},
				],
			},
		});
		const thrown = commandResult(
			(
				await postMcp(
					throwingFields.url,
					makeCall('memory-erase', { id: '42' }, urlCaps(), {
						_meta: { 'dev.example/tenant': 'acme' },
					})
				)
			).json
		);
		expect((thrown.error as { code: string }).code).toBe(ErrorCodes.VALIDATION_ERROR);
		expect(JSON.stringify(thrown)).not.toContain('tenant-sentinel');
		expect(relayErrors.map((error) => error.message)).toEqual(['tenant-sentinel']);
		expect(seenContext).toEqual([{ tenant: 'acme' }]);

		// 3. Approver client cannot bypass HumanRelay via _meta["dev.afd/approval"]
		const withApprover = await createHarness({
			extraOptions: { approver: () => true },
		});
		expectUrlElicitation(
			(
				await postMcp(
					withApprover.url,
					makeCall('memory-erase', { id: '42' }, urlCaps(), {
						_meta: { 'dev.afd/approval': 'afdap1.fake.token' },
					})
				)
			).json
		);
		expect(withApprover.runs.erase).toBe(0);

		// 4. Legacy 2025-era stdio connection refuses host-verified command with CONFIRMATION_REQUIRED
		const stdioRelay = new FakeRelay();
		const stdioCmd = defineCommand({
			name: 'memory-erase',
			description: 'Erase',
			confirmationMode: 'host-verified',
			expose: { mcp: true },
			input: z.object({ id: z.string() }),
			handler: async () => success({}),
		});
		const stdioCommands = [stdioCmd];
		const stdioEngine = createExecutionEngine({
			commandMap: new Map([[stdioCmd.name, stdioCmd]]),
			middleware: [],
			devMode: false,
		});
		const stdioHumanRelay = createHumanRelayGate({
			relay: stdioRelay,
			commands: stdioCommands,
			actor: { kind: 'agent' },
			devMode: false,
		});
		const stdioRouter = createToolRouter({
			executeCommand: stdioEngine.executeCommand,
			executeBatch: stdioEngine.executeBatch,
			executePipeline: stdioEngine.executePipeline,
			commands: stdioCommands,
			toolStrategy: 'individual',
			devMode: false,
			allCommands: stdioCommands,
			exposedCommandNames: new Set([stdioCmd.name]),
			humanRelay: stdioHumanRelay,
		});
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		const handle = serveModernStdio(
			{
				name: 'stdio-relay-test',
				version: '1.0.0',
				instructions: 'test',
				toolStrategy: 'individual',
				devMode: false,
				getToolsList: () => getToolsList(stdioCommands, 'individual'),
				routeToolCall: stdioRouter,
			},
			undefined,
			serverTransport
		);
		const client = new Client({ name: 'legacy-stdio-client', version: '1.0.0' });
		await client.connect(clientTransport);
		cleanups.push(async () => {
			await client.close();
			await handle.close();
		});
		expect(client.getProtocolEra()).toBe('legacy');
		const stdioRes = await client.callTool({
			name: 'afd-call',
			arguments: { command: 'memory-erase', input: { id: '42' } },
		});
		const stdioPayload = JSON.parse(
			(stdioRes.content as Array<{ text: string }>)[0]?.text ?? '{}'
		) as { success: boolean; error?: { code: string } };
		expect(stdioPayload.success).toBe(false);
		expect(stdioPayload.error?.code).toBe(ErrorCodes.CONFIRMATION_REQUIRED);
		expect(stdioRelay.begins).toBe(0);
	});
});
