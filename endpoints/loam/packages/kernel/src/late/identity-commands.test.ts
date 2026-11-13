/**
 * Phase 3's step 3 units (phase 3 specification, 2.1, 3.4, 4.3 to 4.6 and 5.2): the session and passkey commands over
 * the Mock, `HUMAN_REQUIRED`, the recorded table, the sign-in method check, what a signed-out `provider` page answers,
 * the membership a sign-in brings, and step 2's three follow-ups. E1's, E3's and E4's rows carry their ids.
 */

import { type AuthAdapter, MockAuthAdapter, type User } from '@lushly-dev/afd-auth';
import type { JournalEntry, MemoryJournalSink } from '@lushly-dev/afd-core';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MembershipV1 } from '../scope/access.js';
import {
	createScopedWorkspace,
	type ScopedWorkspace,
	type ScopedWorkspaceOptions,
	scopedDeployment,
	scopedPorts,
} from '../scope/fixtures.js';
import { documentsDeployment, documentsPorts, replayKernel } from '../testing.js';
import type { LoamKernelV3 } from '../types.js';
import { SIGNED_OUT_COMMANDS } from './auth-gate.js';
import { DOCUMENT_KIT } from './document-kit.js';
import { createIdentityCommands, HUMAN_COMMANDS, PROVIDER_COMMANDS } from './identity-commands.js';
import { MEMBERSHIP_READ_TIMEOUT_MS, type SessionSettleInputV1 } from './session-settle.js';

const BEA = 'mock-user-bea@example.com';
const OLU = 'mock-user-olu@example.com';
const PROVIDER: IdentityV1 = {
	mode: 'provider',
	organization: 'acme',
	path: 'api/auth',
	methods: ['passkey', 'password'],
};
const ACME: MembershipV1 = {
	mode: 'provider',
	members: new Map([
		[BEA, 'member'],
		[OLU, 'owner'],
	]),
	digest: 'd1',
};
const user = (id: string): User => {
	const email = id.slice('mock-user-'.length);
	return { id, email, name: email.split('@')[0] as string };
};

const kernels: LoamKernelV3[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
	vi.restoreAllMocks();
});

async function workspace(options: ScopedWorkspaceOptions = {}): Promise<ScopedWorkspace> {
	const made = await createScopedWorkspace({ empty: true, ...options });
	kernels.push(made.kernel);
	return made;
}
const provider = (options: ScopedWorkspaceOptions = {}) =>
	workspace({ identity: PROVIDER, membership: ACME, ...options });

const signIn = (kernel: LoamKernelV3, email: string) =>
	kernel.call('auth-sign-in', { method: 'credentials', email, password: 'x' });
const journalOf = (made: { journal: MemoryJournalSink }) =>
	made.journal.read() as Promise<JournalEntry[]>;
const last = async (made: { journal: MemoryJournalSink }, command: string) =>
	(await journalOf(made)).filter((entry) => entry.command === command).at(-1);

