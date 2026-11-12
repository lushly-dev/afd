/**
 * Phase 3's step 2 units (phase 3 specification, 4.4; D88): the listener, the expiry timer with its re-arming
 * and refresh, the membership journaling, `session-settle`'s input as data, the change of person and
 * `SESSION_CHANGED` with its exemptions. E4's rows carry `P3-E4:`.
 */

import { MockAuthAdapter, type User } from '@lushly-dev/afd-auth';
import { type CommandContext, type JournalEntry, MemoryJournalSink } from '@lushly-dev/afd-core';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import { readBoot } from '@lushly-dev/loam-manifest';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKernel, QUEUED } from '../kernel.js';
import type { MembershipV1 } from '../scope/access.js';
import {
	createScopedWorkspace,
	type ScopedWorkspace,
	type ScopedWorkspaceOptions,
	scopedDeployment,
	scopedPorts,
} from '../scope/fixtures.js';
import type { ScopeV1 } from '../scope/records.js';
import type { QueuedTicket } from '../scope/runtime.js';
import { createFixedEnvironment } from '../session.js';
import { documentsDeployment, documentsPorts, replayKernel } from '../testing.js';
import type { KernelEventV3, KernelPortsV1, LoamKernelV3 } from '../types.js';
import { emptyEditorState } from './editor-state.js';
import {
	emptyEditor,
	MAX_TIMER_DELAY_MS,
	REFRESH_RETRY_FIRST_MS,
	type SessionSettleInputV1,
} from './session-settle.js';

const BEA = 'mock-user-bea@example.com';
const OLU = 'mock-user-olu@example.com';
const CARO = 'mock-user-caro@example.com';
const PROVIDER: IdentityV1 = {
	mode: 'provider',
	organization: 'acme',
	path: 'api/auth',
	methods: ['passkey'],
};
const members = (
	entries: Record<string, 'owner' | 'admin' | 'member'>,
	digest = 'd1'
): MembershipV1 => ({ mode: 'provider', members: new Map(Object.entries(entries)), digest });
const ACME = members({ [BEA]: 'member', [OLU]: 'owner' });
const WORKSPACE: ScopeV1 = { workspace: 'personal' };
const T0 = Date.UTC(2026, 10, 3);
const user = (id: string): User => {
	const email = id.slice('mock-user-'.length);
	return { id, email, name: email.split('@')[0] as string };
};

