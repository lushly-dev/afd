/**
 * `BetterAuthAdapter`'s capabilities against a real Better Auth 1.7.18 server with the
 * organization and passkey plugins, over loopback HTTP. Node has no WebAuthn, so a passkey
 * ceremony is the browser suites' (Loam's E1); here the passkey rows are seeded in the
 * provider's database and every other call is real.
 */
import { once } from 'node:events';
import { createServer } from 'node:http';
import { passkey } from '@better-auth/passkey';
import { passkeyClient } from '@better-auth/passkey/client';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { createAuthClient } from 'better-auth/client';
import { organizationClient } from 'better-auth/client/plugins';
import { toNodeHandler } from 'better-auth/node';
import { organization } from 'better-auth/plugins';
import { expect, it, onTestFinished } from 'vitest';
import type { AuthAdapter } from '../types.js';
import { BetterAuthAdapter } from './better-auth.js';

type Row = Record<string, unknown>;

async function startProvider() {
	const database: Record<string, Row[]> = {
		user: [],
		session: [],
		account: [],
		verification: [],
		organization: [],
		member: [],
		invitation: [],
		passkey: [],
	};
	const server = createServer();
	const stop = async () => {
		if (!server.listening) return;
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve()))
		);
	};
	onTestFinished(stop);
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Expected loopback address');
	const baseURL = `http://127.0.0.1:${address.port}`;
	const auth = betterAuth({
		baseURL,
		secret: 'afd-local-integration-secret-at-least-32-characters',
		database: memoryAdapter(database),
		emailAndPassword: { enabled: true },
		advanced: { useSecureCookies: false },
		logger: { disabled: true },
		plugins: [organization(), passkey({ rpID: '127.0.0.1', origin: baseURL })],
	});
	server.on('request', toNodeHandler(auth));
	return { baseURL, database, stop };
}

