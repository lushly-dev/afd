/**
 * @fileoverview The ports' trusted halves and the runner over them (phase 5 specification, 3.2, 4.2 and 4.4). DOM
 * free: the web host gives it a launcher that hands each session's three ports to the runtime's frame, and tests
 * give it one that runs the runtime in process. Everything a runtime sends is checked here before it reaches the
 * kernel, the model's transport or the panel: a message with a key its port does not define is refused.
 */

import type {
	CopilotAgentCapabilityV1,
	CopilotProviderKindV1,
	CopilotProviderV1,
	CopilotRunnerV1,
	CopilotRunV1,
} from './types.js';
import { AGENT_PORT_KEYS, MODEL_PORT_KEYS, PANEL_EVENT_FIELDS, PANEL_PORT_KEYS } from './types.js';
import { composerBodyIs, UNIT_LIMITS } from './units.js';

/** A `MessagePort`, as the DOM and Node both give one. */
export interface PortLike {
	postMessage(message: unknown): void;
	onmessage: ((event: { data: unknown }) => void) | null;
	close(): void;
}

/** A session's three ports, the runtime's halves. */
export interface RuntimePortsV1 {
	agent: PortLike;
	model: PortLike;
	panel: PortLike;
}

/** Where the runtime runs: the opaque-origin frame in a page (3.2), or the same process in tests. */
export interface RuntimeLauncherV1 {
	/** Hand a session's ports to the runtime of `kind`, starting it if it is not running. */
	launch(kind: CopilotProviderKindV1, ports: RuntimePortsV1): void;
	/** Remove every runtime, as a change of person, a sign-out or an unload removes the frame (3.2). */
	reset(): void;
}

/** A provider's answer: its HTTP status and the bytes of its stream, which the model port forwards. */
export interface ModelResponseV1 {
	status: number;
	body: AsyncIterable<Uint8Array>;
}

/**
 * The trusted host's model transport (4.2): the desktop's `model_send` from step 2, the hosted server's route in
 * milestone C, and the test provider. It builds the request itself; the body is all the runtime chose.
 */
export interface ModelTransportV1 {
	send(
		provider: CopilotProviderV1,
		body: Record<string, unknown>,
		signal: AbortSignal
	): Promise<ModelResponseV1>;
}

/** An event the panel draws, from a run it asked for (3.2). */
export interface PanelEventV1 {
	runId: string;
	event: Record<string, unknown>;
}

/** 4.2 and 4.4's bounds on the model port. */
export const MODEL_PORT_LIMITS = Object.freeze({
	/** 4.4's `copilot.turn.iterations`: model requests per turn, counted here, not by the runtime. */
	rounds: 16,
	/** One provider request at a time per session: a runtime cannot fan requests out. */
	concurrent: 1,
	bodyBytes: 4 * 1024 * 1024,
	streamBytes: 16 * 1024 * 1024,
	streamMs: 10 * 60 * 1000,
	outputTokens: 16_384,
	inputTokens: 1_000_000,
});

const REPLY_MAX = 65_536;

/**
 * Bounds on what a runtime can make the trusted side do in one turn: refusals it can have journaled, after which a
 * refused message is answered and no longer journaled and the turn fails; and events it can send the panel, after
 * which the turn stops at its limit (3.2).
 */
export const PORT_BUDGETS = Object.freeze({ refusals: 20, events: 20_000 });

export interface CopilotHostOptionsV1 {
	launcher: RuntimeLauncherV1;
	transport: ModelTransportV1;
	/** Called when a port refuses a message on the model or panel port, which have no journal of their own. */
	onRefused?(port: 'model' | 'panel', reason: string): void;
}

