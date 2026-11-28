/**
 * The copilot's kernel half (phase 5 specification, 3.2 to 3.5 and 6.1's fail-closed rule): P5-A2's rows that the
 * kernel holds, with a fake runtime that writes on the runtime's side of each port, and an in-process TanStack
 * runtime over the test provider end to end.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { type CommandResult, type JournalEntry, MemoryJournalSink } from '@lushly-dev/afd-core';
import { createInProcessLauncher } from '@lushly-dev/loam-copilot';
import { createTestProvider, type ModelScriptV1 } from '@lushly-dev/loam-copilot/test-provider';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKernel, createKernelParts } from '../kernel.js';
import { createScopedWorkspace } from '../scope/fixtures.js';
import { createFixedEnvironment } from '../testing.js';
import { documentsDeployment, documentsPorts } from '../testing-documents.js';
import type { LoamKernel } from '../types.js';
import { COPILOT_TURN_TABLE } from './commands.js';
import {
	type CopilotHostV1,
	checkPortMessage,
	createCopilotHost,
	MODEL_PORT_LIMITS,
	type ModelTransportV1,
	type PanelEventV1,
	PORT_BUDGETS,
	type PortLike,
	panelEvent,
	type RuntimePortsV1,
	UsageReader,
} from './host.js';
import type { CopilotProviderV1, CopilotTurnV1 } from './types.js';

const TEST: CopilotProviderV1 = { id: 'test', kind: 'test', model: 'scripted' };

/** A launcher that hands the runtime's ports to the test, which plays the runtime by hand. */
function fakeLauncher() {
	const launched: RuntimePortsV1[] = [];
	return {
		launched,
		resets: 0,
		launch(_kind: string, ports: RuntimePortsV1) {
			launched.push(ports);
		},
		reset() {
			this.resets += 1;
		},
	};
}

/** The runtime's side of a port: post, and await the next answer. */
function side(port: PortLike) {
	const heard: unknown[] = [];
	let wake: (() => void) | undefined;
	port.onmessage = ({ data }) => {
		heard.push(data);
		wake?.();
	};
	return {
		heard,
		post: (message: unknown) => port.postMessage(message),
		async next(match: (data: unknown) => boolean = () => true): Promise<unknown> {
			for (;;) {
				const found = heard.findIndex(match);
				if (found >= 0) return heard.splice(found, 1)[0];
				await new Promise<void>((resolve) => {
					wake = resolve;
					setTimeout(resolve, 20);
				});
			}
		},
	};
}

interface Setup {
	kernel: LoamKernel;
	provider: ReturnType<typeof createTestProvider>;
	journal: MemoryJournalSink;
	host: CopilotHostV1;
	providers: CopilotProviderV1[];
}

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const dispose of disposers.splice(0)) await dispose();
});

async function setup(
	options: {
		documents?: true;
		launcher?: ReturnType<typeof fakeLauncher> | ReturnType<typeof createInProcessLauncher>;
		scripts?: Record<string, ModelScriptV1>;
		providers?: CopilotProviderV1[];
		runner?: false;
		/** In place of the test provider: the trusted host's transport, as the desktop's would answer. */
		transport?: ModelTransportV1;
	} = {}
): Promise<Setup> {
	const journal = new MemoryJournalSink();
	const provider = createTestProvider({ scripts: options.scripts ?? {} });
	const host = createCopilotHost({
		launcher: options.launcher ?? createInProcessLauncher(),
		transport: options.transport ?? {
			send: (_provider, body, signal) => provider.send(body, signal),
		},
	});
	const providers = options.providers ?? [TEST];
	const kernel = await createKernel({
		store: new MemoryAdapter(),
		storeKind: 'memory',
		journal,
		auth: new MockAuthAdapter(),
		environment: createFixedEnvironment(),
		host: 'test',
		...(options.documents ? { deployment: documentsDeployment(), ports: documentsPorts() } : {}),
		copilot: {
			providers,
			...(options.runner === false ? {} : { runner: host }),
			takeRunId: (session) => host.takeRunId(session),
		},
	});
	disposers.push(async () => {
		host.reset();
		await kernel.dispose();
	});
	return { kernel, journal, host, providers, provider };
}

const data = <T>(result: CommandResult<unknown>): T => {
	expect(result.success, JSON.stringify(result.error)).toBe(true);
	return result.data as T;
};

async function startSession(kernel: LoamKernel): Promise<string> {
	return data<{ session: { id: string } }>(await kernel.call('copilot-session-start', {})).session
		.id;
}

async function entries(journal: MemoryJournalSink): Promise<JournalEntry[]> {
	return journal.read({});
}

/** Start a turn with the fake runtime and return the runtime's three port sides. */
async function fakeTurn(options: { scripts?: Record<string, ModelScriptV1> } = {}) {
	const launcher = fakeLauncher();
	const setupResult = await setup({ launcher, ...options });
	const session = await startSession(setupResult.kernel);
	const sent = data<{ turn: CopilotTurnV1 }>(
		await setupResult.kernel.call('copilot-message-send', { session, text: 'Hello', wait: false })
	);
	const ports = launcher.launched[0] as RuntimePortsV1;
	const agent = side(ports.agent);
	const model = side(ports.model);
	const panel = side(ports.panel);
	const run = (await panel.next((message) => (message as { key?: string }).key === 'run')) as {
		runId: string;
		threadId: string;
		history: unknown[];
		provider: CopilotProviderV1;
	};
	return { ...setupResult, launcher, session, turn: sent.turn, agent, model, panel, run };
}

