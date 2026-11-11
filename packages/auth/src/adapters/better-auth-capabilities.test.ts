import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthSessionState } from '../types.js';
import { BetterAuthAdapter } from './better-auth.js';
import type { BetterAuthClient, BetterAuthSessionValue } from './better-auth-client.js';
import { deviceLabel, sessionHandle } from './session-rows.js';

const SIGNED_IN: BetterAuthSessionValue = {
	data: {
		session: { id: 's-current', expiresAt: '2026-12-31T00:00:00Z' },
		user: { id: 'u1', email: 'ada@example.test', name: 'Ada' },
	},
	isPending: false,
};

function stubClient(overrides: Partial<BetterAuthClient> = {}) {
	let value: BetterAuthSessionValue = { data: null, isPending: true };
	let subscriber: ((next: BetterAuthSessionValue) => void) | null = null;
	const refetch = vi.fn(async () => undefined);
	const client: BetterAuthClient = {
		signIn: { social: vi.fn(), email: vi.fn(), passkey: vi.fn(async () => ({ data: {} })) },
		signOut: vi.fn(),
		useSession: {
			subscribe: (callback) => {
				subscriber = callback;
				return () => {
					subscriber = null;
				};
			},
			get: () => ({ ...value, refetch }),
		},
		...overrides,
	};
	const emit = (next: BetterAuthSessionValue) => {
		value = next;
		subscriber?.({ ...next, refetch });
	};
	return { client, emit, refetch };
}

/** A browser with WebAuthn; `conditional` is what `isConditionalMediationAvailable` answers, or absent. */
function withWebAuthn(conditional: boolean | 'absent' = true) {
	const PublicKeyCredential = Object.assign(
		() => {},
		conditional === 'absent' ? {} : { isConditionalMediationAvailable: async () => conditional }
	);
	vi.stubGlobal('PublicKeyCredential', PublicKeyCredential);
	vi.stubGlobal('navigator', { credentials: { get: () => undefined, create: () => undefined } });
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('P3-E9: BetterAuthAdapter passkey sign-in', () => {
	it('signs in through the passkey plugin, passing autoFill', async () => {
		withWebAuthn();
		const { client } = stubClient();
		const adapter = new BetterAuthAdapter({ client });
		await expect(adapter.signIn({ method: 'passkey', autoFill: true })).resolves.toEqual({
			kind: 'signed-in',
		});
		expect(client.signIn.passkey).toHaveBeenCalledWith({ autoFill: true });
		await adapter.signIn({ method: 'passkey' });
		expect(client.signIn.passkey).toHaveBeenLastCalledWith(undefined);
		adapter.dispose();
	});

	it('is PASSKEY_UNSUPPORTED without WebAuthn, never calling the provider', async () => {
		const { client } = stubClient();
		const adapter = new BetterAuthAdapter({ client });
		await expect(adapter.signIn({ method: 'passkey' })).rejects.toMatchObject({
			code: 'PASSKEY_UNSUPPORTED',
			retryable: false,
		});
		expect(client.signIn.passkey).not.toHaveBeenCalled();
		adapter.dispose();
	});

	it('is PASSKEY_UNSUPPORTED when the client has no passkey sign-in', async () => {
		withWebAuthn();
		const { client } = stubClient();
		const adapter = new BetterAuthAdapter({
			client: { ...client, signIn: { social: vi.fn(), email: vi.fn() } },
		});
		await expect(adapter.signIn({ method: 'passkey' })).rejects.toMatchObject({
			code: 'PASSKEY_UNSUPPORTED',
		});
		adapter.dispose();
	});

	it.each([
		[false, 'false'],
		['absent', 'missing'],
	] as const)(
		'is PASSKEY_UNSUPPORTED for autoFill when conditional mediation is %s (%s)',
		async (conditional, _label) => {
			withWebAuthn(conditional);
			const { client } = stubClient();
			const adapter = new BetterAuthAdapter({ client });
			await expect(adapter.signIn({ method: 'passkey', autoFill: true })).rejects.toMatchObject({
				code: 'PASSKEY_UNSUPPORTED',
			});
			expect(client.signIn.passkey).not.toHaveBeenCalled();
			// Without autoFill, the dialog ceremony does not need conditional mediation.
			await adapter.signIn({ method: 'passkey' });
			expect(client.signIn.passkey).toHaveBeenCalledWith(undefined);
			adapter.dispose();
		}
	);

	it('is PASSKEY_UNSUPPORTED for autoFill when the availability check throws', async () => {
		withWebAuthn();
		(
			globalThis.PublicKeyCredential as unknown as { isConditionalMediationAvailable: () => never }
		).isConditionalMediationAvailable = () => {
			throw new Error('not here');
		};
		const { client } = stubClient();
		const adapter = new BetterAuthAdapter({ client });
		await expect(adapter.signIn({ method: 'passkey', autoFill: true })).rejects.toMatchObject({
			code: 'PASSKEY_UNSUPPORTED',
		});
		adapter.dispose();
	});

	it.each(['AUTH_CANCELLED', 'ERROR_CEREMONY_ABORTED', 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY'])(
		'maps a dismissed ceremony (%s) to PASSKEY_CANCELLED',
		async (code) => {
			withWebAuthn();
			const { client } = stubClient();
			vi.mocked(
				client.signIn.passkey as NonNullable<BetterAuthClient['signIn']['passkey']>
			).mockResolvedValue({ data: null, error: { code, message: 'Auth cancelled', status: 400 } });
			const adapter = new BetterAuthAdapter({ client });
			await expect(adapter.signIn({ method: 'passkey' })).rejects.toMatchObject({
				code: 'PASSKEY_CANCELLED',
				retryable: false,
			});
			adapter.dispose();
		}
	);

	it('maps any other passkey failure to PROVIDER_ERROR', async () => {
		withWebAuthn();
		const { client } = stubClient();
		vi.mocked(
			client.signIn.passkey as NonNullable<BetterAuthClient['signIn']['passkey']>
		).mockResolvedValue({ data: null, error: { code: 'PASSKEY_NOT_FOUND', status: 400 } });
		const adapter = new BetterAuthAdapter({ client });
		await expect(adapter.signIn({ method: 'passkey' })).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
		});
		adapter.dispose();
	});
});