const kernels: LoamKernelV3[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

/** A kernel clock the test sets, a millisecond per reading, which the fixture's Mock shares (4.4). */
function settableClock(start: number) {
	let at = start;
	return {
		now: () => at++,
		set(time: number) {
			at = time;
		},
	};
}

interface FakeTimer {
	at: number;
	fn: () => void;
	cancelled: boolean;
	ran: boolean;
}

/** The host's `schedule` port, faked: the test runs what is due. */
function fakeSchedule() {
	const timers: FakeTimer[] = [];
	return {
		schedule(at: number, fn: () => void) {
			const timer = { at, fn, cancelled: false, ran: false };
			timers.push(timer);
			return () => {
				timer.cancelled = true;
			};
		},
		pending: () => timers.filter((timer) => !timer.cancelled && !timer.ran),
		scheduled: () => timers.length,
		/** Run each timer due by `now`, as the host's would. */
		run(now: number) {
			for (const timer of timers.filter((held) => !held.cancelled && !held.ran)) {
				if (timer.at > now) continue;
				timer.ran = true;
				timer.fn();
			}
		},
	};
}

async function workspace(options: ScopedWorkspaceOptions = {}): Promise<ScopedWorkspace> {
	const made = await createScopedWorkspace(options);
	kernels.push(made.kernel);
	return made;
}

/** A provider workspace with no project yet: a replay starts from an empty store, so each is made by command. */
const providerWorkspace = (options: ScopedWorkspaceOptions = {}): Promise<ScopedWorkspace> =>
	workspace({ identity: PROVIDER, membership: ACME, empty: true, ...options });

/** Vault, restricted to Bea, made by Bea, then entered. */
async function enterVault(kernel: LoamKernelV3): Promise<void> {
	const created = await kernel.call('project-create', {
		name: 'Vault',
		access: { mode: 'restricted', members: [BEA] },
	});
	expect(created.success, JSON.stringify(created.error)).toBe(true);
	expect((await kernel.call('scope-set', { project: 'vault' })).success).toBe(true);
}

const signIn = (kernel: LoamKernelV3, email: string) =>
	kernel.call('auth-sign-in', { method: 'credentials', email, password: 'x' });
const journalOf = (made: { journal: MemoryJournalSink }) => made.journal.read();
const settles = async (made: { journal: MemoryJournalSink }) =>
	(await journalOf(made)).filter((entry) => entry.command === 'session-settle');
/** The settles the timer made: `_setUser`, a change no command made, settles too, as `tab`. */
const expiries = async (made: { journal: MemoryJournalSink }) =>
	(await settles(made)).filter(
		(entry) => (entry.input as SessionSettleInputV1).reason === 'expiry'
	);
const expiryOf = (auth: MockAuthAdapter) => {
	const state = auth.getSession();
	return new Date(
		state.status === 'authenticated' ? (state.session.expiresAt as Date) : 0
	).getTime();
};
const replayProvider = (entries: readonly JournalEntry[], ports: KernelPortsV1 = scopedPorts()) =>
	replayKernel(entries, {
		deployment: scopedDeployment(),
		ports,
		identity: PROVIDER,
		membership: ACME,
	});

describe('P3-E4: a session ends with no command (#854, #864)', () => {
	it('P3-E4: the Mock’s expiry on a fake kernel clock settles with no call, journaled with its input, and leaves the restricted project; the replay has zero differences and never arms the timer', async () => {
		const time = settableClock(T0);
		const timers = fakeSchedule();
		const made = await providerWorkspace({
			clock: time.now,
			ports: { ...scopedPorts(), schedule: timers.schedule },
		});
		expect((await signIn(made.kernel, 'bea@example.com')).success).toBe(true);
		await enterVault(made.kernel);
		const expiresAt = expiryOf(made.auth);
		// One timer, for the session's `expiresAt`, on the kernel's clock.
		expect(timers.pending().map((timer) => timer.at)).toEqual([expiresAt]);
		const events: KernelEventV3[] = [];
		made.kernel.subscribe((event) => events.push(event));
		const before = (await journalOf(made)).length;
		time.set(expiresAt);
		timers.run(expiresAt);
		await vi.waitFor(async () => expect((await journalOf(made)).length).toBe(before + 1));
		const entry = (await journalOf(made)).at(-1) as JournalEntry;
		expect(entry.command).toBe('session-settle');
		expect(entry.input).toEqual({
			person: null,
			role: null,
			membershipDigest: null,
			reason: 'expiry',
		} satisfies SessionSettleInputV1);
		expect(entry.result.data).toEqual({ person: null, left: BEA });
		// Its event says the person changed and the restricted project was left, so every section re-reads.
		expect(events.find((event) => event.command === 'session-settle')).toMatchObject({
			actorChanged: true,
			mutation: true,
			scopeChanged: { to: WORKSPACE, reason: 'actor' },
		});
		expect((await made.kernel.call<{ scope: ScopeV1 }>('scope-get')).data?.scope).toEqual(
			WORKSPACE
		);
		// Signed out, no project is listed: the list loses the name.
		expect((await made.kernel.call('project-list')).error?.code).toBe('UNAUTHORIZED');
		// A session that is gone leaves no timer.
		expect(timers.pending()).toEqual([]);
		const replayTimers = fakeSchedule();
		const { report } = await replayProvider(await journalOf(made), {
			...scopedPorts(),
			schedule: replayTimers.schedule,
		});
		expect(report.diverged).toBe(false);
		expect(replayTimers.scheduled()).toBe(0);
	});

	it('P3-E4: a change of person closes the app, dismisses its overlays and cancels a shell modal', async () => {
		const made = await providerWorkspace();
		const { kernel } = made;
		await signIn(kernel, 'bea@example.com');
		expect((await kernel.call('app-open', { instance: 'dual' })).success).toBe(true);
		const port = kernel.appPort('dual');
		expect((await port.call('toast-show', { message: 'From dual' })).success).toBe(true);
		expect((await kernel.call('modal-open', { title: 'T', body: 'B' })).success).toBe(true);
		const events: KernelEventV3[] = [];
		kernel.subscribe((event) => events.push(event));
		// Another tab signs Olu in: no command here made the change.
		made.auth._setUser(user(OLU));
		await vi.waitFor(async () => expect(await settles(made)).toHaveLength(2));
		const settle = (await settles(made)).at(-1) as JournalEntry;
		expect(settle.input).toEqual({
			person: OLU,
			role: 'owner',
			membershipDigest: 'd1',
			reason: 'tab',
		} satisfies SessionSettleInputV1);
		expect(settle.result.data).toEqual({ person: OLU, left: BEA });
		expect((await kernel.call<{ active: string | null }>('section-get')).data).toMatchObject({
			active: null,
		});
		const overlays = await kernel.call<{ overlays: unknown[] }>('overlay-list');
		expect(overlays.data?.overlays).toEqual([]);
		expect(events.find((event) => event.command === 'session-settle')).toMatchObject({
			actorChanged: true,
			mainChanged: 'push',
		});
		expect((await replayProvider(await journalOf(made))).report.diverged).toBe(false);
	});

	it("P3-E4: a change of person holds the leaving person's draft, and takes it up when they sign in again", async () => {
		const time = settableClock(T0);
		const timers = fakeSchedule();
		const made = await workspace({
			deployment: documentsDeployment(),
			ports: { ...documentsPorts(), schedule: timers.schedule },
			clock: time.now,
		});
		const { kernel } = made;
		await signIn(kernel, 'bea@example.com');
		const created = await kernel.call<{ id: string }>('document-create', {
			type: 'probe',
			title: 'Draft',
		});
		await kernel.call('document-open', { document: created.data?.id });
		const tab = async () =>
			(
				await kernel.call<{ groups: Array<{ tabs: Array<{ id: string; dirty: boolean }> }> }>(
					'editor-get'
				)
			).data?.groups[0]?.tabs[0];
		const id = (await tab())?.id as string;
		expect((await kernel.call('editor-dirty-set', { tab: id, dirty: true })).success).toBe(true);
		const expiresAt = expiryOf(made.auth);
		time.set(expiresAt);
		timers.run(expiresAt);
		await vi.waitFor(async () => expect(await settles(made)).toHaveLength(1));
		// Held: no one else sees it as theirs, and closing it loses nothing of Bea's.
		expect((await tab())?.dirty).toBe(false);
		await signIn(kernel, 'bea@example.com');
		expect((await tab())?.dirty).toBe(true);
	});

	it('P3-E4: refuses a call queued across a change of person with SESSION_CHANGED, journaled, and runs one queued behind its interface’s sign-in as the person it signed in', async () => {
		const auth = new MockAuthAdapter();
		auth._setUser(user(BEA));
		let release: () => void = () => {};
		const loaded = new Promise<undefined>((resolve) => {
			release = () => resolve(undefined);
		});
		const journal = new MemoryJournalSink();
		const kernel = await createKernel({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal,
			auth,
			environment: createFixedEnvironment(),
			host: 'test',
			boot: readBoot(scopedDeployment()) as NonNullable<Parameters<typeof createKernel>[0]['boot']>,
			appsLoader: () => loaded as never,
		});
		kernels.push(kernel);
		void kernel.startApps();
		// Queued as Bea, behind stage B.
		const asBea = kernel.call('project-list');
		const agentAsBea = kernel.agent.call('layout-get');
		// The session changes before they run, by no command of theirs.
		auth._setUser(user(OLU));
		// The palette's sign-in, and a read queued behind it on the same interface.
		const signedIn = signIn(kernel, 'caro@example.com');
		const behind = kernel.call('layout-get');
		release();
		const refused = await asBea;
		expect(refused.error).toMatchObject({ code: 'SESSION_CHANGED', retryable: true });
		expect(refused.error?.suggestion).toBe('Run it again as the person now signed in');
		// The agent's call was queued on another interface: the palette's sign-in does not carry it.
		expect((await agentAsBea).error?.code).toBe('SESSION_CHANGED');
		expect((await signedIn).success).toBe(true);
		expect((await behind).success).toBe(true);
		const entries = await journal.read();
		const journaled = entries.find((entry) => entry.command === 'project-list');
		expect(journaled?.result.error?.code).toBe('SESSION_CHANGED');
		const read = entries.find(
			(entry) => entry.command === 'layout-get' && entry.contextDigest?.interface === 'palette'
		);
		expect(read?.actor).toMatchObject({ kind: 'human', id: CARO });
		// The refusal is the page's decision: a replay answers it from its entry.
		const { report } = await replayKernel(entries, {
			deployment: scopedDeployment(),
			ports: scopedPorts(),
		});
		expect(report.diverged).toBe(false);
		expect(report.recorded).toContain(journaled?.seq);
	});

	it("P3-E4: refuses a nested call whose copied person is not the session's, signed out or another person (the step 1 review's N4)", async () => {
		const made = await workspace();
		const nested = (traceId: string) =>
			made.registries.palette.execute('layout-get', {}, {
				traceId,
				parent: 'outer',
				actor: { kind: 'human', id: BEA },
			} as CommandContext);
		await signIn(made.kernel, 'bea@example.com');
		expect((await nested('n1')).success).toBe(true);
		// A copied human actor no longer survives a sign-out on an excluded command.
		await made.kernel.call('auth-sign-out');
		expect((await nested('n2')).error?.code).toBe('SESSION_CHANGED');
		// Nor is it re-stamped as whoever is signed in now.
		await signIn(made.kernel, 'olu@example.com');
		expect((await nested('n3')).error?.code).toBe('SESSION_CHANGED');
		const entries = await journalOf(made);
		expect(entries.filter((entry) => entry.result.error?.code === 'SESSION_CHANGED')).toHaveLength(
			2
		);
	});

	it('P3-E4: the kernel’s own internal commands are never refused SESSION_CHANGED', async () => {
		const made = await workspace();
		await signIn(made.kernel, 'bea@example.com');
		const ticket: QueuedTicket = { person: OLU };
		// A queued call carrying a ticket from another person, as a boot command and as a shell command.
		const run = (name: string, input: unknown, traceId: string) =>
			made.registries.boot.execute(name, input, {
				traceId,
				[QUEUED]: ticket,
			} as CommandContext);
		expect((await run('app-settle', {}, 'q1')).error?.code).not.toBe('SESSION_CHANGED');
		const shell = await made.registries.palette.execute('layout-get', {}, {
			traceId: 'q2',
			[QUEUED]: ticket,
		} as CommandContext);
		expect(shell.error?.code).toBe('SESSION_CHANGED');
	});

	it('P3-E4: SESSION_50 settles nothing: its sign-in and sign-out settle inside the auth commands', async () => {
		const { recordSession, SESSION_50, diffJournals } = await import('../testing.js');
		const first = await recordSession(SESSION_50);
		expect(first.entries.some((entry) => entry.command === 'session-settle')).toBe(false);
		const second = await recordSession(SESSION_50);
		expect(diffJournals(first.entries, second.entries).equal).toBe(true);
	});
});

describe('P3-E4: the expiry timer re-arms and refreshes (4.4)', () => {
	async function timed(auth: MockAuthAdapter, time: ReturnType<typeof settableClock>) {
		const timers = fakeSchedule();
		const journal = new MemoryJournalSink();
		const kernel = await createKernel({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal,
			auth,
			environment: createFixedEnvironment(),
			host: 'test',
			clock: time.now,
			ports: { schedule: timers.schedule } as unknown as KernelPortsV1,
		});
		kernels.push(kernel);
		return { kernel, journal, timers };
	}

	it('P3-E4: re-arms only when the adapter reports another expiresAt', async () => {
		const time = settableClock(T0);
		const auth = new MockAuthAdapter({ clock: { now: time.now } });
		const { timers } = await timed(auth, time);
		auth._setUser(user(BEA), { expiresAt: new Date(T0 + 60_000) });
		expect(timers.pending().map((timer) => timer.at)).toEqual([T0 + 60_000]);
		auth._setUser(user(BEA), { expiresAt: new Date(T0 + 60_000) });
		expect(timers.scheduled()).toBe(1);
		// Better Auth slides a session's expiry as it is used.
		auth._setUser(user(BEA), { expiresAt: new Date(T0 + 120_000) });
		expect(timers.pending().map((timer) => timer.at)).toEqual([T0 + 120_000]);
	});

	it('P3-E4: clamps a delay past 2^31−1 ms, and re-arms when it wakes early, with no refresh', async () => {
		const time = settableClock(T0);
		const auth = new MockAuthAdapter({ clock: { now: time.now } });
		const refresh = vi.spyOn(auth, 'refresh');
		const { timers, journal } = await timed(auth, time);
		const far = T0 + MAX_TIMER_DELAY_MS + 86_400_000;
		auth._setUser(user(BEA), { expiresAt: new Date(far) });
		const [first] = timers.pending();
		expect(first?.at).toBeLessThanOrEqual(T0 + MAX_TIMER_DELAY_MS + 10);
		expect(first?.at).toBeGreaterThan(T0 + MAX_TIMER_DELAY_MS - 1_000);
		time.set(first?.at as number);
		timers.run(first?.at as number);
		await vi.waitFor(() => expect(timers.pending().map((timer) => timer.at)).toEqual([far]));
		expect(refresh).not.toHaveBeenCalled();
		expect(await expiries({ journal })).toEqual([]);
	});

	it('P3-E4: refreshes first, and settles only when the person really changed', async () => {
		const time = settableClock(T0);
		const auth = new MockAuthAdapter({ clock: { now: time.now } });
		const { timers, journal } = await timed(auth, time);
		auth._setUser(user(BEA), { expiresAt: new Date(T0 + 60_000) });
		// The provider slid the session: the same person, a later expiry.
		auth.refresh = async () => auth._setUser(user(BEA), { expiresAt: new Date(T0 + 600_000) });
		time.set(T0 + 60_000);
		timers.run(T0 + 60_000);
		await vi.waitFor(() =>
			expect(timers.pending().map((timer) => timer.at)).toEqual([T0 + 600_000])
		);
		expect(await expiries({ journal })).toEqual([]);
	});

	it('P3-E4: never settles on a failed refresh, and asks again with backoff (5 s, then 10 s, …)', async () => {
		const time = settableClock(T0);
		const auth = new MockAuthAdapter({ clock: { now: time.now } });
		const { timers, journal } = await timed(auth, time);
		auth._setUser(user(BEA), { expiresAt: new Date(T0 + 60_000) });
		const real = auth.refresh.bind(auth);
		let failures = 2;
		auth.refresh = async () => {
			if (failures-- > 0) throw new Error('The provider could not be reached');
			await real();
		};
		let at = T0 + 60_000;
		time.set(at);
		timers.run(at);
		for (const delay of [REFRESH_RETRY_FIRST_MS, REFRESH_RETRY_FIRST_MS * 2]) {
			await vi.waitFor(() => expect(timers.pending()).toHaveLength(1));
			const next = timers.pending()[0]?.at as number;
			expect(next - at).toBeGreaterThanOrEqual(delay);
			expect(next - at).toBeLessThan(delay + 50);
			expect(await expiries({ journal })).toEqual([]);
			at = next;
			time.set(at);
			timers.run(at);
		}
		await vi.waitFor(async () => expect(await expiries({ journal })).toHaveLength(1));
		expect((await expiries({ journal }))[0]?.input).toMatchObject({ person: null });
	});
});

describe('P3-E4: the listener and the settles (4.4)', () => {
	it('P3-E4: a change no auth command made is settled; an auth command settles inside itself', async () => {
		const made = await workspace();
		await signIn(made.kernel, 'bea@example.com');
		await made.kernel.call('auth-sign-out');
		expect(await settles(made)).toEqual([]);
		made.auth._setUser(user(OLU));
		await vi.waitFor(async () => expect(await settles(made)).toHaveLength(1));
		expect((await settles(made))[0]?.input).toEqual({
			person: OLU,
			role: null,
			membershipDigest: null,
			reason: 'tab',
		} satisfies SessionSettleInputV1);
		expect(
			(
				await replayKernel(await journalOf(made), {
					deployment: scopedDeployment(),
					ports: scopedPorts(),
				})
			).report.diverged
		).toBe(false);
	});

	it('P3-E4: two changes to the same person make one call; a change to a different person is never merged away', async () => {
		const made = await workspace();
		made.auth._setUser(user(OLU));
		made.auth._setUser(user(OLU));
		await vi.waitFor(async () => expect(await settles(made)).toHaveLength(1));
		made.auth._setUser(user(BEA));
		made.auth._setUser(user(CARO));
		await vi.waitFor(async () => expect(await settles(made)).toHaveLength(3));
		expect(
			(await settles(made)).map((entry) => (entry.input as SessionSettleInputV1).person)
		).toEqual([OLU, BEA, CARO]);
		expect((await settles(made)).map((entry) => entry.result.data)).toEqual([
			{ person: OLU, left: null },
			{ person: BEA, left: OLU },
			{ person: CARO, left: BEA },
		]);
	});

	it('P3-E4: is not served, not callable through a port, and refused on the agent interface', async () => {
		const made = await workspace();
		const input = { person: null, role: null, membershipDigest: null, reason: 'tab' };
		expect((await made.kernel.call('session-settle', input)).error?.code).toBe('COMMAND_NOT_FOUND');
		expect((await made.kernel.agent.call('session-settle', input)).error?.code).toBe(
			'COMMAND_NOT_FOUND'
		);
		expect(made.kernel.listCommands().some((row) => row.name === 'session-settle')).toBe(false);
		expect(made.kernel.agent.listCommands().some((row) => row.name === 'session-settle')).toBe(
			false
		);
		const served = made.mcpOptions()?.commands.map((command) => command.name);
		expect(served).not.toContain('session-settle');
		expect((await made.kernel.appPort('dual').call('session-settle', input)).success).toBe(false);
	});

	it("P3-E4: a change of person resets an editor record to the editor's own first shape", () => {
		// `late-identity` keeps its own copy, so it imports nothing of `late-editor` (13).
		expect(emptyEditor()).toEqual(emptyEditorState());
	});
});

describe('P3-E4: membership is journaled, first and on every change (4.4, 7.6)', () => {
	it("P3-E4: stage B's first act is `session-settle` with the probe's person, role and digest, a change from null in the original and the replay", async () => {
		const auth = new MockAuthAdapter();
		auth._setUser(user(BEA));
		const made = await providerWorkspace({ auth });
		const entries = await journalOf(made);
		const at = entries.findIndex((entry) => entry.command === 'session-settle');
		// Only boot's own work comes before it.
		expect(entries.slice(0, at).map((entry) => entry.command)).toEqual([
			'workspace-deployment-apply',
		]);
		const first = entries[at];
		expect(first?.input).toEqual({
			person: BEA,
			role: 'member',
			membershipDigest: 'd1',
			reason: 'provider',
		} satisfies SessionSettleInputV1);
		expect(first?.result.data).toEqual({ person: BEA, left: null });
		await enterVault(made.kernel);
		expect((await replayProvider(await journalOf(made))).report.diverged).toBe(false);
	});

	it("P3-E4: a changed digest read before an owner's command is a top-level settle before it, and a replay replays the entry", async () => {
		const read = vi.fn(async () => ({ role: 'owner' as const, digest: 'd2' }));
		const made = await providerWorkspace({
			ports: { ...scopedPorts(), readMembership: read },
		});
		await signIn(made.kernel, 'bea@example.com');
		const created = await made.kernel.call('project-create', { name: 'Ledger' });
		expect(created.success).toBe(true);
		const entries = await journalOf(made);
		const at = entries.findIndex((entry) => entry.command === 'project-create');
		expect(entries[at - 1]?.command).toBe('session-settle');
		expect(entries[at - 1]?.input).toEqual({
			person: BEA,
			role: 'owner',
			membershipDigest: 'd2',
			reason: 'membership',
		} satisfies SessionSettleInputV1);
		expect(entries[at - 1]?.context?.parent).toBeUndefined();
		// The same digest again: no settle.
		await made.kernel.call('project-create', { name: 'Archive' });
		expect(
			(await settles(made)).filter(
				(entry) => (entry.input as SessionSettleInputV1).reason === 'membership'
			)
		).toHaveLength(1);
		const replayed = await replayProvider(await journalOf(made));
		expect(replayed.report.diverged).toBe(false);
	});

	it("P3-E4: a membership read that fails before an owner's command refuses it, retryable, and a replay agrees", async () => {
		let failing = true;
		const made = await providerWorkspace({
			ports: {
				...scopedPorts(),
				readMembership: async () => {
					if (failing) throw new Error('provider unreachable');
					return { role: 'owner' as const, digest: 'd1' };
				},
			},
		});
		await signIn(made.kernel, 'bea@example.com');
		const refused = await made.kernel.call('project-create', { name: 'Ledger' });
		expect(refused.error).toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE', retryable: true });
		expect(
			(await settles(made)).filter(
				(entry) => (entry.input as SessionSettleInputV1).reason === 'membership'
			)
		).toHaveLength(0);
		expect((await made.kernel.call('project-list', {})).data).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ name: 'Ledger' })])
		);
		failing = false;
		expect((await made.kernel.call('project-create', { name: 'Ledger' })).success).toBe(true);
		expect((await replayProvider(await journalOf(made))).report.diverged).toBe(false);
	});

	it('P3-E4: a person the read no longer finds a member is refused by line 0 on what was read', async () => {
		const made = await providerWorkspace({
			ports: { ...scopedPorts(), readMembership: async () => null },
		});
		await signIn(made.kernel, 'bea@example.com');
		const refused = await made.kernel.call('project-create', { name: 'Ledger' });
		expect(refused.error?.code).toBe('WORKSPACE_NOT_MEMBER');
		expect((await settles(made)).at(-1)?.input).toEqual({
			person: BEA,
			role: null,
			membershipDigest: null,
			reason: 'membership',
		} satisfies SessionSettleInputV1);
	});
});