describe('P3-E3: sessions (4.6), over the Mock in `local` mode', () => {
	it('P3-E3: lists the one session, current, by handle, and revoking it signs out', async () => {
		const made = await workspace();
		await signIn(made.kernel, 'bea@example.com');
		const listed = await made.kernel.call<{ sessions: Record<string, unknown>[] }>('session-list');
		expect(listed.success, JSON.stringify(listed.error)).toBe(true);
		expect(listed.data?.sessions).toHaveLength(1);
		const [row] = listed.data?.sessions ?? [];
		expect(row).toMatchObject({ current: true, id: expect.any(String) });
		expect(Object.keys(row as object).sort()).toEqual(
			['createdAt', 'current', 'device', 'expiresAt', 'id', 'updatedAt'].sort()
		);
		const revoked = await made.kernel.call('session-revoke', { session: 'all' });
		expect(revoked.success, JSON.stringify(revoked.error)).toBe(true);
		expect(revoked.data).toEqual({ revoked: 1, signedOut: true, disconnected: 0 });
		expect(made.auth.getSession().status).toBe('unauthenticated');
	});

	it('P3-E3: journals each as recorded, so a replay answers it from its entry and reaches no provider', async () => {
		const made = await workspace();
		await signIn(made.kernel, 'bea@example.com');
		await made.kernel.call('session-list');
		const entry = await last(made, 'session-list');
		expect(entry?.context?.replay).toBe('recorded');
		const entries = await journalOf(made);
		const { report } = await replayKernel(entries, {
			deployment: scopedDeployment(),
			ports: scopedPorts(),
		});
		expect(report.diverged).toBe(false);
		expect(report.recorded).toContain(entry?.seq);
		expect(PROVIDER_COMMANDS).toEqual([
			'session-list',
			'session-revoke',
			'account-passkey-list',
			'account-passkey-add',
			'account-passkey-rename',
			'account-passkey-remove',
		]);
	});

	it("P3-E3: keeps the provider's REAUTH_REQUIRED and SESSION_NOT_FOUND, and answers any other failure as retryable", async () => {
		const made = await workspace();
		await signIn(made.kernel, 'bea@example.com');
		const sessions = made.auth.sessions as NonNullable<AuthAdapter['sessions']>;
		const revoke = vi.spyOn(sessions, 'revokeSession');
		revoke.mockRejectedValueOnce(
			Object.assign(new Error('Sign in with a passkey again'), { code: 'REAUTH_REQUIRED' })
		);
		expect((await made.kernel.call('session-revoke', { session: 'others' })).error).toMatchObject({
			code: 'REAUTH_REQUIRED',
			retryable: false,
		});
		revoke.mockRejectedValueOnce(
			Object.assign(new Error('No such session'), { code: 'SESSION_NOT_FOUND' })
		);
		expect(
			(await made.kernel.call('session-revoke', { session: '0123456789abcdef' })).error?.code
		).toBe('SESSION_NOT_FOUND');
		revoke.mockRejectedValueOnce(new Error('fetch failed'));
		expect((await made.kernel.call('session-revoke', { session: 'others' })).error).toMatchObject({
			code: 'IDENTITY_PROVIDER_UNAVAILABLE',
			retryable: true,
		});
	});
});

describe('P3-E1: passkeys (5.2), over the Mock in `local` mode', () => {
	it('P3-E1: adds, lists and renames a passkey, refuses the last one, and removes one of two', async () => {
		const made = await workspace();
		await signIn(made.kernel, 'bea@example.com');
		const added = await made.kernel.call<{ id: string; name: string | null }>(
			'account-passkey-add',
			{ name: 'Laptop' }
		);
		expect(added.success, JSON.stringify(added.error)).toBe(true);
		expect(added.data?.name).toBe('Laptop');
		const id = added.data?.id as string;
		const renamed = await made.kernel.call<{ name: string }>('account-passkey-rename', {
			passkey: id,
			name: 'Work laptop',
		});
		expect(renamed.data?.name).toBe('Work laptop');
		const listed = await made.kernel.call<{ passkeys: { id: string; name: string }[] }>(
			'account-passkey-list'
		);
		expect(listed.data?.passkeys.map((row) => row.name)).toEqual(['Work laptop']);
		// The only passkey, with no other way in: refused (recovery is step 4's, so `recovery` reads `none`).
		expect((await made.kernel.call('account-passkey-remove', { passkey: id })).error?.code).toBe(
			'PASSKEY_LAST'
		);
		const second = await made.kernel.call<{ id: string }>('account-passkey-add', {});
		expect(second.success).toBe(true);
		expect((await made.kernel.call('account-passkey-remove', { passkey: id })).data).toEqual({
			removed: true,
		});
		expect(
			(await made.kernel.call('account-passkey-rename', { passkey: 'nope', name: 'x' })).error?.code
		).toBe('PASSKEY_NOT_FOUND');
	});

	it('P3-E1: signs in with a passkey through `auth-sign-in`, journaled with no credential', async () => {
		const made = await workspace();
		await signIn(made.kernel, 'bea@example.com');
		expect((await made.kernel.call('account-passkey-add', {})).success).toBe(true);
		await made.kernel.call('auth-sign-out');
		const signed = await made.kernel.call('auth-sign-in', { method: 'passkey' });
		expect(signed.success, JSON.stringify(signed.error)).toBe(true);
		expect(made.auth.getSession().user?.id).toBe(BEA);
		expect((await last(made, 'auth-sign-in'))?.input).toEqual({ method: 'passkey' });
	});
});