describe('P3-E9: BetterAuthAdapter initial and refresh', () => {
	it('reports initial until the store answers, then the store', () => {
		const initial: AuthSessionState = {
			status: 'authenticated',
			session: { id: 'probe', expiresAt: new Date('2026-12-31T00:00:00Z') },
			user: { id: 'u1', email: 'ada@example.test' },
		};
		const { client, emit } = stubClient();
		const adapter = new BetterAuthAdapter({ client, initial });
		expect(adapter.getSession()).toBe(initial);
		emit({ data: null, isPending: false });
		expect(adapter.getSession().status).toBe('unauthenticated');
		// Pending again later is loading, not the stale initial state.
		emit({ data: null, isPending: true });
		expect(adapter.getSession().status).toBe('loading');
		adapter.dispose();
	});

	it('refresh() refetches through the store and applies its answer', async () => {
		const { client, emit, refetch } = stubClient();
		const adapter = new BetterAuthAdapter({ client });
		refetch.mockImplementation(async () => {
			emit(SIGNED_IN);
		});
		await adapter.refresh();
		expect(refetch).toHaveBeenCalledTimes(1);
		expect(adapter.getSession().status).toBe('authenticated');
		adapter.dispose();
	});

	// Better Auth 1.7.18's session atom (client/session-atom.mjs): `refetch` never rejects. On a
	// transport failure it stores the thrown value as `error`, on a 5xx `{ status, ... }`, keeps
	// the stale `data`, and resolves; a 401 stores the error and clears `data`.
	it.each([
		['a transport failure', new TypeError('Failed to fetch'), 'NETWORK_ERROR'],
		['a 5xx', { status: 503, statusText: 'Service Unavailable' }, 'REFRESH_FAILED'],
		['an unknown failure', new Error('boom'), 'REFRESH_FAILED'],
	])('refresh() rejects after %s, which the store resolves with', async (_, error, code) => {
		const { client, emit, refetch } = stubClient();
		const adapter = new BetterAuthAdapter({ client });
		emit(SIGNED_IN);
		refetch.mockImplementation(async () => {
			emit({ ...SIGNED_IN, error });
		});
		await expect(adapter.refresh()).rejects.toMatchObject({ code, retryable: true });
		// The stale session is still what the store holds; the rejection is what says so.
		expect(adapter.getSession().status).toBe('authenticated');
		adapter.dispose();
	});

	it('refresh() resolves on a 401, with the session gone', async () => {
		const { client, emit, refetch } = stubClient();
		const adapter = new BetterAuthAdapter({ client });
		emit(SIGNED_IN);
		refetch.mockImplementation(async () => {
			emit({ data: null, isPending: false, error: { status: 401, statusText: 'Unauthorized' } });
		});
		await expect(adapter.refresh()).resolves.toBeUndefined();
		expect(adapter.getSession().status).toBe('unauthenticated');
		adapter.dispose();
	});

	it('refresh() maps a refetch that does reject', async () => {
		const { client, refetch } = stubClient();
		const adapter = new BetterAuthAdapter({ client });
		refetch.mockRejectedValue(new TypeError('fetch failed'));
		await expect(adapter.refresh()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
		adapter.dispose();
	});

	it('refresh() does nothing for a store without refetch', async () => {
		const adapter = new BetterAuthAdapter({
			client: {
				signIn: { social: vi.fn(), email: vi.fn() },
				signOut: vi.fn(),
				useSession: { subscribe: () => () => {}, get: () => ({ data: null, isPending: false }) },
			},
		});
		await expect(adapter.refresh()).resolves.toBeUndefined();
		adapter.dispose();
	});
});

describe('P3-E9: BetterAuthAdapter capabilities over a stubbed client', () => {
	it('lists sessions as handles and revokes one by its token', async () => {
		const listSessions = vi.fn(async () => ({
			data: [
				{
					id: 's-current',
					token: 'token-current',
					userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1',
					createdAt: '2026-11-01T00:00:00Z',
					updatedAt: new Date('2026-11-02T00:00:00Z'),
					expiresAt: '2026-12-01T00:00:00Z',
				},
				{
					id: 's-other',
					token: 'token-other',
					userAgent: null,
					createdAt: '2026-11-01T00:00:00Z',
					updatedAt: '2026-11-01T00:00:00Z',
					expiresAt: null,
				},
			],
		}));
		const revokeSession = vi.fn(async () => ({ data: { status: true } }));
		const revokeOtherSessions = vi.fn(async () => ({ data: { status: true } }));
		const revokeSessions = vi.fn(async () => ({ data: { status: true } }));
		const { client, emit } = stubClient({
			listSessions,
			revokeSession,
			revokeOtherSessions,
			revokeSessions,
		});
		const adapter = new BetterAuthAdapter({ client });
		emit(SIGNED_IN);

		const rows = await adapter.sessions.listSessions();
		expect(rows).toEqual([
			{
				handle: await sessionHandle('token-current'),
				current: true,
				createdAt: new Date('2026-11-01T00:00:00Z'),
				updatedAt: new Date('2026-11-02T00:00:00Z'),
				expiresAt: new Date('2026-12-01T00:00:00Z'),
				device: 'Safari on iOS',
			},
			{
				handle: await sessionHandle('token-other'),
				current: false,
				createdAt: new Date('2026-11-01T00:00:00Z'),
				updatedAt: new Date('2026-11-01T00:00:00Z'),
			},
		]);

		await adapter.sessions.revokeSession(rows[1]?.handle ?? '');
		expect(revokeSession).toHaveBeenCalledWith({ token: 'token-other' });
		await adapter.sessions.revokeSession('others');
		expect(revokeOtherSessions).toHaveBeenCalledTimes(1);
		await adapter.sessions.revokeSession('all');
		expect(revokeSessions).toHaveBeenCalledTimes(1);
		adapter.dispose();
	});

	it('learns an unknown handle by listing once, and refuses one that is not there', async () => {
		const listSessions = vi.fn(async () => ({
			data: [
				{
					id: 's-other',
					token: 'token-other',
					createdAt: '2026-11-01T00:00:00Z',
					updatedAt: '2026-11-01T00:00:00Z',
				},
			],
		}));
		const revokeSession = vi.fn(async () => ({ data: { status: true } }));
		const { client } = stubClient({ listSessions, revokeSession });
		const adapter = new BetterAuthAdapter({ client });

		await adapter.sessions.revokeSession(await sessionHandle('token-other'));
		expect(listSessions).toHaveBeenCalledTimes(1);
		expect(revokeSession).toHaveBeenCalledWith({ token: 'token-other' });

		await expect(adapter.sessions.revokeSession('ffffffffffffffff')).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
		});
		expect(revokeSession).toHaveBeenCalledTimes(1);
		adapter.dispose();
	});

	it('answers PROVIDER_ERROR for a client without the routes or plugins', async () => {
		const { client } = stubClient();
		const adapter = new BetterAuthAdapter({ client });
		await expect(adapter.sessions.listSessions()).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
		await expect(adapter.passkeys.listPasskeys()).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
		await expect(adapter.organization.membership('org-1')).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
		});
		adapter.dispose();
	});

	it('adds a passkey, mapping a dismissed ceremony and a missing answer', async () => {
		withWebAuthn();
		const addPasskey = vi.fn();
		const { client } = stubClient({
			passkey: {
				addPasskey,
				listUserPasskeys: vi.fn(),
				updatePasskey: vi.fn(),
				deletePasskey: vi.fn(),
			},
		});
		const adapter = new BetterAuthAdapter({ client });

		addPasskey.mockResolvedValueOnce({
			data: {
				id: 'pk-1',
				name: 'Laptop',
				createdAt: '2026-11-09T00:00:00Z',
				deviceType: 'singleDevice',
				backedUp: false,
				publicKey: 'not returned',
			},
		});
		expect(await adapter.passkeys.addPasskey({ name: 'Laptop' })).toEqual({
			id: 'pk-1',
			name: 'Laptop',
			createdAt: new Date('2026-11-09T00:00:00Z'),
			deviceType: 'singleDevice',
			backedUp: false,
		});
		expect(addPasskey).toHaveBeenCalledWith({ name: 'Laptop' });

		addPasskey.mockResolvedValueOnce({
			data: { id: 'pk-2', createdAt: '2026-11-09T00:00:00Z', deviceType: 'other' },
		});
		expect(await adapter.passkeys.addPasskey()).toEqual({
			id: 'pk-2',
			createdAt: new Date('2026-11-09T00:00:00Z'),
		});
		expect(addPasskey).toHaveBeenLastCalledWith(undefined);

		addPasskey.mockResolvedValueOnce({ data: null, error: { code: 'ERROR_CEREMONY_ABORTED' } });
		await expect(adapter.passkeys.addPasskey()).rejects.toMatchObject({
			code: 'PASSKEY_CANCELLED',
		});
		addPasskey.mockResolvedValueOnce({ data: null, error: null });
		await expect(adapter.passkeys.addPasskey()).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
		adapter.dispose();
	});

	it('never lets an organization call fall back to the active organization', async () => {
		const getActiveMemberRole = vi.fn();
		const listInvitations = vi.fn(async () => ({ data: [] }));
		const inviteMember = vi.fn(async () => ({ data: null }));
		const organization = {
			getActiveMemberRole,
			listMembers: vi.fn(),
			inviteMember,
			listInvitations,
			cancelInvitation: vi.fn(),
			removeMember: vi.fn(),
			updateMemberRole: vi.fn(),
			leave: vi.fn(),
			listUserInvitations: vi.fn(),
			acceptInvitation: vi.fn(),
			rejectInvitation: vi.fn(),
		};
		const { client } = stubClient({ organization });
		const access = new BetterAuthAdapter({ client }).organization;

		for (const empty of ['', undefined as unknown as string]) {
			await expect(access.membership(empty)).rejects.toThrow(TypeError);
			await expect(access.listMembers(empty)).rejects.toThrow(TypeError);
			await expect(access.invite(empty, { email: 'a@b.test', role: 'member' })).rejects.toThrow(
				TypeError
			);
			await expect(access.listInvitations(empty)).rejects.toThrow(TypeError);
			await expect(access.cancelInvitation(empty, 'i-1')).rejects.toThrow(TypeError);
			await expect(access.removeMember(empty, 'm-1')).rejects.toThrow(TypeError);
			await expect(access.setRole(empty, 'm-1', 'admin')).rejects.toThrow(TypeError);
			await expect(access.leave(empty)).rejects.toThrow(TypeError);
		}
		for (const method of Object.values(organization)) expect(method).not.toHaveBeenCalled();

		getActiveMemberRole.mockResolvedValueOnce({
			data: null,
			error: { code: 'YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION', status: 403 },
		});
		expect(await access.membership('org-1')).toBeNull();
		expect(getActiveMemberRole).toHaveBeenLastCalledWith({ query: { organizationId: 'org-1' } });
		getActiveMemberRole.mockResolvedValueOnce({ data: null, error: { status: 500 } });
		await expect(access.membership('org-1')).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
		getActiveMemberRole.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		await expect(access.membership('org-1')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });

		await expect(
			access.invite('org-1', { email: 'a@b.test', role: 'member' })
		).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
		});
		await expect(access.cancelInvitation('org-1', 'i-elsewhere')).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
		});
		expect(organization.cancelInvitation).not.toHaveBeenCalled();
	});
});