/** The runner the kernel is given, and the panel's side of it. */
export interface CopilotHostV1 extends CopilotRunnerV1 {
	/** The filtered events of a session's runs. Returns an unsubscribe. */
	subscribe(session: string, listener: (event: PanelEventV1) => void): () => void;
	/** The run id the panel's `ChatClient` chose for a session's next turn. */
	expectRun(session: string, runId: string): void;
	/** Read once by the kernel's next `copilot-message-send` of that session. */
	takeRunId(session: string): string | undefined;
	/** Stop every run as `session-changed` and remove the runtimes (3.2). */
	reset(): void;
}

interface SessionState {
	kind: CopilotProviderKindV1;
	agent: PortLike;
	model: PortLike;
	panel: PortLike;
	/** The current run, or the last one: its capability stays to journal a refusal between turns. */
	run?: CopilotRunV1;
	live: boolean;
	reply: string;
	usage: { inputTokens: number; outputTokens: number };
	streams: Map<string, AbortController>;
	/** This turn's model requests, refusals journaled and panel events. */
	rounds: number;
	refusals: number;
	/** The trusted transport's code for this run's last failed request, which a failed run reports (4.2, 14). */
	modelCode?: string;
	events: number;
	/**
	 * Each unit composer's model rounds and output tokens (7.3): counted toward its unit, never the turn's rounds, and
	 * its output apart from the turn's output limit; its input counts toward the turn's input tokens (4.4).
	 */
	units: Map<string, { rounds: number; output: number }>;
	unitOutput: number;
}

type Checked =
	| { ok: true; message: Record<string, unknown> & { key: string } }
	| { ok: false; reason: string; keys: string[]; id?: number };

/** A plain object whose `key` its port defines, holding no key outside that row (3.2). */
export function checkPortMessage(
	data: unknown,
	table: Readonly<Record<string, readonly string[]>>
): Checked {
	if (data === null || typeof data !== 'object' || Array.isArray(data)) {
		return { ok: false, reason: 'Not an object', keys: [] };
	}
	const proto = Object.getPrototypeOf(data);
	if (proto !== Object.prototype && proto !== null) {
		return { ok: false, reason: 'Not a plain object', keys: [] };
	}
	const message = data as Record<string, unknown>;
	const id = Number.isSafeInteger(message.id) ? (message.id as number) : undefined;
	const row = typeof message.key === 'string' ? table[message.key] : undefined;
	if (!row || !Object.hasOwn(table, message.key as string)) {
		return {
			ok: false,
			reason: 'A key this port does not define',
			keys: ['key'],
			...(id !== undefined ? { id } : {}),
		};
	}
	const extra = Object.keys(message).filter((key) => !row.includes(key));
	if (extra.length > 0) {
		return {
			ok: false,
			reason: 'Keys this port does not define',
			keys: extra,
			...(id !== undefined ? { id } : {}),
		};
	}
	if (row.includes('id') && id === undefined) {
		return { ok: false, reason: 'A message without its id', keys: ['id'] };
	}
	return { ok: true, message: message as Record<string, unknown> & { key: string } };
}

/**
 * A runtime's event as the panel may see it (3.2): a type `PANEL_EVENT_FIELDS` names, with only that type's fields and
 * only string values, each at most 65,536 characters. Anything else is dropped: the panel draws text and tool calls
 * alone, and no interrupt, approval state, `CUSTOM` event or snapshot reaches it.
 */
export function panelEvent(
	event: unknown
): (Record<string, string> & { type: string }) | undefined {
	if (event === null || typeof event !== 'object' || Array.isArray(event)) return undefined;
	const type = (event as { type?: unknown }).type;
	if (typeof type !== 'string' || !Object.hasOwn(PANEL_EVENT_FIELDS, type)) return undefined;
	const copy: Record<string, string> & { type: string } = { type };
	for (const field of PANEL_EVENT_FIELDS[type] ?? []) {
		const value = (event as Record<string, unknown>)[field];
		if (typeof value === 'string') copy[field] = value.slice(0, REPLY_MAX);
	}
	// Every message the runtime starts is the model's: it can never draw text as the person's (3.4).
	if (type === 'TEXT_MESSAGE_START') copy.role = 'assistant';
	return copy;
}