describe('the copilot commands (3.5)', () => {
	it('starts a session in the active scope with the default provider', async () => {
		const { kernel } = await setup();
		const { session } = data<{ session: Record<string, unknown> }>(
			await kernel.call('copilot-session-start', { title: 'Plans' })
		);
		expect(session).toMatchObject({ title: 'Plans', provider: 'test', taint: [], scope: {} });
		expect(String(session.id)).toMatch(/^cps_[0-9a-f]{16}$/);
		expect(data(await kernel.call('copilot-provider-list', {}))).toEqual({
			providers: [{ id: 'test', kind: 'test', model: 'scripted', default: true }],
		});
	});

	it('runs a turn end to end over the frame-less runtime: "No script", done, usage from the stream', async () => {
		const { kernel, journal } = await setup();
		const session = await startSession(kernel);
		const { turn } = data<{ turn: CopilotTurnV1 }>(
			await kernel.call('copilot-message-send', { session, text: 'Hello there' })
		);
		expect(turn).toMatchObject({ seq: 1, state: 'done', reply: 'No script', calls: [] });
		expect(turn.usage.inputTokens).toBeGreaterThan(0);
		expect(turn.usage.outputTokens).toBeGreaterThan(0);
		const settle = (await entries(journal)).find(
			(entry) => entry.command === 'copilot-turn-settle'
		);
		expect(settle?.result.success).toBe(true);
		const got = data<{ turns: CopilotTurnV1[] }>(
			await kernel.call('copilot-session-get', { session })
		);
		expect(got.turns.map((item) => [item.seq, item.state])).toEqual([[1, 'done']]);
	});

	it('runs reads as the copilot in act, records each call, and asks before a mutation by default (6.1)', async () => {
		const { kernel, journal } = await setup({
			scripts: {
				reads: [
					{ tools: [{ name: 'shell-info-get', input: {} }] },
					{ tools: [{ name: 'project-create', input: { name: 'Payroll' } }] },
					{ text: 'Done.' },
				],
			},
		});
		const session = await startSession(kernel);
		const { turn } = data<{ turn: CopilotTurnV1 }>(
			await kernel.call('copilot-message-send', { session, text: 'script:reads' })
		);
		// D156's default asks before a change: the turn waits on the person (3.5).
		expect(turn.state).toBe('waiting');
		expect(
			turn.calls.map((call) => [call.command, call.mode, call.reason, call.outcome, call.code])
		).toEqual([
			['shell-info-get', 'act', 'policy', 'ok', undefined],
			['project-create', 'ask', 'policy', 'pending', 'CONFIRMATION_PENDING'],
		]);
		expect(turn.calls[1]?.notification).toMatch(/^ntf_/);
		expect(turn.calls[0]?.inputDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		const journaled = (await entries(journal)).filter(
			(entry) => entry.command === 'shell-info-get' || entry.command === 'project-create'
		);
		for (const entry of journaled) {
			expect(entry.actor).toMatchObject({ kind: 'agent', id: 'copilot' });
			expect(entry.context).toMatchObject({
				copilotSession: session,
				turn: 1,
				trace: { session, turn: 1 },
			});
		}
		expect(journaled.find((entry) => entry.command === 'project-create')?.result.success).toBe(
			false
		);
		expect(
			data<{ projects: unknown[] }>(await kernel.call('project-list', {})).projects
		).toHaveLength(0);
		// The tool result the model got is data in a result block (5.2).
		const health = data<{ totals: { acted: number; asked: number } }>(
			await kernel.call('approval-health-get', {})
		);
		// `acted` counts changes run without asking (the review's N4): the read is none.
		expect(health.totals).toMatchObject({ acted: 0, asked: 1 });
	});

	it("hands a person's own writes back with HUMAN_REQUIRED from their handlers, never asked (phase 4's 3.2, 6.1)", async () => {
		const { kernel, journal } = await setup({
			scripts: {
				writes: [
					{ tools: [{ name: 'autonomy-set', input: { level: 'workspace', mode: 'act' } }] },
					{ tools: [{ name: 'autonomy-set', input: { level: 'person', cap: 'act' } }] },
					{
						tools: [
							{
								name: 'setting-set',
								input: {
									section: 'loam.documents',
									key: 'trashDays',
									value: 3,
									level: 'workspace',
								},
							},
						],
					},
					{
						tools: [
							{
								name: 'setting-set',
								input: { section: 'loam.appearance', key: 'theme', value: 'dark', level: 'person' },
							},
						],
					},
					{ text: 'Done.' },
				],
			},
		});
		const session = await startSession(kernel);
		const { turn } = data<{ turn: CopilotTurnV1 }>(
			await kernel.call('copilot-message-send', { session, text: 'script:writes' })
		);
		expect(turn.calls.map((call) => [call.command, call.code])).toEqual([
			['autonomy-set', 'HUMAN_REQUIRED'],
			['autonomy-set', 'HUMAN_REQUIRED'],
			['setting-set', 'HUMAN_REQUIRED'],
			// A person-level write an agent may make for its person asks, by D156's default (6.1).
			['setting-set', 'CONFIRMATION_PENDING'],
		]);
		const handed = (await entries(journal)).filter((entry) => entry.command === 'autonomy-set');
		expect(handed.map((entry) => entry.result.error?.details)).toEqual([
			{
				route: '~/settings/loam.autonomy',
				section: 'loam.autonomy',
				key: 'workspace/-/*/*',
				level: 'workspace',
			},
			{
				route: '~/settings/loam.autonomy#cap',
				section: 'loam.autonomy',
				key: 'cap',
				level: 'person',
			},
		]);
		expect(data<{ rows: unknown[] }>(await kernel.call('autonomy-list', {})).rows).toEqual([]);
	});

	it('refuses a second message while a turn runs, a person-only provider check, and another session', async () => {
		const { kernel, providers } = await setup({ scripts: { hang: [{ hang: true }] } });
		const session = await startSession(kernel);
		const first = await kernel.call('copilot-message-send', {
			session,
			text: 'script:hang',
			wait: false,
		});
		expect(data<{ turn: CopilotTurnV1 }>(first).turn.state).toBe('running');
		const second = await kernel.call('copilot-message-send', { session, text: 'More' });
		expect(second.error).toMatchObject({ code: 'COPILOT_TURN_RUNNING', retryable: true });
		expect(second.error?.suggestion).toContain('copilot-turn-stop');
		const stopped = data<{ turn: CopilotTurnV1 }>(
			await kernel.call('copilot-turn-stop', { session, turn: 1 })
		);
		expect(stopped.turn).toMatchObject({ state: 'stopped', stoppedBy: 'person' });
		// A settled turn is returned as it is.
		expect(
			data<{ turn: CopilotTurnV1 }>(await kernel.call('copilot-turn-stop', { session, turn: 1 }))
				.turn.state
		).toBe('stopped');
		expect((await kernel.call('copilot-turn-stop', { session, turn: 9 })).error?.code).toBe(
			'COPILOT_SESSION_NOT_FOUND'
		);
		const attach = await kernel.call('copilot-message-send', {
			session,
			text: 'Hi',
			attach: [{ uri: 'loam://x' }],
		});
		expect(attach.error?.code).toBe('VALIDATION_ERROR');
		// The session's provider removed from the deployment.
		providers.splice(0, 1, { id: 'other', kind: 'test', model: 'scripted' });
		const unknown = await kernel.call('copilot-message-send', { session, text: 'Hi' });
		expect(unknown.error).toMatchObject({ code: 'COPILOT_PROVIDER_UNKNOWN' });
		expect(unknown.error?.suggestion).toContain('Start a new session');
		for (const id of ['cps_0000000000000000', 'nope']) {
			expect((await kernel.call('copilot-session-get', { session: id })).error?.code).toBe(
				'COPILOT_SESSION_NOT_FOUND'
			);
		}
	});

	it('says no model is configured when there is none, or no runner (4.1)', async () => {
		for (const options of [{ providers: [] }, { runner: false as const }]) {
			const { kernel } = await setup(options);
			const session = await startSession(kernel);
			const sent = await kernel.call('copilot-message-send', { session, text: 'Hello' });
			expect(sent.error?.code).toBe('COPILOT_PROVIDER_MISSING');
			expect(sent.error?.suggestion).toContain('loam.deployment.toml');
		}
		// Desktop host suggests Loam -> Copilot Models... while non-desktop stays unchanged (amendment 8.3).
		const desktopKernel = await createKernel({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'desktop',
			copilot: { providers: [] },
		});
		await desktopKernel.startApps();
		const session = await startSession(desktopKernel);
		const sent = await desktopKernel.call('copilot-message-send', { session, text: 'Hello' });
		expect(sent.error?.code).toBe('COPILOT_PROVIDER_MISSING');
		expect(sent.error?.suggestion).toBe(
			'Open Loam → Copilot Models… (or click Configure model…) to add a model provider.'
		);
		await desktopKernel.dispose();
	});

	it('a turn failed by the trusted transport reports the transport’s code, not the runtime’s reading of it (step 2)', async () => {
		const { kernel } = await setup({
			transport: {
				async send() {
					throw Object.assign(new Error('COPILOT_KEY_MISSING'), { code: 'COPILOT_KEY_MISSING' });
				},
			},
		});
		const session = await startSession(kernel);
		const sent = data<{ turn: CopilotTurnV1 }>(
			await kernel.call('copilot-message-send', { session, text: 'Hello' })
		);
		expect(sent.turn).toMatchObject({ state: 'failed', failure: { code: 'COPILOT_KEY_MISSING' } });
	});

	it('a stream that reports no usage is counted from its bytes, so the turn’s token limits still bind (step 2)', async () => {
		const provider = createTestProvider({ scripts: {} });
		const { kernel } = await setup({
			transport: {
				async send(_provider, body, signal) {
					const answer = await provider.send(body, signal);
					const decoder = new TextDecoder();
					const encoder = new TextEncoder();
					return {
						status: answer.status,
						// The provider's own stream, every usage record removed.
						body: (async function* () {
							for await (const chunk of answer.body)
								yield encoder.encode(
									decoder.decode(chunk).replace(/"usage":\{[^}]*\}/g, '"usage":{}')
								);
						})(),
					};
				},
			},
		});
		const session = await startSession(kernel);
		const sent = data<{ turn: CopilotTurnV1 }>(
			await kernel.call('copilot-message-send', { session, text: 'Hello' })
		);
		expect(sent.turn.state).toBe('done');
		expect(sent.turn.usage.inputTokens).toBeGreaterThan(0);
		expect(sent.turn.usage.outputTokens).toBeGreaterThan(0);
	});

	it('a turn whose record was being written when the person changed ends unlaunched (step 2)', async () => {
		const launcher = fakeLauncher();
		const { kernel } = await setup({ launcher });
		const signIn = (email: string) =>
			kernel.call('auth-sign-in', { method: 'credentials', email, password: 'x' });
		expect((await signIn('bea@example.com')).success).toBe(true);
		const session = await startSession(kernel);
		// The turn's record is held mid-write until the person has signed out.
		const create = MemoryAdapter.prototype.create;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let held = false;
		const spy = vi.spyOn(MemoryAdapter.prototype, 'create').mockImplementation(async function (
			this: MemoryAdapter,
			table,
			record
		) {
			if (table === COPILOT_TURN_TABLE && !held) {
				held = true;
				await gate;
			}
			return create.call(this, table, record) as never;
		});
		try {
			const sending = kernel.call('copilot-message-send', { session, text: 'Hello', wait: false });
			await vi.waitFor(() => expect(held).toBe(true));
			expect((await kernel.call('auth-sign-out', {})).success).toBe(true);
			release();
			await sending;
		} finally {
			release();
			spy.mockRestore();
		}
		// Nothing was launched for a person who had gone.
		expect(launcher.launched).toEqual([]);
		await signIn('bea@example.com');
		const got = data<{ turns: CopilotTurnV1[] }>(
			await kernel.call('copilot-session-get', { session })
		);
		expect(got.turns[0]).toMatchObject({ state: 'stopped', stoppedBy: 'session-changed' });
	});

	it('in a `local` deployment, a sign-out or a sign-in stops every turn and removes the runtimes (step 2)', async () => {
		for (const change of ['auth-sign-out', 'auth-sign-in'] as const) {
			const launcher = fakeLauncher();
			const { kernel } = await setup({ launcher });
			expect(
				(
					await kernel.call('auth-sign-in', {
						method: 'credentials',
						email: 'bea@example.com',
						password: 'x',
					})
				).success
			).toBe(true);
			const session = await startSession(kernel);
			data(await kernel.call('copilot-message-send', { session, text: 'Hello', wait: false }));
			expect(launcher.launched).toHaveLength(1);
			const changed = await kernel.call(
				change,
				change === 'auth-sign-in'
					? { method: 'credentials', email: 'olu@example.com', password: 'x' }
					: {}
			);
			expect(changed.success, change).toBe(true);
			await vi.waitFor(() => expect(launcher.resets, change).toBe(1));
			// The session is Bea's: back as Bea, its turn ended as the change of person.
			await kernel.call('auth-sign-in', {
				method: 'credentials',
				email: 'bea@example.com',
				password: 'x',
			});
			const got = data<{ turns: CopilotTurnV1[] }>(
				await kernel.call('copilot-session-get', { session })
			);
			expect(got.turns[0], change).toMatchObject({
				state: 'stopped',
				stoppedBy: 'session-changed',
			});
		}
	});

	it('stops the turn and removes the runtimes on a real change of person, and the next person reaches nothing (3.2)', async () => {
		const BEA = 'mock-user-bea@example.com';
		const OLU = 'mock-user-olu@example.com';
		const launcher = fakeLauncher();
		const provider = createTestProvider({ scripts: {} });
		const host = createCopilotHost({
			launcher,
			transport: { send: (_provider, body, signal) => provider.send(body, signal) },
		});
		const made = await createScopedWorkspace({
			identity: {
				mode: 'provider',
				organization: 'acme',
				path: 'api/auth',
				methods: ['passkey', 'password'],
			},
			membership: {
				mode: 'provider',
				members: new Map([
					[BEA, 'member'],
					[OLU, 'owner'],
				]),
				digest: 'd1',
			},
			empty: true,
			copilot: { providers: [TEST], runner: host, takeRunId: (id) => host.takeRunId(id) },
		});
		disposers.push(() => made.kernel.dispose());
		const { kernel } = made;
		const signIn = (email: string) =>
			kernel.call('auth-sign-in', { method: 'credentials', email, password: 'x' });
		expect((await signIn('bea@example.com')).success).toBe(true);
		const session = data<{ session: { id: string } }>(
			await kernel.call('copilot-session-start', {})
		).session.id;
		data(await kernel.call('copilot-message-send', { session, text: 'Hello', wait: false }));
		const agent = side((launcher.launched[0] as RuntimePortsV1).agent);
		// Another tab signs Olu in: no command here made the change.
		made.auth._setUser({ id: OLU, email: 'olu@example.com', name: 'olu' });
		await vi.waitFor(async () => expect(launcher.resets).toBe(1));
		// Bea's runtime, still holding its port, reaches nothing of Olu's: the port is closed, and nothing answers.
		agent.post({ id: 1, key: 'call', name: 'project-list', input: {} });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(agent.heard).toEqual([]);
		// Bea's turn ended as the change of person, and her session is not Olu's to read.
		expect((await kernel.call('copilot-session-get', { session })).error?.code).toBe(
			'COPILOT_SESSION_NOT_FOUND'
		);
		await signIn('bea@example.com');
		const got = data<{ turns: CopilotTurnV1[] }>(
			await kernel.call('copilot-session-get', { session })
		);
		expect(got.turns[0]).toMatchObject({ state: 'stopped', stoppedBy: 'session-changed' });
		const projectCalls = (await entries(made.journal)).filter(
			(entry) => entry.command === 'project-list' && entry.actor?.id === 'copilot'
		);
		expect(projectCalls).toEqual([]);
	});

	it('lists sessions newest first, with paging, and a session’s turns from a seq', async () => {
		const { kernel } = await setup();
		const ids: string[] = [];
		for (let i = 0; i < 3; i++) ids.push(await startSession(kernel));
		const page = data<{ sessions: Array<{ id: string }>; next?: string }>(
			await kernel.call('copilot-session-list', { limit: 2 })
		);
		expect(page.sessions).toHaveLength(2);
		expect(page.next).toBeDefined();
		const rest = data<{ sessions: Array<{ id: string }>; next?: string }>(
			await kernel.call('copilot-session-list', { limit: 2, before: page.next })
		);
		expect([...page.sessions, ...rest.sessions].map((item) => item.id).sort()).toEqual(
			[...ids].sort()
		);
		expect(rest.next).toBeUndefined();
		// A cursor that names no session ends the list.
		expect(
			data<{ sessions: unknown[] }>(
				await kernel.call('copilot-session-list', { before: 'cps_ffffffffffffffff' })
			).sessions
		).toEqual([]);
		const session = ids[0] as string;
		await kernel.call('copilot-message-send', { session, text: 'One' });
		await kernel.call('copilot-message-send', { session, text: 'Two' });
		const got = data<{ turns: CopilotTurnV1[] }>(
			await kernel.call('copilot-session-get', { session, from: 2, limit: 1 })
		);
		expect(got.turns.map((turn) => turn.seq)).toEqual([2]);
	});
});

