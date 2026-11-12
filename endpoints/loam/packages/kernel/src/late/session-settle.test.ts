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
	MEMBERSHIP_READ_TIMEOUT_MS,
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
		// Stage A was Bea's; the change to Olu during stage B is settled before the queued calls run (B1).
		const settled = entries.filter((entry) => entry.command === 'session-settle');
		expect(settled.map((entry) => entry.input)).toEqual([
			{ person: OLU, role: null, membershipDigest: null, reason: 'tab' },
		]);
		expect(entries.indexOf(settled[0] as JournalEntry)).toBeLessThan(
			entries.findIndex((entry) => entry.command === 'project-list')
		);
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

/** A `provider` kernel with a boot, whose stage B waits for `release`, over `store`: stage A then stage B (2.2). */
async function bootedProvider(auth: MockAuthAdapter, store = new MemoryAdapter()) {
	let release: () => void = () => {};
	const loaded = new Promise<undefined>((resolve) => {
		release = () => resolve(undefined);
	});
	const journal = new MemoryJournalSink();
	const kernel = await createKernel({
		store,
		storeKind: 'memory',
		journal,
		auth,
		environment: createFixedEnvironment(),
		host: 'test',
		identity: PROVIDER,
		membership: ACME,
		boot: readBoot(scopedDeployment()) as NonNullable<Parameters<typeof createKernel>[0]['boot']>,
		appsLoader: () => loaded as never,
	});
	kernels.push(kernel);
	return { kernel, journal, release };
}

