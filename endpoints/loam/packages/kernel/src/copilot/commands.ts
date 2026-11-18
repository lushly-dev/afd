/**
 * @fileoverview The copilot's records and commands (phase 5 specification, 3.4 and 3.5), the agent port's kernel
 * half (3.2) and the gate that fails every copilot mutation closed until enforcement lands (6.1). In the
 * `late-copilot` chunk, which `late/` loads in stage B: it imports types alone, and every function it shares with
 * first paint or `late` reaches it through {@link CopilotDeps}' kit, as `late-documents`' does (2.4).
 */

import type { CommandContext, CommandMiddleware, CommandResult } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { DocumentKit } from '../late/document-kit.js';
import type { ScopeV1 } from '../scope/records.js';
import type { ContextFieldV2 } from '../types.js';
import type {
	CopilotAgentCapabilityV1,
	CopilotCallV1,
	CopilotOptionsV1,
	CopilotProviderV1,
	CopilotSessionV1,
	CopilotTraceV1,
	CopilotTurnOutcomeV1,
	CopilotTurnV1,
	ToolDescriptorV1,
} from './types.js';

/** The person's records (3.4): sessions listed by `person`, turns by `session`. */
export const COPILOT_SESSION_TABLE = 'copilot-session';
export const COPILOT_TURN_TABLE = 'copilot-turn';

/** The copilot's human commands (3.5): in `HUMAN_COMMANDS`, so the agent interface answers `HUMAN_REQUIRED`. */
export const COPILOT_HUMAN_COMMANDS = Object.freeze([
	'copilot-session-start',
	'copilot-message-send',
	'copilot-turn-stop',
] as const);

/** Its queries: palette only, `agent: false`, so no agent lists or reads a person's conversations (3.5). */
export const COPILOT_QUERIES = Object.freeze([
	'copilot-session-list',
	'copilot-session-get',
	'copilot-provider-list',
	'approval-health-get',
] as const);

/**
 * The queries' exposure (3.5): the palette's alone. The three human commands keep the shell's, so the agent interface
 * reaches them only to be refused `HUMAN_REQUIRED`, journaled, as phase 3's human commands are.
 */
export const COPILOT_EXPOSE = Object.freeze({
	palette: true,
	agent: false,
	mcp: false,
	cli: false,
});

/** The agent port's refusal, an internal command so it is journaled (3.2). */
export const COPILOT_PORT_REFUSE = 'copilot-port-refuse';

/** The kernel's own write of a settled turn: boot-only, so no person, app or agent reaches it. */
export const COPILOT_TURN_SETTLE = 'copilot-turn-settle';

/** 3.5: `copilot-message-send` with `wait` returns after this long with the turn still `running`. */
export const MESSAGE_WAIT_MS = 50_000;

/** 4.4's defaults. Phase 4's settings are not built, so step 1 uses the defaults as the limits. */
export const TURN_LIMITS = Object.freeze({
	calls: 40,
	iterations: 16,
	seconds: 600,
	inputTokens: 1_000_000,
	outputTokens: 16_384,
});

/**
 * The chrome's own commands, which move the person's palette or record their editor selection: never the copilot's
 * tools (4.5).
 */
const CHROME_ONLY: readonly string[] = ['palette-open', 'palette-close', 'editor-selection-set'];

/** 4.5: at most this many tool definitions. */
export const TOOLS_MAX = 128;

const TEXT_MAX = 32_768;
const REPLY_MAX = 65_536;
const TITLE_MAX = 80;
const SESSION_ID = /^cps_[0-9a-f]{16}$/;

const SUGGESTIONS = {
	PROVIDER_MISSING:
		'Add a provider under [copilot] in loam.deployment.toml, then run deployment write',
	PROVIDER_UNKNOWN: 'Start a new session; the provider is not in this desktop’s configuration',
	SESSION_NOT_FOUND: 'List your sessions with copilot-session-list',
	TURN_RUNNING: 'Wait for the turn, or stop it with copilot-turn-stop',
	PORT_REFUSED: 'None: only the runtime uses the port',
	AUTONOMY_UNAVAILABLE: 'Agents can only read until autonomy is enforced',
} as const;

