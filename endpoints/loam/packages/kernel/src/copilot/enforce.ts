/**
 * @fileoverview Autonomy enforced (phase 5 specification, 6.1; D145): before every top-level call the copilot or any
 * other caller on the agent interface makes, phase 4's `resolveAutonomy` decides `act`, `ask` or `suggest`, and a
 * destructive command is at most `ask`. It runs after strict validation, line 0, the human, owner and person-session
 * checks and access (the scope middleware), and before phase 4's confirmations' gate, which holds the decline window
 * and raises the confirmation (6.1's order). `act` runs; `ask` leaves its decision on the call for that gate, which
 * asks whatever the command declares; `suggest` runs nothing, stores a suggestion record for a copilot session, and
 * answers `AUTONOMY_SUGGEST_ONLY`. Taint's lowering (5.3) is step 4's, between the mode and the window.
 *
 * In the `late-copilot` chunk; it imports types alone.
 */

import type { CommandContext, CommandMiddleware, CommandResult } from '@lushly-dev/afd-core';
import type { ConfirmationAskedV1 } from '@lushly-dev/loam-sdk';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { KernelFieldContext } from '../context-fields.js';
import type { LoamKernelErrorCode } from '../errors.js';
import type { ScopeV1 } from '../scope/records.js';
import type { Health, HealthKeyV1 } from './health.js';
import type { CopilotTraceV1 } from './types.js';

/** The same keys as `late/confirmation-parts.ts`'s `ENFORCED` and `RAISED`, by `Symbol.for`: nothing of it imported. */
const ENFORCED = Symbol.for('dev.loam/enforced');
const RAISED = Symbol.for('dev.loam/raised');
/** `journal-order.ts`'s `RECORDED_AUTONOMY`: in a replay alone, the decision the entry journaled (#1936). */
const RECORDED_AUTONOMY = Symbol.for('dev.loam/recorded-autonomy');

/** The person's suggestion records (6.1), in the workspace store, each carrying `person`. */
export const SUGGESTION_TABLE = 'copilot-suggestion';
/** A suggestion expires after 10 minutes (6.1). */
export const SUGGESTION_TTL_MS = 600_000;
export const SUGGESTION_ID = /^sug_[0-9a-f]{16}$/;

export type AutonomyModeV1 = 'suggest' | 'ask' | 'act';

/** 6.1's suggestion record: what the copilot asked to run, as validated, which the person may run from the panel. */
export interface SuggestionV1 {
	id: string;
	workspace: string;
	person: string;
	session: string;
	turn: number;
	command: string;
	/** The validated input, as it will run. */
	input: unknown;
	scope: ScopeV1;
	reasons: Array<'policy' | 'taint' | 'unit'>;
	/** The sources a taint names (5.3); empty before step 4. */
	sources: string[];
	createdAt: number;
	expiresAt: number;
	/** When the person ran it: a suggestion runs once. */
	ranAt?: number;
}

/** What the gate decided for one copilot call, which the agent port's half records on its turn (3.4). */
export interface DecisionV1 {
	mode: AutonomyModeV1;
	reason: 'policy' | 'taint' | 'unit';
	/** The suggestion record this call stored, for `suggest`. */
	suggestion?: string;
	/** The confirmation the confirmations' gate raised, or found pending on the key, for this very call. */
	notification?: string;
}

export interface EnforcementDeps {
	store: DataAdapter;
	workspace: string;
	health: Health;
	/** 4.2's resolution for this call, in its scope, for its person; undefined for a command it cannot place. */
	resolve(
		name: string,
		context: CommandContext
	): Promise<{ mode: AutonomyModeV1; chain: ConfirmationAskedV1['chain'] } | undefined>;
	isMutation(name: string): boolean;
	isMounted(name: string): boolean;
	/**
	 * A command that declares itself destructive, or holds an approval (an AFD `approval` or a mounted tool's
	 * `approval: 'required'`): at most `ask` for an agent (6.1), named so in the chain.
	 */
	heldBy(name: string): 'destructive' | 'approval' | undefined;
	/**
	 * A refusal the command's own path would make before running, which no question may come before (6.1's order): a
	 * mounted instance that does not serve the call's project. Undefined for none.
	 */
	preflight(name: string, context: CommandContext): CommandResult<never> | undefined;
	/** Whether the journal records a call of `name`: approval health counts only what a replay sees (6.3). */
	journaled(name: string): boolean;
	/** A command that declares a `confirm_prompt`: the confirmations' gate asks for it in `act` too. */
	declares(name: string): boolean;
	/**
	 * Never asked or suggested (6.1): a human or owner command, which the chain refused before this; a person-session
	 * command; a write whose own handler hands the agent off; the confirmations' own reads; an internal command.
	 */
	exempt(name: string, input: unknown): boolean;
	/**
	 * The refusal a call's own handler makes an agent, which only a read can tell (a notice that is a pending
	 * confirmation), made here, so nothing changes between this and the handler (re-check 2, B3). Undefined for none.
	 */
	handOff(
		name: string,
		input: unknown,
		context: CommandContext
	): Promise<CommandResult<never> | undefined>;
	/** The command's instance, or undefined for the shell's. */
	instanceOf(name: string): string | undefined;
	personOf(context: CommandContext): string | undefined;
	now(context: CommandContext): number;
	/** Recorded for a copilot call, by its trace, before its result returns to the port. */
	decided(trace: CopilotTraceV1, decision: DecisionV1): void;
	/** Whether the call's actor may enter the call's scope (`decideAccess`): nothing is asked or suggested otherwise. */
	enterable(context: CommandContext): boolean;
	/** Phase 2's `PROJECT_NOT_FOUND`, byte-identical for a project that is missing and one the caller may not enter. */
	projectNotFound(): CommandResult<never>;
	kernelFailure(
		code: LoamKernelErrorCode,
		message: string,
		suggestion: string,
		extra?: { details?: Record<string, unknown>; retryable?: boolean }
	): CommandResult<never>;
}