describe("P3-E4: the review of step 2's blockers (B1 to B4)", () => {
	it("P3-E4: B1: a change of person during stage B is settled from stage A's person, whose records stage A read", async () => {
		const store = new MemoryAdapter();
		const auth = new MockAuthAdapter();
		auth._setUser(user(BEA));
		const first = await bootedProvider(auth, store);
		void first.kernel.startApps();
		first.release();
		await first.kernel.appsReady;
		// Bea leaves the projects section open: her `loam.apps`, under her key.
		expect((await first.kernel.call('section-open', { section: 'projects' })).success).toBe(true);
		await first.kernel.flush();
		await first.kernel.dispose();
		// A reload: stage A reads Bea's records; during stage B another tab signs Olu in.
		const second = await bootedProvider(auth, store);
		expect(
			(await second.kernel.call<{ section: string | null }>('section-get')).data?.section
		).toBe('projects');
		void second.kernel.startApps();
		auth._setUser(user(OLU));
		second.release();
		await second.kernel.appsReady;
		await vi.waitFor(async () => expect(await settles(second)).toHaveLength(2));
		expect((await settles(second)).map((entry) => entry.input)).toEqual([
			{ person: BEA, role: 'member', membershipDigest: 'd1', reason: 'provider' },
			{ person: OLU, role: 'owner', membershipDigest: 'd1', reason: 'tab' },
		]);
		expect((await settles(second)).at(-1)?.result.data).toEqual({ person: OLU, left: BEA });
		// Olu sees Olu's state, not the section Bea left open.
		expect(
			(await second.kernel.call<{ section: string | null }>('section-get')).data?.section
		).toBe(null);
		expect(
			(
				await replayKernel(await journalOf(second), {
					deployment: scopedDeployment(),
					ports: scopedPorts(),
					identity: PROVIDER,
					membership: ACME,
				})
			).report.diverged
		).toBe(false);
	});

	it("P3-E4: B2: a tab's change and a sign-out run one after another, so neither files one person's drafts as another's", async () => {
		const made = await workspace({ deployment: documentsDeployment(), ports: documentsPorts() });
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
		// Another tab signs Olu in, and a sign-out here ends while that change is still being settled.
		made.auth._setUser(user(OLU));
		const out = kernel.call('auth-sign-out');
		await out;
		await vi.waitFor(async () => expect(await settles(made)).toHaveLength(1));
		// Bea's draft is held for Bea: she signs in again and it is back.
		await signIn(kernel, 'bea@example.com');
		expect((await tab())?.dirty).toBe(true);
	});

	it('P3-E4: B2: a change of person while the membership is read refuses the call, and records no one with another person’s role', async () => {
		const made = await providerWorkspace({
			ports: {
				...scopedPorts(),
				readMembership: async () => {
					// Another tab signs Olu in while the provider answers.
					made.auth._setUser(user(OLU));
					return { role: 'owner' as const, digest: 'd2' };
				},
			},
		});
		await signIn(made.kernel, 'bea@example.com');
		const refused = await made.kernel.call('project-create', { name: 'Ledger' });
		expect(refused.error).toMatchObject({ code: 'SESSION_CHANGED', retryable: true });
		const membership = (await settles(made)).filter(
			(entry) => (entry.input as SessionSettleInputV1).reason === 'membership'
		);
		expect(membership).toEqual([]);
		expect(
			(await journalOf(made)).some(
				(entry) => entry.command === 'project-create' && entry.result.success
			)
		).toBe(false);
	});

	it('P3-E4: B2: a change to someone superseded at once settles with what the kernel holds for them, never the next person’s membership', async () => {
		const made = await providerWorkspace({
			ports: {
				...scopedPorts(),
				// The host answers for whoever is signed in at that moment.
				readMembership: async () => ({
					role: 'member' as const,
					digest: `for-${made.auth.getSession().user?.id}`,
				}),
			},
		});
		await signIn(made.kernel, 'bea@example.com');
		made.auth._setUser(user(OLU));
		made.auth._setUser(user(CARO));
		await vi.waitFor(async () => expect(await settles(made)).toHaveLength(3));
		const [, olu, caro] = (await settles(made)).map((entry) => entry.input);
		expect(olu).toEqual({ person: OLU, role: 'owner', membershipDigest: 'd1', reason: 'tab' });
		expect(caro).toEqual({
			person: CARO,
			role: 'member',
			membershipDigest: `for-${CARO}`,
			reason: 'tab',
		});
	});

	it('P3-E4: B3: a settle the re-read cannot make, as for a role the kernel does not take, refuses the call', async () => {
		const made = await providerWorkspace({
			ports: {
				...scopedPorts(),
				readMembership: async () =>
					({ role: 'billing', digest: 'd2' }) as unknown as { role: 'owner'; digest: string },
			},
		});
		await signIn(made.kernel, 'olu@example.com');
		const refused = await made.kernel.call('project-create', { name: 'Ledger' });
		expect(refused.error).toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE', retryable: true });
		expect(
			(await journalOf(made)).some(
				(entry) => entry.command === 'project-create' && entry.result.success
			)
		).toBe(false);
	});

	it('P3-E4: B4: a change of person dismisses every overlay, an inactive app’s among them', async () => {
		const made = await providerWorkspace();
		const { kernel } = made;
		await signIn(kernel, 'bea@example.com');
		// No app is active: dual's toast is its own all the same.
		expect((await kernel.appPort('dual').call('toast-show', { message: 'For Bea' })).success).toBe(
			true
		);
		expect(
			(await kernel.call<{ overlays: Array<{ owner: string }> }>('overlay-list')).data?.overlays
		).toHaveLength(1);
		made.auth._setUser(user(OLU));
		await vi.waitFor(async () => expect(await settles(made)).toHaveLength(2));
		expect((await kernel.call<{ overlays: unknown[] }>('overlay-list')).data?.overlays).toEqual([]);
	});
});

