/**
 * @fileoverview The kernel's `late-hosted` chunk (phase 6 specification, 6.1, 6.3 and 6.4; D103; step 5): in a hosted
 * `provider` deployment the browser runs the trust-record commands on the hosted server and keeps a copy of what the
 * server's records show its person. Loaded in stage B only when the host gives `serverCall`, or when a replay's journal
 * says its deployment was hosted (A5), so a `local` shell and a static `provider` shell never request it (P6-E9).
 *
 * - **Routing (6.1).** Each routed write keeps its definition, so line 0, the auth gate and the scope middleware run as in
 *   phase 3; only its handler is replaced, by a call to `serverCall`, whose `CommandResult` it returns unchanged. Nothing
 *   it does writes the browser's store, on any path.
 * - **The agent interface (A6).** An agent's routed write is `HUMAN_REQUIRED` before any request; its reads are the
 *   copy's. An agent changes these records over MCP, as its own connected agent.
 * - **The copy (6.3).** `trust-record-settle` replaces the `project` and `workspace-app` tables with the snapshot's rows,
 *   and the `agent-member` table with its installed rows alone; connected agents are held in memory. It grants nothing:
 *   every write is the server's.
 * - **Replay (6.4, A5).** The routed writes are recorded, so a replay answers each from its entry and never reaches a
 *   server; `trust-record-settle` re-runs from its journaled input.
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { RecordCache } from '../scope/cache.js';
import type { ProjectV1, ScopeV1, WorkspaceAppV1 } from '../scope/records.js';
import {
	ROUTED_WRITES,
	type ServerCallAnswerV1,
	type ServerCallV1,
	TRUST_RECORDS_MAX_BYTES,
	type TrustRecordAgentV1,
	type TrustRecordSettleInputV1,
	type TrustRecordSettleReasonV1,
	type TrustRecordSnapshotV1,
} from '../trust-records.js';
import type { DocumentKit } from './document-kit.js';
import { AGENT_MEMBER_TABLE } from './tables.js';

export interface HostedDeps {
	store: DataAdapter;
	scope: {
		workspace: { id: string };
		projects: RecordCache<ProjectV1>;
		workspaceApps: RecordCache<WorkspaceAppV1>;
		active(): ScopeV1;
	};
	/** The kernel's `agent-member` cache, reloaded after a settle (phase 3 specification, 8). */
	agents: { load(store: DataAdapter): Promise<void> };
	/** The host's transport (6.1); absent in a replay, which never reaches a server. */
	serverCall?: ServerCallV1 | undefined;
	/** Boot's own: never queued, top-level and journaled, which the settle runs as. */
	runBoot(name: string, input: unknown): Promise<{ success: boolean }>;
	replaying(): boolean;
	/** After a call, top-level on the settles' chain, the next call waiting for it (phase 3's 4.4). Never in a replay. */
	follow(job: () => Promise<unknown>): void;
	/** The person the shell is for. */
	person(): string | undefined;
	/** The one function that changes the active scope (phase 2 specification, 3.4). */
	leave(context: CommandContext): void;
	/** The host's notice that its periodic session read ran (phase 3's 4.3): the copy is refreshed with it. */
	watch?: ((listener: () => void) => () => void) | undefined;
	/** The shell's global strip, with its polite live region: a refused copy says so there (6.3, section 16). */
	strip?: ((message: string | null) => void) | undefined;
	/** `loam.limits.journalEntryBytes`: a settle the journal could not keep whole is refused, so a replay never stops at it. */
	journalBytes?: (() => number) | undefined;
	kit: Pick<DocumentKit, 'define' | 'success' | 'kernelFailure' | 'z'>;
}