/** A client with its own cookie jar, as one browser profile, and the adapter over it. */
function signedInClient(baseURL: string, userAgent: string) {
	const cookies = new Map<string, string>();
	const client = createAuthClient({
		baseURL,
		plugins: [organizationClient(), passkeyClient()],
		fetchOptions: {
			customFetchImpl: async (input, init) => {
				const headers = new Headers(init?.headers);
				headers.set('origin', baseURL);
				headers.set('user-agent', userAgent);
				headers.set('cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
				const response = await fetch(input, { ...init, headers });
				for (const cookie of response.headers.getSetCookie()) {
					const pair = cookie.split(';')[0] ?? '';
					const index = pair.indexOf('=');
					const value = pair.slice(index + 1);
					if (/max-age=0/i.test(cookie) || !value) cookies.delete(pair.slice(0, index));
					else cookies.set(pair.slice(0, index), value);
				}
				return response;
			},
		},
	});
	const adapter = new BetterAuthAdapter({ client });
	onTestFinished(() => adapter.dispose());
	return { client, adapter, cookies };
}

async function settle(adapter: AuthAdapter, status: string) {
	await expect
		.poll(async () => {
			await adapter.refresh?.();
			return adapter.getSession().status;
		})
		.toBe(status);
}

const CHROME_MAC =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';

it('lists sessions by handle and revokes them, with no token or IP address', async () => {
	const { baseURL, database } = await startProvider();
	const credentials = { email: 'ada@example.test', password: 'local-test-password-123' };
	const laptop = signedInClient(baseURL, CHROME_MAC);
	expect((await laptop.client.signUp.email({ ...credentials, name: 'Ada' })).error).toBeNull();
	await settle(laptop.adapter, 'authenticated');
	const phone = signedInClient(baseURL, FIREFOX_LINUX);
	await phone.adapter.signIn({ method: 'credentials', ...credentials });
	await settle(phone.adapter, 'authenticated');

	const sessions = laptop.adapter.sessions;
	if (!sessions) throw new Error('Expected sessions');
	const rows = await sessions.listSessions();
	expect(rows).toHaveLength(2);
	for (const row of rows) {
		expect(row.handle).toMatch(/^[0-9a-f]{16}$/);
		expect(Object.keys(row).sort()).toEqual(
			['createdAt', 'current', 'device', 'expiresAt', 'handle', 'updatedAt'].sort()
		);
	}
	const tokens = database.session?.map((session) => String(session.token)) ?? [];
	const serialized = JSON.stringify(rows);
	for (const token of tokens) expect(serialized).not.toContain(token);
	expect(serialized).not.toContain('127.0.0.1');
	const current = rows.find((row) => row.current);
	const other = rows.find((row) => !row.current);
	expect(current?.device).toBe('Chrome on macOS');
	expect(other?.device).toBe('Firefox on Linux');

	await sessions.revokeSession(other?.handle ?? '');
	await settle(phone.adapter, 'unauthenticated');
	expect(laptop.adapter.getSession().status).toBe('authenticated');
	await expect(sessions.revokeSession('0000000000000000')).rejects.toMatchObject({
		code: 'PROVIDER_ERROR',
	});

	await phone.adapter.signIn({ method: 'credentials', ...credentials });
	await settle(phone.adapter, 'authenticated');
	await sessions.revokeSession('others');
	await settle(phone.adapter, 'unauthenticated');
	expect(await sessions.listSessions()).toHaveLength(1);
	await sessions.revokeSession('all');
	await settle(laptop.adapter, 'unauthenticated');
	expect(database.session).toHaveLength(0);
}, 20_000);

it('reads and changes organizations by id, never the active one', async () => {
	const { baseURL, database } = await startProvider();
	const ada = signedInClient(baseURL, CHROME_MAC);
	await ada.client.signUp.email({
		email: 'ada@example.test',
		password: 'pw-ada-123456',
		name: 'Ada',
	});
	await settle(ada.adapter, 'authenticated');
	const bea = signedInClient(baseURL, CHROME_MAC);
	await bea.client.signUp.email({
		email: 'bea@example.test',
		password: 'pw-bea-123456',
		name: 'Bea',
	});
	await settle(bea.adapter, 'authenticated');
	// Better Auth lists and accepts an invitation only for a verified email.
	for (const user of database.user ?? []) user.emailVerified = true;

	const acme = await ada.client.organization.create({ name: 'Acme', slug: 'acme' });
	const other = await bea.client.organization.create({ name: 'Other', slug: 'other' });
	const acmeId = acme.data?.id ?? '';
	const otherId = other.data?.id ?? '';
	// Bea's active organization is now Other; nothing the adapter does may read it.
	const orgA = ada.adapter.organization;
	const orgB = bea.adapter.organization;
	if (!orgA || !orgB) throw new Error('Expected organization access');

	expect(await orgA.membership(acmeId)).toEqual({ role: 'owner' });
	expect(await orgB.membership(acmeId)).toBeNull();
	expect(await orgA.membership(otherId)).toBeNull();
	await expect(orgB.membership('')).rejects.toThrow(TypeError);
	await expect(orgB.listMembers('')).rejects.toThrow(TypeError);

	const invitation = await orgA.invite(acmeId, { email: 'bea@example.test', role: 'member' });
	expect(invitation).toMatchObject({ organizationId: acmeId, status: 'pending', role: 'member' });
	expect((await orgA.listInvitations(acmeId)).map((i) => i.id)).toEqual([invitation.id]);
	// An invitation of Acme cannot be cancelled in the name of another organization.
	await expect(orgB.cancelInvitation(otherId, invitation.id)).rejects.toMatchObject({
		code: 'PROVIDER_ERROR',
	});
	expect((await orgB.listOwnInvitations()).map((i) => i.id)).toEqual([invitation.id]);
	await orgB.acceptInvitation(invitation.id);
	expect(await orgB.membership(acmeId)).toEqual({ role: 'member' });

	const members = await orgA.listMembers(acmeId);
	expect(members.map((member) => [member.user.email, member.role]).sort()).toEqual([
		['ada@example.test', 'owner'],
		['bea@example.test', 'member'],
	]);
	expect(await orgA.listMembers(acmeId, { limit: 1 })).toHaveLength(1);
	const beaMember = members.find((member) => member.user.email === 'bea@example.test');
	await orgA.setRole(acmeId, beaMember?.id ?? '', 'admin');
	expect(await orgB.membership(acmeId)).toEqual({ role: 'admin' });
	// The last owner cannot leave: Better Auth's own error, as PROVIDER_ERROR.
	await expect(orgA.leave(acmeId)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
	await orgB.leave(acmeId);
	expect(await orgB.membership(acmeId)).toBeNull();

	const second = await orgA.invite(acmeId, { email: 'bea@example.test', role: 'member' });
	await orgB.rejectInvitation(second.id);
	const third = await orgA.invite(acmeId, { email: 'cy@example.test', role: 'member' });
	await orgA.cancelInvitation(acmeId, third.id);
	expect(
		(await orgA.listInvitations(acmeId))
			.map((i) => [i.id, i.status])
			.filter(([id]) => id !== invitation.id)
	).toEqual([
		[second.id, 'rejected'],
		[third.id, 'canceled'],
	]);
}, 20_000);

it('lists, renames and removes passkeys at the provider; WebAuthn-less is unsupported', async () => {
	const { baseURL, database } = await startProvider();
	const ada = signedInClient(baseURL, CHROME_MAC);
	await ada.client.signUp.email({
		email: 'ada@example.test',
		password: 'pw-ada-123456',
		name: 'Ada',
	});
	await settle(ada.adapter, 'authenticated');
	const bea = signedInClient(baseURL, CHROME_MAC);
	await bea.client.signUp.email({
		email: 'bea@example.test',
		password: 'pw-bea-123456',
		name: 'Bea',
	});
	await settle(bea.adapter, 'authenticated');
	const userId = (email: string) => String(database.user?.find((u) => u.email === email)?.id);
	const seed = (id: string, owner: string) =>
		database.passkey?.push({
			id,
			name: 'Laptop',
			publicKey: 'public-key',
			userId: userId(owner),
			credentialID: `credential-${id}`,
			counter: 0,
			deviceType: 'multiDevice',
			backedUp: true,
			transports: 'internal',
			createdAt: new Date('2026-11-09T00:00:00Z'),
		});
	seed('pk-ada', 'ada@example.test');
	seed('pk-bea', 'bea@example.test');

	const passkeys = ada.adapter.passkeys;
	if (!passkeys) throw new Error('Expected passkeys');
	expect(await passkeys.listPasskeys()).toEqual([
		{
			id: 'pk-ada',
			name: 'Laptop',
			createdAt: new Date('2026-11-09T00:00:00Z'),
			deviceType: 'multiDevice',
			backedUp: true,
		},
	]);
	await passkeys.renamePasskey('pk-ada', 'Work laptop');
	expect((await passkeys.listPasskeys())[0]?.name).toBe('Work laptop');
	// Another person's passkey is refused by the provider.
	await expect(passkeys.renamePasskey('pk-bea', 'Mine')).rejects.toMatchObject({
		code: 'PROVIDER_ERROR',
	});
	await expect(passkeys.removePasskey('pk-bea')).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
	await passkeys.removePasskey('pk-ada');
	expect(await passkeys.listPasskeys()).toEqual([]);
	expect(database.passkey?.map((row) => row.id)).toEqual(['pk-bea']);

	await expect(passkeys.addPasskey({ name: 'Phone' })).rejects.toMatchObject({
		code: 'PASSKEY_UNSUPPORTED',
	});
	await expect(ada.adapter.signIn({ method: 'passkey' })).rejects.toMatchObject({
		code: 'PASSKEY_UNSUPPORTED',
	});
}, 20_000);

it('refresh() rejects with NETWORK_ERROR when the provider is unreachable, keeping the session', async () => {
	const { baseURL, stop } = await startProvider();
	const ada = signedInClient(baseURL, CHROME_MAC);
	await ada.client.signUp.email({
		email: 'ada@example.test',
		password: 'pw-ada-123456',
		name: 'Ada',
	});
	await settle(ada.adapter, 'authenticated');
	await expect(ada.adapter.refresh()).resolves.toBeUndefined();

	await stop();
	// Better Auth's refetch resolves here and keeps the stale session; refresh() must not.
	await expect(ada.client.useSession.get().refetch()).resolves.toBeUndefined();
	await expect(ada.adapter.refresh()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
	expect(ada.adapter.getSession().status).toBe('authenticated');
}, 20_000);