/** A copy with nothing but JSON in it, so no function or prototype crosses a port. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

const refusal = (message: string) => ({
	code: 'COPILOT_PORT_REFUSED' as const,
	message,
	suggestion: 'None: only the runtime uses the port',
});

/**
 * The trusted halves of a session's ports, and the runner the kernel calls. One set of ports per session, so a
 * runtime can never name another session: the port it writes on is the session (3.2, T19).
 */
export function createCopilotHost(options: CopilotHostOptionsV1): CopilotHostV1 {
	const sessions = new Map<string, SessionState>();
	const listeners = new Map<string, Set<(event: PanelEventV1) => void>>();
	const expected = new Map<string, string>();
	let streams = 0;

	const emit = (session: string, event: PanelEventV1) => {
		for (const listener of [...(listeners.get(session) ?? [])]) {
			try {
				listener(event);
			} catch (error) {
				(globalThis as { reportError?: (error: unknown) => void }).reportError?.(error);
			}
		}
	};

	/** The current run's capability, or a refusal-only one between turns. */
	const capability = (state: SessionState): CopilotAgentCapabilityV1 | undefined =>
		state.run?.agent;

	/**
	 * A refusal on any of the session's ports, journaled through the agent port's half (`COPILOT_PORT_REFUSED`, 3.2)
	 * while the turn's budget lasts; past it, a running turn fails and nothing more is journaled.
	 */
	async function refuseOn(
		state: SessionState,
		port: 'agent' | 'model' | 'panel',
		reason: string,
		keys: readonly string[]
	): Promise<unknown> {
		const text = `${port === 'agent' ? '' : `${port} port: `}${reason}`;
		if (port !== 'agent') options.onRefused?.(port, text);
		state.refusals += 1;
		const agent = capability(state);
		if (state.refusals > PORT_BUDGETS.refusals || !agent) {
			if (state.run && state.live)
				end(state, state.run, { state: 'failed', failure: { code: 'COPILOT_PORT_REFUSED' } });
			return { success: false, error: refusal(text) };
		}
		return agent.refuse(text, keys);
	}

	function serveAgent(state: SessionState): void {
		state.agent.onmessage = async ({ data }) => {
			if (!capability(state)) return;
			const checked = checkPortMessage(data, AGENT_PORT_KEYS);
			if (!checked.ok) {
				const result = await refuseOn(state, 'agent', checked.reason, checked.keys);
				if (checked.id !== undefined)
					state.agent.postMessage({ id: checked.id, result: plain(result) });
				return;
			}
			const agent = capability(state) as CopilotAgentCapabilityV1;
			const { message } = checked;
			let result: unknown;
			let input: unknown;
			try {
				// JSON alone crosses into the kernel: no BigInt, cycle or prototype the clone let through.
				input = message.key === 'call' ? plain(message.input ?? {}) : undefined;
			} catch {
				input = undefined;
			}
			if (!state.live) {
				result = await refuseOn(state, 'agent', 'No turn is running', [message.key]);
			} else if (message.key === 'call') {
				result =
					typeof message.name === 'string' && message.name.length <= 128 && input !== undefined
						? await agent.call(message.name, input)
						: await refuseOn(state, 'agent', 'A command name and a JSON input are needed', [
								'name',
							]);
			} else if (message.key === 'listCommands') {
				result = await agent.listCommands();
			} else if (message.key === 'unit') {
				const unit = message.unit;
				// A unit whose composer went past its output tokens on its last answer is failed, its text never sent (7.3).
				const over =
					typeof unit === 'string' &&
					(state.units.get(unit)?.output ?? 0) > UNIT_LIMITS.outputTokens;
				result =
					typeof unit === 'string' && typeof message.text === 'string'
						? await agent.unit(unit, over ? '' : message.text)
						: await refuseOn(state, 'agent', 'A unit id and its text must be strings', ['unit']);
				// Its count goes only with the unit itself: a refused message leaves a live unit's spending in place.
				if (typeof unit === 'string' && agent.composing(unit) === undefined)
					state.units.delete(unit);
			} else {
				result =
					typeof message.notification === 'string'
						? await agent.confirmation(message.notification)
						: await refuseOn(state, 'agent', 'A notification id must be a string', [
								'notification',
							]);
			}
			state.agent.postMessage({ id: message.id, result: plain(result) });
		};
	}

	function serveModel(state: SessionState): void {
		const refuse = (id: number | undefined, message: string, code = 'COPILOT_PORT_REFUSED') => {
			void refuseOn(state, 'model', message, [code]);
			if (id !== undefined)
				state.model.postMessage({
					id,
					error: { ...refusal(message), code },
				});
		};
		state.model.onmessage = ({ data }) => {
			const checked = checkPortMessage(data, MODEL_PORT_KEYS);
			if (!checked.ok) return refuse(checked.id, `${checked.reason}: ${checked.keys.join(', ')}`);
			const { message } = checked;
			if (message.key === 'cancel') {
				if (typeof message.stream === 'string') state.streams.get(message.stream)?.abort();
				return;
			}
			const id = message.id as number;
			const run = state.run;
			// Only the session's own provider, and only while its turn runs (4.2).
			if (!run || !state.live) return refuse(id, 'No turn is running');
			if (message.provider !== run.provider.id) return refuse(id, 'Not this session’s provider');
			// 4.4's rounds, and one request at a time, counted here: the runtime's own loop limit is untrusted.
			if (state.streams.size >= MODEL_PORT_LIMITS.concurrent)
				return refuse(id, 'One model request at a time');
			// A unit composer's request (7.3): only for a unit this turn handed out and has not had back, within its rounds
			// and output tokens, which count toward the unit and never the turn's rounds.
			const unit = message.unit;
			let spent: { rounds: number; output: number } | undefined;
			if (unit !== undefined) {
				const context = typeof unit === 'string' ? run.agent.composing(unit) : undefined;
				if (typeof unit !== 'string' || context === undefined)
					return refuse(id, 'No unit of this turn is being composed with that id');
				// The unit's own context and nothing more: no history, no tools, no other unit (7.3).
				if (!composerBodyIs(message.body, context))
					return refuse(id, 'A unit’s request sends its own context alone', 'MODEL_BODY_REFUSED');
				spent = state.units.get(unit) ?? { rounds: 0, output: 0 };
				state.units.set(unit, spent);
				if (spent.rounds >= UNIT_LIMITS.rounds)
					return refuse(id, 'The unit reached its limit of model rounds');
				if (spent.output >= UNIT_LIMITS.outputTokens)
					return refuse(id, 'The unit reached its limit of output tokens');
			} else if (state.rounds >= MODEL_PORT_LIMITS.rounds) {
				refuse(id, 'The turn reached its limit of model rounds');
				end(state, run, { state: 'stopped', stoppedBy: 'limit' });
				return;
			}
			const body = message.body;
			if (
				body === null ||
				typeof body !== 'object' ||
				Array.isArray(body) ||
				Object.getPrototypeOf(body) !== Object.prototype
			) {
				return refuse(id, 'The body must be an object', 'MODEL_BODY_REFUSED');
			}
			let text: string;
			try {
				text = JSON.stringify(body);
			} catch {
				return refuse(id, 'The body must be JSON', 'MODEL_BODY_REFUSED');
			}
			if (new TextEncoder().encode(text).length > MODEL_PORT_LIMITS.bodyBytes) {
				return refuse(id, 'The body is over 4 MiB', 'MODEL_BODY_REFUSED');
			}
			const sent = JSON.parse(text) as Record<string, unknown>;
			// 4.2: a missing `max_tokens` is set to the turn's output limit, and a larger one lowered to it.
			const asked = sent.max_tokens;
			const bound = spent
				? UNIT_LIMITS.outputTokens - spent.output
				: MODEL_PORT_LIMITS.outputTokens;
			sent.max_tokens =
				typeof asked === 'number' && Number.isFinite(asked) && asked > 0
					? Math.min(Math.floor(asked), bound)
					: bound;
			if (spent) spent.rounds += 1;
			else state.rounds += 1;
			const stream = `mst_${++streams}`;
			const controller = new AbortController();
			state.streams.set(stream, controller);
			run.signal.addEventListener('abort', () => controller.abort(), { once: true });
			state.model.postMessage({ id, stream });
			void pump(state, run, stream, sent, controller, spent);
		};
	}

	async function pump(
		state: SessionState,
		run: CopilotRunV1,
		stream: string,
		body: Record<string, unknown>,
		controller: AbortController,
		unit?: { rounds: number; output: number }
	): Promise<void> {
		const usage = new UsageReader(run.provider.kind);
		const sentBytes = new TextEncoder().encode(JSON.stringify(body)).length;
		let bytes = 0;
		let status = 200;
		let code: string | undefined;
		const deadline = setTimeout(() => {
			code = 'MODEL_STREAM_LIMIT';
			controller.abort();
		}, MODEL_PORT_LIMITS.streamMs);
		try {
			const response = await options.transport.send(run.provider, body, controller.signal);
			status = response.status;
			for await (const chunk of response.body) {
				if (controller.signal.aborted) break;
				bytes += chunk.byteLength;
				if (bytes > MODEL_PORT_LIMITS.streamBytes) {
					code = 'MODEL_STREAM_LIMIT';
					break;
				}
				usage.read(chunk);
				state.model.postMessage({ key: 'chunk', stream, chunk });
			}
		} catch (error) {
			if (!controller.signal.aborted) {
				status = 502;
				code = (error as { code?: string })?.code ?? 'MODEL_UNREACHABLE';
			}
		} finally {
			clearTimeout(deadline);
			state.streams.delete(stream);
		}
		// The turn's tokens are counted from the provider's stream, never from the runtime (4.4). A stream that said
		// nothing of its usage (a server that does not report it) is counted from its bytes, a token for every four,
		// so the turn's limits still bind (step 2's trust review).
		if (state.run === run) {
			const counted = usage.input > 0 || usage.output > 0;
			const output = counted ? usage.output : Math.ceil(bytes / 4);
			state.usage.inputTokens += counted ? usage.input : Math.ceil(sentBytes / 4);
			state.usage.outputTokens += output;
			// A composer's output counts toward its unit, apart from the turn's output limit (7.3, 4.4).
			if (unit) {
				unit.output += output;
				state.unitOutput += output;
			}
			if (code && code !== 'MODEL_STREAM_LIMIT') state.modelCode = code;
		}
		if (code) status = status >= 400 ? status : 502;
		state.model.postMessage({ key: 'done', stream, status, ...(code ? { code } : {}) });
		if (
			state.run === run &&
			state.live &&
			(state.usage.inputTokens > MODEL_PORT_LIMITS.inputTokens ||
				state.usage.outputTokens - state.unitOutput >
					MODEL_PORT_LIMITS.outputTokens * MODEL_PORT_LIMITS.rounds ||
				code === 'MODEL_STREAM_LIMIT')
		) {
			end(state, run, { state: 'stopped', stoppedBy: 'limit' });
		}
	}

	function servePanel(state: SessionState, session: string): void {
		state.panel.onmessage = ({ data }) => {
			const checked = checkPortMessage(data, PANEL_PORT_KEYS);
			if (!checked.ok) {
				void refuseOn(state, 'panel', checked.reason, checked.keys);
				return;
			}
			const { message } = checked;
			const run = state.run;
			// Only the current run's, and only while it runs: a stopped run says nothing more.
			if (!run || !state.live || message.runId !== run.runId) return;
			if (message.key === 'end') {
				const code =
					typeof message.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(message.code)
						? message.code
						: 'RUN_ERROR';
				if (message.state === 'done') end(state, run, { state: 'done' });
				else if (message.state === 'limit')
					end(state, run, { state: 'stopped', stoppedBy: 'limit' });
				// The transport's code, when a request failed, is the trusted one: the runtime's is its own reading of it.
				else end(state, run, { state: 'failed', failure: { code: state.modelCode ?? code } });
				return;
			}
			const copy = panelEvent(message.event);
			if (!copy) return;
			state.events += 1;
			if (state.events > PORT_BUDGETS.events) {
				end(state, run, { state: 'stopped', stoppedBy: 'limit' });
				return;
			}
			// A run's ids are the kernel's, never the runtime's.
			if ('runId' in copy) copy.runId = run.runId;
			if ('threadId' in copy) copy.threadId = run.session.id;
			if (copy.type === 'TEXT_MESSAGE_CONTENT' && typeof copy.delta === 'string') {
				state.reply = (state.reply + copy.delta).slice(0, REPLY_MAX);
			}
			emit(session, { runId: run.runId, event: copy });
		};
	}

	function end(
		state: SessionState,
		run: CopilotRunV1,
		outcome: {
			state: 'done' | 'failed' | 'stopped';
			stoppedBy?: 'person' | 'limit' | 'session-changed';
			failure?: { code: string };
		}
	): void {
		if (state.run !== run || !state.live) return;
		state.live = false;
		for (const controller of state.streams.values()) controller.abort();
		state.panel.postMessage({ key: 'abort', runId: run.runId });
		// The panel's client hears the run end however it ended, so a stopped run never leaves it waiting.
		emit(run.session.id, {
			runId: run.runId,
			event:
				outcome.state === 'failed'
					? {
							type: 'RUN_ERROR',
							runId: run.runId,
							threadId: run.session.id,
							message: `The turn failed: ${outcome.failure?.code ?? 'RUN_ERROR'}`,
						}
					: { type: 'RUN_FINISHED', runId: run.runId, threadId: run.session.id },
		});
		run.settle({
			...outcome,
			reply: state.reply,
			usage: { ...state.usage },
			rounds: state.rounds,
			unitOutput: state.unitOutput,
		});
	}

	function open(run: CopilotRunV1): SessionState {
		const found = sessions.get(run.session.id);
		if (found && found.kind === run.provider.kind) return found;
		if (found) close(found);
		const Channel = (
			globalThis as unknown as { MessageChannel: new () => { port1: PortLike; port2: PortLike } }
		).MessageChannel;
		const agent = new Channel();
		const model = new Channel();
		const panel = new Channel();
		const state: SessionState = {
			kind: run.provider.kind,
			agent: agent.port1,
			model: model.port1,
			panel: panel.port1,
			live: false,
			reply: '',
			usage: { inputTokens: 0, outputTokens: 0 },
			streams: new Map(),
			rounds: 0,
			refusals: 0,
			events: 0,
			units: new Map(),
			unitOutput: 0,
		};
		serveAgent(state);
		serveModel(state);
		servePanel(state, run.session.id);
		sessions.set(run.session.id, state);
		options.launcher.launch(run.provider.kind, {
			agent: agent.port2,
			model: model.port2,
			panel: panel.port2,
		});
		return state;
	}

	function close(state: SessionState): void {
		for (const controller of state.streams.values()) controller.abort();
		state.agent.close();
		state.model.close();
		state.panel.close();
	}

	return {
		start(run) {
			const state = open(run);
			if (state.run && state.live) end(state, state.run, { state: 'stopped', stoppedBy: 'person' });
			state.run = run;
			state.live = true;
			state.reply = '';
			// A continuation counts on from what its turn spent (3.5, 4.4).
			state.usage = run.spent ? { ...run.spent.usage } : { inputTokens: 0, outputTokens: 0 };
			state.rounds = run.spent?.rounds ?? 0;
			state.refusals = 0;
			state.modelCode = undefined;
			state.events = 0;
			state.units = new Map();
			// A continuation counts on from what its turn's composers spent, apart from its own output (3.5, 4.4).
			state.unitOutput = run.spent?.unitOutput ?? 0;
			run.signal.addEventListener(
				'abort',
				() => {
					if (state.run !== run || !state.live) return;
					state.live = false;
					for (const controller of state.streams.values()) controller.abort();
					state.panel.postMessage({ key: 'abort', runId: run.runId });
					// The kernel ended the turn (a stop, a limit, a change of person): the panel's client hears it end.
					emit(run.session.id, {
						runId: run.runId,
						event: { type: 'RUN_FINISHED', runId: run.runId, threadId: run.session.id },
					});
				},
				{ once: true }
			);
			// The panel port carries in only the run, the thread and the text (3.2); the history and the provider are
			// the kernel's, from its records, never the panel's copy.
			state.panel.postMessage({
				key: 'run',
				runId: run.runId,
				threadId: run.session.id,
				text: run.text,
				history: plain(run.history),
				...(run.attachments && run.attachments.length > 0
					? { attachments: plain(run.attachments) }
					: {}),
				provider: plain(run.provider),
			});
		},
		subscribe(session, listener) {
			const set = listeners.get(session) ?? new Set();
			set.add(listener);
			listeners.set(session, set);
			return () => {
				set.delete(listener);
			};
		},
		expectRun(session, runId) {
			expected.set(session, runId);
		},
		takeRunId(session) {
			const runId = expected.get(session);
			expected.delete(session);
			return runId;
		},
		reset() {
			for (const state of sessions.values()) {
				if (state.run && state.live)
					end(state, state.run, { state: 'stopped', stoppedBy: 'session-changed' });
				close(state);
			}
			sessions.clear();
			expected.clear();
			// The panel's subscriptions were the previous person's: none hears anything more.
			listeners.clear();
			options.launcher.reset();
		},
	};
}