/** What the copilot chunk needs from the kernel. */
export interface CopilotDeps {
	/** The workspace store: the person's sessions and turns, each carrying `person`. */
	store: DataAdapter;
	workspace: string;
	options?: CopilotOptionsV1 | undefined;
	kit: Pick<DocumentKit, 'define' | 'success' | 'kernelFailure' | 'personOf' | 'callNow' | 'z'>;
	isMutation(name: string): boolean;
	/** A mounted instance's command: its result is the server's, labelled `content` whole until step 4 (5.1). */
	isMounted(name: string): boolean;
	/** The owning instance of an app's command. */
	instanceOf(name: string): string | undefined;
	/** The agent interface's commands with their input schemas, as its registry lists them. */
	agentCommands(): Array<{ name: string; description: string; inputSchema?: unknown }>;
	/**
	 * Run `name` on the agent interface as `copilot` for the person, in `scope`, with `trace`: the kernel's minted
	 * options, the only path that sets the trace (3.2).
	 */
	callAsCopilot(
		name: string,
		input: unknown,
		trace: CopilotTraceV1,
		scope: ScopeV1 | 'workspace'
	): Promise<CommandResult>;
	/** The kernel's own journaled work, for `copilot-turn-settle`. */
	runBoot(name: string, input: unknown): Promise<CommandResult>;
	/** Commands no agent may run: `HUMAN_COMMANDS` and `OWNER_COMMANDS`, never listed for the copilot. */
	humanOnly(name: string): boolean;
	/** Commands `listCommands` never reports. */
	internal(name: string): boolean;
	/** `sha256:` and the hex SHA-256 of canonical JSON. */
	digest(value: unknown): Promise<string>;
	/** The kernel's clock. */
	now(): number;
	/** The person the kernel decides for now: a turn acts only while it is still its session's person (3.2). */
	person(): string;
}

/** One turn while it runs: what 3.4 records, kept in memory until it settles. */
interface Running {
	turn: CopilotTurnV1;
	session: CopilotSessionV1;
	controller: AbortController;
	revoked: boolean;
	settled: Promise<CopilotTurnV1>;
	resolve(turn: CopilotTurnV1): void;
	timer?: ReturnType<typeof setTimeout>;
}

const turnId = (session: string, seq: number) => `${session}~${String(seq).padStart(6, '0')}`;

export interface CopilotParts {
	/** The seven commands of 3.5, in this order. */
	commands: ZodCommandDefinition[];
	/** `copilot-port-refuse`, which `INTERNAL_COMMANDS` keeps out of every list. */
	internal: ZodCommandDefinition[];
	/** `copilot-turn-settle`, in `BOOT_ONLY`. */
	bootOnly: ZodCommandDefinition[];
	/** `copilotSession`, `turn` and `trace`, declared on both registries from stage B (3.2). */
	contextFields: ContextFieldV2[];
	/**
	 * Last in the kernel's chain (6.1's fifth line, after access): until phase 4's steps land, a copilot call to a
	 * mutation, or to a mounted instance whose default mode is `ask`, is `AUTONOMY_UNAVAILABLE`, journaled.
	 */
	gate: CommandMiddleware;
	/** Stop every running turn, as a change of person or sign-out does (3.2). */
	stopAll(stoppedBy: 'session-changed' | 'person'): Promise<void>;
}