describe('who reaches the copilot (3.3, 3.5)', () => {
	it('answers HUMAN_REQUIRED to an agent for the human commands, and the queries are the palette’s alone', async () => {
		const { kernel } = await setup();
		const session = await startSession(kernel);
		for (const [name, input] of [
			['copilot-session-start', {}],
			['copilot-message-send', { session, text: 'Hi' }],
			['copilot-turn-stop', { session, turn: 1 }],
		] as const) {
			expect((await kernel.agent.call(name, input)).error?.code, name).toBe('HUMAN_REQUIRED');
		}
		for (const name of [
			'copilot-session-list',
			'copilot-session-get',
			'copilot-provider-list',
			'approval-health-get',
		]) {
			expect((await kernel.agent.call(name, { session })).error?.code, name).toBe(
				'COMMAND_NOT_EXPOSED'
			);
			expect(kernel.agent.listCommands().map((command) => command.name)).not.toContain(name);
			expect(kernel.listCommands().map((command) => command.name)).toContain(name);
		}
	});

	it('keeps `copilot` for the kernel: another caller naming it is AGENT_NAME_RESERVED', async () => {
		const { kernel } = await setup();
		const named = await kernel.agent.call('shell-info-get', {}, { agent: 'copilot' });
		expect(named.error?.code).toBe('AGENT_NAME_RESERVED');
	});

	it('never reads a caller’s own trace: only the kernel’s options for the port carry one (3.2)', async () => {
		const { kernel, journal } = await setup();
		const forged = { session: 'cps_0000000000000000', turn: 1, call: 'cpc_0001' };
		data(await kernel.agent.call('shell-info-get', {}, { trace: forged }));
		data(await kernel.call('shell-info-get', {}, { trace: forged }));
		const read = (await entries(journal)).filter((entry) => entry.command === 'shell-info-get');
		expect(read).toHaveLength(2);
		for (const entry of read) {
			expect(entry.context ?? {}).not.toHaveProperty('trace');
			expect(entry.context ?? {}).not.toHaveProperty('copilotSession');
			expect(entry.actor?.id).not.toBe('copilot');
		}
	});

	it('serves none of the copilot’s commands over MCP', async () => {
		const parts = await createKernelParts({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
		});
		disposers.push(() => parts.kernel.dispose());
		const served = parts.mcpOptions()?.commands.map((command) => command.name) ?? [];
		expect(
			served.filter((name) => name.startsWith('copilot-') || name === 'approval-health-get')
		).toEqual([]);
		expect(parts.mcpOptions()?.contextFields.map((field) => field.name)).toEqual(['scope']);
	});
});

