/**
 * @fileoverview The copilot's records and commands (phase 5 specification, 3.4 and 3.5), the agent port's kernel
 * half (3.2), autonomy enforced on the agent interface (6.1, `enforce.ts`), a turn that waits on the person and
 * continues once they answer (3.5), approval health (6.3, `health.ts`), and labels and taint (5.1, 5.3, `labels.ts`,
 * `taint.ts`). In the
 * `late-copilot` chunk, which `late/` loads in stage B: it imports types alone, and every function it shares with
 * first paint or `late` reaches it through {@link CopilotDeps}' kit, as `late-documents`' does (2.4).
 */

import type { CommandContext, CommandMiddleware, CommandResult } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { ConfirmationAskedV1, ResourceLinkV1 } from '@lushly-dev/loam-sdk';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { DocumentKit } from '../scope/command-kit.js';
import type { ScopeV1 } from '../scope/records.js';
import type { ContextField } from '../types.js';
import {
	ATTACH_JSON,
	attachSchema,
	readAttachments,
	rebuildAttachments,
	validateAttachments,
} from './attachments.js';
import {
	type AutonomyModeV1,
	createEnforcement,
	type DecisionV1,
	type Enforcement,
	SUGGESTION_ID,
	SUGGESTION_TABLE,
	type SuggestionV1,
} from './enforce.js';
import { copilotContextFields } from './fields.js';
import { type ApprovalHealthV1, createHealth, type HealthReasonV1 } from './health.js';
import { forRuntime, listTools } from './labels.js';
import {
	AGENT_CHANNELS,
	CHROME_ONLY,
	CONFIRMATION_OWN,
	continuation,
	createConfirmationTracker,
	SUGGESTIONS,
	writesRecords,
} from './pending.js';
import { createTaint } from './taint.js';
import type {
	AttachedContentV1,
	CopilotAgentCapabilityV1,
	CopilotCallV1,
	CopilotConfirmationCardV1,
	CopilotOptionsV1,
	CopilotProviderV1,
	CopilotSessionV1,
	CopilotSuggestionCardV1,
	CopilotTraceV1,
	CopilotTurnOutcomeV1,
	CopilotTurnV1,
	ToolDescriptorV1,
} from './types.js';
import { createUnits, unitInvalid } from './units.js';

export type { CopilotConfirmationCardV1, CopilotSuggestionCardV1 } from './types.js';

/** The person's records (3.4): sessions listed by `person`, turns by `session`. */
export const COPILOT_SESSION_TABLE = 'copilot-session';
export const COPILOT_TURN_TABLE = 'copilot-turn';

export const COPILOT_HUMAN_COMMANDS = Object.freeze([
	'copilot-session-start',
	'copilot-message-send',
	'copilot-turn-stop',
] as const);
export const COPILOT_QUERIES = Object.freeze([
	'copilot-session-list',
	'copilot-session-get',
	'copilot-provider-list',
	'approval-health-get',
] as const);
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

const TURN_LIMITS = Object.freeze({
	calls: 40,
	iterations: 16,
	seconds: 600,
	inputTokens: 1_000_000,
	outputTokens: 16_384,
});

export { TURN_LIMITS };
export const TOOLS_MAX = 128;

const TEXT_MAX = 32_768;
const REPLY_MAX = 65_536;
const TITLE_MAX = 80;
const SESSION_ID = /^cps_[0-9a-f]{16}$/;