describe('P3-E1: the kernel’s wrapper of `auth-sign-in` (4.6)', () => {
	it('P3-E1: refuses a method `identity.methods` does not allow, SIGN_IN_METHOD_UNAVAILABLE, before the adapter', async () => {
		const made = await provider({ identity: { ...PROVIDER, methods: ['passkey'] } });
		const signInSpy = vi.spyOn(made.auth, 'signIn');
		const refused = await signIn(made.kernel, 'bea@example.com');
		expect(refused.error?.code).toBe('SIGN_IN_METHOD_UNAVAILABLE');
		expect(refused.error?.suggestion).toContain('passkey');
		expect(signInSpy).not.toHaveBeenCalled();
		expect((await last(made, 'auth-sign-in'))?.result.success).toBe(false);
		// A passkey is allowed: the adapter is asked (and the Mock with no passkey answers for itself).
		const passkey = await made.kernel.call('auth-sign-in', { method: 'passkey' });
		expect(passkey.error?.code).not.toBe('SIGN_IN_METHOD_UNAVAILABLE');
		expect(signInSpy).toHaveBeenCalledTimes(1);
	});

	it('P3-E1: leaves `local` mode, which has no methods, as phases 0 to 2 have it', async () => {
		const made = await workspace();
		expect((await signIn(made.kernel, 'bea@example.com')).success).toBe(true);
	});
});

describe('P3-E1: HUMAN_REQUIRED (3.4)', () => {
	it('P3-E1: refuses the session and passkey commands through the agent interface, journaled, in both modes', async () => {
		for (const made of [await workspace(), await provider()]) {
			await signIn(made.kernel, 'bea@example.com');
			const inputs: Record<string, unknown> = {
				'session-revoke': { session: 'others' },
				'account-passkey-rename': { passkey: 'p', name: 'n' },
				'account-passkey-remove': { passkey: 'p' },
			};
			for (const name of PROVIDER_COMMANDS) {
				const refused = await made.kernel.agent.call(name, inputs[name] ?? {});
				expect(refused.error?.code, name).toBe('HUMAN_REQUIRED');
				const entry = await last(made, name);
				expect(entry?.result.success, name).toBe(false);
				expect(entry?.actor?.kind, name).toBe('agent');
			}
		}
	});
	it('P3-E1: refuses a human command on every interface but the palette, an MCP server included (I2)', () => {
		const commands = createIdentityCommands({
			auth: new MockAuthAdapter(),
			identity: PROVIDER,
			kit: DOCUMENT_KIT,
		});
		for (const name of HUMAN_COMMANDS) {
			for (const iface of ['agent', 'mcp', 'cli', undefined]) {
				const refused = commands.humanRequired({ interface: iface } as never, name);
				expect(refused?.error?.code, `${name} on ${iface}`).toBe('HUMAN_REQUIRED');
			}
			expect(commands.humanRequired({ interface: 'palette' } as never, name)).toBeUndefined();
		}
		expect(commands.humanRequired({ interface: 'mcp' } as never, 'layout-get')).toBeUndefined();
	});
});