/** The default when a command cannot be placed (4.2 step 3, D156): never looser than it. */
const defaultMode = (mutation: boolean, mounted: boolean): AutonomyModeV1 =>
	mutation || mounted ? 'ask' : 'act';

export interface Enforcement {
	gate: CommandMiddleware;
	/** The person's own suggestion, live: not run, not expired, of this workspace. */
	suggestion(id: string, person: string, now: number): Promise<SuggestionV1 | undefined>;
	/** Mark a suggestion run, once, and count it (6.3's `ranSuggestion`). False when it was already run. */
	ran(record: SuggestionV1, now: number, person: string): Promise<boolean>;
	/** The health key of a call, for counting outside the gate. */
	keyOf(
		person: string,
		name: string,
		scope: ScopeV1 | undefined,
		reason: DecisionV1['reason'],
		at: number
	): HealthKeyV1;
}

export function createEnforcement(deps: EnforcementDeps): Enforcement {
	const { store, health } = deps;

	const keyOf: Enforcement['keyOf'] = (person, name, scope, reason, at) => ({
		person,
		project: scope?.project,
		instance: deps.instanceOf(name) ?? 'shell',
		command: name,
		reason,
		at,
	});

	const newId = (context: CommandContext): string => {
		const hex = () =>
			Math.floor((context.random?.next() ?? Math.random()) * 0x100000000)
				.toString(16)
				.padStart(8, '0');
		return `sug_${hex()}${hex()}`;
	};

	/** A person's suggestions past a day go when they get a new one (the review's N2): none keeps the store growing. */
	async function sweep(person: string, now: number): Promise<void> {
		const listed = await store.list<SuggestionV1>(SUGGESTION_TABLE, { person } as never);
		for (const row of listed.data)
			if (row.person === person && row.expiresAt + 86_400_000 < now)
				await store.remove(SUGGESTION_TABLE, row.id);
	}

	const gate: CommandMiddleware = async (name, input, context, next) => {
		const call = context as CommandContext &
			KernelFieldContext & {
				trace?: CopilotTraceV1;
				confirmation?: string;
			};
		// The agent interface's own top-level calls: a nested call runs inside the call this let through, and an app's
		// port is an app's, not an agent's. A hosted server's MCP calls (`interface: 'mcp'`, phase 3's step 7) are not
		// enforced here until milestone C (10.1, D98): that server keeps no autonomy rows and has no person's inbox.
		// The decision is this gate's alone to journal (#1936): never a caller's, nor one an outer call left.
		delete call.autonomy;
		if (call.interface !== 'agent' || call.parent !== undefined || call.caller !== undefined)
			return next();
		// The shell's run of a call a person confirmed: the confirmations' gate checks its id against the act that holds it.
		if (call.confirmation !== undefined) return next();
		// A person's session is theirs (6.1: one needing PERSON_SESSION is never asked): signing in or out is refused.
		if (name === 'auth-sign-in' || name === 'auth-sign-out') {
			return deps.kernelFailure(
				'HUMAN_REQUIRED',
				`'${name}' changes who is signed in, which only the person does`,
				'A person must do this in the shell'
			);
		}
		// What the journal leaves out (a search, the scope, a list) is a read no replay could ask again: never asked.
		if (deps.exempt(name, input) || !deps.journaled(name)) return next();
		const handedOff = await deps.handOff(name, input, context);
		if (handedOff) return handedOff;
		const trace = call.trace;
		// A mounted tool's result is content the copilot cannot label before step 4's labels and taint (4.5, 5.1): until
		// then the copilot's call is refused, whatever its mode, so none reaches a session untainted.
		if (trace !== undefined && deps.isMounted(name)) {
			return deps.kernelFailure(
				'AUTONOMY_UNAVAILABLE',
				`'${name}' is a mounted server's command, which the copilot cannot call until labels and taint are enforced`,
				'Agents can only read until autonomy is enforced'
			);
		}
		const before = deps.preflight(name, context);
		if (before) return before;
		const resolved = await deps.resolve(name, context);
		let mode: AutonomyModeV1 =
			resolved?.mode ?? defaultMode(deps.isMutation(name), deps.isMounted(name));
		const chain: ConfirmationAskedV1['chain'] = resolved
			? structuredClone(resolved.chain)
			: [{ id: 'default', mode, as: 'mode' }];
		// Destructive and approval-held commands are at most `ask` for an agent, under any row (6.1).
		const held = deps.heldBy(name);
		if (held) {
			chain.push({ id: held, mode: 'ask', as: 'ceiling' });
			if (mode === 'act') mode = 'ask';
		}
		// A replay takes the decision its entry journaled, as the call was decided live (#1936).
		const recorded = (call as unknown as Record<symbol, unknown>)[RECORDED_AUTONOMY];
		if (recorded === 'act' || recorded === 'ask' || recorded === 'suggest') mode = recorded;
		// No confirmation or suggestion for a project the caller may not enter (6.1's order): a shell command that ignores
		// its scope would otherwise put the project's name in a header, and the person in front of a call that fails.
		if (mode !== 'act' && !deps.enterable(context)) return deps.projectNotFound();
		const decision: DecisionV1 = { mode, reason: 'policy' };
		// Journaled with the call (#1936): a replay that answers it from its record runs this gate again all the same.
		call.autonomy = mode;
		if (trace !== undefined) deps.decided(trace, decision);
		const person = deps.personOf(context);
		const at = deps.now(context);
		const scope = call.scope as ScopeV1 | undefined;
		const count = async (field: 'acted' | 'suggested') => {
			if (person !== undefined) await health.bump(keyOf(person, name, scope, 'policy', at), field);
		};
		if (mode === 'suggest') {
			let id: string | undefined;
			if (trace !== undefined && person !== undefined) {
				id = newId(context);
				const record: SuggestionV1 = {
					id,
					workspace: deps.workspace,
					person,
					session: trace.session,
					turn: trace.turn,
					command: name,
					input: structuredClone(input ?? {}),
					scope: scope ?? { workspace: deps.workspace },
					reasons: ['policy'],
					sources: [],
					createdAt: at,
					expiresAt: at + SUGGESTION_TTL_MS,
				};
				await store.create(SUGGESTION_TABLE, record);
				decision.suggestion = id;
				await sweep(person, at);
			}
			await count('suggested');
			return deps.kernelFailure(
				'AUTONOMY_SUGGEST_ONLY',
				`The person's autonomy setting for '${name}' is Suggest, so nothing ran`,
				id !== undefined
					? 'The person can run the suggested command from the panel'
					: `The person can run '${name}' themselves from the palette`,
				{ details: { command: name, ...(id !== undefined ? { suggestion: id } : {}) } }
			);
		}
		const asked: ConfirmationAskedV1 = { mode: 'ask', reason: 'policy', sources: [], chain };
		(call as unknown as Record<symbol, unknown>)[ENFORCED] = {
			ask: mode === 'ask',
			asked,
			...(trace !== undefined
				? { session: trace.session, group: `${trace.session}/${trace.turn}`, trace: { ...trace } }
				: {}),
		};
		// Run in `act` without asking (6.3), a change: a read in `act` is no decision a person could be asked about, so the
		// rates are over changes (the review's N4). A command whose own `confirm_prompt` asked is counted as asked instead.
		// Counted before it runs, so nothing is written between its handler and its journal entry, which a read made then
		// would see on the wrong side of it (#1936).
		if (mode === 'act' && deps.isMutation(name) && !deps.declares(name)) await count('acted');
		const result = await next();
		const raised = (call as unknown as Record<symbol, unknown>)[RAISED];
		if (typeof raised === 'string') decision.notification = raised;
		return result;
	};

	return {
		gate,
		keyOf,
		async suggestion(id, person, now) {
			if (!SUGGESTION_ID.test(id)) return undefined;
			const row = await store.get<SuggestionV1>(SUGGESTION_TABLE, id);
			if (
				!row ||
				row.person !== person ||
				row.workspace !== deps.workspace ||
				row.ranAt !== undefined ||
				now >= row.expiresAt
			)
				return undefined;
			return structuredClone(row);
		},
		async ran(record, now, person) {
			const row = await store.get<SuggestionV1>(SUGGESTION_TABLE, record.id);
			// Checked again as it is spent (the review's B9): its person, its workspace, never run, and still live.
			if (
				!row ||
				row.ranAt !== undefined ||
				row.person !== person ||
				row.workspace !== deps.workspace ||
				now >= row.expiresAt
			)
				return false;
			await store.update(SUGGESTION_TABLE, record.id, { ranAt: now } as never);
			await health.bump(
				keyOf(record.person, record.command, record.scope, 'policy', record.createdAt),
				'ranSuggestion'
			);
			return true;
		},
	};
}
