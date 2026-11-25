/**
 * @fileoverview Autonomy enforced (phase 5 specification, 6.1; D145): before every top-level call the copilot or any
 * other caller on the agent interface makes, phase 4's `resolveAutonomy` decides `act`, `ask` or `suggest`, and a
 * destructive command is at most `ask`. It runs after strict validation, line 0, the human, owner and person-session
 * checks and access (the scope middleware), and before phase 4's confirmations' gate, which holds the decline window
 * and raises the confirmation (6.1's order). `act` runs; `ask` leaves its decision on the call for that gate, which
 * asks whatever the command declares; `suggest` runs nothing, stores a suggestion record for a copilot session, and
 * answers `AUTONOMY_SUGGEST_ONLY`. Between the mode and the window, taint's lowering (5.3): a tainted session's call to
 * another mounted instance, to an app holding `http`, or to a mutation outside a `per-part` source is at most `ask`,
 * with `reason: 'taint'` and the sources, and a call nested in a copilot call (an app's, under a `calls` grant) is
 * lowered by the same rule, with the calling app as the caller (L2).
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
/** `journal-order.ts`'s `RECORDED_TAINT`: in a replay alone, the taint sources the entry journaled (#2118). */
const RECORDED_TAINT = Symbol.for('dev.loam/recorded-taint');

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
	journaled(name: string, context?: CommandContext): boolean;
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
	/** The sources a copilot session is tainted from (5.3), empty for none. */
	taintOf(session: string): Promise<string[]>;
	/** A mounted command's entry `labels` (5.1), undefined for any other. */
	labelsOf(name: string): 'whole' | 'per-part' | undefined;
	/** A native or view app's command whose app holds the `http` grant, served (5.3). */
	holdsHttp(name: string): boolean;
	personOf(context: CommandContext): string | undefined;
	now(context: CommandContext): number;
	/** Recorded for a copilot call, by its trace, before its result returns to the port. */
	decided(trace: CopilotTraceV1, decision: DecisionV1): void;
	/** A confirmation a call nested in a copilot call raised, by the trace, so its turn waits for it (3.5). */
	nestedRaised(trace: CopilotTraceV1, notification: string): void;
	/** Whether the call's actor may enter the call's scope (`decideAccess`): nothing is asked or suggested otherwise. */
	enterable(context: CommandContext): boolean;
	/** The unit a submit runs for (7.3): its source, which taints the submit. Absent, or undefined: no unit's submit. */
	unitOf?(trace: CopilotTraceV1): { source: string } | undefined;
	/** Phase 2's `PROJECT_NOT_FOUND`, byte-identical for a project that is missing and one the caller may not enter. */
	projectNotFound(): CommandResult<never>;
	kernelFailure(
		code: LoamKernelErrorCode,
		message: string,
		suggestion: string,
		extra?: { details?: Record<string, unknown>; retryable?: boolean }
	): CommandResult<never>;
}

/**
 * The default when a command cannot be placed (4.2 step 3, D156): never looser than it, a `per-part` instance's reads
 * acting as 6.1 says.
 */
const defaultMode = (mutation: boolean, mounted: boolean, vouched: boolean): AutonomyModeV1 =>
	mutation || (mounted && !vouched) ? 'ask' : 'act';

const RANK: readonly AutonomyModeV1[] = ['suggest', 'ask', 'act'];
const lower = (a: AutonomyModeV1, b: AutonomyModeV1): AutonomyModeV1 =>
	RANK.indexOf(a) <= RANK.indexOf(b) ? a : b;

/**
 * A unit's submit's mode (7.3): `act` in place of the default (D156's `ask` for a mutation), since it only stores
 * composed text at the server that asked for it, which the person reviews at the set's send. Every row a person or an
 * owner set still applies, a command's, an instance's or a general one, as do every ceiling and the person's cap; only
 * the default, as the mode or as a project row's bound, is replaced.
 */