describe('P3-E1: signed out in `provider` mode (2.1, 4.5)', () => {
	it('P3-E1: `app-list` answers none and `palette-search` only the signed-out commands', async () => {
		const made = await provider();
		const listed = await made.kernel.call<{ apps: unknown[] }>('app-list');
		expect(listed.data?.apps).toEqual([]);
		const searched = await made.kernel.call<{ items: { name: string }[] }>('palette-search', {
			query: '',
			limit: 50,
		});
		expect(searched.data?.items.length).toBeGreaterThan(0);
		for (const item of searched.data?.items ?? [])
			expect(SIGNED_OUT_COMMANDS as readonly string[]).toContain(item.name);
		await signIn(made.kernel, 'bea@example.com');
		const signedIn = await made.kernel.call<{ items: { name: string }[] }>('palette-search', {
			query: 'project',
		});
		expect(signedIn.data?.items.some((item) => item.name === 'project-create')).toBe(true);
		expect(
			((await made.kernel.call<{ apps: unknown[] }>('app-list')).data?.apps.length ?? 0) > 0
		).toBe(true);
	});

	it('P3-E1: clears `~signed-out` at each sign-out', async () => {
		const store = new MemoryAdapter();
		const made = await provider({ store });
		expect((await made.kernel.call('layout-set', { sidebar: { width: 333 } })).success).toBe(true);
		await made.kernel.flush();
		const ids = async () =>
			(await store.list<{ id: string }>('settings')).data.map((row) => row.id);
		expect((await ids()).some((id) => id.endsWith('~signed-out'))).toBe(true);
		await signIn(made.kernel, 'bea@example.com');
		expect((await made.kernel.call('layout-set', { sidebar: { width: 300 } })).success).toBe(true);
		await made.kernel.flush();
		await made.kernel.call('auth-sign-out');
		await made.kernel.flush();
		expect((await ids()).some((id) => id.endsWith('~signed-out'))).toBe(false);
		// Bea's own records are kept.
		expect((await ids()).some((id) => id.endsWith(`~${BEA}`))).toBe(true);
	});
});

describe('P3-E4: the membership a sign-in brings (4.4, 7.6)', () => {
	it('P3-E4: a passkey autofill waiting for the person holds no change of person: the listener settles one', async () => {
		const made = await provider();
		let started = false;
		let finish: (value: unknown) => void = () => {};
		const signIn = made.auth.signIn.bind(made.auth);
		made.auth.signIn = ((input: { method: string; autoFill?: boolean }) => {
			if (!input.autoFill) return signIn(input as never);
			started = true;
			return new Promise((resolve) => {
				finish = resolve as (value: unknown) => void;
			});
		}) as typeof made.auth.signIn;
		const waiting = made.kernel.call('auth-sign-in', { method: 'passkey', autoFill: true });
		await vi.waitFor(() => expect(started).toBe(true));
		// Another tab signs Bea in while the autofill waits: settled as the listener's, not held for the autofill.
		made.auth._setUser(user(BEA));
		await vi.waitFor(async () =>
			expect((await last(made, 'session-settle'))?.input).toMatchObject({
				person: BEA,
				reason: 'tab',
			})
		);
		finish({ status: 'unauthenticated' });
		await waiting;
	});

	it('P3-E4: only a passkey call is an autofill: another method that says `autoFill` holds the change as its own (N1; the input schema strips `autoFill` there first, and the scope checks the method as well)', async () => {
		const made = await provider();
		let started = false;
		let finish: (value: unknown) => void = () => {};
		made.auth.signIn = (() => {
			started = true;
			return new Promise((resolve) => {
				finish = resolve as (value: unknown) => void;
			});
		}) as typeof made.auth.signIn;
		const waiting = made.kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'bea@example.com',
			password: 'x',
			autoFill: true,
		});
		await vi.waitFor(() => expect(started).toBe(true));
		made.auth._setUser(user(BEA));
		await new Promise((resolve) => setTimeout(resolve, 50));
		// The sign-in in progress settles the change inside itself (4.4); the listener leaves it.
		expect(
			(await journalOf(made)).some(
				(entry) =>
					entry.command === 'session-settle' &&
					(entry.input as { reason?: string }).reason === 'tab' &&
					(entry.input as { person?: string }).person === BEA
			)
		).toBe(false);
		finish({ status: 'unauthenticated' });
		await waiting;
	});

	it('P3-E4: reads it once the sign-in is journaled, settles it top-level, and the next call waits for it', async () => {
		let answer: (found: { role: 'member'; digest: string }) => void = () => {};
		const made = await provider({
			membership: { mode: 'provider', members: new Map(), digest: '' },
			ports: {
				...scopedPorts(),
				readMembership: () =>
					new Promise((resolve) => {
						answer = resolve as never;
					}),
			},
		});
		expect((await signIn(made.kernel, 'bea@example.com')).success).toBe(true);
		// Bea was no member stage A knew of: her next call waits for the read, then runs as a member.
		const pending = made.kernel.call('project-list');
		await new Promise((resolve) => setTimeout(resolve, 10));
		answer({ role: 'member', digest: 'd-bea' });
		const listed = await pending;
		expect(listed.success, JSON.stringify(listed.error)).toBe(true);
		const entries = await journalOf(made);
		const order = entries.map((entry) => entry.command);
		const settle = entries.findLast((entry) => entry.command === 'session-settle');
		expect(settle?.input).toEqual({
			person: BEA,
			role: 'member',
			membershipDigest: 'd-bea',
			reason: 'membership',
		} satisfies SessionSettleInputV1);
		expect(order.lastIndexOf('auth-sign-in')).toBeLessThan(order.lastIndexOf('session-settle'));
		expect(order.lastIndexOf('session-settle')).toBeLessThan(order.lastIndexOf('project-list'));
		// A replay drives its Mock and membership from the entries, reaching no provider.
		const { report } = await replayKernel(entries, {
			deployment: scopedDeployment(),
			ports: scopedPorts(),
			identity: PROVIDER,
			membership: { mode: 'provider', members: new Map(), digest: '' },
		});
		expect(report.diverged).toBe(false);
	});
});