/**
 * Reads token usage from a provider's server-sent events as they pass (4.4): Anthropic's `message_start` and
 * `message_delta`, which the test provider speaks too, and Chat Completions' final `usage`. Best effort over
 * bytes; a chunk boundary inside a line is joined.
 */
export class UsageReader {
	input = 0;
	output = 0;
	#pending = '';
	#message = 0;
	readonly #decoder = new TextDecoder();
	constructor(readonly kind: CopilotProviderKindV1) {}

	read(chunk: Uint8Array): void {
		const text = this.#pending + this.#decoder.decode(chunk, { stream: true });
		const lines = text.split('\n');
		this.#pending = lines.pop() ?? '';
		for (const line of lines) {
			if (!line.startsWith('data:')) continue;
			const json = line.slice(5).trim();
			if (!json.startsWith('{')) continue;
			let data: Record<string, unknown>;
			try {
				data = JSON.parse(json);
			} catch {
				continue;
			}
			const count = (value: unknown) =>
				typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
			if (this.kind === 'anthropic' || this.kind === 'test') {
				const usage =
					(data.message as { usage?: Record<string, unknown> } | undefined)?.usage ??
					(data.usage as Record<string, unknown> | undefined);
				if (!usage) continue;
				// `message_delta`'s count is the message's so far, so only what it adds is counted.
				if (data.type === 'message_start') {
					this.input += count(usage.input_tokens);
					this.#message = count(usage.output_tokens);
					this.output += this.#message;
				} else if (data.type === 'message_delta') {
					const now = count(usage.output_tokens);
					if (now > this.#message) {
						this.output += now - this.#message;
						this.#message = now;
					}
				}
			} else {
				const usage = data.usage as Record<string, unknown> | undefined;
				if (!usage) continue;
				this.input += count(usage.prompt_tokens);
				this.output += count(usage.completion_tokens);
			}
		}
	}
}