export function createCopilotParts(deps: CopilotDeps): CopilotParts {
	const { store, kit } = deps;
	const { z } = kit;
	const providers = (): readonly CopilotProviderV1[] => deps.options?.providers ?? [];
	const running = new Map<string, Running>();
	/** Sessions whose turn is being created: the second message of a pair is `COPILOT_TURN_RUNNING`. */
	const starting = new Set<string>();

	const fail = (
		code: Parameters<CopilotDeps['kit']['kernelFailure']>[0],
		message: string,
		suggestion: string,
		retryable = false
	): CommandResult<never> => kit.kernelFailure(code, message, suggestion, { retryable });

	const sessionNotFound = (id: string) =>
		fail('COPILOT_SESSION_NOT_FOUND', `No session '${id}' of yours`, SUGGESTIONS.SESSION_NOT_FOUND);

	/** The caller's own session, or nothing: another person's answers as one that does not exist. */
	async function own(person: string, id: string): Promise<CopilotSessionV1 | undefined> {
		if (!SESSION_ID.test(id)) return undefined;
		const row = await store.get<CopilotSessionV1>(COPILOT_SESSION_TABLE, id);
		return row && row.person === person ? row : undefined;
	}

	async function turnsOf(session: string): Promise<CopilotTurnV1[]> {
		const listed = await store.list<CopilotTurnV1 & { id: string }>(COPILOT_TURN_TABLE, {
			session,
		} as never);
		const turns = listed.data
			.filter((row) => row.session === session)
			.map(({ id: _id, ...turn }) => turn as CopilotTurnV1)
			.sort((a, b) => a.seq - b.seq);
		// A running turn's calls are in memory until it settles.
		const live = running.get(session);
		return live
			? turns.map((turn) => (turn.seq === live.turn.seq ? copy(live.turn) : turn))
			: turns;
	}

	const copy = (turn: CopilotTurnV1): CopilotTurnV1 => structuredClone(turn);

	const newSessionId = (context: CommandContext): string => {
		const hex = () =>
			Math.floor((context.random?.next() ?? Math.random()) * 0x100000000)
				.toString(16)
				.padStart(8, '0');
		return `cps_${hex()}${hex()}`;
	};

	const scopeOf = (context: CommandContext): { project?: string } => {
		const project = (context as { scope?: ScopeV1 }).scope?.project;
		return project ? { project } : {};
	};

	// ─── Settling ─────────────────────────────────────────────────────────────

	/**
	 * End a running turn once: revoke its capability, abort its run, and write the record through the kernel's own
	 * `copilot-turn-settle`. A later report for the same turn is ignored.
	 */
	async function finish(
		session: string,
		seq: number,
		outcome: Partial<CopilotTurnOutcomeV1> & { state: CopilotTurnOutcomeV1['state'] }
	): Promise<CopilotTurnV1 | undefined> {
		const live = running.get(session);
		if (!live || live.turn.seq !== seq || live.revoked) return undefined;
		live.revoked = true;
		running.delete(session);
		if (live.timer) clearTimeout(live.timer);
		live.controller.abort();
		const turn: CopilotTurnV1 = {
			...live.turn,
			state: outcome.state,
			reply: (outcome.reply ?? live.turn.reply).slice(0, REPLY_MAX),
			usage: outcome.usage ?? live.turn.usage,
			...(outcome.stoppedBy ? { stoppedBy: outcome.stoppedBy } : {}),
			...(outcome.failure ? { failure: { code: outcome.failure.code } } : {}),
		};
		await deps.runBoot(COPILOT_TURN_SETTLE, { turn });
		live.resolve(turn);
		return turn;
	}

	// ─── The agent port's kernel half (3.2) ───────────────────────────────────

	function capabilityFor(live: Running): CopilotAgentCapabilityV1 {
		const { session } = live;
		const scope: ScopeV1 | 'workspace' = session.scope.project
			? { workspace: deps.workspace, project: session.scope.project }
			: 'workspace';
		let calls = 0;
		/**
		 * Whether the person the kernel decides for is still the session's: on a change of person every turn stops, and
		 * a call that races the change is refused rather than run for the next person (3.2).
		 */
		const samePerson = (): boolean => {
			if (deps.person() === session.person) return true;
			void finish(session.id, live.turn.seq, { state: 'stopped', stoppedBy: 'session-changed' });
			return false;
		};
		const refuse = (reason: string, keys: readonly string[]) =>
			deps.callAsCopilot(
				COPILOT_PORT_REFUSE,
				{ reason: reason.slice(0, 128), keys: keys.slice(0, 32).map((key) => key.slice(0, 64)) },
				{ session: session.id, turn: live.turn.seq, call: 'port' },
				scope
			);
		return {
			refuse,
			async call(name, input) {
				if (live.revoked) return refuse('The turn has ended', ['call']);
				if (!samePerson()) return refuse('The person changed', ['call']);
				// The session's limit cannot be skipped: a confirmation is read through `confirmation` alone (3.2).
				if (typeof name !== 'string' || name.startsWith('confirmation-'))
					return refuse('Not a command the copilot calls', ['name']);
				calls += 1;
				const callId = `cpc_${String(calls).padStart(4, '0')}`;
				if (calls > TURN_LIMITS.calls) {
					void finish(session.id, live.turn.seq, {
						state: 'stopped',
						stoppedBy: 'limit',
					});
					return refuse('The turn reached its limit of calls', ['call']);
				}
				const trace = { session: session.id, turn: live.turn.seq, call: callId };
				const result = await deps.callAsCopilot(name, input, trace, scope);
				const instance = deps.instanceOf(name);
				const entry: CopilotCallV1 = {
					callId,
					command: name,
					...(instance ? { instance } : {}),
					inputDigest: await deps.digest(input ?? {}),
					mode: 'act',
					outcome: result.success ? 'ok' : 'error',
					...(result.success ? {} : { code: result.error?.code ?? 'UNKNOWN' }),
					...(result.success && typeof result.undoCommand === 'string'
						? { undo: result.undoCommand }
						: {}),
					// Before step 4 the copilot reaches no mounted instance, so every result it receives is trusted.
					labels: { content: 0, server: 0, trusted: 1 },
				};
				if (!live.revoked) live.turn.calls.push(entry);
				return result;
			},
			async listCommands() {
				if (live.revoked || !samePerson()) return [];
				return toolsFor();
			},
			async confirmation() {
				// No confirmation is raised before step 3, so this session raised none to read (6.2).
				return refuse('No confirmation of this session has that id', ['notification']);
			},
		};
	}

	/** 4.5's list: the agent interface's commands, less every one the copilot may not reach. */
	function toolsFor(): ToolDescriptorV1[] {
		return deps
			.agentCommands()
			.filter(
				(command) =>
					!deps.internal(command.name) &&
					!deps.humanOnly(command.name) &&
					// No mounted tool is listed until step 4, so no mounted content reaches a session before taint (4.5).
					!deps.isMounted(command.name) &&
					!command.name.startsWith('confirmation-') &&
					!CHROME_ONLY.includes(command.name)
			)
			.slice(0, TOOLS_MAX)
			.map((command) => ({
				name: command.name,
				description: command.description,
				inputSchema:
					command.inputSchema && typeof command.inputSchema === 'object'
						? (command.inputSchema as Record<string, unknown>)
						: { type: 'object' },
			}));
	}

	// ─── The commands (3.5) ───────────────────────────────────────────────────

	const sessionRef = z.string().check(z.minLength(1), z.maxLength(64));
	const SESSION_JSON = { type: 'string' as const, minLength: 1, maxLength: 64 };

	const startInput = z.strictObject({
		title: z.optional(z.string().check(z.minLength(1), z.maxLength(TITLE_MAX))),
	});
	const sessionStart = kit.define<typeof startInput, { session: CopilotSessionV1 }>({
		name: 'copilot-session-start',
		title: 'Start a copilot session',
		description: 'Start a copilot conversation in the current scope',
		category: 'copilot',
		mutation: true,
		executionTime: 'fast',
		input: startInput,
		jsonSchema: {
			type: 'object',
			properties: { title: { type: 'string', minLength: 1, maxLength: TITLE_MAX } },
			additionalProperties: false,
		},
		async handler(input, context) {
			const person = kit.personOf(context);
			const configured = providers();
			const provider = configured.some((entry) => entry.id === deps.options?.default)
				? (deps.options?.default as string)
				: (configured[0]?.id ?? '');
			const session: CopilotSessionV1 = {
				id: newSessionId(context),
				scope: scopeOf(context),
				person,
				provider,
				title: input.title ?? 'Untitled',
				taint: [],
				createdAt: kit.callNow(context),
			};
			await store.create(COPILOT_SESSION_TABLE, session);
			return kit.success({ session });
		},
	});

	const sendInput = z.strictObject({
		session: sessionRef,
		text: z.string().check(z.minLength(1), z.maxLength(TEXT_MAX)),
		attach: z.optional(z.array(z.unknown()).check(z.maxLength(10))),
		wait: z.optional(z.boolean()),
	});
	const messageSend = kit.define<typeof sendInput, { turn: CopilotTurnV1 }>({
		name: 'copilot-message-send',
		title: 'Send the copilot a message',
		description:
			'Send a message to a copilot session; the copilot answers with the commands you could run yourself',
		category: 'copilot',
		mutation: true,
		executionTime: 'slow',
		input: sendInput,
		jsonSchema: {
			type: 'object',
			properties: {
				session: SESSION_JSON,
				text: { type: 'string', minLength: 1, maxLength: TEXT_MAX },
				attach: { type: 'array', items: {} as never, maxItems: 10 },
				wait: { type: 'boolean' },
			},
			required: ['session', 'text'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const person = kit.personOf(context);
			const session = await own(person, input.session);
			if (!session) return sessionNotFound(input.session);
			const configured = providers();
			if (configured.length === 0 || !deps.options?.runner) {
				return fail(
					'COPILOT_PROVIDER_MISSING',
					'No model is configured for the copilot',
					SUGGESTIONS.PROVIDER_MISSING
				);
			}
			const provider = configured.find((entry) => entry.id === session.provider);
			if (!provider) {
				return fail(
					'COPILOT_PROVIDER_UNKNOWN',
					`The session's provider '${session.provider}' is not configured here`,
					SUGGESTIONS.PROVIDER_UNKNOWN
				);
			}
			if (running.has(session.id) || starting.has(session.id)) {
				return fail(
					'COPILOT_TURN_RUNNING',
					'A turn of this session is still running',
					SUGGESTIONS.TURN_RUNNING,
					true
				);
			}
			// Attachments are given to the model as content, which taints the session (3.5, 5.1). Taint is step 4's,
			// so until then an attachment is refused rather than given untainted.
			if ((input.attach?.length ?? 0) > 0) {
				return fail(
					'VALIDATION_ERROR',
					'Attachments are not given to the copilot yet',
					'Send the text alone; attachments come with labels and taint'
				);
			}
			// Held from here until the turn is running, so a second message cannot start one beside it.
			starting.add(session.id);
			let previous: CopilotTurnV1[];
			try {
				previous = await turnsOf(session.id);
			} catch (cause) {
				starting.delete(session.id);
				throw cause;
			}
			const seq = (previous.at(-1)?.seq ?? 0) + 1;
			const turn: CopilotTurnV1 = {
				session: session.id,
				seq,
				text: input.text,
				attach: [],
				state: 'running',
				calls: [],
				reply: '',
				usage: { inputTokens: 0, outputTokens: 0 },
			};
			try {
				await store.create(COPILOT_TURN_TABLE, { id: turnId(session.id, seq), ...turn });
			} finally {
				starting.delete(session.id);
			}
			let resolve!: (turn: CopilotTurnV1) => void;
			const settled = new Promise<CopilotTurnV1>((done) => {
				resolve = done;
			});
			const live: Running = {
				turn: copy(turn),
				session,
				controller: new AbortController(),
				revoked: false,
				settled,
				resolve,
			};
			running.set(session.id, live);
			// 4.4's seconds: a turn that runs past them stops with `stoppedBy: 'limit'`.
			live.timer = setTimeout(
				() => void finish(session.id, seq, { state: 'stopped', stoppedBy: 'limit' }),
				TURN_LIMITS.seconds * 1000
			);
			const history = previous.flatMap((earlier) => [
				{ role: 'user' as const, text: earlier.text },
				...(earlier.reply ? [{ role: 'assistant' as const, text: earlier.reply }] : []),
			]);
			try {
				deps.options.runner.start({
					session,
					turn: seq,
					runId: deps.options.takeRunId?.(session.id) ?? `run_${session.id}_${seq}`,
					provider: { id: provider.id, kind: provider.kind, model: provider.model },
					history,
					text: input.text,
					agent: capabilityFor(live),
					settle: (outcome) => void finish(session.id, seq, outcome),
					signal: live.controller.signal,
				});
			} catch {
				await finish(session.id, seq, {
					state: 'failed',
					failure: { code: 'COPILOT_RUNTIME_FAILED' },
				});
			}
			if (input.wait === false) return kit.success({ turn: copy(live.turn) });
			let timer: ReturnType<typeof setTimeout> | undefined;
			const waited = await Promise.race([
				settled,
				new Promise<undefined>((done) => {
					timer = setTimeout(() => done(undefined), MESSAGE_WAIT_MS);
				}),
			]);
			clearTimeout(timer);
			return kit.success({ turn: waited ?? copy(live.turn) });
		},
	});

	const stopInput = z.strictObject({
		session: sessionRef,
		turn: z.int().check(z.minimum(1)),
	});
	const turnStop = kit.define<typeof stopInput, { turn: CopilotTurnV1 }>({
		name: 'copilot-turn-stop',
		title: 'Stop the copilot',
		description: 'Stop a running copilot turn at once, and list every call it had made',
		category: 'copilot',
		mutation: true,
		executionTime: 'fast',
		input: stopInput,
		jsonSchema: {
			type: 'object',
			properties: {
				session: SESSION_JSON,
				turn: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
			},
			required: ['session', 'turn'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const session = await own(kit.personOf(context), input.session);
			if (!session) return sessionNotFound(input.session);
			const stopped = await finish(session.id, input.turn, {
				state: 'stopped',
				stoppedBy: 'person',
			});
			if (stopped) return kit.success({ turn: stopped });
			const found = (await turnsOf(session.id)).find((turn) => turn.seq === input.turn);
			if (!found) {
				return fail(
					'COPILOT_SESSION_NOT_FOUND',
					`Session '${session.id}' has no turn ${input.turn}`,
					SUGGESTIONS.SESSION_NOT_FOUND
				);
			}
			// A settled turn is returned as it is (3.5).
			return kit.success({ turn: found });
		},
	});

	const listInput = z.strictObject({
		limit: z.optional(z.int().check(z.minimum(1), z.maximum(50))),
		before: z.optional(sessionRef),
	});
	const sessionList = kit.define<typeof listInput, { sessions: CopilotSessionV1[]; next?: string }>(
		{
			name: 'copilot-session-list',
			title: 'List copilot sessions',
			description: 'List your copilot sessions, newest first',
			category: 'copilot',
			mutation: false,
			executionTime: 'fast',
			input: listInput,
			jsonSchema: {
				type: 'object',
				properties: {
					limit: { type: 'integer', minimum: 1, maximum: 50 },
					before: SESSION_JSON,
				},
				additionalProperties: false,
			},
			expose: COPILOT_EXPOSE,
			async handler(input, context) {
				const person = kit.personOf(context);
				const listed = await store.list<CopilotSessionV1>(COPILOT_SESSION_TABLE, {
					person,
				} as never);
				const all = listed.data
					.filter((row) => row.person === person)
					.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
				const at = input.before ? all.findIndex((row) => row.id === input.before) : -1;
				// A cursor that names no session of yours ends the list: it never starts it again.
				if (input.before && at < 0) return kit.success({ sessions: [] });
				const from = input.before ? at + 1 : 0;
				const limit = input.limit ?? 20;
				const sessions = all.slice(from, from + limit);
				const next = from + limit < all.length ? sessions.at(-1)?.id : undefined;
				return kit.success({ sessions, ...(next ? { next } : {}) });
			},
		}
	);

	const getInput = z.strictObject({
		session: sessionRef,
		from: z.optional(z.int().check(z.minimum(1))),
		limit: z.optional(z.int().check(z.minimum(1), z.maximum(20))),
	});
	const sessionGet = kit.define<
		typeof getInput,
		{ session: CopilotSessionV1; turns: CopilotTurnV1[] }
	>({
		name: 'copilot-session-get',
		title: 'Show a copilot session',
		description: 'Show a copilot session with its turns, the calls each made and how each ended',
		category: 'copilot',
		mutation: false,
		executionTime: 'fast',
		input: getInput,
		jsonSchema: {
			type: 'object',
			properties: {
				session: SESSION_JSON,
				from: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
				limit: { type: 'integer', minimum: 1, maximum: 20 },
			},
			required: ['session'],
			additionalProperties: false,
		},
		expose: COPILOT_EXPOSE,
		async handler(input, context) {
			const session = await own(kit.personOf(context), input.session);
			if (!session) return sessionNotFound(input.session);
			const from = input.from ?? 1;
			const turns = (await turnsOf(session.id))
				.filter((turn) => turn.seq >= from)
				.slice(0, input.limit ?? 20);
			return kit.success({ session, turns });
		},
	});

	const empty = z.strictObject({});
	const providerList = kit.define<
		typeof empty,
		{ providers: Array<CopilotProviderV1 & { default: boolean }> }
	>({
		name: 'copilot-provider-list',
		title: 'List copilot models',
		description: 'List the models this deployment offers the copilot, never a key or an endpoint',
		category: 'copilot',
		mutation: false,
		executionTime: 'fast',
		input: empty,
		jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
		expose: COPILOT_EXPOSE,
		async handler() {
			const configured = providers();
			const chosen = configured.some((entry) => entry.id === deps.options?.default)
				? deps.options?.default
				: configured[0]?.id;
			return kit.success({
				providers: configured.map(({ id, kind, model }) => ({
					id,
					kind,
					model,
					default: id === chosen,
				})),
			});
		},
	});

	const healthInput = z.strictObject({
		project: z.optional(sessionRef),
		since: z.optional(z.number().check(z.minimum(0))),
	});
	const approvalHealth = kit.define<typeof healthInput, ApprovalHealthV1>({
		name: 'approval-health-get',
		title: 'Show approval health',
		description:
			'How often agents asked you, what you approved and what ran without asking, per command',
		category: 'copilot',
		mutation: false,
		executionTime: 'fast',
		input: healthInput,
		jsonSchema: {
			type: 'object',
			properties: {
				project: { type: 'string', minLength: 1, maxLength: 64 },
				since: { type: 'number', minimum: 0 },
			},
			additionalProperties: false,
		},
		expose: COPILOT_EXPOSE,
		async handler(input, context) {
			const person = kit.personOf(context);
			const listed = await store.list<CopilotSessionV1>(COPILOT_SESSION_TABLE, {
				person,
			} as never);
			const sessions = listed.data.filter(
				(row) =>
					row.person === person &&
					(input.project === undefined || row.scope.project === input.project)
			);
			// Before step 3 nothing asks or suggests, so every count but `acted` is 0: a call the copilot made in `act`
			// that reached its command. Step 3 keeps 6.3's counters by day; this reads the turns.
			const rows = new Map<string, ApprovalHealthRowV1>();
			for (const session of sessions) {
				if (input.since !== undefined && session.createdAt < input.since) continue;
				for (const turn of await turnsOf(session.id)) {
					for (const call of turn.calls) {
						if (call.mode !== 'act' || call.code === 'AUTONOMY_UNAVAILABLE') continue;
						const key = `${call.instance ?? ''}\u0000${call.command}`;
						const row = rows.get(key) ?? {
							...(call.instance ? { instance: call.instance } : {}),
							command: call.command,
							reason: 'policy' as const,
							...zeroCounters(),
						};
						row.acted += 1;
						rows.set(key, row);
					}
				}
			}
			const totals = zeroCounters();
			for (const row of rows.values()) totals.acted += row.acted;
			const rate = (top: number, bottom: number) => (bottom === 0 ? null : top / bottom);
			return kit.success({
				totals,
				askRate: rate(totals.asked, totals.acted + totals.asked),
				confirmRate: rate(totals.confirmed, totals.asked),
				declineRate: rate(totals.declined, totals.asked),
				rows: [...rows.values()],
				flags: [],
			});
		},
	});

	// ─── Internal and boot-only ───────────────────────────────────────────────

	const refuseInput = z.strictObject({
		reason: z.string().check(z.maxLength(128)),
		keys: z.array(z.string().check(z.maxLength(64))).check(z.maxLength(32)),
	});
	const portRefuse = kit.define<typeof refuseInput, never>({
		name: COPILOT_PORT_REFUSE,
		description: 'The agent port’s refusal of a message it does not define, journaled (internal)',
		category: 'copilot',
		mutation: false,
		executionTime: 'fast',
		input: refuseInput,
		jsonSchema: { type: 'object' },
		async handler(input) {
			return fail(
				'COPILOT_PORT_REFUSED',
				`The copilot's port refused a message: ${input.reason}${input.keys.length ? ` (${input.keys.join(', ')})` : ''}`,
				SUGGESTIONS.PORT_REFUSED
			);
		},
	});

	const settleInput = z.strictObject({ turn: z.unknown() });
	const turnSettle = kit.define<typeof settleInput, { turn: CopilotTurnV1 }>({
		name: COPILOT_TURN_SETTLE,
		description: 'The kernel’s record of how a copilot turn ended (boot-only)',
		category: 'copilot',
		mutation: true,
		executionTime: 'fast',
		input: settleInput,
		jsonSchema: { type: 'object' },
		async handler(input) {
			const turn = input.turn as CopilotTurnV1;
			const id = turnId(turn.session, turn.seq);
			const row = { id, ...turn };
			if (await store.get(COPILOT_TURN_TABLE, id)) await store.update(COPILOT_TURN_TABLE, id, row);
			else await store.create(COPILOT_TURN_TABLE, row);
			return kit.success({ turn });
		},
	});

	// ─── The gate (6.1) ───────────────────────────────────────────────────────

	const gate: CommandMiddleware = async (name, _input, context, next) => {
		const trace = (context as { trace?: CopilotTraceV1 }).trace;
		// The copilot's own calls only, and only its top-level call: a nested call runs inside the call this gate let
		// through, and its own checks (a handler's nested mutation is refused) still apply.
		if (trace === undefined || context.parent !== undefined || context.caller !== undefined)
			return next();
		if (name === COPILOT_PORT_REFUSE) return next();
		if (deps.isMutation(name)) {
			return fail(
				'AUTONOMY_UNAVAILABLE',
				`'${name}' changes something, and the copilot can only read until autonomy is enforced`,
				SUGGESTIONS.AUTONOMY_UNAVAILABLE
			);
		}
		// A mounted tool's default mode is `ask` (phase 4's 4.2), and nothing can ask yet: refused, so no mounted
		// content reaches a session before step 4's labels and taint, even by a name the copilot was not listed.
		if (deps.isMounted(name)) {
			return fail(
				'AUTONOMY_UNAVAILABLE',
				`'${name}' is a mounted server's command, which the copilot cannot call until autonomy is enforced`,
				SUGGESTIONS.AUTONOMY_UNAVAILABLE
			);
		}
		return next();
	};

	const contextFields: ContextFieldV2[] = [
		// `session` is a name AFD sets itself (the auth session), so the copilot's session is `copilotSession`.
		{
			name: 'copilotSession',
			meta: 'dev.loam/copilot-session',
			schema: z.string().check(z.minLength(1), z.maxLength(64)),
			journal: true,
		},
		{
			name: 'turn',
			meta: 'dev.loam/turn',
			schema: z.int().check(z.minimum(1)),
			journal: true,
		},
		{
			name: 'trace',
			meta: 'dev.loam/trace',
			schema: z.strictObject({
				session: z.string().check(z.minLength(1), z.maxLength(64)),
				turn: z.int().check(z.minimum(1)),
				call: z.string().check(z.minLength(1), z.maxLength(64)),
			}),
			journal: true,
		},
	];

	return {
		commands: [
			sessionStart,
			messageSend,
			turnStop,
			sessionList,
			sessionGet,
			providerList,
			approvalHealth,
		] as unknown as ZodCommandDefinition[],
		internal: [portRefuse] as unknown as ZodCommandDefinition[],
		bootOnly: [turnSettle] as unknown as ZodCommandDefinition[],
		contextFields,
		gate,
		async stopAll(stoppedBy) {
			await Promise.all(
				[...running.values()].map((live) =>
					finish(live.session.id, live.turn.seq, { state: 'stopped', stoppedBy })
				)
			);
			// A change of person also removes every runtime: the frame goes, with whatever it held (3.2).
			if (stoppedBy === 'session-changed') deps.options?.runner?.reset?.();
		},
	};
}

/** 6.3's counters. */
export interface ApprovalCountersV1 {
	acted: number;
	asked: number;
	confirmed: number;
	declined: number;
	expired: number;
	withdrawn: number;
	suggested: number;
	ranSuggestion: number;
}

export interface ApprovalHealthRowV1 extends ApprovalCountersV1 {
	instance?: string;
	command: string;
	reason: 'policy' | 'taint' | 'unit';
}

/** `approval-health-get`'s answer (6.3). */
export interface ApprovalHealthV1 {
	totals: ApprovalCountersV1;
	askRate: number | null;
	confirmRate: number | null;
	declineRate: number | null;
	rows: ApprovalHealthRowV1[];
	flags: Array<{ code: string; message: string }>;
}

const zeroCounters = (): ApprovalCountersV1 => ({
	acted: 0,
	asked: 0,
	confirmed: 0,
	declined: 0,
	expired: 0,
	withdrawn: 0,
	suggested: 0,
	ranSuggestion: 0,
});