/** What the copilot chunk needs from the kernel. */
export interface CopilotDeps {
	/** The workspace store: the person's sessions and turns, each carrying `person`. */
	store: DataAdapter;
	workspace: string;
	options?: CopilotOptionsV1 | undefined;
	kit: Pick<
		DocumentKit,
		'define' | 'success' | 'kernelFailure' | 'personOf' | 'callNow' | 'z' | 'projectNotFound'
	>;
	/** Whether the call's actor may enter its scope (6.1's order: access before the mode). Absent: every scope. */
	enterable?(context: CommandContext): boolean;
	isMutation(name: string): boolean;
	/** A mounted instance's command: its result is the server's, `content` whole unless its entry says `per-part` (5.1). */
	isMounted(name: string): boolean;
	/** Mounted command metadata: instance, `labels`, whether named, and deployer text (4.5, 5.1). */
	mountOf?(
		name: string
	):
		| { instance: string; labels: 'whole' | 'per-part'; named: boolean; deployerText: string }
		| undefined;
	/** A native or view app's command whose app holds the `http` grant (5.3). Absent: none does. */
	holdsHttp?(name: string): boolean;
	/** The mounted instances whose servers' words a shell read's result can carry (a catalog, B1). Absent: none. */
	mountWordsOf?(
		name: string,
		input: unknown,
		result: CommandResult
	): { whole: string[]; vouched: string[] };
	/** The owning instance of an app's command. */
	instanceOf(name: string): string | undefined;
	/** The shell's name for a mounted instance's own tool, as its server names it (7.3's submit). Absent: none. */
	commandOfTool?(instance: string, tool: string): string | undefined;
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
	/** Writes whose own handler refuses agents with `HUMAN_REQUIRED` hand-off (phase 4's 3.2). */
	handlerRefuses?(name: string, input: unknown): boolean;
	/** Commands `listCommands` never reports. */
	internal(name: string): boolean;
	/** `sha256:` and the hex SHA-256 of canonical JSON. */
	digest(value: unknown): Promise<string>;
	/** The kernel's clock. */
	now(): number;
	/** The person the kernel decides for now: a turn acts only while it is still its session's person (3.2). */
	person(): string;
	/** 4.2's resolution for one call (6.1), phase 4's `resolveAutonomy` over the rows and the person's cap. */
	resolve?(
		name: string,
		context: CommandContext
	): Promise<{ mode: AutonomyModeV1; chain: ConfirmationAskedV1['chain'] } | undefined>;
	/** A destructive or approval-held command, at most `ask` for an agent (6.1), by which. */
	heldBy?(name: string): 'destructive' | 'approval' | undefined;
	/** A refusal a command's own path makes before it runs, which no question may precede (6.1's order). */
	preflight?(name: string, context: CommandContext): CommandResult<never> | undefined;
	/** Whether the journal records a call of `name` (approval health counts what a replay sees). Absent: all. */
	journaled?(name: string, context?: CommandContext): boolean;
	/** A command that declares a `confirm_prompt` (phase 4's 7.2). */
	declares?(name: string): boolean;
	/** Never asked or suggested (6.1), beside `humanOnly`, `handlerRefuses` and `internal`: person-session commands. */
	personSession?(name: string): boolean;
	/** A confirmation of the person's, as a card draws it and the waiting turn reads its state (3.5, 6.2). */
	confirmationOf?(
		id: string,
		person: string,
		/** `reader`: a caller reading it, whose access to its scope is checked, an absent actor included. */
		options?: { now?: number; reader?: { actor: unknown }; traceId?: string | undefined }
	): Promise<CopilotConfirmationCardV1 | undefined>;
	/** `decideAccess` on a record's scope, for the actor reading it now (the inbox's rule). Absent: every scope. */
	allows?(actor: unknown, scope: ScopeV1): boolean;
	/** The person's confirmations an agent raised that still wait, for approval health's `expired` (6.3). */
	pendingAsked?(
		person: string,
		traceId?: string
	): Promise<Array<{ command: string; scope: ScopeV1; reason: HealthReasonV1; createdAt: number }>>;
	/** Withdraw the person's pending confirmations a turn raised, by session+turn or id (3.5). */
	withdraw?(
		context: CommandContext | undefined,
		match: { session: string; turn: number } | { id: string },
		person: string
	): Promise<number>;
	/** Read one attached resource link as the calling person under `decideAccess` (3.5, 5.1). */
	readAttachment?(
		link: ResourceLinkV1,
		context?: CommandContext
	): Promise<AttachedContentV1 | CommandResult<never>>;
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
	/** What the turn spent before this run: a continuation keeps the turn's limits (3.5, 4.4). */
	spent: Spent;
	/** When this run started, on the kernel's clock. */
	startedAt: number;
	/** The confirmations this turn raised that may still wait, with their `expiresAt` (3.5). */
	pending: Map<string, number>;
	/** The reply before this run, which a continuation's text follows. */
	replyBefore: string;
}

/** A turn's spending across its runs (4.4). */
interface Spent {
	calls: number;
	rounds: number;
	/** Its unit composers' output tokens, within `usage` (7.3). */
	unitOutput?: number;
	elapsedMs: number;
	usage: { inputTokens: number; outputTokens: number };
}

/** A turn that waits on the person's answers: it continues, once, when every one of them has ended (3.5). */
interface Waiting {
	turn: CopilotTurnV1;
	session: CopilotSessionV1;
	pending: Map<string, number>;
	spent: Spent;
	timer?: ReturnType<typeof setTimeout>;
	checking?: Promise<void>;
	/** The write that made it `waiting`, which an end waits for, so its own write lands last. */
	settling?: Promise<unknown>;
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
	contextFields: ContextField[];
	/**
	 * After access, before the confirmations' gate (6.1's order): the mode of every top-level call on the agent interface,
	 * the copilot's and any other agent's, from phase 4's `resolveAutonomy` (`enforce.ts`).
	 */
	gate: CommandMiddleware;
	/** Stop every running turn, as a change of person or sign-out does (3.2). */
	stopAll(stoppedBy: 'session-changed' | 'person'): Promise<void>;
	/** Told by phase 4's confirmations when an agent's confirmation is raised or ends (6.3, 3.5). */
	observe(
		event: 'asked' | 'confirmed' | 'declined' | 'withdrawn',
		row: {
			id: string;
			person: string;
			scope: ScopeV1;
			createdAt: number;
			confirmation: { command: string; asked?: ConfirmationAskedV1; session?: string };
		},
		replacedBy?: {
			id: string;
			confirmation: { expiresAt: number };
		}
	): Promise<void>;
	/** The person's live suggestion, and its run, for `palette-run`'s "Run it" (6.1). */
	suggestions: Pick<Enforcement, 'suggestion' | 'ran'>;
}