describe('the agent port’s kernel half (3.2, P5-A2)', () => {
	it('refuses, and journals, a message with an actor, scope, _meta, trace or interface key', async () => {
		const { agent, journal } = await fakeTurn();
		for (const extra of ['actor', 'scope', '_meta', 'trace', 'interface', 'agent']) {
			agent.post({ id: 1, key: 'call', name: 'shell-info-get', input: {}, [extra]: 'x' });
			const answer = (await agent.next()) as { id: number; result: CommandResult };
			expect(answer.result.error?.code, extra).toBe('COPILOT_PORT_REFUSED');
		}
		agent.post({ id: 2, key: 'callAs', name: 'shell-info-get' });
		expect(((await agent.next()) as { result: CommandResult }).result.error?.code).toBe(
			'COPILOT_PORT_REFUSED'
		);
		const refusals = (await entries(journal)).filter(
			(entry) => entry.command === 'copilot-port-refuse'
		);
		expect(refusals).toHaveLength(7);
		expect(refusals[0]).toMatchObject({
			result: { success: false, error: { code: 'COPILOT_PORT_REFUSED' } },
			actor: { kind: 'agent', id: 'copilot' },
		});
		expect(JSON.stringify(refusals[0]?.input)).toContain('actor');
	});

	it('never reaches a confirmation, a human command or a palette path, and lists none of them', async () => {
		const { agent, journal } = await fakeTurn();
		const call = async (name: string, input: unknown = {}) => {
			agent.post({ id: 7, key: 'call', name, input });
			return ((await agent.next()) as { result: CommandResult }).result;
		};
		expect((await call('confirmation-get', { id: 'n1' })).error?.code).toBe('COPILOT_PORT_REFUSED');
		// #1869: CHROME_ONLY and internal commands are blocked at the agent port too, not just hidden from listCommands,
		// and each refusal is logged via `copilot-port-refuse`.
		const blockedCommands = [
			'palette-open',
			'palette-close',
			'editor-selection-set',
			'overlay-global-set',
			'app-call-refuse',
		];
		const beforeRefusals = (await entries(journal)).filter(
			(entry) => entry.command === 'copilot-port-refuse'
		).length;
		for (const blocked of blockedCommands) {
			expect((await call(blocked, {})).error?.code, blocked).toBe('COPILOT_PORT_REFUSED');
		}
		const addedRefusals = (await entries(journal))
			.filter((entry) => entry.command === 'copilot-port-refuse')
			.slice(beforeRefusals);
		expect(addedRefusals).toHaveLength(blockedCommands.length);
		for (const refusal of addedRefusals) {
			expect(refusal.input).toMatchObject({
				reason: 'Not a command the copilot calls',
				keys: ['name'],
			});
		}
		expect((await call('session-list', {})).error?.code).toBe('HUMAN_REQUIRED');
		expect((await call('copilot-message-send', { session: 'x', text: 'y' })).error?.code).toBe(
			'HUMAN_REQUIRED'
		);
		// Both are human commands (6.1): `notification-act` from phase 4's step 5, `palette-run` from its step 6.
		expect(
			(await call('notification-act', { notification: 'ntf_0000000000000000' })).error?.code
		).toBe('HUMAN_REQUIRED');
		expect((await call('palette-run', { command: 'shell-info-get' })).error?.code).toBe(
			'HUMAN_REQUIRED'
		);
		agent.post({ id: 8, key: 'confirmation', notification: 'n1' });
		expect(((await agent.next()) as { result: CommandResult }).result.error?.code).toBe(
			'COPILOT_PORT_REFUSED'
		);
		agent.post({ id: 9, key: 'listCommands' });
		const tools = ((await agent.next()) as { result: Array<{ name: string; inputSchema: object }> })
			.result;
		const names = tools.map((tool) => tool.name);
		expect(names).toContain('shell-info-get');
		expect(names).toContain('project-list');
		for (const hidden of [
			'persona-set',
			'notification-act',
			'palette-run',
			'copilot-message-send',
			'copilot-session-get',
			'copilot-port-refuse',
			'copilot-turn-settle',
			'app-call-refuse',
		])
			expect(names, hidden).not.toContain(hidden);
		expect(tools.length).toBeLessThanOrEqual(128);
		expect(tools.every((tool) => typeof tool.inputSchema === 'object')).toBe(true);
	});

	it('never reads another caller’s confirmation.input via notification-list (#1868)', async () => {
		const store = new MemoryAdapter();
		const launcher = fakeLauncher();
		const host = createCopilotHost({
			launcher,
			transport: {
				send: (_provider, body, signal) => createTestProvider({ scripts: {} }).send(body, signal),
			},
		});
		const kernel = await createKernel({
			store,
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			copilot: {
				providers: [TEST],
				runner: host,
				takeRunId: (session) => host.takeRunId(session),
			},
		});
		disposers.push(async () => {
			host.reset();
			await kernel.dispose();
		});

		const notificationId = 'ntf_0000000000000099';
		await store.create('notification', {
			id: notificationId,
			workspace: 'personal',
			person: 'local',
			source: 'agent:shell-agent',
			cbucket: 'agents:local',
			kind: 'confirmation',
			title: 'Confirm delete',
			tone: 'warning',
			scope: { workspace: 'personal' },
			createdAt: 1_700_000_000_001,
			confirmation: {
				command: 'doc-delete',
				caller: 'agent:shell-agent',
				input: { secret: 'do-not-leak-to-copilot' },
				header: 'Requested by shell-agent for you',
				prompt: 'Delete?',
				title: 'Delete',
				expiresAt: 1_900_000_000_000,
				state: 'pending',
			},
		} as never);

		const session = await startSession(kernel);
		data(await kernel.call('copilot-message-send', { session, text: 'Check inbox', wait: false }));
		const ports = launcher.launched[0] as RuntimePortsV1;
		const agent = side(ports.agent);
		const panel = side(ports.panel);
		await panel.next((message) => (message as { key?: string }).key === 'run');

		for (const input of [
			{ kind: 'confirmation', body: true },
			{ notification: notificationId, body: true },
		]) {
			agent.post({ id: 21, key: 'call', name: 'notification-list', input });
			const reply = (await agent.next()) as {
				result: CommandResult<{
					notifications: Array<{ id: string; confirmation?: Record<string, unknown> }>;
				}>;
			};
			expect(reply.result.success).toBe(true);
			const row = reply.result.data?.notifications.find((each) => each.id === notificationId);
			expect(row?.confirmation).toBeDefined();
			expect(row?.confirmation).not.toHaveProperty('input');
		}
	});

	it('answers nothing more once the turn is stopped, and the stop lists every call made', async () => {
		const { kernel, agent, panel, session, run } = await fakeTurn();
		agent.post({ id: 1, key: 'call', name: 'shell-info-get', input: {} });
		expect(((await agent.next()) as { result: CommandResult }).result.success).toBe(true);
		const stopped = data<{ turn: CopilotTurnV1 }>(
			await kernel.call('copilot-turn-stop', { session, turn: 1 })
		);
		expect(stopped.turn.calls.map((call) => call.command)).toEqual(['shell-info-get']);
		expect(await panel.next((message) => (message as { key?: string }).key === 'abort')).toEqual({
			key: 'abort',
			runId: run.runId,
		});
		agent.post({ id: 2, key: 'call', name: 'shell-info-get', input: {} });
		expect(((await agent.next()) as { result: CommandResult }).result.error?.code).toBe(
			'COPILOT_PORT_REFUSED'
		);
		// The runtime's late events and end are ignored: the turn stays stopped.
		panel.post({ key: 'end', runId: run.runId, state: 'done', code: 'RUN_ERROR' });
		await new Promise((resolve) => setTimeout(resolve, 20));
		const got = data<{ turns: CopilotTurnV1[] }>(
			await kernel.call('copilot-session-get', { session })
		);
		expect(got.turns[0]).toMatchObject({
			state: 'stopped',
			calls: [{ command: 'shell-info-get' }],
		});
	});

	it("records one round's calls in the order they were made, not the order they settle (#2647)", async () => {
		const { kernel, agent, session } = await fakeTurn();
		// Sent together, as one model round's calls are: the asked mutation usually settles after the read made after it,
		// which put the read first before #2647. Which settles first is left unasserted, so this never flakes on it.
		agent.post({ id: 1, key: 'call', name: 'project-create', input: { name: 'Payroll' } });
		agent.post({ id: 2, key: 'call', name: 'shell-info-get', input: {} });
		await agent.next();
		await agent.next();
		const stopped = data<{ turn: CopilotTurnV1 }>(
			await kernel.call('copilot-turn-stop', { session, turn: 1 })
		);
		expect(stopped.turn.calls.map((call) => [call.callId, call.command])).toEqual([
			['cpc_0001', 'project-create'],
			['cpc_0002', 'shell-info-get'],
		]);
	});

	it('copies the trace to every call made while a copilot call runs, nested calls included (3.2)', async () => {
		const launcher = fakeLauncher();
		const { kernel, journal } = await setup({ launcher, documents: true });
		const made = await kernel.call<{ id: string }>('document-create', { type: 'probe' });
		const document = data<{ id: string }>(made).id;
		const session = await startSession(kernel);
		await kernel.call('copilot-message-send', { session, text: 'Export it', wait: false });
		const agent = side((launcher.launched[0] as RuntimePortsV1).agent);
		agent.post({ id: 1, key: 'call', name: 'document-export', input: { document } });
		const answer = (await agent.next()) as { result: CommandResult };
		expect(answer.result.success, JSON.stringify(answer.result.error)).toBe(true);
		const all = await entries(journal);
		const outer = all.find((entry) => entry.command === 'document-export');
		const nested = all.find((entry) => entry.command === 'probe-export');
		const trace = { session, turn: 1, call: 'cpc_0001' };
		expect(outer?.context).toMatchObject({ trace, copilotSession: session, turn: 1 });
		expect(nested?.context).toMatchObject({ trace, copilotSession: session, turn: 1 });
		expect(nested?.actor).toMatchObject({ kind: 'agent', id: 'copilot' });
		// The person's own calls carry none.
		const own = all.find((entry) => entry.command === 'document-create');
		expect(own?.context ?? {}).not.toHaveProperty('trace');
	});

	it('stops a turn at its limit of calls (4.4)', async () => {
		const { kernel, agent, session } = await fakeTurn();
		for (let index = 0; index < 41; index++) {
			agent.post({ id: index + 1, key: 'call', name: 'shell-info-get', input: {} });
			await agent.next();
		}
		const got = data<{ turns: CopilotTurnV1[] }>(
			await kernel.call('copilot-session-get', { session })
		);
		expect(got.turns[0]).toMatchObject({ state: 'stopped', stoppedBy: 'limit' });
		expect(got.turns[0]?.calls).toHaveLength(40);
	});

	it('gives the runtime the kernel’s history and provider, never a key or an endpoint', async () => {
		const launcher = fakeLauncher();
		const { kernel } = await setup({ launcher });
		const session = await startSession(kernel);
		// The first turn ends through the runtime's own end message.
		await kernel.call('copilot-message-send', { session, text: 'First', wait: false });
		const panel = side((launcher.launched[0] as RuntimePortsV1).panel);
		const first = (await panel.next()) as { runId: string };
		panel.post({
			key: 'event',
			runId: first.runId,
			event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'Reply one' },
		});
		panel.post({ key: 'end', runId: first.runId, state: 'done', code: 'RUN_ERROR' });
		await new Promise((resolve) => setTimeout(resolve, 20));
		await kernel.call('copilot-message-send', { session, text: 'Second', wait: false });
		const second = (await panel.next(
			(message) => (message as { text?: string }).text === 'Second'
		)) as Record<string, unknown>;
		expect(Object.keys(second).sort()).toEqual([
			'history',
			'key',
			'provider',
			'runId',
			'text',
			'threadId',
		]);
		expect(second.history).toEqual([
			{ role: 'user', text: 'First' },
			{ role: 'assistant', text: 'Reply one' },
		]);
		expect(second.provider).toEqual(TEST);
		expect(launcher.launched).toHaveLength(1);
	});
});