export interface HostedParts {
	/** `trust-record-settle`, boot-only: run by this chunk, or re-run by a replay from its entry. */
	settle: ZodCommandDefinition;
	/** A routed write's definition, its handler the server's; any other command as it is. */
	route(command: ZodCommandDefinition): ZodCommandDefinition;
	/** Whether a replay answers `name` from its entry (A5): every routed write. */
	recorded(name: string): boolean;
	/** Whether `name`'s browser-side preparation is skipped: the server decides it, so nothing here reads or writes. */
	routed(name: string): boolean;
	/** A6: an agent's routed write, refused `HUMAN_REQUIRED` before line 0, any gate or any request; else undefined. */
	agentRefusal(call: CommandContext, name: string): CommandResult<never> | undefined;
	/** After every call, once its entry is journaled: a change of person settles the copy for the next one (6.3). */
	after(name: string): void;
	/** Stage B's first copy, after phase 3's first `session-settle` and before any queued call (6.3). */
	begin(): Promise<void>;
	/** Connected agents, held in memory for display: phase 3 keeps them in the provider's database (its 9.2). */
	connected(): readonly TrustRecordAgentV1[];
	/** In a replay, `workspace-deployment-apply`'s own: whether the period it begins was hosted (A5). */
	applied(input: unknown): void;
	stop(): void;
}

const routedSet: ReadonlySet<string> = new Set(ROUTED_WRITES);

/**
 * `PROJECT_TABLE` and `WORKSPACE_APP_TABLE`, held equal to them by a unit: imported as values, the bundler would part
 * first paint's records module into a chunk of its own for this one (phase 3 specification, 13).
 */
export const COPY_TABLES = Object.freeze({ project: 'project', workspaceApp: 'workspace-app' });

/** Whose copy the store holds and of which generation, in the `settings` table, written in the settle's own batch. */
export const COPY_HOLDER = Object.freeze({ table: 'settings', id: 'loam.trust-records' });

/** The journal's own margin over an entry's input (its context, result and digests), kept under its bound. */
const ENTRY_MARGIN_BYTES = 64 * 1024;

const EMPTY: TrustRecordSnapshotV1 = Object.freeze({
	generation: '',
	projects: [],
	workspaceApps: [],
	agents: [],
}) as TrustRecordSnapshotV1;

/** The UTF-8 bytes of `value` as JSON, or none for a value with no JSON form. */
const jsonBytes = (value: unknown): number => {
	try {
		return new TextEncoder().encode(JSON.stringify(value) ?? '').length;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
};

/** A row the copy can hold: an object with a string `id`. */
const row = (value: unknown): value is { id: string } =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as { id?: unknown }).id === 'string' &&
	(value as { id: string }).id !== '';