export function createCopilotParts(deps: CopilotDeps): CopilotParts {
	const { store, kit } = deps;
	const { z } = kit;
	const providers = (): readonly CopilotProviderV1[] => deps.options?.providers ?? [];
	const running = new Map<string, Running>();
	/** Sessions whose turn is being created: the second message of a pair is `COPILOT_TURN_RUNNING`. */
	const starting = new Set<string>();
	/** Moved by every change of person: a turn whose start began before one never launches (step 2's trust review). */
	let epoch = 0;
	/** Turns that wait on the person's answers, by session (3.5). */
	const waiting = new Map<string, Waiting>();
	/** Waiting turns whose end is being written: their confirmations are still held (re-check 6). */
	const ending = new Set<Waiting>();
	/** Kernel-verified confirmations raised per session and reshow replacement mappings (#2307). */
	const tracker = createConfirmationTracker();
	/** What the gate decided for each copilot call, by its trace, until the port's half records it (3.4). */
	const decisions = new Map<string, DecisionV1>();
	const traceKey = (trace: CopilotTraceV1) => `${trace.session}/${trace.turn}/${trace.call}`;
	const health = createHealth({ store, workspace: deps.workspace });
	const taint = createTaint({
		store,
		sessionTable: COPILOT_SESSION_TABLE,
		commandOf: (name) => ({
			instance: deps.instanceOf(name),
			mounted: deps.isMounted(name),
			labels: deps.mountOf?.(name)?.labels,
		}),
		mountWordsOf: (name, input, result) =>
			deps.mountWordsOf?.(name, input, result) ?? { whole: [], vouched: [] },
		personOf: (context) => kit.personOf(context),
		now: (context) => kit.callNow(context),
		submitting: (trace) => units.submitting(trace),
	});
	/** Fresh-context units (7.3): the composer's unit, and its submit, apart from the parent. */
	const units = createUnits({
		instanceOf: deps.instanceOf,
		commandOfTool: (instance, tool) => deps.commandOfTool?.(instance, tool),
		mountOf: (name) => deps.mountOf?.(name),
		heldBy: (name) => deps.heldBy?.(name),
		declares: (name) => deps.declares?.(name) === true,
		callAsCopilot: deps.callAsCopilot,
		forget(trace) {
			decisions.delete(traceKey(trace));
			nestedRaised.delete(traceKey(trace));
			taint.take(trace);
		},
	});
	/** The confirmations calls nested in a copilot call raised, by its trace, until the port's half reads them (B8). */
	const nestedRaised = new Map<string, string[]>();
	/** Each confirmation read of the port gets a trace of its own, so two reads' labels never meet (B10). */
	let reads = 0;
	/** Never asked or suggested (6.1). */
	const exempt = (name: string, input: unknown): boolean =>
		name === COPILOT_PORT_REFUSE ||
		deps.humanOnly(name) ||
		// A person-session command moves the person's view; signing in or out is refused in the gate (6.1).
		(deps.personSession?.(name) === true && !name.startsWith('auth-')) ||
		deps.handlerRefuses?.(name, input) === true ||
		deps.internal(name) ||
		CONFIRMATION_OWN.includes(name) ||
		(AGENT_CHANNELS.includes(name) && !writesRecords(name, input)) ||
		CHROME_ONLY.includes(name);
	const enforcement = createEnforcement({
		store,
		workspace: deps.workspace,
		health,
		resolve: (name, context) => deps.resolve?.(name, context) ?? Promise.resolve(undefined),
		isMutation: deps.isMutation,
		isMounted: deps.isMounted,
		heldBy: (name) => deps.heldBy?.(name),
		preflight: (name, context) => deps.preflight?.(name, context),
		journaled: (name, context) => deps.journaled?.(name, context) ?? true,
		// Marking read or archiving one notice that is a pending confirmation: refused as its handler refuses an agent
		// (10.2), on the call's own clock, so nothing ends between the decision and a write (re-check 2, B3).
		async handOff(name, input, context) {
			if (name !== 'notification-read' && name !== 'notification-archive') return undefined;
			const id = (input as { notification?: unknown } | null)?.notification;
			if (typeof id !== 'string') return undefined;
			// As the caller may read it now: one of a project they left is no answer at all (re-check 3).
			const card = await deps.confirmationOf?.(id, kit.personOf(context), {
				now: kit.callNow(context),
				reader: { actor: context.actor },
				traceId: context.traceId,
			});
			return card?.state === 'pending'
				? fail(
						'HUMAN_REQUIRED',
						'A confirmation waiting for the person is read or archived only by the person',
						'Tell the person it is in their inbox'
					)
				: undefined;
		},
		declares: (name) => deps.declares?.(name) === true,
		exempt,
		instanceOf: deps.instanceOf,
		taintOf: (session) => taint.sourcesOf(session),
		unitOf: (trace) => units.unitOf(trace),
		labelsOf: (name) => deps.mountOf?.(name)?.labels,
		holdsHttp: (name) => deps.holdsHttp?.(name) === true,
		personOf: (context) => kit.personOf(context),
		now: (context) => kit.callNow(context),
		decided(trace, decision) {
			decisions.set(traceKey(trace), decision);
			// Bounded: a decision the port never read (a nested or refused path) goes with the oldest.
			if (decisions.size > 256) decisions.delete(decisions.keys().next().value as string);
		},
		nestedRaised(trace, notification) {
			nestedRaised.set(traceKey(trace), [
				...(nestedRaised.get(traceKey(trace)) ?? []),
				notification,
			]);
			if (nestedRaised.size > 256) nestedRaised.delete(nestedRaised.keys().next().value as string);
		},
		kernelFailure: kit.kernelFailure,
		enterable: (context) => deps.enterable?.(context) ?? true,
		projectNotFound: () => kit.projectNotFound(),
	});

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
		// A running or waiting turn's in-memory calls (including reshow replacements) lead the stored copy.
		const active = running.get(session) ?? waiting.get(session);
		return active
			? turns.map((turn) => (turn.seq === active.turn.seq ? copy(active.turn) : turn))
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
		units.end(session, seq);
		if (live.timer) clearTimeout(live.timer);
		live.controller.abort();
		const spent: Spent = {
			calls: live.spent.calls,
			rounds: outcome.rounds ?? live.spent.rounds,
			unitOutput: outcome.unitOutput ?? live.spent.unitOutput,
			elapsedMs: live.spent.elapsedMs + Math.max(0, deps.now() - live.startedAt),
			usage: outcome.usage ?? live.turn.usage,
		};
		// A turn whose call is pending a confirmation waits, and continues once every one has ended (3.5).
		const waits = outcome.state === 'done' && live.pending.size > 0;
		const said = outcome.reply ?? '';
		const reply =
			live.replyBefore && said ? `${live.replyBefore}\n\n${said}` : live.replyBefore || said;
		const turn: CopilotTurnV1 = {
			...live.turn,
			state: waits ? 'waiting' : outcome.state,
			reply: (reply || live.turn.reply).slice(0, REPLY_MAX),
			usage: spent.usage,
			...(outcome.stoppedBy ? { stoppedBy: outcome.stoppedBy } : {}),
			...(outcome.failure ? { failure: { code: outcome.failure.code } } : {}),
		};
		// Held as waiting from before the write, so a stop or a new message during it finds the turn (the review's gap).
		const held: Waiting | undefined = waits
			? { turn: copy(turn), session: live.session, pending: live.pending, spent }
			: undefined;
		if (held) waiting.set(session, held);
		// Any other end withdraws the turn's pending confirmations (3.5): a stop, a limit, a failure, a change of person,
		// in the settle's own journaled entry, so a replay withdraws the same (the re-check's I3).
		const settling = deps.runBoot(COPILOT_TURN_SETTLE, {
			turn,
			...(waits ? {} : { withdraw: withdrawalOf(live.session, live.pending) }),
		});
		if (held) held.settling = settling;
		await settling;
		if (held && waiting.get(session) === held) void check(session);
		live.resolve(turn);
		return turn;
	}

	/** Withdraw what the turn raised that still waits, by the session and turn its records name (3.5). */
	const withdrawalOf = (session: CopilotSessionV1, pending: ReadonlyMap<string, number>) => ({
		person: session.person,
		// Those the turn holds, a pending one found on an earlier turn's key among them (the re-check's B4).
		ids: [...pending.keys()],
	});

	/** The outcome of each confirmation a waiting turn raised, once every one has ended; undefined while one waits. */
	async function check(session: string): Promise<void> {
		const held = waiting.get(session);
		if (!held) return;
		const run = async () => {
			if (waiting.get(session) !== held) return;
			let ended: Array<{ id: string; command: string; state: string }> = [];
			let latest = 0;
			let replaced = false;
			// Re-scan if a changed-preview reshow swaps `held.pending` while a read is in flight (#2307).
			for (let scan = 0; scan < 16; scan += 1) {
				ended = [];
				latest = 0;
				replaced = false;
				for (const [id, expiresAt] of [...held.pending]) {
					const card = await deps.confirmationOf?.(id, held.session.person);
					if (waiting.get(session) !== held) return;
					if (!held.pending.has(id)) {
						replaced = true;
						break;
					}
					if (card?.state === 'pending') {
						latest = Math.max(latest, card.expiresAt, expiresAt);
						continue;
					}
					// A row that has gone ended long ago.
					ended.push({
						id,
						command: card?.command ?? 'the command',
						state: card?.state ?? 'expired',
					});
				}
				if (!replaced) break;
			}
			if (waiting.get(session) !== held || replaced || starting.has(session)) return;
			if (latest > 0) {
				if (held.timer) clearTimeout(held.timer);
				held.timer = setTimeout(() => void check(session), Math.max(0, latest - deps.now()) + 50);
				return;
			}
			waiting.delete(session);
			if (held.timer) clearTimeout(held.timer);
			await resume(held, ended);
		};
		held.checking = (held.checking ?? Promise.resolve()).then(run, run);
		await held.checking;
	}

	/** Continue a waiting turn, once its confirmations have all ended, within the turn's limits (3.5, 4.4). */
	async function resume(
		held: Waiting,
		ended: ReadonlyArray<{ id: string; command: string; state: string }>
	): Promise<void> {
		const { session } = held;
		const provider = providers().find((entry) => entry.id === session.provider);
		const runner = deps.options?.runner;
		// A turn that cannot continue ends as it stands: done, its calls recorded.
		if (
			!provider ||
			!runner ||
			running.has(session.id) ||
			starting.has(session.id) ||
			deps.person() !== session.person
		) {
			await deps.runBoot(COPILOT_TURN_SETTLE, { turn: { ...held.turn, state: 'done' } });
			return;
		}
		const seq = held.turn.seq;
		const live = runningFor(session, { ...copy(held.turn), state: 'running' }, held.spent);
		live.replyBefore = held.turn.reply;
		running.set(session.id, live);
		armTimer(live);
		const [previous, rebuilt] = await Promise.all([
			turnsOf(session.id).then((all) => all.filter((turn) => turn.seq < seq)),
			rebuildAttachments(held.turn.attach, deps.readAttachment, fail),
		]);
		const history = [
			...historyOf(previous),
			{
				role: 'user' as const,
				text: held.turn.text,
				...(rebuilt.length > 0 ? { attachments: rebuilt } : {}),
			},
			...(held.turn.reply ? [{ role: 'assistant' as const, text: held.turn.reply }] : []),
		];
		// Stopped, or the person changed, while the history was read: it never starts (the review's gap).
		if (running.get(session.id) !== live || live.revoked || deps.person() !== session.person) {
			await finish(session.id, seq, { state: 'stopped', stoppedBy: 'session-changed' });
			return;
		}
		try {
			runner.start({
				session,
				turn: seq,
				runId: `run_${session.id}_${seq}_${held.spent.rounds}`,
				provider: { id: provider.id, kind: provider.kind, model: provider.model },
				history,
				text: continuation(ended),
				agent: capabilityFor(live),
				settle: (outcome) => void finish(session.id, seq, outcome),
				signal: live.controller.signal,
				spent: {
					usage: { ...held.spent.usage },
					rounds: held.spent.rounds,
					unitOutput: held.spent.unitOutput ?? 0,
				},
			});
		} catch {
			await finish(session.id, seq, {
				state: 'failed',
				failure: { code: 'COPILOT_RUNTIME_FAILED' },
			});
		}
	}

	/** A running turn's record in memory, with what it spent before (4.4). */
	function runningFor(session: CopilotSessionV1, turn: CopilotTurnV1, spent: Spent): Running {
		let resolve!: (turn: CopilotTurnV1) => void;
		const settled = new Promise<CopilotTurnV1>((done) => {
			resolve = done;
		});
		return {
			turn,
			session,
			controller: new AbortController(),
			revoked: false,
			settled,
			resolve,
			spent: structuredClone(spent),
			startedAt: deps.now(),
			pending: new Map(),
			replyBefore: '',
		};
	}

	/** 4.4's seconds, less what the turn spent before: past them it stops with `stoppedBy: 'limit'`. */
	function armTimer(live: Running): void {
		const left = Math.max(0, TURN_LIMITS.seconds * 1000 - live.spent.elapsedMs);
		live.timer = setTimeout(
			() => void finish(live.session.id, live.turn.seq, { state: 'stopped', stoppedBy: 'limit' }),
			left
		);
	}

	const historyOf = (turns: readonly CopilotTurnV1[]) =>
		turns.flatMap((earlier) => [
			{ role: 'user' as const, text: earlier.text },
			...(earlier.reply ? [{ role: 'assistant' as const, text: earlier.reply }] : []),
		]);

	/** Whether this session raised the confirmation: this turn's, or one a turn of it recorded (6.2). */
	async function raisedBy(live: Running, notification: string): Promise<boolean> {
		if (live.pending.has(notification) || tracker.hasRaised(live.session.id, notification))
			return true;
		if (live.turn.calls.some((call) => call.notification === notification)) return true;
		return (await turnsOf(live.session.id)).some((turn) =>
			turn.calls.some((call) => call.notification === notification)
		);
	}

	/** End a waiting turn as `state`, and say whether there was one (3.5). */
	async function endWaiting(
		session: string,
		seq: number | undefined,
		state: 'done' | 'stopped',
		stoppedBy?: 'person' | 'session-changed'
	): Promise<CopilotTurnV1 | undefined> {
		const held = waiting.get(session);
		if (!held || (seq !== undefined && held.turn.seq !== seq)) return undefined;
		waiting.delete(session);
		// Its confirmations stay held while its end is written (re-check 6): a late call's cleanup must still see them.
		ending.add(held);
		if (held.timer) clearTimeout(held.timer);
		try {
			await held.settling;
			const turn: CopilotTurnV1 = { ...held.turn, state, ...(stoppedBy ? { stoppedBy } : {}) };
			await deps.runBoot(COPILOT_TURN_SETTLE, {
				turn,
				...(state === 'stopped' ? { withdraw: withdrawalOf(held.session, held.pending) } : {}),
			});
			return turn;
		} finally {
			ending.delete(held);
		}
	}

	// ─── The agent port's kernel half (3.2) ───────────────────────────────────

	function capabilityFor(live: Running): CopilotAgentCapabilityV1 {
		const { session } = live;
		const scope: ScopeV1 | 'workspace' = session.scope.project
			? { workspace: deps.workspace, project: session.scope.project }
			: 'workspace';
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
				// The session's limit cannot be skipped: a confirmation is read through `confirmation` alone (3.2), and
				// chrome-only or internal commands are never reachable through the copilot's port (4.5, #1869).
				if (
					typeof name !== 'string' ||
					name.startsWith('confirmation-') ||
					CHROME_ONLY.includes(name) ||
					deps.internal(name)
				)
					return refuse('Not a command the copilot calls', ['name']);
				live.spent.calls += 1;
				const callId = `cpc_${String(live.spent.calls).padStart(4, '0')}`;
				if (live.spent.calls > TURN_LIMITS.calls) {
					void finish(session.id, live.turn.seq, {
						state: 'stopped',
						stoppedBy: 'limit',
					});
					return refuse('The turn reached its limit of calls', ['call']);
				}
				const trace = { session: session.id, turn: live.turn.seq, call: callId };
				const inputDigest = await deps.digest(input ?? {});
				// Again after the await, with none between this and the dispatch (the re-check's B2): a stop or a change of
				// person while the digest was made sends nothing.
				if (live.revoked) return refuse('The turn has ended', ['call']);
				if (!samePerson()) return refuse('The person changed', ['call']);
				const answered = await deps.callAsCopilot(name, input, trace, scope);
				const decided = decisions.get(traceKey(trace));
				decisions.delete(traceKey(trace));
				const labels = taint.take(trace);
				const instance = deps.instanceOf(name);
				// A unit (7.3): the runtime's composer is given it, and the parent nothing of it but its id and state.
				const opened = labels?.unit
					? units.decide(name, answered, labels, trace, live.revoked)
					: undefined;
				if (opened?.limit)
					void finish(session.id, live.turn.seq, { state: 'stopped', stoppedBy: 'limit' });
				const result = opened?.result ?? answered;
				const inner = nestedRaised.get(traceKey(trace)) ?? [];
				nestedRaised.delete(traceKey(trace));
				const code = result.success ? undefined : (result.error?.code ?? 'UNKNOWN');
				// A result's own words never make a confirmation or a suggestion (the reviews' I1): only the id the
				// confirmations' gate issued or found pending for this very call, or for a call nested in it (B8), read back
				// to be this session's, or the suggestion the gate recorded for it.
				const raisedId =
					code === 'CONFIRMATION_PENDING' && decided?.notification !== undefined
						? decided.notification
						: inner[0];
				const resolvedId = raisedId !== undefined ? tracker.latest(raisedId).id : undefined;
				const claimed =
					resolvedId !== undefined
						? await deps.confirmationOf?.(resolvedId, session.person)
						: undefined;
				const currentClaim =
					claimed?.session === session.id
						? tracker.latest(claimed.id, claimed.expiresAt)
						: undefined;
				const notification = currentClaim?.id;
				const suggestion = code === 'AUTONOMY_SUGGEST_ONLY' ? decided?.suggestion : undefined;
				const entry: CopilotCallV1 = {
					callId,
					command: name,
					...(instance ? { instance } : {}),
					inputDigest,
					// A command's own `confirm_prompt` asks in `act` too: what reached the person is an ask (3.4).
					mode: notification !== undefined ? 'ask' : (decided?.mode ?? 'act'),
					...(notification !== undefined && raisedId === inner[0] && claimed?.asked
						? { reason: claimed.asked.reason }
						: decided
							? { reason: decided.reason }
							: {}),
					outcome:
						notification !== undefined
							? 'pending'
							: suggestion !== undefined
								? 'suggested'
								: result.success
									? 'ok'
									: 'error',
					...(code !== undefined ? { code } : {}),
					...(notification !== undefined ? { notification } : {}),
					...(suggestion !== undefined ? { suggestion } : {}),
					...(result.success && typeof result.undoCommand === 'string'
						? { undo: result.undoCommand }
						: {}),
					// 5.1's parts by label, nested calls' content included (5.3).
					labels: labels ? { ...labels.counts } : { content: 0, server: 0, trusted: 1 },
					...(opened ? { unit: opened.unit } : {}),
				};
				if (!live.revoked) {
					live.turn.calls.push(entry);
					if (currentClaim !== undefined) {
						live.pending.set(currentClaim.id, currentClaim.expiresAt);
						tracker.noteRaised(session.id, currentClaim.id);
					}
					// The rest a nested call raised wait too, each this session's (B8).
					for (const id of inner.slice(1)) {
						const card = await deps.confirmationOf?.(tracker.latest(id).id, session.person);
						if (card?.session === session.id) {
							const latest = tracker.latest(card.id, card.expiresAt);
							live.pending.set(latest.id, latest.expiresAt);
							tracker.noteRaised(session.id, latest.id);
						}
					}
				} else if (
					notification !== undefined &&
					// Only one this very call raised, and no live turn of the session holds (re-check 4): a confirmation
					// found pending on the key may be one another turn waits on.
					claimed?.raisedBy?.turn === live.turn.seq &&
					claimed.raisedBy.call === callId &&
					!waiting.get(session.id)?.pending.has(notification) &&
					!running.get(session.id)?.pending.has(notification) &&
					![...ending].some(
						(each) => each.session.id === session.id && each.pending.has(notification)
					) &&
					// Nor one a turn of the session recorded, an ended one too: a waiting turn a new message ended left its
					// confirmations in the inbox on purpose (re-check 5).
					!(await turnsOf(session.id)).some((turn) =>
						turn.calls.some((each) => each.notification === notification)
					)
				) {
					// The turn ended while this call asked: what it raised goes with the turn (3.5), through the settle's
					// journaled entry again, with the turn as it was stored, so a replay withdraws it too (re-check 2).
					// That id alone, and the turn's record left as it is (re-check 3): another of its confirmations may
					// still be waiting for the person.
					await deps.runBoot(COPILOT_TURN_SETTLE, {
						withdraw: { person: session.person, ids: [notification] },
					});
				}
				return opened ? opened.result : forRuntime(result, labels);
			},
			async unit(id, text) {
				if (live.revoked) return refuse('The turn has ended', ['unit']);
				if (!samePerson()) return refuse('The person changed', ['unit']);
				const done = await units.submit(session.id, live.turn.seq, id, text, scope);
				return done ?? refuse('No unit of this turn is being composed with that id', ['unit']);
			},
			composing: (id) =>
				live.revoked ? undefined : units.composing(session.id, live.turn.seq, id),
			async listCommands() {
				if (live.revoked || !samePerson()) return [];
				return toolsFor();
			},
			async confirmation(notification) {
				if (live.revoked) return refuse('The turn has ended', ['confirmation']);
				if (!samePerson()) return refuse('The person changed', ['confirmation']);
				// Only a confirmation this session raised (6.2); the kernel's own read checks the session again.
				// A read is a call of the turn's, under its limit (4.4), charged before its lookup (the re-check's B6).
				live.spent.calls += 1;
				if (live.spent.calls > TURN_LIMITS.calls) {
					void finish(session.id, live.turn.seq, { state: 'stopped', stoppedBy: 'limit' });
					return refuse('The turn reached its limit of calls', ['confirmation']);
				}
				if (typeof notification !== 'string' || !(await raisedBy(live, notification)))
					return refuse('No confirmation of this session has that id', ['notification']);
				// Again after the lookup, with none between this and the read (re-check 2, B5).
				if (live.revoked) return refuse('The turn has ended', ['confirmation']);
				if (!samePerson()) return refuse('The person changed', ['confirmation']);
				reads += 1;
				const trace = { session: session.id, turn: live.turn.seq, call: `confirmation-${reads}` };
				const read = await deps.callAsCopilot('confirmation-get', { notification }, trace, scope);
				// A stored outcome keeps the labels of the run it was (5.1): given to the model as they say. A unit's, the run
				// of a call the person confirmed, is never composed or given to the parent (7.3).
				const kept = taint.take(trace);
				return kept?.unit
					? unitInvalid('a unit whose call was confirmed is not composed', kept.source)
					: forRuntime(read, kept);
			},
		};
	}

	/**
	 * 4.5's list: the agent interface's commands, less every one the copilot may not reach. A mounted instance's are
	 * listed as `labels.ts`'s `mountedTool` gives them: a `per-part` server's descriptions as its claims, a `whole`
	 * server's as the deployer's words alone, with its schema cut to structural keywords.
	 */
	function toolsFor(): ToolDescriptorV1[] {
		return listTools(
			deps.agentCommands(),
			(name) =>
				deps.internal(name) ||
				deps.humanOnly(name) ||
				// Signing in or out is the person's alone (6.1).
				name.startsWith('auth-') ||
				name.startsWith('confirmation-') ||
				CHROME_ONLY.includes(name),
			// A mounted command whose entry the kernel cannot read is not listed: nothing of its server's reaches the model.
			(name) => (deps.isMounted(name) ? (deps.mountOf?.(name) ?? null) : undefined),
			// One place is the runtime's own `confirmation-get` (4.5's 128 in all).
			TOOLS_MAX - 1
		);
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
		attach: attachSchema(z),
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
				attach: ATTACH_JSON,
				wait: { type: 'boolean' },
			},
			required: ['session', 'text'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const enteredAt = deps.now();
			const person = kit.personOf(context);
			const found = await own(person, input.session);
			if (!found) return sessionNotFound(input.session);
			let session = found;
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
			const validated = validateAttachments(input.attach, deps.workspace, fail);
			if (!Array.isArray(validated)) return validated;
			const changed = () =>
				fail(
					'SESSION_CHANGED',
					'Who is signed in changed before the message could be sent',
					'Start a new session and try again'
				);
			starting.add(session.id);
			const startedAt = epoch;
			let attachments: AttachedContentV1[];
			let previous: CopilotTurnV1[];
			let turn: CopilotTurnV1;
			try {
				const read = await readAttachments(validated, context, deps.readAttachment, fail);
				if (!Array.isArray(read)) return read;
				if (epoch !== startedAt || deps.person() !== session.person) return changed();
				attachments = read;
				await endWaiting(session.id, undefined, 'done');
				previous = await turnsOf(session.id);
				if (epoch !== startedAt || deps.person() !== session.person) return changed();
				const seq = (previous.at(-1)?.seq ?? 0) + 1;
				turn = {
					session: session.id,
					seq,
					text: input.text,
					attach: validated,
					state: 'running',
					calls: [],
					reply: '',
					usage: { inputTokens: 0, outputTokens: 0 },
				};
				const committed = await taint.commitTurn(
					session.id,
					attachments.map((each) => each.source),
					kit.callNow(context),
					COPILOT_TURN_TABLE,
					turnId(session.id, seq),
					{ id: turnId(session.id, seq), ...turn }
				);
				if (!committed) return sessionNotFound(input.session);
				session = committed;
			} finally {
				starting.delete(session.id);
				if (waiting.has(session.id)) void check(session.id);
			}
			const live = runningFor(session, copy(turn), {
				calls: 0,
				rounds: 0,
				elapsedMs: 0,
				usage: { inputTokens: 0, outputTokens: 0 },
			});
			const { settled } = live;
			running.set(session.id, live);
			if (epoch !== startedAt || deps.person() !== session.person) {
				await finish(session.id, turn.seq, { state: 'stopped', stoppedBy: 'session-changed' });
				return kit.success({ turn: copy(live.turn) });
			}
			armTimer(live);
			try {
				deps.options.runner.start({
					session,
					turn: turn.seq,
					runId: deps.options.takeRunId?.(session.id) ?? `run_${session.id}_${turn.seq}`,
					provider: { id: provider.id, kind: provider.kind, model: provider.model },
					history: historyOf(previous),
					text: input.text,
					...(attachments.length > 0 ? { attachments } : {}),
					agent: capabilityFor(live),
					settle: (outcome) => void finish(session.id, turn.seq, outcome),
					signal: live.controller.signal,
				});
			} catch {
				await finish(session.id, turn.seq, {
					state: 'failed',
					failure: { code: 'COPILOT_RUNTIME_FAILED' },
				});
			}
			if (input.wait === false) return kit.success({ turn: copy(live.turn) });
			let timer: ReturnType<typeof setTimeout> | undefined;
			const waitMs = Math.max(0, MESSAGE_WAIT_MS - Math.max(0, deps.now() - enteredAt));
			const waited = await Promise.race([
				settled,
				new Promise<undefined>((done) => {
					timer = setTimeout(() => done(undefined), waitMs);
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
			const stopped =
				(await finish(session.id, input.turn, { state: 'stopped', stoppedBy: 'person' })) ??
				(await endWaiting(session.id, input.turn, 'stopped', 'person'));
			// Stopping withdrew the turn's pending confirmations (3.5), in `finish` or `endWaiting`.
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
		{
			session: CopilotSessionV1;
			turns: CopilotTurnV1[];
			confirmations: CopilotConfirmationCardV1[];
			suggestions: CopilotSuggestionCardV1[];
		}
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
			// The panel's cards, from the kernel's records alone, by the ids the agent port's half recorded (3.2, 6.2).
			const confirmations: CopilotConfirmationCardV1[] = [];
			const suggestions: CopilotSuggestionCardV1[] = [];
			const now = kit.callNow(context);
			const seen = new Set<string>();
			for (const call of turns.flatMap((turn) => turn.calls)) {
				// One card per confirmation, however many calls found it (re-check 2).
				if (call.notification !== undefined && !seen.has(call.notification)) {
					seen.add(call.notification);
					// As the person may read it now (the inbox's rule): a project they left shows nothing (re-check 3).
					const card = await deps.confirmationOf?.(call.notification, session.person, {
						reader: { actor: context.actor },
						traceId: context.traceId,
					});
					if (card && card.session === session.id) confirmations.push(card);
				}
				if (call.suggestion !== undefined && SUGGESTION_ID.test(call.suggestion)) {
					const row = await store.get<SuggestionV1>(SUGGESTION_TABLE, call.suggestion);
					if (
						row &&
						row.person === session.person &&
						row.session === session.id &&
						deps.allows?.(context.actor, row.scope) !== false
					) {
						suggestions.push({
							id: row.id,
							command: row.command,
							input: structuredClone(row.input),
							scope: row.scope,
							reasons: [...row.reasons],
							sources: [...row.sources],
							expiresAt: row.expiresAt,
							ran: row.ranAt !== undefined || now >= row.expiresAt,
						});
					}
				}
			}
			return kit.success({ session, turns, confirmations, suggestions });
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
			// 6.3's daily counters, and the confirmations still waiting, so what expired is what was asked less the rest.
			const pending = (await deps.pendingAsked?.(person, context.traceId)) ?? [];
			const keys = pending.map((row) =>
				enforcement.keyOf(person, row.command, row.scope, row.reason, row.createdAt)
			);
			const read = await health.read(
				person,
				{ project: input.project, since: input.since, now: kit.callNow(context) },
				keys
			);
			// No setting removes a destructive or approval-held command's ask, or its own `confirm_prompt`'s: not flagged.
			const fixed = (command: string) =>
				deps.heldBy?.(command) !== undefined || deps.declares?.(command) === true;
			return kit.success({ ...read, flags: read.flags.filter((flag) => !fixed(flag.command)) });
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

	const settleInput = z.strictObject({
		turn: z.optional(z.unknown()),
		withdraw: z.optional(
			z.strictObject({
				person: z.string().check(z.minLength(1), z.maxLength(256)),
				ids: z.array(z.string().check(z.maxLength(64))).check(z.maxLength(200)),
			})
		),
	});
	const turnSettle = kit.define<typeof settleInput, { turn: CopilotTurnV1 }>({
		name: COPILOT_TURN_SETTLE,
		description: 'The kernel’s record of how a copilot turn ended (boot-only)',
		category: 'copilot',
		mutation: true,
		executionTime: 'fast',
		input: settleInput,
		jsonSchema: { type: 'object' },
		async handler(input, context) {
			const ended = input.withdraw as { person: string; ids: string[] } | undefined;
			// With no turn, a late call's own confirmation alone (its turn already ended and was written).
			if (input.turn === undefined) {
				for (const each of ended?.ids ?? [])
					await deps.withdraw?.(context, { id: each }, ended?.person ?? '');
				return kit.success({ turn: undefined as never });
			}
			const turn = input.turn as CopilotTurnV1;
			const id = turnId(turn.session, turn.seq);
			const row = { id, ...turn };
			if (await store.get(COPILOT_TURN_TABLE, id)) await store.update(COPILOT_TURN_TABLE, id, row);
			else await store.create(COPILOT_TURN_TABLE, row);
			// An ended turn's pending confirmations go with it (3.5): those it raised, by the session and turn stored on
			// them, and those it holds by id.
			if (ended) {
				await deps.withdraw?.(context, { session: turn.session, turn: turn.seq }, ended.person);
				for (const each of ended.ids) await deps.withdraw?.(context, { id: each }, ended.person);
			}
			return kit.success({ turn });
		},
	});

	const contextFields = copilotContextFields(z);

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
		// Taint's record outermost, so it reads every traced call's result, nested and confirmed runs too (5.3).
		gate: (name, input, context, next) =>
			taint.record(name, input, context, () => enforcement.gate(name, input, context, next)),
		suggestions: { suggestion: enforcement.suggestion, ran: enforcement.ran },
		async observe(event, row, replacedBy) {
			// A changed preview replaces the confirmation in place (7.2): swap the tracked id before any
			// await so a concurrent check never sees the withdrawn original, resumes the turn early and
			// withdraws the replacement when settling (#2307).
			const session = row.confirmation.session;
			if (event === 'withdrawn' && replacedBy !== undefined && session !== undefined) {
				tracker.replace(
					session,
					row.id,
					{ id: replacedBy.id, expiresAt: replacedBy.confirmation.expiresAt },
					[running.get(session), waiting.get(session)]
				);
			}
			const asked = row.confirmation.asked;
			// Approval health counts an agent's confirmations alone, by the day it was raised (6.3).
			if (asked !== undefined) {
				await health.bump(
					enforcement.keyOf(
						row.person,
						row.confirmation.command,
						row.scope,
						asked.reason,
						row.createdAt
					),
					event
				);
			}
			// A waiting turn hears its confirmation end, and continues once all have (3.5).
			if (event === 'withdrawn' && replacedBy !== undefined && session !== undefined) {
				if (waiting.get(session)?.pending.has(replacedBy.id)) void check(session);
				return;
			}
			if (event !== 'asked' && session !== undefined && waiting.get(session)?.pending.has(row.id))
				void check(session);
		},
		async stopAll(stoppedBy) {
			if (stoppedBy === 'session-changed') epoch += 1;
			await Promise.all([
				...[...running.values()].map((live) =>
					finish(live.session.id, live.turn.seq, { state: 'stopped', stoppedBy })
				),
				...[...waiting.keys()].map((session) =>
					endWaiting(session, undefined, 'stopped', stoppedBy)
				),
			]);
			// A change of person also removes every runtime: the frame goes, with whatever it held (3.2).
			if (stoppedBy === 'session-changed') {
				tracker.clear();
				deps.options?.runner?.reset?.();
			}
		},
	};
}

export type {
	ApprovalCountersV1,
	ApprovalHealthRowV1,
	ApprovalHealthV1,
} from './health.js';