describe("P3-E4: the review of step 2's improvements (I1 to I5)", () => {
	it('P3-E4: I1: while a change of person cannot be settled, the next person’s calls are refused, never run on the leaving person’s state', async () => {
		let invalid = false;
		const made = await providerWorkspace({
			ports: {
				...scopedPorts(),
				readMembership: async () =>
					(invalid ? { role: 'billing', digest: 'd2' } : { role: 'member', digest: 'd1' }) as {
						role: 'member';
						digest: string;
					},
			},
		});
		await signIn(made.kernel, 'bea@example.com');
		expect((await made.kernel.call('section-open', { section: 'projects' })).success).toBe(true);
		// Another tab signs Olu in, and the provider answers with a role the settle refuses.
		invalid = true;
		made.auth._setUser(user(OLU));
		// The settle Olu's change needs is refused at its input, so the shell stays Bea's: Olu's call is refused.
		const read = await made.kernel.call('section-get');
		expect(read.error).toMatchObject({ code: 'SESSION_CHANGED', retryable: true });
	});

	it('P3-E4: I2: a change of person an `auth-*` call did not make is settled after its entry', async () => {
		const made = await workspace();
		await signIn(made.kernel, 'bea@example.com');
		// A passkey sign-in that fails, as the Mock has no passkeys, while another tab signs Olu in.
		const real = made.auth.signIn.bind(made.auth);
		made.auth.signIn = async (options) => {
			made.auth._setUser(user(OLU));
			return real(options);
		};
		const failed = await made.kernel.call('auth-sign-in', { method: 'passkey' });
		expect(failed.success).toBe(false);
		await vi.waitFor(async () => expect(await settles(made)).toHaveLength(1));
		const entries = await journalOf(made);
		const settle = entries.findIndex((entry) => entry.command === 'session-settle');
		expect(entries[settle]?.input).toMatchObject({ person: OLU, reason: 'tab' });
		expect(entries[settle - 1]?.command).toBe('auth-sign-in');
		expect(
			(await replayKernel(entries, { deployment: scopedDeployment(), ports: scopedPorts() })).report
				.diverged
		).toBe(false);
	});

	it('P3-E4: I3: an adapter that reports a change during each refresh neither double-arms the timer nor resets its backoff', async () => {
		const time = settableClock(T0);
		const auth = new MockAuthAdapter({ clock: { now: time.now } });
		const timers = fakeSchedule();
		const kernel = await createKernel({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth,
			environment: createFixedEnvironment(),
			host: 'test',
			clock: time.now,
			ports: { schedule: timers.schedule } as unknown as KernelPortsV1,
		});
		kernels.push(kernel);
		const expiresAt = new Date(T0 + 60_000);
		auth._setUser(user(BEA), { expiresAt });
		// Each refresh reports the session again, its expiry a moment away, then fails.
		auth.refresh = async () => {
			auth._setUser(user(BEA), { expiresAt: new Date(time.now() + 1_000) });
			throw new Error('The provider could not be reached');
		};
		let at = T0 + 60_000;
		time.set(at);
		timers.run(at);
		for (const delay of [
			REFRESH_RETRY_FIRST_MS,
			REFRESH_RETRY_FIRST_MS * 2,
			REFRESH_RETRY_FIRST_MS * 4,
		]) {
			await vi.waitFor(() => expect(timers.pending()).toHaveLength(1));
			const next = timers.pending()[0]?.at as number;
			expect(next - at).toBeGreaterThanOrEqual(delay);
			expect(next - at).toBeLessThan(delay + 50);
			at = next;
			time.set(at);
			timers.run(at);
		}
	});

	it("P3-E4: I5: line 0 decides an owner's command on the membership read before it, not on the one held", async () => {
		const made = await providerWorkspace({
			ports: {
				...scopedPorts(),
				readMembership: async () => ({ role: 'owner' as const, digest: 'd2' }),
			},
		});
		// Caro is not in the members stage A was given; the provider has just added her as an owner.
		await signIn(made.kernel, 'caro@example.com');
		const created = await made.kernel.call('project-create', { name: 'Ledger' });
		expect(created.success, JSON.stringify(created.error)).toBe(true);
		expect((await settles(made)).at(-1)?.input).toEqual({
			person: CARO,
			role: 'owner',
			membershipDigest: 'd2',
			reason: 'membership',
		} satisfies SessionSettleInputV1);
	});
});