export function createHostedParts(deps: HostedDeps): HostedParts {
	const { kit } = deps;
	const z = kit.z;
	/** The generation the copy was last settled to; undefined before one this page knows of. */
	let generation: string | undefined;
	/**
	 * The person the copy is for, from its holder record or the last settle: `UNKNOWN` until one is read, so any person the
	 * shell is for settles it first (6.3: one person's copy never serves another).
	 */
	const UNKNOWN = Symbol();
	let heldFor: string | null | typeof UNKNOWN = UNKNOWN;
	let connected: TrustRecordAgentV1[] = [];
	let stopped = false;
	let unwatch: (() => void) | undefined;
	/** Whether stage B's first settle has run: before it, a change of person is that settle's to see. */
	let begun = false;
	/** A settle for a change of person queued or running: one is enough, the person read when it runs. */
	let sessionQueued = false;
	/** In a replay, whether the period the journal is in was hosted, from its last apply (A5); live, always. */
	let replayHosted = false;
	const active = () => !deps.replaying() || replayHosted;
	/** The largest snapshot the copy takes: 2 MiB, or less, so the journal keeps the settle's input whole (6.3, 6.4). */
	const maxBytes = () =>
		Math.min(TRUST_RECORDS_MAX_BYTES, (deps.journalBytes?.() ?? Infinity) - ENTRY_MARGIN_BYTES);

	/**
	 * The three tables replaced with the snapshot's rows, and the holder record, in one atomic batch: a row the snapshot does
	 * not hold is gone, and a failure leaves the store as it was (6.3).
	 */
	async function replace(
		tables: ReadonlyArray<[string, readonly { id: string }[]]>,
		holder: { id: string; person: string | null; generation: string }
	): Promise<void> {
		const operations = [];
		for (const [table, rows] of tables) {
			const held = (await deps.store.list<{ id: string }>(table)).data;
			const path = (id: string) => `/${table}/${encodeURIComponent(id)}`;
			operations.push(
				...held.map((each) => ({ method: 'DELETE' as const, path: path(each.id) })),
				...rows.map((each) => ({ method: 'PUT' as const, path: path(each.id), body: each }))
			);
		}
		const at = `/${COPY_HOLDER.table}/${encodeURIComponent(COPY_HOLDER.id)}`;
		operations.push(
			{ method: 'DELETE' as const, path: at },
			{ method: 'PUT' as const, path: at, body: holder }
		);
		const { summary } = await deps.store.batch(operations);
		if (summary.failed > 0) throw new Error('The store could not replace the copy');
	}

	const settleInput = z.strictObject({
		reason: z.enum(['boot', 'call', 'refresh', 'session']),
		snapshot: z.strictObject({
			generation: z.string(),
			projects: z.array(z.unknown()),
			workspaceApps: z.array(z.unknown()),
			agents: z.array(z.unknown()),
		}),
		// A snapshot refused for its size is journaled by its size alone, never itself: the journal keeps the entry whole,
		// so a replay never stops at it (step 5's re-check).
		oversized: z.optional(z.int().check(z.minimum(0))),
	});
	const settle = kit.define<typeof settleInput, { generation: string; projects: number }>({
		name: 'trust-record-settle',
		description:
			"The kernel's own: the copy of the hosted server's trust records, replaced from its snapshot",
		category: 'project',
		mutation: true,
		executionTime: 'fast',
		input: settleInput,
		jsonSchema: {
			type: 'object',
			properties: {
				reason: { type: 'string', enum: ['boot', 'call', 'refresh', 'session'] },
				oversized: { type: 'integer', minimum: 0 },
				snapshot: {
					type: 'object',
					properties: {
						generation: { type: 'string' },
						projects: { type: 'array' },
						workspaceApps: { type: 'array' },
						agents: { type: 'array' },
					},
					required: ['generation', 'projects', 'workspaceApps', 'agents'],
					additionalProperties: false,
				},
			},
			required: ['reason', 'snapshot'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const snapshot = input.snapshot as unknown as TrustRecordSnapshotV1;
			if (input.oversized !== undefined || jsonBytes(snapshot) > maxBytes()) {
				deps.strip?.(
					"This workspace's projects and apps are over what this page keeps, so they may be out of date"
				);
				return kit.kernelFailure(
					'TRUST_RECORDS_TOO_LARGE',
					"The server's records for you are over what this page keeps, so this copy was left as it was",
					'Archive projects you no longer use; the limit is 2 MiB'
				);
			}
			const rows = [snapshot.projects, snapshot.workspaceApps, snapshot.agents];
			if (!rows.every((each) => each.every(row))) {
				return kit.kernelFailure(
					'REQUEST_INVALID',
					'The snapshot holds a row with no id, so this copy was left as it was',
					'Reload the shell; the hosted server answered a snapshot it should not have'
				);
			}
			const installed = snapshot.agents.filter((agent) => agent.kind === 'installed');
			const person = deps.person() ?? null;
			await replace(
				[
					[COPY_TABLES.project, snapshot.projects],
					[COPY_TABLES.workspaceApp, snapshot.workspaceApps],
					[AGENT_MEMBER_TABLE, installed],
				],
				{ id: COPY_HOLDER.id, person, generation: snapshot.generation }
			);
			deps.strip?.(null);
			await Promise.all([
				deps.scope.projects.load(deps.store),
				deps.scope.workspaceApps.load(deps.store),
				deps.agents.load(deps.store),
			]);
			connected = snapshot.agents.filter((agent) => agent.kind === 'connected');
			generation = snapshot.generation;
			heldFor = person;
			// A project the person may no longer see leaves the copy, and the active scope leaves it (6.3).
			const active = deps.scope.active();
			if (active.project !== undefined && !deps.scope.projects.get(active.project))
				deps.leave(context);
			return kit.success({
				generation: snapshot.generation,
				projects: snapshot.projects.length,
			});
		},
	}) as unknown as ZodCommandDefinition;

	/** The snapshot for the person now, or undefined when the server did not give one. */
	async function snapshotNow(): Promise<TrustRecordSnapshotV1 | undefined> {
		if (!deps.serverCall) return undefined;
		let answer: ServerCallAnswerV1;
		try {
			// The person it is for travels with it: the server refuses it for any other (6.2, step 5's trust review).
			const person = deps.person();
			answer = await deps.serverCall({
				command: 'trust-record-snapshot',
				input: {},
				scope: { workspace: deps.scope.workspace.id },
				...(person !== undefined ? { person } : {}),
			});
		} catch {
			return undefined;
		}
		return answer.result.success ? (answer.result.data as TrustRecordSnapshotV1) : undefined;
	}

	/** Whose copy the store holds, from its holder record, once per page. */
	async function readHolder(): Promise<void> {
		if (heldFor !== UNKNOWN) return;
		const held = await deps.store
			.get<{ person?: unknown; generation?: unknown }>(COPY_HOLDER.table, COPY_HOLDER.id)
			.catch(() => null);
		if (held && (typeof held.person === 'string' || held.person === null)) {
			heldFor = held.person;
			if (typeof held.generation === 'string') generation = held.generation;
		}
	}

	/** Settle the copy for `reason` (6.3): fetched, and settled when it differs, or always at boot or a change of person. */
	async function refresh(reason: TrustRecordSettleReasonV1): Promise<void> {
		if (stopped || deps.replaying()) return;
		await readHolder();
		const person = deps.person();
		const another = heldFor !== (person ?? null);
		// Signed out, nobody's copy is shown: the next person's settle replaces it.
		let snapshot = person === undefined ? EMPTY : await snapshotNow();
		if (stopped || person !== deps.person()) return;
		// A copy held for another person, or for no one known, never stays for this one (6.3): with no snapshot to replace it,
		// or one too large to keep, it is settled empty rather than kept.
		const bytes = snapshot ? jsonBytes(snapshot) : 0;
		if (snapshot && bytes > maxBytes()) {
			// Refused, journaled by its size: the copy stays for its own person, and for another it is settled empty below.
			await deps.runBoot('trust-record-settle', { reason, snapshot: EMPTY, oversized: bytes });
			snapshot = undefined;
		}
		if (another && !snapshot) snapshot = EMPTY;
		if (!snapshot) return;
		if (!another && snapshot.generation === generation && reason !== 'boot') return;
		const input: TrustRecordSettleInputV1 = { reason, snapshot };
		await deps.runBoot('trust-record-settle', input);
	}

	/**
	 * `agent-member-list` and `-get` answered from the copy (A6, 6.3): the snapshot's rows, filtered for this person by the
	 * server, installed ones from the table and connected ones from memory; in a period of a replay that was not hosted,
	 * as phase 3 answers them.
	 */
	function fromCopy(command: ZodCommandDefinition): ZodCommandDefinition {
		return {
			...command,
			async handler(input: unknown, context: CommandContext): Promise<CommandResult> {
				if (!active()) return command.handler(input, context) as Promise<CommandResult>;
				// A copy that is not known to be this person's answers nothing of it: the settle after this call replaces it
				// (step 5's re-check: another tab's sign-in reaches the shell before a call does).
				const own = heldFor !== UNKNOWN && heldFor === (deps.person() ?? null);
				const installed = own
					? (await deps.store.list<TrustRecordAgentV1>(AGENT_MEMBER_TABLE)).data
					: [];
				// Phase 3's order: oldest first, then by id.
				const rows = [...installed, ...(own ? connected : [])].sort(
					(a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0) || (a.id < b.id ? -1 : 1)
				);
				if (command.name === 'agent-member-get') {
					const id = (input as { agent?: unknown } | undefined)?.agent;
					const found = rows.find((row) => row.id === id);
					return found
						? kit.success(found)
						: kit.kernelFailure(
								'AGENT_MEMBER_NOT_FOUND',
								'The workspace has no agent member with this id that you can see',
								'List the agent members with agent-member-list and name one of them'
							);
				}
				const status = (input as { status?: string } | undefined)?.status ?? 'all';
				return kit.success({
					agents: status === 'all' ? rows : rows.filter((row) => row.status === status),
				});
			},
		} as ZodCommandDefinition;
	}

	/** A6: the agent interface's routed writes are a person's alone. */
	const agentRefusal = (call: CommandContext, name: string): CommandResult<never> | undefined =>
		routedSet.has(name) && active() && (call.interface === 'agent' || call.actor?.kind === 'agent')
			? kit.kernelFailure(
					'HUMAN_REQUIRED',
					`In a hosted workspace '${name}' is a person's, made in the shell`,
					"Connect over MCP as the person's agent to change it, or ask the person"
				)
			: undefined;

	return {
		settle,
		agentRefusal,
		route(command) {
			if (command.name === 'agent-member-list' || command.name === 'agent-member-get')
				return fromCopy(command);
			if (!routedSet.has(command.name)) return command;
			return {
				...command,
				async handler(input: unknown, context: CommandContext): Promise<CommandResult> {
					// A replay of a period that was not hosted runs the phase 3 handler, as that period did (A5).
					if (!active()) return command.handler(input, context) as Promise<CommandResult>;
					// A6 again, at the handler: no path reaches the server for an agent.
					const refused = agentRefusal(context, command.name);
					if (refused) return refused;
					if (!deps.serverCall) {
						return kit.kernelFailure(
							'SERVER_UNAVAILABLE',
							'This page has no connection to the hosted server',
							'Try again; the hosted server did not answer',
							{ retryable: true }
						);
					}
					const scope = (context.scope as ScopeV1 | undefined) ?? {
						workspace: deps.scope.workspace.id,
					};
					// The person the shell made the call as: the server refuses it if the session is now another's (6.2).
					const person = deps.person();
					const answer = await deps.serverCall({
						command: command.name,
						input,
						scope,
						...(person !== undefined ? { person } : {}),
					});
					// The copy follows the server's answer, top-level after this call's entry, when it says it changed (6.3).
					if (answer.generation !== undefined && answer.generation !== generation)
						deps.follow(() => refresh('call'));
					return answer.result;
				},
			} as ZodCommandDefinition;
		},
		recorded: (name) => routedSet.has(name) && active(),
		routed: (name) => routedSet.has(name) && active(),
		after(name) {
			if (!begun || stopped || deps.replaying() || name === 'trust-record-settle') return;
			// Any person the copy is not known to be for, after any call: the next call waits for the settle (6.3).
			if (sessionQueued || (heldFor !== UNKNOWN && (deps.person() ?? null) === heldFor)) return;
			sessionQueued = true;
			deps.follow(() =>
				refresh('session').finally(() => {
					sessionQueued = false;
				})
			);
		},
		applied(input) {
			replayHosted = (input as { host?: { kind?: unknown } } | undefined)?.host?.kind === 'hosted';
		},
		async begin() {
			if (stopped || deps.replaying()) return;
			await refresh('boot');
			begun = true;
			unwatch = deps.watch?.(() => deps.follow(() => refresh('refresh')));
		},
		connected: () => connected,
		stop() {
			stopped = true;
			unwatch?.();
			unwatch = undefined;
		},
	};
}