describe("P3-E4: step 2's follow-ups, closed by step 3", () => {
	it('P3-E4: reads membership again on the backoff after a settle’s read fails, and lets the person in', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		try {
			let reads = 0;
			const made = await provider({
				membership: { mode: 'provider', members: new Map([[OLU, 'owner']]), digest: 'd1' },
				ports: {
					...scopedPorts(),
					readMembership: async () => {
						// Olu's read after the sign-in answers; Bea's first read fails.
						if (made.auth.getSession().user?.id === OLU)
							return { role: 'owner' as const, digest: 'd1' };
						reads++;
						if (reads === 1) throw new Error('The provider did not answer');
						return { role: 'member' as const, digest: 'd-bea' };
					},
				},
			});
			await signIn(made.kernel, 'olu@example.com');
			// A tab's change to Bea: the settle's read fails, so she is held to what the kernel knows (no member).
			made.auth._setUser(user(BEA));
			await vi.waitFor(async () =>
				expect((await last(made, 'session-settle'))?.input).toMatchObject({
					person: BEA,
					role: null,
				})
			);
			expect((await made.kernel.call('project-list')).error?.code).toBe('WORKSPACE_NOT_MEMBER');
			// The backoff's first wait: the read is tried again and settles her membership.
			await vi.advanceTimersByTimeAsync(5_000);
			await vi.waitFor(async () =>
				expect((await last(made, 'session-settle'))?.input).toEqual({
					person: BEA,
					role: 'member',
					membershipDigest: 'd-bea',
					reason: 'membership',
				})
			);
			expect((await made.kernel.call('project-list')).success).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it("P3-E4: a read's timeout that wakes early waits again, on the kernel's clock", async () => {
		let at = Date.UTC(2026, 10, 13);
		let reads = 0;
		const fired: Array<{ at: number; fn: () => void }> = [];
		const made = await provider({
			clock: () => at,
			ports: {
				...scopedPorts(),
				// The host's timer runs every task at once, ahead of the kernel's clock.
				schedule: (due: number, fn: () => void) => {
					fired.push({ at: due, fn });
					return () => {};
				},
				// The read after the sign-in answers; the re-read before the command never does.
				readMembership: () =>
					++reads === 1
						? Promise.resolve({ role: 'owner' as const, digest: 'd1' })
						: new Promise(() => {}),
			} as never,
		});
		await signIn(made.kernel, 'olu@example.com');
		const pending = made.kernel.call('project-create', { name: 'Ledger' });
		await vi.waitFor(() =>
			expect(fired.some((timer) => timer.at === at + MEMBERSHIP_READ_TIMEOUT_MS)).toBe(true)
		);
		let settled = false;
		void pending.then(() => {
			settled = true;
		});
		// Woken before the deadline: no refusal yet, and another wait is scheduled for the same deadline.
		const deadline = at + MEMBERSHIP_READ_TIMEOUT_MS;
		const early = fired.filter((timer) => timer.at === deadline);
		for (const timer of early) timer.fn();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(settled).toBe(false);
		expect(fired.filter((timer) => timer.at === deadline).length).toBeGreaterThan(early.length);
		at = deadline;
		for (const timer of fired.filter((held) => held.at === deadline).slice(early.length))
			timer.fn();
		expect((await pending).error?.code).toBe('MEMBERSHIP_UNAVAILABLE');
	});

	it('P3-E4: counts another session of the same person as a change, so a read it overlapped is read again', async () => {
		let reads = 0;
		let overlapped: string | undefined;
		const made = await provider({
			membership: { mode: 'provider', members: new Map([[OLU, 'owner']]), digest: 'd1' },
			ports: {
				...scopedPorts(),
				readMembership: async () => {
					if (made.auth.getSession().user?.id === OLU)
						return { role: 'owner' as const, digest: 'd1' };
					reads++;
					// While Bea's first read answers, an adapter merges Bea → someone → Bea into one new session.
					if (overlapped === undefined) {
						overlapped = `read-${reads}`;
						made.auth._setUser(user(BEA), { id: 'another-session' });
					}
					return { role: 'member' as const, digest: `read-${reads}` };
				},
			},
		});
		await signIn(made.kernel, 'olu@example.com');
		made.auth._setUser(user(BEA));
		await vi.waitFor(async () =>
			expect((await last(made, 'session-settle'))?.input).toMatchObject({ person: BEA })
		);
		// The overlapped read was not trusted: the settle carries the read made after it.
		const settled = (await last(made, 'session-settle'))?.input as SessionSettleInputV1;
		expect(overlapped).toBe('read-1');
		expect(settled).toMatchObject({ person: BEA, membershipDigest: `read-${reads}` });
		expect(settled.membershipDigest).not.toBe(overlapped);
	});
});

describe('P3-E4: a held draft makes `beforeunload` ask (4.5)', () => {
	it('P3-E4: asks while another person holds a draft in the page, and stops once they take it up', async () => {
		// The page's `beforeunload`: `globalThis` is the page in a browser, and here an event target stands for it.
		const page = new EventTarget();
		vi.stubGlobal('addEventListener', page.addEventListener.bind(page));
		vi.stubGlobal('removeEventListener', page.removeEventListener.bind(page));
		try {
			const made = await provider({ deployment: documentsDeployment(), ports: documentsPorts() });
			await signIn(made.kernel, 'bea@example.com');
			const asks = () => {
				const event = new Event('beforeunload', { cancelable: true });
				page.dispatchEvent(event);
				return event.defaultPrevented;
			};
			expect(asks()).toBe(false);
			const opened = await made.kernel.call<{ tab: string }>('document-create', {
				type: 'probe',
				title: 'Draft',
			});
			expect(opened.success, JSON.stringify(opened.error)).toBe(true);
			const document = (opened.data as unknown as { id: string }).id;
			expect((await made.kernel.call('document-open', { document })).success).toBe(true);
			const editor = await made.kernel.call<{ groups: { tabs: { id: string }[] }[] }>('editor-get');
			const tab = editor.data?.groups[0]?.tabs[0]?.id as string;
			expect((await made.kernel.call('editor-dirty-set', { tab, dirty: true })).success).toBe(true);
			await made.kernel.call('auth-sign-out');
			expect(asks()).toBe(true);
			await signIn(made.kernel, 'bea@example.com');
			expect(asks()).toBe(false);
		} finally {
			// Never left stubbed for the next test, whatever this one's assertions did.
			vi.unstubAllGlobals();
		}
	});
});
