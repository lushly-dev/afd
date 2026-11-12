/**
 * @fileoverview Hearing the adapter (phase 3 specification, 4.4; D88): the listener, the expiry timer, the
 * membership journaling and `session-settle`, the kernel's change of person, with `SESSION_CHANGED` for a
 * call queued across a change or carrying another person's copied actor. All `late/`'s: first paint holds only
 * the ticket `run` gives a queued call (13). Every settle runs with boot's own fields, so it is never queued and
 * runs, top-level and journaled, before any call it must come before; no person, port or agent reaches it.
 */

import type { AuthAdapter } from '@lushly-dev/afd-auth';
import type { Actor, CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { JsonSchema, ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import type { AppsRuntime } from '../apps-runtime.js';
import type { OverlayStore } from '../overlays.js';
import type { AccessActorV1, MemberRoleV1 } from '../scope/access.js';
import type { LateScope } from '../scope/middleware.js';
import type { PersonalStore } from '../scope/personal.js';
import type { ScopeV1 } from '../scope/records.js';
import type { QueuedTicket, ScopeRuntime } from '../scope/runtime.js';
import type { ShellState } from '../shell-state.js';
import type { KernelPortsV1 } from '../types.js';
import type { DocumentKit } from './document-kit.js';
import type { EditorDraftsV1, EditorStateV1 } from './editor-state.js';

/** Why the kernel settles (4.4): stage B's first act, an expiry, another tab or the adapter, a membership read. */
export type SessionSettleReasonV1 = 'provider' | 'expiry' | 'tab' | 'membership';

/** `session-settle`'s input: the change, as data, computed by the kernel before it runs (4.4). */
export interface SessionSettleInputV1 {
	person: string | null;
	role: MemberRoleV1 | null;
	membershipDigest: string | null;
	reason: SessionSettleReasonV1;
}

/** `session-settle`'s result: the person now, and the one the last settle named, null at each page's start. */
export interface SessionSettleResultV1 {
	person: string | null;
	left: string | null;
}

/** A person's membership as the host reads it again (7.6), from `whoami` in a browser: null for none. */
export interface MembershipReadV1 {
	role: MemberRoleV1;
	digest: string;
}

/** The longest delay `setTimeout` keeps: a later expiry is waited for in steps of this (4.4). */
export const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/**
 * After `refresh()` fails, the timer asks again after this long, doubling each time up to
 * {@link REFRESH_RETRY_MAX_MS}, for as long as the session reports the same expiry; it never settles on a
 * failure. Every enforcement point already refuses an expired session, so the page only catches up later.
 */
export const REFRESH_RETRY_FIRST_MS = 5_000;
export const REFRESH_RETRY_MAX_MS = 300_000;

/**
 * The commands before which the kernel reads the person's membership again (7.6): the owner cases of shared
 * commands and the owner commands that exist so far; step 4 adds the rest of `OWNER_COMMANDS`.
 */
const rereads = (name: string, input: unknown): boolean =>
	name === 'project-create' ||
	name === 'workspace-app-set' ||
	(name === 'project-update' && typeof input === 'object' && input !== null && 'access' in input);

/** `session-settle`'s input schema, from the kit's Zod: this chunk imports none of first paint's (13). */
const settleInputOf = ({ z }: Pick<DocumentKit, 'z'>) =>
	z.strictObject({
		person: z.nullable(z.string().check(z.minLength(1), z.maxLength(256))),
		role: z.nullable(z.enum(['owner', 'admin', 'member'])),
		membershipDigest: z.nullable(z.string().check(z.maxLength(256))),
		reason: z.enum(['provider', 'expiry', 'tab', 'membership']),
	});

/**
 * An editor record's first shape, `emptyEditorState()`'s, held equal to it by a test: imported, the bundler would
 * part `editor-state.ts` from `late-editor` into a chunk of its own for this one (13).
 */
export const emptyEditor = (): EditorStateV1 => ({
	version: 1,
	groups: [{ id: 'g1', tabs: [], active: null }],
	activeGroup: 'g1',
	nextTab: 1,
	nextGroup: 2,
});
const NULL: JsonSchema = { type: 'null' };
const SETTLE_INPUT_JSON: JsonSchema = {
	type: 'object',
	properties: {
		person: { anyOf: [{ type: 'string', minLength: 1, maxLength: 256 }, NULL] } as JsonSchema,
		role: { anyOf: [{ type: 'string', enum: ['owner', 'admin', 'member'] }, NULL] } as JsonSchema,
		membershipDigest: { anyOf: [{ type: 'string', maxLength: 256 }, NULL] } as JsonSchema,
		reason: { type: 'string', enum: ['provider', 'expiry', 'tab', 'membership'] },
	},
	required: ['person', 'role', 'membershipDigest', 'reason'],
	additionalProperties: false,
};

/**
 * What this chunk reads of first paint's modules, given by `late/`, which imports them already: imported here, the
 * bundler would part first paint's shared modules into a chunk of their own for this one (13).
 */
export interface SessionSettleKit extends Pick<DocumentKit, 'define' | 'success' | 'z' | 'marked'> {
	/** The person the adapter reports now, on the kernel's clock: `sessionActor`. */
	actor(): AccessActorV1;
	/** `personKey`. */
	personKey(actor: AccessActorV1): string | undefined;
	/** A queued call's ticket, which `run` set. */
	ticket(call: CommandContext): QueuedTicket | undefined;
	/** `SESSION_CHANGED` (15): retryable, journaled, and decided by the page, so a replay answers it from its entry. */
	sessionChanged(): CommandResult<never>;
	/** `MEMBERSHIP_UNAVAILABLE` (15): the membership read before `name` failed, or its settle did. */
	membershipUnavailable(name: string): CommandResult<never>;
	/** `INTERNAL_COMMANDS`: the kernel's own, never refused. */
	internal: readonly string[];
}

export interface SessionSettleDeps {
	auth: AuthAdapter;
	identity?: IdentityV1 | undefined;
	scope: ScopeRuntime;
	state: ShellState;
	viewState: ViewStateRegistry;
	overlays: OverlayStore;
	apps(): AppsRuntime;
	lateScope: Pick<LateScope, 'applyScopeChange'>;
	/** The editor area's drafts in memory, live: a change of person moves them (4.5). */
	drafts: EditorDraftsV1;
	/** The editor record of a scope, registered and read: the next person's active scope's (4.5). */
	ensureEditor(project: string | undefined): Promise<unknown>;
	/**
	 * A `provider` deployment's view-state store, keyed by {@link SessionSettle.person}, and `quiet`, which drops
	 * the writes `fn` queues (4.5).
	 */
	personal?: PersonalStore | undefined;
	quiet?(fn: () => void): void;
	clock?: { now(): number };
	ports?: Pick<KernelPortsV1, 'schedule' | 'readMembership'> | undefined;
	/** Boot's own: never queued, top-level, journaled (phase 2 specification, 2.2). */
	runBoot(name: string, input: unknown): Promise<{ success: boolean }>;
	kit: SessionSettleKit;
	/** By interface, the `auth-*` call queued last and not yet ended: `run`'s, cleared here as one ends. */
	pending: Partial<Record<string, QueuedTicket>>;
	/**
	 * The actor stage A chose the scope for and read the records of, undefined in it when signed out; none when
	 * stage A has not chosen yet, as with no boot, where stage B runs first (the review of step 2's B1).
	 */
	stageA?: [AccessActorV1] | undefined;
	/**
	 * A replay's: `replaying`, and `drive`, which sets its Mock to the person an entry records, so the replay
	 * decides as the original did with no provider (4.4, 11).
	 */
	internals?: {
		replaying?: boolean;
		drive?(person: string | null): void;
		actorOf?(traceId: string | undefined): { actor?: Actor } | undefined;
	};
}

/** What the scope middleware, the auth gate and the kernel call of this part. */
export interface SessionSettle {
	command: ZodCommandDefinition;
	/**
	 * Stage B's first act: in `provider` mode the first settle, for stage A's person, then the listener and the
	 * timer, and a change since stage A heard at once (4.4).
	 */
	begin(): Promise<void>;
	/**
	 * Line −1, before line 0: a queued call the person changed under, a copied actor that is not the person
	 * signed in, or a call stamped as a person the shell is not settled for, is `SESSION_CHANGED`. The kernel's
	 * own internal commands are never refused, nor is an `auth-*` call the last.
	 */
	refuse(call: CommandContext, name: string): CommandResult<never> | undefined;
	/** The auth gate keeps a call's copied actor here, before afd-auth's middleware stamps the session's. */
	copied: WeakMap<object, Actor>;
	/**
	 * Before a person's or an agent's call is stamped, in the auth gate: a change of person not yet settled, as an
	 * expiry the timer has not reached, is settled first, so the call runs on the next person's state (#854) and
	 * I1 refuses only a change that races it.
	 */
	settleFirst(name: string, call: CommandContext): Promise<void> | undefined;
	/**
	 * Around an `auth-*` call, which settles inside itself (4.4): a sign-in or sign-out that succeeded made the
	 * change, and in `provider` mode, where records are per person, it does what a settle does, on its own call;
	 * in `local` mode it holds the leaving person's drafts and takes up the next one's (4.5). On the settles'
	 * chain, so no change of person runs beside another.
	 */
	authStart(): void;
	authEnd(call: CommandContext, name: string, succeeded: boolean): Promise<void>;
	/**
	 * After an `auth-*` call, journaled: a change its command did not make, as another tab's during
	 * `auth-session-get`, is settled now, after its entry (the review of step 2's I2).
	 */
	afterAuth(): void;
	/** Whether line 0 waits for the membership read before `name`, in `run` rather than before it (I5). */
	rereadsBefore(name: string): boolean;
	/**
	 * Before a command that reads membership again (7.6), on the settles' chain: a changed digest is a top-level
	 * `session-settle` with `reason: 'membership'`, before the call that needed it runs. Answers a refusal:
	 * `MEMBERSHIP_UNAVAILABLE` when the host's read or the settle fails (fail closed), `SESSION_CHANGED` when the
	 * person changed while it read. A replay replays the entry instead.
	 */
	reread(name: string, input: unknown): Promise<CommandResult<never> | undefined>;
	/** The person the shell is for, which the personal store keys records by; undefined before stage B. */
	person(): string | null | undefined;
	/** A reload, for a replay: each page starts settled to no one (10). */
	reload(): void;
	stop(): void;
}

export function createSessionSettle(deps: SessionSettleDeps): SessionSettle {
	const provider = deps.identity?.mode === 'provider';
	const now = (): number => (deps.clock ?? Date).now();
	const replaying = (): boolean => deps.internals?.replaying === true;
	const { kit } = deps;
	const current = (): string | null => kit.personKey(kit.actor()) ?? null;
	const actorOf = (person: string | null): AccessActorV1 =>
		person === null ? undefined : { kind: 'human', id: person };
	/** The person the last settle named, on this page: null at each page's start, the original's and the replay's. */
	let settled: string | null = null;
	/**
	 * The person the shell's state is for: stage A's, then each settle's and each `auth-*` call's. Undefined with
	 * no stage A yet, and after a replay's reload, when it is read once needed (10).
	 */
	let decided: string | null | undefined = deps.stageA && (kit.personKey(deps.stageA[0]) ?? null);
	const decidedNow = (): string | null => {
		if (decided === undefined) decided = current();
		return decided;
	};
	/**
	 * The person the shell is for, their session past its `expiresAt` on the kernel's clock and nothing else
	 * changed: phase 2's path (3.4) takes it into account at the next call, and the timer settles it (#854). It is
	 * no other person's state, so neither settled first nor refused.
	 */
	const expiredOnly = (): boolean => {
		const state = deps.auth.getSession();
		return (
			decided != null &&
			current() === null &&
			state.status === 'authenticated' &&
			state.user.id === decided
		);
	};
	/** The person the last settle queued names, so two changes to them make one call (4.4). */
	let target: string | null | undefined;
	/**
	 * Every change of person runs here, one after another: the listener's settles, the membership re-read and an
	 * `auth-*` call's change (the review of step 2's B2).
	 */
	let chain: Promise<unknown> = Promise.resolve();
	const serial = <T>(job: () => Promise<T>): Promise<T> => {
		const ran = chain.then(job);
		chain = ran.catch(report);
		return ran;
	};
	/** Each change the adapter reports, counted, so a read it overlapped is not trusted. */
	let changes = 0;
	let authRunning = 0;
	let firing = false;
	let stopped = false;
	let subscription: { unsubscribe(): void } | undefined;
	let cancel: (() => void) | undefined;
	/** The `expiresAt` the timer is armed for, so it re-arms only when the adapter reports another (4.4). */
	let armedFor: number | undefined;
	let retries = 0;
	const copied = new WeakMap<object, Actor>();
	/**
	 * By person, the drafts they left in memory, so no action of another person loses one, taken up again if they
	 * sign in again in the same page (4.5). No one's key is the empty string.
	 */
	const held = new Map<string, EditorDraftsV1>();
	const switchDrafts = (left: string | null, next: string | null): void => {
		if (left === next) return;
		const { dirty, selections } = deps.drafts;
		const back = held.get(next ?? '');
		held.delete(next ?? '');
		held.set(left ?? '', { dirty: new Map(dirty), selections: new Map(selections) });
		dirty.clear();
		selections.clear();
		for (const [tab, document] of back?.dirty ?? []) dirty.set(tab, document);
		for (const [tab, selection] of back?.selections ?? []) selections.set(tab, selection);
	};

	function report(cause: unknown): void {
		(globalThis as { reportError?: (error: unknown) => void }).reportError?.(cause);
	}

	/** The host's `schedule`, or `setTimeout` on the kernel's clock, which never holds a Node process open. */
	const schedule =
		deps.ports?.schedule ??
		((at: number, fn: () => void) => {
			const handle = setTimeout(fn, Math.max(0, at - now())) as { unref?(): void };
			handle.unref?.();
			return () => clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
		});

	/** The role and digest the kernel holds for `person`: what stage A was given, or the last settle journaled. */
	const heldFor = (
		person: string | null
	): Pick<SessionSettleInputV1, 'role' | 'membershipDigest'> => {
		const role = (provider && person !== null && deps.scope.membership.members.get(person)) || null;
		return { role, membershipDigest: role === null ? null : deps.scope.membership.digest };
	};

	/**
	 * Settle `person`, on the chain. The host reads the membership of whoever is signed in, so it is read only for
	 * the person signed in, and only trusted if no change overlapped it: one that did drops this settle, and the
	 * notice that change made settles instead. Another person, superseded before this ran, settles with what the
	 * kernel holds, so no change to a different person is merged away (4.4).
	 */
	async function settleNow(person: string | null, reason: SessionSettleReasonV1): Promise<void> {
		if (stopped) return;
		if (reason !== 'provider' && person === decidedNow()) return;
		let membership = heldFor(person);
		if (provider && person !== null && reason !== 'provider' && person === current()) {
			const read = deps.ports?.readMembership;
			if (read) {
				const seen = changes;
				try {
					const found = await read();
					membership = { role: found?.role ?? null, membershipDigest: found?.digest ?? null };
				} catch (cause) {
					// A read that fails decides with what the kernel holds: line 0 refuses a person it does not list.
					report(cause);
				}
				if (stopped || changes !== seen || current() !== person) return;
			}
		}
		await deps.runBoot('session-settle', { person, ...membership, reason });
	}

	/** A change no `auth-*` command made: settled, on the chain, when the person really changed. */
	function notice(reason: SessionSettleReasonV1): Promise<void> {
		if (stopped || replaying()) return Promise.resolve();
		const person = current();
		if (person === (target === undefined ? decidedNow() : target)) return chain.then(() => {});
		target = person;
		return serial(async () => {
			try {
				await settleNow(person, reason);
			} finally {
				if (target === person) target = undefined;
			}
		});
	}

	const expiryOf = (): number | undefined => {
		const state = deps.auth.getSession();
		const at = state.status === 'authenticated' ? state.session.expiresAt : undefined;
		const ms = at === undefined ? Number.NaN : new Date(at).getTime();
		return Number.isFinite(ms) ? ms : undefined;
	};

	/** Wait for `at`, in steps no longer than `setTimeout` keeps; one timer at a time (I3). */
	const wait = (at: number, fire: () => void): void => {
		cancel?.();
		cancel = schedule(Math.min(at, now() + MAX_TIMER_DELAY_MS), fire);
	};

	/** Ask again after a failure, backing off; a new expiry resets it (4.4). */
	const retry = (at: number): void => {
		if (stopped) return;
		const delay = Math.min(REFRESH_RETRY_FIRST_MS * 2 ** retries, REFRESH_RETRY_MAX_MS);
		retries++;
		wait(now() + delay, () => void fire(at));
	};

	/** The timer for the session's `expiresAt`, re-armed only when the adapter reports another one. */
	function arm(): void {
		// While it fires, the adapter's own change during `refresh()` neither re-arms it nor resets its backoff.
		if (stopped || replaying() || firing) return;
		const at = current() === null ? undefined : expiryOf();
		if (at === armedFor && (cancel !== undefined || at === undefined)) return;
		cancel?.();
		cancel = undefined;
		armedFor = at;
		retries = 0;
		if (at !== undefined) wait(at, () => void fire(at));
	}

	async function fire(at: number): Promise<void> {
		cancel = undefined;
		if (stopped) return;
		// Woke early: a clamped delay, or a host whose timer ran ahead of the kernel's clock.
		if (now() < at) {
			wait(at, () => void fire(at));
			return;
		}
		firing = true;
		try {
			await deps.auth.refresh?.();
		} catch (cause) {
			// The provider could not be reached: never settle on a failure; ask again later.
			report(cause);
			firing = false;
			retry(at);
			return;
		}
		firing = false;
		if (stopped) return;
		// An expired session is no one's (`sessionActor`), so a refresh that kept it settles to no one here.
		await notice('expiry');
		armedFor = undefined;
		arm();
	}

	/** Every change the adapter reports: the timer re-arms, and a change no command made is settled. */
	function heard(): void {
		changes++;
		if (stopped || replaying()) return;
		arm();
		if (authRunning === 0 && !firing) void notice('tab');
	}

	/**
	 * The next person's records, in memory, from the store: `provider` mode's records are per person (4.5), keyed
	 * by the person the shell is for, which `change` has set. With no one signed in they stay at their first
	 * shape: `~signed-out` holds defaults only.
	 */
	async function hydrate(personal: PersonalStore, to: string | null): Promise<void> {
		// What is pending is the leaving person's, keyed when it was queued: written as theirs first.
		await deps.viewState.flush();
		deps.quiet?.(() => {
			// Each record back to its first shape, so nothing of the leaving person's shows where the next has none.
			for (const { id } of deps.viewState.list()) {
				if (personal.key(id) === id) continue;
				if (id === 'loam.apps') deps.viewState.set(id, { active: null, section: null, path: '' });
				else if (id === 'loam.scope') deps.viewState.set(id, { project: null });
				else if (id.startsWith('loam.editor')) {
					deps.viewState.replace(id, emptyEditor() as unknown as Record<string, unknown>);
				} else {
					deps.viewState.replace(
						id,
						deps.state.layoutInitial(id) as unknown as Record<string, unknown>
					);
				}
			}
		});
		if (to !== null) await deps.state.hydrate();
	}

	/**
	 * A change of person (4.4), to `to`, never the adapter's live person: every open overlay dismissed as an app
	 * switch, since each is the leaving person's; the active app closed by `app-close`'s rules; selections
	 * cleared; the leaving person's drafts held; in `provider` mode the next person's records read; then the scope
	 * they may be in. `left` is read once and the shell is `to`'s before the first await (B2).
	 */
	async function change(to: string | null, context: CommandContext): Promise<void> {
		const { overlays, state, scope } = deps;
		const left = decidedNow();
		decided = to;
		const before = scope.active();
		for (const owner of new Set(overlays.list().map((overlay) => overlay.owner))) {
			overlays.closeForSwitch(owner);
		}
		// In `provider` mode nothing written while leaving is the next person's: it is dropped (4.5).
		const leave = () => {
			if (state.activeApp() !== null && deps.apps().close().success) {
				// `setMain`'s write, as `app-close` makes it.
				deps.viewState.set('loam.apps', {
					section: before.project === undefined ? null : 'projects',
					path: '',
				});
				scope.note(context.traceId, { mainChanged: 'push' });
			}
			deps.apps().clearSelections();
		};
		if (deps.quiet) deps.quiet(leave);
		else leave();
		switchDrafts(left, to);
		if (deps.personal) await hydrate(deps.personal, to);
		const recorded = deps.personal ? state.scopeProject() : before.project;
		const at: ScopeV1 =
			recorded && scope.allows(actorOf(to), { workspace: before.workspace, project: recorded })
				? { workspace: before.workspace, project: recorded }
				: { workspace: before.workspace };
		deps.lateScope.applyScopeChange(at, 'actor', context);
		await deps.ensureEditor(at.project);
		if (at.workspace !== before.workspace || at.project !== before.project) {
			scope.note(context.traceId, {
				scopeChanged: { from: before, to: at, reason: 'actor' },
				mainChanged: 'push',
			});
		}
	}

	const settleInput = settleInputOf(kit);
	const command = kit.define<typeof settleInput, SessionSettleResultV1>({
		name: 'session-settle',
		description: "The kernel's own: the person or the membership it decides with changed",
		category: 'session',
		mutation: true,
		executionTime: 'instant',
		input: settleInput,
		jsonSchema: SETTLE_INPUT_JSON,
		async handler(input, context) {
			// A replay's Mock and membership are driven to what the entry records; the original's already are.
			if (replaying()) deps.internals?.drive?.(input.person);
			if (provider && input.person !== null) {
				const members = new Map(deps.scope.membership.members);
				if (input.role === null) members.delete(input.person);
				else members.set(input.person, input.role);
				deps.scope.membership = {
					mode: 'provider',
					members,
					digest: input.membershipDigest ?? '',
				};
			}
			const left = settled;
			settled = input.person;
			const changed = input.person !== decidedNow();
			if (changed) await change(input.person, context);
			else if (input.reason === 'membership') {
				// The same person: only the membership, and the active project if it is no longer allowed.
				const active = deps.scope.active();
				if (!deps.scope.allows(actorOf(input.person), active)) {
					deps.lateScope.applyScopeChange({ workspace: active.workspace }, 'actor', context);
				}
			}
			if (changed || input.reason === 'membership') {
				deps.scope.note(context.traceId, { actorChanged: true });
			}
			return kit.success({ person: input.person, left });
		},
	}) as unknown as ZodCommandDefinition;

	return {
		command,
		copied,
		async begin() {
			subscription ??= deps.auth.onAuthStateChange(heard);
			if (replaying()) return;
			// Stage A's person, whose records stage A read: the first settle names them, a change from null in the
			// original and the replay alike, and the notice after it hears a change since stage A (B1).
			const first = decidedNow();
			if (provider) await serial(() => settleNow(first, 'provider'));
			arm();
			await notice('tab');
		},
		refuse(call, name) {
			if (replaying() || kit.internal.includes(name)) return undefined;
			const ticket = kit.ticket(call);
			const signedIn = current() ?? undefined;
			if (ticket) {
				// Queued behind an `auth-*` call of its interface: as the person that call left (4.4).
				const behind = ticket.behind;
				const expected = behind && 'left' in behind ? behind.left : ticket.person;
				if (expected !== signedIn) return kit.sessionChanged();
			}
			// A copied actor (a port's, a surface's or a nested call) acts only for the person signed in, where
			// afd-auth's middleware would stamp it as whoever is signed in now.
			const actor = copied.get(call);
			if (actor && kit.personKey(actor) !== signedIn) return kit.sessionChanged();
			// A person's or an agent's call in this page, stamped as a person the shell is not settled for: the
			// change is on its way, and nothing runs as one person on another's state (I1).
			if (
				!name.startsWith('auth-') &&
				kit.marked(call) &&
				decided !== undefined &&
				!deps.internals?.actorOf?.(call.traceId) &&
				(kit.personKey(call.actor) ?? null) !== decided &&
				!(kit.personKey(call.actor) === undefined && expiredOnly())
			) {
				return kit.sessionChanged();
			}
			return undefined;
		},
		settleFirst(name, call) {
			if (
				stopped ||
				replaying() ||
				decided === undefined ||
				kit.internal.includes(name) ||
				name.startsWith('auth-') ||
				!kit.marked(call)
			)
				return undefined;
			// Settled already, or only expired, which the timer settles; a change on its way is awaited with its notice.
			if (target === undefined && (current() === decided || expiredOnly())) return undefined;
			return notice('expiry');
		},
		authStart() {
			authRunning++;
		},
		authEnd(call, name, succeeded) {
			authRunning--;
			const ticket = kit.ticket(call);
			// The person the call left, read as it ends, before the chain runs anything else.
			const person = current();
			if (ticket) {
				ticket.left = person ?? undefined;
				const iface = call.interface as string;
				if (deps.pending[iface] === ticket) delete deps.pending[iface];
			}
			return serial(async () => {
				// A sign-in or sign-out that succeeded settled inside itself, as phase 2's middleware caller does;
				// any other change is settled after the call (`afterAuth`).
				if (succeeded && (name === 'auth-sign-in' || name === 'auth-sign-out')) {
					settled = person;
					const from = decidedNow();
					if (person !== from) {
						if (deps.personal) {
							await change(person, call);
							deps.scope.note(call.traceId, { actorChanged: true });
						} else {
							// `local` mode's records are everyone's: only the drafts move (4.5).
							decided = person;
							switchDrafts(from, person);
						}
					}
				}
				arm();
			});
		},
		afterAuth() {
			if (authRunning === 0) void notice('tab');
		},
		rereadsBefore: (name) =>
			provider &&
			(name === 'project-create' || name === 'workspace-app-set' || name === 'project-update'),
		reread(name, input) {
			if (!provider || replaying() || !rereads(name, input)) return Promise.resolve(undefined);
			return serial(async () => {
				const person = current();
				if (person === null) return undefined;
				// The person signed in is not the one the shell is settled for: refused, as I1 would.
				if (person !== decidedNow()) return kit.sessionChanged();
				const read = deps.ports?.readMembership;
				if (!read) return undefined;
				const seen = changes;
				let found: Awaited<ReturnType<typeof read>>;
				try {
					found = await read();
				} catch (cause) {
					report(cause);
					return kit.membershipUnavailable(name);
				}
				// Another tab changed who is signed in while it read: the answer may be anyone's (B2).
				if (changes !== seen || current() !== person) return kit.sessionChanged();
				const membership = { role: found?.role ?? null, membershipDigest: found?.digest ?? null };
				// Unchanged from what the kernel decides with, which the last settle journaled or stage A was given.
				const holding = heldFor(person);
				if (
					membership.role === holding.role &&
					membership.membershipDigest === holding.membershipDigest
				)
					return undefined;
				// A settle that fails, as for a role or digest it does not take, refuses the call (B3).
				const settledIt = await deps.runBoot('session-settle', {
					person,
					...membership,
					reason: 'membership',
				});
				return settledIt.success ? undefined : kit.membershipUnavailable(name);
			});
		},
		person: () => decided,
		reload() {
			settled = null;
			decided = undefined;
			target = undefined;
		},
		stop() {
			stopped = true;
			cancel?.();
			cancel = undefined;
			subscription?.unsubscribe();
			subscription = undefined;
		},
	};
}