describe('P3-E9: BetterAuthAdapter session handles and member ids', () => {
	const OTHER = {
		id: 's-other',
		token: 'token-other',
		createdAt: '2026-11-01',
		updatedAt: '2026-11-01',
	};

	function sessionsClient() {
		const listSessions = vi.fn(async () => ({ data: [OTHER] }));
		const revokeSession = vi.fn(async () => ({ data: { status: true } }));
		return { listSessions, revokeSession, ...stubClient({ listSessions, revokeSession }) };
	}

	it.each([
		['sign-out', { data: null, isPending: false }],
		[
			'a change of user',
			{
				data: {
					session: { id: 's-bea', expiresAt: '2026-12-31T00:00:00Z' },
					user: { id: 'u2', email: 'bea@example.test' },
				},
				isPending: false,
			},
		],
	] as const)('forgets the handles on %s', async (_, next) => {
		const { client, emit, listSessions, revokeSession } = sessionsClient();
		const adapter = new BetterAuthAdapter({ client });
		emit(SIGNED_IN);
		const [row] = await adapter.sessions.listSessions();
		expect(listSessions).toHaveBeenCalledTimes(1);

		emit(next);
		listSessions.mockResolvedValueOnce({ data: [] });
		// The handle is no longer mapped: revoking lists again, finds nothing, and refuses.
		await expect(adapter.sessions.revokeSession(row?.handle ?? '')).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
		});
		expect(listSessions).toHaveBeenCalledTimes(2);
		expect(revokeSession).not.toHaveBeenCalled();
		adapter.dispose();
	});

	it('keeps the handles while the same user’s session slides', async () => {
		const { client, emit, listSessions, revokeSession } = sessionsClient();
		const adapter = new BetterAuthAdapter({ client });
		emit(SIGNED_IN);
		const [row] = await adapter.sessions.listSessions();
		emit({
			data: {
				session: { id: 's-current', expiresAt: '2027-01-31T00:00:00Z' },
				user: { id: 'u1', email: 'ada@example.test', name: 'Ada' },
			},
			isPending: false,
		});
		await adapter.sessions.revokeSession(row?.handle ?? '');
		expect(listSessions).toHaveBeenCalledTimes(1);
		expect(revokeSession).toHaveBeenCalledWith({ token: 'token-other' });
		adapter.dispose();
	});

	it('does not restore handles from a list that began before a sign-out', async () => {
		const { client, emit, listSessions, revokeSession } = sessionsClient();
		const adapter = new BetterAuthAdapter({ client });
		emit(SIGNED_IN);
		let release: () => void = () => {};
		listSessions.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = () => resolve({ data: [OTHER] });
				})
		);
		const listing = adapter.sessions.listSessions();
		emit({ data: null, isPending: false });
		release();
		const [row] = await listing;
		listSessions.mockResolvedValueOnce({ data: [] });
		await expect(adapter.sessions.revokeSession(row?.handle ?? '')).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
		});
		expect(revokeSession).not.toHaveBeenCalled();
		adapter.dispose();
	});

	it('refuses a member id with @, which Better Auth would read as an email', async () => {
		const removeMember = vi.fn();
		const organization = { removeMember } as unknown as BetterAuthClient['organization'];
		const { client } = stubClient({ organization });
		const adapter = new BetterAuthAdapter({ client });
		for (const id of ['bea@example.test', '', undefined as unknown as string]) {
			await expect(adapter.organization.removeMember('org-1', id)).rejects.toThrow(TypeError);
		}
		expect(removeMember).not.toHaveBeenCalled();
		adapter.dispose();
	});
});

describe('P3-E9: session rows', () => {
	it('hashes a token to its first 16 hex characters of SHA-256', async () => {
		// SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
		expect(await sessionHandle('abc')).toBe('ba7816bf8f01cfea');
	});

	it.each([
		[
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
			'Edge on Windows',
		],
		[
			'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
			'Chrome on Android',
		],
		[
			'Mozilla/5.0 (X11; CrOS x86_64 16000.0.0) AppleWebKit/537.36 Chrome/140.0.0.0',
			'Chrome on ChromeOS',
		],
		['Mozilla/5.0 (Windows NT 10.0) OPR/110.0', 'Opera on Windows'],
		['curl/8.0', undefined],
		['Mozilla/5.0 (Macintosh)', 'macOS'],
		['Safari/604.1', 'Safari'],
		[null, undefined],
		['', undefined],
	])('labels %s as %s', (userAgent, label) => {
		expect(deviceLabel(userAgent)).toBe(label);
	});
});