export function unitMode(
	resolved: { chain: ConfirmationAskedV1['chain'] } | undefined
): AutonomyModeV1 {
	const [first, ...rest] = resolved?.chain ?? [];
	let mode: AutonomyModeV1 = first && first.id !== 'default' ? first.mode : 'act';
	for (const item of rest) if (item.id !== 'default') mode = lower(mode, item.mode);
	return mode;
}

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

	/** 5.3's rule: whether a tainted session's call of `name` is lowered to at most `ask`. */
	function lowers(name: string, sources: readonly string[]): boolean {
		const instance = deps.instanceOf(name);
		const mounted = deps.isMounted(name);
		// Another mounted instance, reads included: a mounted server may be remote, so an input can carry content out.
		if (mounted && (instance === undefined || !sources.includes(instance))) return true;
		// A `whole` source's own commands: its mutation reports are display only (phase 1's 7.4), so none of its calls can
		// be told a read, and each asks (the review's B5).
		if (mounted && deps.labelsOf(name) !== 'per-part') return true;
		// An app that holds `http`, reads included, for the same reason.
		if (!mounted && instance !== undefined && deps.holdsHttp(name)) return true;
		// A mutation anywhere, except in a taint source whose entry vouches for its labels (`per-part`).
		return (
			deps.isMutation(name) &&
			!(
				mounted &&
				instance !== undefined &&
				sources.includes(instance) &&
				deps.labelsOf(name) === 'per-part'
			)
		);
	}

	/**
	 * A call an app makes while running a command the copilot called (L2, 5.3): it carries the trace, and taint lowers it
	 * by the same rule, with the calling app as the caller, so the confirmations' gate asks the person, saying why.
	 * Untainted, it runs as the app's call. A run a person confirmed runs as confirmed.
	 */
	async function nestedGate(
		name: string,
		input: unknown,
		call: CommandContext & KernelFieldContext & { confirmation?: string },
		trace: CopilotTraceV1,
		next: () => Promise<CommandResult>
	): Promise<CommandResult> {
		delete call.taint;
		if (call.confirmation !== undefined) return next();
		if (deps.exempt(name, input) || !deps.journaled(name, call)) return next();
		const recordedTaint = (call as unknown as Record<symbol, unknown>)[RECORDED_TAINT];
		const sources = Array.isArray(recordedTaint)
			? (recordedTaint as string[])
			: await deps.taintOf(trace.session);
		if (sources.length > 0) call.taint = [...sources];
		const tainted = sources.length > 0 && lowers(name, sources);
		// A destructive or approval-held command is at most `ask` on a copilot's behalf, nested too (6.1, the review's B6).
		const held = deps.heldBy(name);
		if (!tainted && held === undefined) return next();
		if (!deps.enterable(call)) return deps.projectNotFound();
		const asked: ConfirmationAskedV1 = {
			mode: 'ask',
			reason: tainted ? 'taint' : 'policy',
			sources: tainted ? [...sources] : [],
			chain: [
				...(held ? [{ id: held, mode: 'ask' as const, as: 'ceiling' as const }] : []),
				...(tainted ? [{ id: 'taint', mode: 'ask' as const, as: 'ceiling' as const }] : []),
			],
		};
		(call as unknown as Record<symbol, unknown>)[ENFORCED] = {
			ask: true,
			asked,
			session: trace.session,
			group: `${trace.session}/${trace.turn}`,
			trace: { ...trace },
		};
		const result = await next();
		// The turn waits for it as for its own (3.5, the review's B8): only an id phase 4's gate issued for this very call.
		const raised = (call as unknown as Record<symbol, unknown>)[RAISED];
		if (typeof raised === 'string') deps.nestedRaised(trace, raised);
		return result;
	}

	const gate: CommandMiddleware = async (name, input, context, next) => {
		const call = context as CommandContext &
			KernelFieldContext & {
				trace?: CopilotTraceV1;
				confirmation?: string;
			};
		// A call nested in a copilot call, or an app's carrying its trace (L2): 5.3's rule alone.
		if (call.trace !== undefined && (call.parent !== undefined || call.caller !== undefined))
			return nestedGate(name, input, call, call.trace, next);
		// The agent interface's own top-level calls: a nested call runs inside the call this let through, and an app's
		// port is an app's, not an agent's. A hosted server's MCP calls (`interface: 'mcp'`, phase 3's step 7) are not
		// enforced here until milestone C (10.1, D98): that server keeps no autonomy rows and has no person's inbox.
		// The decision is this gate's alone to journal (#1936): never a caller's, nor one an outer call left.
		delete call.autonomy;
		delete call.taint;
		if (call.interface !== 'agent' || call.parent !== undefined || call.caller !== undefined)
			return next();
		// The shell's run of a call a person confirmed: the confirmations' gate checks its id against the act that holds it.
		if (call.confirmation !== undefined) return next();
		// A person's session is theirs (6.1: one needing PERSON_SESSION is never asked): signing in or out is refused.
		// afd-auth keeps `auth-sign-in` off the agent surface, so the registry refuses it before this; kept as a second
		// guard should a host expose it.
		if (name === 'auth-sign-in' || name === 'auth-sign-out') {
			return deps.kernelFailure(
				'HUMAN_REQUIRED',
				`'${name}' changes who is signed in, which only the person does`,
				'A person must do this in the shell'
			);
		}
		// What the journal leaves out (a search, the scope, a list) is a read no replay could ask again: never asked.
		if (deps.exempt(name, input) || !deps.journaled(name, call)) return next();
		const handedOff = await deps.handOff(name, input, context);
		if (handedOff) return handedOff;
		const trace = call.trace;
		const before = deps.preflight(name, context);
		if (before) return before;
		const resolved = await deps.resolve(name, context);
		const unit = trace !== undefined ? deps.unitOf?.(trace) : undefined;
		let mode: AutonomyModeV1 = unit
			? unitMode(resolved)
			: (resolved?.mode ??
				defaultMode(
					deps.isMutation(name),
					deps.isMounted(name),
					deps.labelsOf(name) === 'per-part'
				));
		const chain: ConfirmationAskedV1['chain'] = resolved
			? structuredClone(resolved.chain)
			: [{ id: 'default', mode, as: 'mode' }];
		// Destructive and approval-held commands are at most `ask` for an agent, under any row (6.1).
		const held = deps.heldBy(name);
		if (held) {
			chain.push({ id: held, mode: 'ask', as: 'ceiling' });
			if (mode === 'act') mode = 'ask';
		}
		// Taint (5.3): a tainted session's call outside what its sources vouch for is at most `ask`, whatever the rows say.
		let reason: DecisionV1['reason'] = unit ? 'unit' : 'policy';
		let sources: string[] = [];
		// A replay takes the decision its entry journaled, as the call was decided live (#1936), and the session's taint
		// with it (#2118): an entry that journaled none read none.
		const recorded = (call as unknown as Record<symbol, unknown>)[RECORDED_AUTONOMY];
		const replayed = recorded === 'act' || recorded === 'ask' || recorded === 'suggest';
		if (trace !== undefined) {
			const recordedTaint = (call as unknown as Record<symbol, unknown>)[RECORDED_TAINT];
			const session = replayed
				? Array.isArray(recordedTaint)
					? (recordedTaint as string[])
					: []
				: await deps.taintOf(trace.session);
			// Journaled with the call, as `autonomy` is.
			if (session.length > 0) call.taint = [...session];
			// A unit's submit is treated as tainted by the unit's source (7.3).
			const tainted = [...new Set([...session, ...(unit ? [unit.source] : [])])];
			if (tainted.length > 0 && lowers(name, tainted)) {
				sources = tainted;
				chain.push({ id: 'taint', mode: 'ask', as: 'ceiling' });
				if (mode === 'act') mode = 'ask';
				// No setting removes a taint's ask, so it is counted apart from the policy's (6.3).
				if (mode === 'ask') reason = 'taint';
			}
		}
		if (replayed) mode = recorded;
		// A unit's text never goes into a confirmation or a suggestion record (7.3): a submit that would ask or suggest is
		// refused, and nothing is stored or counted.
		// A command that declares a `confirm_prompt` would be asked by phase 4's gate in `act` too: refused alike.
		if (unit && (mode !== 'act' || deps.declares(name))) {
			if (trace !== undefined) deps.decided(trace, { mode, reason });
			return deps.kernelFailure(
				'UNIT_INVALID',
				mode === 'act'
					? `'${name}' asks the person first, so a unit's text is not sent to it`
					: `The person's autonomy for '${name}' is ${mode === 'ask' ? 'Ask' : 'Suggest'}${reason === 'taint' ? ', under taint,' : ''} so a unit's text is not sent to it`,
				"None: the server's unit is malformed or not allowed; it is reported to the person"
			);
		}
		// No confirmation or suggestion for a project the caller may not enter (6.1's order): a shell command that ignores
		// its scope would otherwise put the project's name in a header, and the person in front of a call that fails.
		if (mode !== 'act' && !deps.enterable(context)) return deps.projectNotFound();
		const decision: DecisionV1 = { mode, reason };
		// Journaled with the call (#1936): a replay that answers it from its record runs this gate again all the same.
		call.autonomy = mode;
		if (trace !== undefined) deps.decided(trace, decision);
		const person = deps.personOf(context);
		const at = deps.now(context);
		const scope = call.scope as ScopeV1 | undefined;
		const count = async (field: 'acted' | 'suggested') => {
			if (person !== undefined) await health.bump(keyOf(person, name, scope, reason, at), field);
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
					reasons: sources.length > 0 ? ['policy', 'taint'] : ['policy'],
					sources: [...sources],
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
		const asked: ConfirmationAskedV1 = { mode: 'ask', reason, sources: [...sources], chain };
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