describe('the model and panel ports’ halves (3.2, 4.2, 4.4)', () => {
	it('refuses another provider, a body that is not an object, and a message with a key it does not define', async () => {
		const { model } = await fakeTurn();
		model.post({ id: 1, key: 'send', provider: 'other', body: { messages: [] } });
		expect(await model.next()).toMatchObject({ id: 1, error: { code: 'COPILOT_PORT_REFUSED' } });
		model.post({ id: 2, key: 'send', provider: 'test', body: [1, 2] });
		expect(await model.next()).toMatchObject({ id: 2, error: { code: 'MODEL_BODY_REFUSED' } });
		model.post({ id: 3, key: 'send', provider: 'test', body: {}, url: 'https://example.test' });
		expect(await model.next()).toMatchObject({ id: 3, error: { code: 'COPILOT_PORT_REFUSED' } });
		const big = 'x'.repeat(MODEL_PORT_LIMITS.bodyBytes + 1);
		model.post({
			id: 4,
			key: 'send',
			provider: 'test',
			body: { messages: [{ role: 'user', content: big }] },
		});
		expect(await model.next()).toMatchObject({ id: 4, error: { code: 'MODEL_BODY_REFUSED' } });
	});

	it('streams the provider’s bytes and sets a missing or larger max_tokens to the turn’s output limit', async () => {
		const { model, provider } = await fakeTurn();
		model.post({
			id: 5,
			key: 'send',
			provider: 'test',
			body: { messages: [{ role: 'user', content: 'Hi' }], max_tokens: 128_000 },
		});
		const answer = (await model.next()) as { stream: string };
		expect(answer.stream).toMatch(/^mst_/);
		const done = (await model.next((message) => (message as { key?: string }).key === 'done')) as {
			status: number;
		};
		expect(done.status).toBe(200);
		expect(provider.bodies.at(-1)?.max_tokens).toBe(MODEL_PORT_LIMITS.outputTokens);
		model.post({ id: 6, key: 'send', provider: 'test', body: { messages: [] } });
		await model.next((message) => (message as { id?: number }).id === 6);
		await model.next((message) => (message as { key?: string }).key === 'done');
		expect(provider.bodies.at(-1)?.max_tokens).toBe(MODEL_PORT_LIMITS.outputTokens);
	});

	it('forwards only text and tool-call events, with only their fields; drops interrupts, CUSTOM and another run', async () => {
		const { host, panel, run, session } = await fakeTurn();
		const heard: PanelEventV1[] = [];
		host.subscribe(session, (event) => heard.push(event));
		const post = (event: Record<string, unknown>, runId = run.runId) =>
			panel.post({ key: 'event', runId, event });
		post({ type: 'CUSTOM', name: 'loam-confirmation', value: { notification: 'n1' } });
		post({ type: 'CUSTOM', name: 'ui-resource', value: { uri: 'ui://x' } });
		post({
			type: 'RUN_FINISHED',
			runId: run.runId,
			outcome: { type: 'interrupt', interrupts: [{ id: 'i' }] },
		});
		post({
			type: 'TOOL_CALL_START',
			toolCallId: 't1',
			toolCallName: 'x',
			state: 'approval-requested',
		});
		// The runtime cannot draw its text as the person's (3.4).
		post({ type: 'TEXT_MESSAGE_START', messageId: 'm2', role: 'user' });
		post({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: '<b>bold</b>' }, 'run_other');
		post({ type: 'MESSAGES_SNAPSHOT', messages: [] });
		panel.post({
			key: 'event',
			runId: run.runId,
			event: { type: 'TEXT_MESSAGE_CONTENT', delta: 'ok' },
			extra: 1,
		});
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(heard.map((item) => item.event)).toEqual([
			{ type: 'RUN_FINISHED', runId: run.runId },
			{ type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'x' },
			{ type: 'TEXT_MESSAGE_START', messageId: 'm2', role: 'assistant' },
		]);
	});

	it('takes one model request at a time, and stops the turn at its rounds, counted on the trusted side (4.4)', async () => {
		const { kernel, model, session } = await fakeTurn();
		const body = { messages: [{ role: 'user', content: 'Hi' }] };
		model.post({ id: 1, key: 'send', provider: 'test', body });
		model.post({ id: 2, key: 'send', provider: 'test', body });
		expect(await model.next((message) => (message as { id?: number }).id === 2)).toMatchObject({
			error: { code: 'COPILOT_PORT_REFUSED' },
		});
		await model.next((message) => (message as { key?: string }).key === 'done');
		for (let round = 2; round <= MODEL_PORT_LIMITS.rounds; round++) {
			model.post({ id: 10 + round, key: 'send', provider: 'test', body });
			await model.next((message) => (message as { key?: string }).key === 'done');
		}
		model.post({ id: 99, key: 'send', provider: 'test', body });
		expect(await model.next((message) => (message as { id?: number }).id === 99)).toMatchObject({
			error: { code: 'COPILOT_PORT_REFUSED' },
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		const got = data<{ turns: CopilotTurnV1[] }>(
			await kernel.call('copilot-session-get', { session })
		);
		expect(got.turns[0]).toMatchObject({ state: 'stopped', stoppedBy: 'limit' });
	});

	it('fails a turn whose runtime keeps sending what its ports refuse, and stops journaling it', async () => {
		const { kernel, agent, journal, session } = await fakeTurn();
		for (let index = 0; index < PORT_BUDGETS.refusals + 5; index++) {
			agent.post({ id: index + 1, key: 'call', name: 'shell-info-get', input: {}, actor: 'x' });
			await agent.next();
		}
		const journaled = (await entries(journal)).filter(
			(entry) => entry.command === 'copilot-port-refuse'
		);
		expect(journaled).toHaveLength(PORT_BUDGETS.refusals);
		const got = data<{ turns: CopilotTurnV1[] }>(
			await kernel.call('copilot-session-get', { session })
		);
		expect(got.turns[0]).toMatchObject({
			state: 'failed',
			failure: { code: 'COPILOT_PORT_REFUSED' },
		});
	});

	it('ends every run as session-changed when the host is reset, as removing the frame does', async () => {
		const { kernel, host, session, launcher } = await fakeTurn();
		host.reset();
		await new Promise((resolve) => setTimeout(resolve, 20));
		const got = data<{ turns: CopilotTurnV1[] }>(
			await kernel.call('copilot-session-get', { session })
		);
		expect(got.turns[0]).toMatchObject({ state: 'stopped', stoppedBy: 'session-changed' });
		expect(launcher.resets).toBe(1);
	});

	it('fails a turn the runtime ends with an error, with its code', async () => {
		const { kernel, panel, run, session } = await fakeTurn();
		panel.post({ key: 'end', runId: run.runId, state: 'failed', code: 'MODEL_REFUSED' });
		await new Promise((resolve) => setTimeout(resolve, 20));
		const got = data<{ turns: CopilotTurnV1[] }>(
			await kernel.call('copilot-session-get', { session })
		);
		expect(got.turns[0]).toMatchObject({ state: 'failed', failure: { code: 'MODEL_REFUSED' } });
	});
});

describe('the pure parts', () => {
	it('checks a port message: a plain object, a key its port defines, no other key, an id', () => {
		const table = { call: ['id', 'key', 'name'] };
		expect(checkPortMessage({ id: 1, key: 'call', name: 'x' }, table).ok).toBe(true);
		expect(checkPortMessage(null, table)).toMatchObject({ ok: false });
		expect(checkPortMessage(new Map(), table)).toMatchObject({
			ok: false,
			reason: 'Not a plain object',
		});
		expect(checkPortMessage({ id: 1, key: 'toString' }, table)).toMatchObject({
			ok: false,
			keys: ['key'],
		});
		expect(checkPortMessage({ key: 'call', name: 'x' }, table)).toMatchObject({
			ok: false,
			keys: ['id'],
		});
		expect(checkPortMessage({ id: 1, key: 'call', name: 'x', actor: 1 }, table)).toMatchObject({
			ok: false,
			keys: ['actor'],
		});
	});

	it('keeps a panel event’s own fields, strings only', () => {
		expect(
			panelEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'd', raw: {} })
		).toEqual({
			type: 'TEXT_MESSAGE_CONTENT',
			messageId: 'm',
			delta: 'd',
		});
		expect(panelEvent({ type: 'TOOL_CALL_RESULT', toolCallId: 't', content: { html: 1 } })).toEqual(
			{
				type: 'TOOL_CALL_RESULT',
				toolCallId: 't',
			}
		);
		expect(panelEvent({ type: 'CUSTOM' })).toBeUndefined();
		expect(panelEvent('RUN_FINISHED')).toBeUndefined();
	});

	it('counts tokens from Anthropic’s and Chat Completions’ streams, across chunk boundaries', () => {
		const encode = (text: string) => new TextEncoder().encode(text);
		const anthropic = new UsageReader('anthropic');
		const start = `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 1 } } })}\n`;
		anthropic.read(encode(start.slice(0, 20)));
		anthropic.read(encode(start.slice(20)));
		anthropic.read(
			encode(`data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 7 } })}\n`)
		);
		expect([anthropic.input, anthropic.output]).toEqual([12, 7]);
		const openai = new UsageReader('openai');
		openai.read(
			encode(
				`data: ${JSON.stringify({ usage: { prompt_tokens: 4, completion_tokens: 3 } })}\ndata: [DONE]\n`
			)
		);
		expect([openai.input, openai.output]).toEqual([4, 3]);
	});
});