describe("P3-E4: the re-review of step 2's fixes", () => {
	it("P3-E4: N1: an adapter event that leaves the person as they were, during the settle's read, does not drop the settle", async () => {
		let slide = false;
		const made = await providerWorkspace({
			ports: {
				...scopedPorts(),
				readMembership: async () => {
					// The provider's refetch slides Olu's expiry while it answers: the same person.
					if (slide)
						made.auth._setUser(user(OLU), { expiresAt: new Date(Date.now() + 5 * 3_600_000) });
					return { role: 'owner' as const, digest: 'd1' };
				},
			},
		});
		await signIn(made.kernel, 'bea@example.com');
		expect((await made.kernel.call('section-open', { section: 'projects' })).success).toBe(true);
		slide = true;
		made.auth._setUser(user(OLU));
		await vi.waitFor(async () =>
			expect((await settles(made)).at(-1)?.input).toEqual({
				person: OLU,
				role: 'owner',
				membershipDigest: 'd1',
				reason: 'tab',
			} satisfies SessionSettleInputV1)
		);
		// Olu's state, and Olu's calls run.
		const section = await made.kernel.call<{ section: string | null }>('section-get');
		expect(section.success, JSON.stringify(section.error)).toBe(true);
		expect(section.data?.section).toBe(null);
	});

	it("P3-E4: N1: the same person's adapter event during the re-read does not refuse an owner's command", async () => {
		const made = await providerWorkspace({
			ports: {
				...scopedPorts(),
				readMembership: async () => {
					made.auth._setUser(user(OLU), { expiresAt: new Date(Date.now() + 5 * 3_600_000) });
					return { role: 'owner' as const, digest: 'd1' };
				},
			},
		});
		await signIn(made.kernel, 'olu@example.com');
		const created = await made.kernel.call('project-create', { name: 'Ledger' });
		expect(created.success, JSON.stringify(created.error)).toBe(true);
	});

	it('P3-E4: a settle that throws after a refresh is reported, and the timer re-arms', async () => {
		const time = settableClock(T0);
		const auth = new MockAuthAdapter({ clock: { now: time.now } });
		const timers = fakeSchedule();
		const kernel = await createKernel({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth,
			environment: createFixedEnvironment(),
			host: 'test',
			clock: time.now,
			ports: { schedule: timers.schedule } as unknown as KernelPortsV1,
		});
		kernels.push(kernel);
		auth._setUser(user(BEA), { expiresAt: new Date(T0 + 60_000) });
		// The provider slides the session; then the adapter throws on the next read of it, once.
		const getSession = auth.getSession.bind(auth);
		let throwNext = false;
		auth.getSession = () => {
			if (throwNext) {
				throwNext = false;
				throw new Error('The adapter could not read its session');
			}
			return getSession();
		};
		auth.refresh = async () => {
			auth._setUser(user(BEA), { expiresAt: new Date(T0 + 600_000) });
			throwNext = true;
		};
		const reportError = vi.fn();
		vi.stubGlobal('reportError', reportError);
		try {
			time.set(T0 + 60_000);
			timers.run(T0 + 60_000);
			await vi.waitFor(() =>
				expect(timers.pending().map((timer) => timer.at)).toEqual([T0 + 600_000])
			);
			expect(reportError).toHaveBeenCalledWith(
				expect.objectContaining({ message: 'The adapter could not read its session' })
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('P3-E4: a membership read that never answers fails after its timeout, so stage B ends and the settle decides with what is held', async () => {
		// A clock that stands still, so the read's timeout is at exactly its bound.
		let at = T0;
		const time = { now: () => at };
		const auth = new MockAuthAdapter({ clock: time });
		auth._setUser(user(BEA));
		const timers = fakeSchedule();
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
			clock: time.now,
			identity: PROVIDER,
			membership: ACME,
			ports: {
				schedule: timers.schedule,
				readMembership: () => new Promise(() => {}),
			} as unknown as KernelPortsV1,
			boot: readBoot(scopedDeployment()) as NonNullable<Parameters<typeof createKernel>[0]['boot']>,
			appsLoader: () => loaded as never,
		});
		kernels.push(kernel);
		let ended = false;
		void kernel.startApps();
		void kernel.appsReady.then(() => {
			ended = true;
		});
		// Another tab signs Olu in during stage B: the settle reads Olu's membership, which never answers.
		auth._setUser(user(OLU));
		release();
		const due = T0 + MEMBERSHIP_READ_TIMEOUT_MS;
		// One timer at the read's bound, and none sooner: Olu's expiry timer is an hour away.
		await vi.waitFor(() =>
			expect(timers.pending().filter((timer) => timer.at === due)).toHaveLength(1)
		);
		expect(timers.pending().filter((timer) => timer.at <= due)).toHaveLength(1);
		expect(ended).toBe(false);
		at = due;
		timers.run(due);
		await vi.waitFor(() => expect(ended).toBe(true));
		expect((await settles({ journal })).map((entry) => entry.input)).toEqual([
			{ person: BEA, role: 'member', membershipDigest: 'd1', reason: 'provider' },
			{ person: OLU, role: 'owner', membershipDigest: 'd1', reason: 'tab' },
		]);
	});
});

describe("P3-E4: the re-check of step 2's fixes", () => {
	it("P3-E4: a change to someone else and back during the settle's read drops that read, and the person is settled on a read of their own", async () => {
		let reads = 0;
		const made = await providerWorkspace({
			ports: {
				...scopedPorts(),
				readMembership: async () => {
					reads++;
					if (reads === 1) {
						// Caro, then Olu again, while the provider answers: its answer may be Caro's.
						made.auth._setUser(user(CARO));
						made.auth._setUser(user(OLU));
						return { role: 'member' as const, digest: 'caro-answer' };
					}
					return { role: 'owner' as const, digest: 'd1' };
				},
			},
		});
		await signIn(made.kernel, 'bea@example.com');
		made.auth._setUser(user(OLU));
		await vi.waitFor(async () =>
			expect((await settles(made)).at(-1)?.input).toMatchObject({ person: OLU })
		);
		const inputs = (await settles(made)).map((entry) => entry.input as SessionSettleInputV1);
		expect(inputs.some((input) => input.membershipDigest === 'caro-answer')).toBe(false);
		expect(inputs.at(-1)).toEqual({
			person: OLU,
			role: 'owner',
			membershipDigest: 'd1',
			reason: 'tab',
		} satisfies SessionSettleInputV1);
	});

	it("P3-E4: a change to someone else and back during the re-read refuses the owner's command", async () => {
		let flip = false;
		const made = await providerWorkspace({
			ports: {
				...scopedPorts(),
				readMembership: async () => {
					if (flip) {
						made.auth._setUser(user(BEA));
						made.auth._setUser(user(OLU));
					}
					return { role: 'member' as const, digest: 'd-bea' };
				},
			},
		});
		await signIn(made.kernel, 'olu@example.com');
		flip = true;
		const refused = await made.kernel.call('project-create', { name: 'Ledger' });
		expect(refused.error).toMatchObject({ code: 'SESSION_CHANGED', retryable: true });
		expect(
			(await settles(made)).some(
				(entry) => (entry.input as SessionSettleInputV1).membershipDigest === 'd-bea'
			)
		).toBe(false);
	});

	it("P3-E4: the re-read's own timeout refuses the owner's command, ignores a late answer and clears itself", async () => {
		let at = T0;
		const time = { now: () => at };
		const timers = fakeSchedule();
		let reads = 0;
		let answer: (found: { role: 'admin'; digest: string }) => void = () => {};
		const made = await providerWorkspace({
			clock: time.now,
			auth: new MockAuthAdapter({ clock: time }),
			ports: {
				...scopedPorts(),
				schedule: timers.schedule,
				readMembership: () => {
					reads++;
					if (reads === 1) {
						return new Promise((resolve) => {
							answer = resolve as never;
						});
					}
					return Promise.resolve({ role: 'owner' as const, digest: 'd1' });
				},
			} as unknown as ReturnType<typeof scopedPorts>,
		});
		await signIn(made.kernel, 'olu@example.com');
		const before = (await settles(made)).length;
		const pending = made.kernel.call('project-create', { name: 'Ledger' });
		const due = T0 + MEMBERSHIP_READ_TIMEOUT_MS;
		await vi.waitFor(() =>
			expect(timers.pending().filter((timer) => timer.at === due)).toHaveLength(1)
		);
		at = due;
		timers.run(due);
		expect((await pending).error).toMatchObject({
			code: 'MEMBERSHIP_UNAVAILABLE',
			retryable: true,
		});
		// The provider answers after all: nothing comes of it.
		answer({ role: 'admin', digest: 'late' });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(await settles(made)).toHaveLength(before);
		const created = await made.kernel.call('project-create', { name: 'Ledger' });
		expect(created.success, JSON.stringify(created.error)).toBe(true);
		// The read that answered cleared its timeout: only Olu's expiry timer is left.
		expect(timers.pending().filter((timer) => timer.at < T0 + 3_600_000)).toEqual([]);
	});

	it("P3-E4: a read's timeout goes with the kernel when it is disposed", async () => {
		const timers = fakeSchedule();
		const made = await providerWorkspace({
			ports: {
				...scopedPorts(),
				schedule: timers.schedule,
				readMembership: () => new Promise(() => {}),
			} as unknown as ReturnType<typeof scopedPorts>,
		});
		await signIn(made.kernel, 'olu@example.com');
		void made.kernel.call('project-create', { name: 'Ledger' });
		await vi.waitFor(() => expect(timers.pending().length).toBeGreaterThanOrEqual(2));
		await made.kernel.dispose();
		expect(timers.pending()).toEqual([]);
	});

	it('P3-E4: a timer fire that fails after its settle is reported, never left unhandled', async () => {
		const time = settableClock(T0);
		const auth = new MockAuthAdapter({ clock: { now: time.now } });
		const timers = fakeSchedule();
		const kernel = await createKernel({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth,
			environment: createFixedEnvironment(),
			host: 'test',
			clock: time.now,
			ports: { schedule: timers.schedule } as unknown as KernelPortsV1,
		});
		kernels.push(kernel);
		auth._setUser(user(BEA), { expiresAt: new Date(T0 + 60_000) });
		// After the refresh, every read of the session throws: the settle's, then the re-arm's.
		const getSession = auth.getSession.bind(auth);
		let failing = false;
		let failures = 0;
		auth.getSession = () => {
			if (failing) throw new Error(`The adapter could not read its session (${++failures})`);
			return getSession();
		};
		auth.refresh = async () => {
			failing = true;
		};
		const reportError = vi.fn();
		vi.stubGlobal('reportError', reportError);
		try {
			time.set(T0 + 60_000);
			timers.run(T0 + 60_000);
			// The settle's failure, caught in the fire, and the re-arm's, which ends the fire.
			await vi.waitFor(() => expect(reportError).toHaveBeenCalledTimes(2));
			for (const [error] of reportError.mock.calls) {
				expect((error as Error).message).toMatch(/^The adapter could not read its session/);
			}
		} finally {
			failing = false;
			vi.unstubAllGlobals();
		}
	});

	it("P3-E4: a change whose settle failed is settled again, before the next person's call, as another tab's", async () => {
		let reads = 0;
		const made = await providerWorkspace({
			ports: {
				...scopedPorts(),
				readMembership: async () =>
					(++reads === 1 ? { role: 'billing', digest: 'd2' } : { role: 'owner', digest: 'd1' }) as {
						role: 'owner';
						digest: string;
					},
			},
		});
		await signIn(made.kernel, 'bea@example.com');
		reads = 0;
		// Another tab signs Olu in; the provider's first answer is one the settle refuses.
		made.auth._setUser(user(OLU));
		await vi.waitFor(() => expect(reads).toBe(1));
		const read = await made.kernel.call('section-get');
		expect(read.success, JSON.stringify(read.error)).toBe(true);
		expect((await settles(made)).at(-1)?.input).toEqual({
			person: OLU,
			role: 'owner',
			membershipDigest: 'd1',
			reason: 'tab',
		} satisfies SessionSettleInputV1);
	});
});
