/**
 * P3-E20's provider half (phase 3 specification, 9.4): the authorization server `createLoamAuthOptions` configures, by
 * direct requests against a real Better Auth 1.7.18 provider. PKCE for every client, no `client_credentials`, no skipped
 * consent, no client registered from a page, a denial answered `access_denied`, and the authorize endpoint sending a
 * person to Loam's login page signed out and to its consent page signed in. The pages themselves are Chromium's
 * (`web/test/browser/identity/oauth.test.ts`).
 */

import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DISCOVERY_TOOLS, loamScopes } from './mcp.js';
import { ACCESS_TOKEN_SECONDS, OAUTH_DISABLED_PATHS } from './oauth.js';
import { recoverPerson } from './recovery.js';
import { createTestProvider } from './testing/provider.js';
import { TestBrowser } from './testing/requests.js';

const ORIGIN = 'https://acme.example';
const ISSUER = `${ORIGIN}/api/auth`;
const RESOURCE = `${ORIGIN}/mcp`;
const REDIRECT = 'http://127.0.0.1:43124/callback';
const PASSWORD = 'correct horse battery staple';
const database = new DatabaseSync(':memory:');
let provider: Awaited<ReturnType<typeof createTestProvider>>;
let clientId: string;

interface ProviderAnswer {
	client_id: string;
}
const admin = () =>
	(
		provider.auth.api as unknown as Record<
			'adminCreateOAuthClient',
			(input: unknown) => Promise<ProviderAnswer>
		>
	).adminCreateOAuthClient;

async function as(email: string): Promise<TestBrowser> {
	const page = new TestBrowser((request) => provider.auth.handler(request), ORIGIN);
	expect((await page.signIn(email, PASSWORD)).status).toBe(200);
	return page;
}

const NATIVE = {
	redirect_uris: [REDIRECT],
	token_endpoint_auth_method: 'none',
	application_type: 'native',
	grant_types: ['authorization_code', 'refresh_token'],
	response_types: ['code'],
};

const authorizeQuery = (extra: Record<string, string> = {}) => {
	const verifier = randomBytes(32).toString('base64url');
	return {
		verifier,
		query: new URLSearchParams({
			response_type: 'code',
			client_id: clientId,
			redirect_uri: REDIRECT,
			scope: 'loam:read loam:write',
			state: 's',
			code_challenge: createHash('sha256').update(verifier).digest('base64url'),
			code_challenge_method: 'S256',
			resource: RESOURCE,
			...extra,
		}),
	};
};

beforeAll(async () => {
	provider = await createTestProvider({
		baseURL: ISSUER,
		secret: 'a'.repeat(32),
		database,
		workspace: 'acme',
		organization: { slug: 'acme', name: 'Acme' },
		people: [
			{ email: 'olu@example.com', name: 'Olu', role: 'owner', password: PASSWORD },
			{ email: 'bea@example.com', name: 'Bea', role: 'member', password: PASSWORD },
			{ email: 'cy@example.com', name: 'Cy', role: 'member', password: PASSWORD },
		],
		methods: ['passkey', 'password'],
		send: async () => {},
	});
	const owner = await as('olu@example.com');
	clientId = (
		await admin()({
			headers: new Headers({ cookie: owner.cookie }),
			body: { client_name: 'Claude Code', ...NATIVE },
		})
	).client_id;
});
afterAll(() => database.close());

describe('P3-E20: the authorization server (9.4)', () => {
	it('P3-E20: a signed-out person is sent to the login page with the signed request, a signed-in one to the consent page', async () => {
		const signedOut = new TestBrowser((request) => provider.auth.handler(request), ORIGIN);
		const { query } = authorizeQuery();
		const login = new URL(
			(await signedOut.call(`/oauth2/authorize?${query}`)).headers.get('location') ?? '',
			ORIGIN
		);
		expect(`${login.origin}${login.pathname}`).toBe(`${ORIGIN}/~/oauth/login`);
		expect(login.searchParams.get('sig')).toBeTruthy();
		const bea = await as('bea@example.com');
		const consent = new URL(
			(await bea.call(`/oauth2/authorize?${query}`)).headers.get('location') ?? '',
			ORIGIN
		);
		expect(`${consent.origin}${consent.pathname}`).toBe(`${ORIGIN}/~/oauth/consent`);
		expect(consent.searchParams.get('client_id')).toBe(clientId);
	});

	it('P3-E20: Deny answers `access_denied` to the client, and connects nothing', async () => {
		const bea = await as('bea@example.com');
		const { query } = authorizeQuery();
		const location = new URL(
			(await bea.call(`/oauth2/authorize?${query}`)).headers.get('location') ?? '',
			ORIGIN
		);
		const denied = await bea.call('/oauth2/consent', {
			body: { accept: false, oauth_query: location.search.slice(1) },
		});
		const back = new URL((denied.body as { url: string }).url);
		expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
		expect(back.searchParams.get('error')).toBe('access_denied');
		expect(database.prepare('SELECT * FROM loam_connected_agent').all()).toEqual([]);
	});

	it('P3-E20: a request without PKCE is refused, for a public client and a confidential one', async () => {
		const bea = await as('bea@example.com');
		const owner = await as('olu@example.com');
		const confidential = (
			await admin()({
				headers: new Headers({ cookie: owner.cookie }),
				body: {
					client_name: 'Confidential',
					redirect_uris: ['https://app.example/callback'],
					token_endpoint_auth_method: 'client_secret_basic',
					grant_types: ['authorization_code'],
					response_types: ['code'],
				},
			})
		).client_id;
		for (const client of [clientId, confidential]) {
			const query = new URLSearchParams({
				response_type: 'code',
				client_id: client,
				redirect_uri: client === clientId ? REDIRECT : 'https://app.example/callback',
				scope: 'loam:read',
				state: 's',
				resource: RESOURCE,
			});
			const answered = await bea.call(`/oauth2/authorize?${query}`);
			const location = answered.headers.get('location') ?? '';
			expect(location, client).not.toContain('/~/oauth/consent');
			expect(`${location} ${JSON.stringify(answered.body)}`).toMatch(/pkce|invalid_request/i);
		}
	});

	it('P3-E20: a client registering `require_pkce: false` or `skip_consent` is refused, the admin route included', async () => {
		const owner = await as('olu@example.com');
		for (const extra of [{ require_pkce: false }, { skip_consent: true }]) {
			await expect(
				admin()({
					headers: new Headers({ cookie: owner.cookie }),
					body: { client_name: 'Lax', ...NATIVE, ...extra },
				})
			).rejects.toThrow();
		}
	});

	it('P3-E20: `client_credentials` is refused, so every token has a person', async () => {
		const answer = await provider.auth.handler(
			new Request(`${ISSUER}/oauth2/token`, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					grant_type: 'client_credentials',
					client_id: clientId,
					scope: 'loam:read',
					resource: RESOURCE,
				}),
			})
		);
		expect(answer.status).toBeGreaterThanOrEqual(400);
		expect(JSON.stringify(await answer.json())).toMatch(
			/unsupported_grant_type|unauthorized_client|invalid/
		);
	});

	it('P3-E20: no person registers or changes a client from a page, and a non-owner cannot pre-register one', async () => {
		const bea = await as('bea@example.com');
		for (const path of OAUTH_DISABLED_PATHS) {
			expect(
				(await bea.call(path, { body: { client_name: 'Mine', ...NATIVE } })).status,
				path
			).toBe(404);
		}
		expect(
			(await bea.call('/oauth2/register', { body: { client_name: 'Mine', ...NATIVE } })).status
		).toBeGreaterThanOrEqual(400);
		await expect(
			admin()({
				headers: new Headers({ cookie: bea.cookie }),
				body: { client_name: 'Mine', ...NATIVE },
			})
		).rejects.toThrow();
	});

	it('P3-E20: an access token lives 10 minutes and is bound to the one resource', async () => {
		const bea = await as('bea@example.com');
		const { query, verifier } = authorizeQuery();
		const location = new URL(
			(await bea.call(`/oauth2/authorize?${query}`)).headers.get('location') ?? '',
			ORIGIN
		);
		const consent = location.href.startsWith(REDIRECT)
			? location.href
			: (
					(
						await bea.call('/oauth2/consent', {
							body: { accept: true, oauth_query: location.search.slice(1) },
						})
					).body as { url: string }
				).url;
		const code = new URL(consent).searchParams.get('code') as string;
		const exchanged = (await (
			await provider.auth.handler(
				new Request(`${ISSUER}/oauth2/token`, {
					method: 'POST',
					headers: { 'content-type': 'application/x-www-form-urlencoded' },
					body: new URLSearchParams({
						grant_type: 'authorization_code',
						code,
						redirect_uri: REDIRECT,
						client_id: clientId,
						code_verifier: verifier,
						resource: RESOURCE,
					}),
				})
			)
		).json()) as { access_token: string };
		const claims = JSON.parse(
			Buffer.from(exchanged.access_token.split('.')[1] as string, 'base64url').toString()
		) as { aud: string; iss: string; exp: number; iat: number };
		expect(claims.aud).toBe(RESOURCE);
		expect(claims.iss).toBe(ISSUER);
		expect(claims.exp - claims.iat).toBe(ACCESS_TOKEN_SECONDS);
	});
});

describe("Step 4's follow-up: a person's connections end with `revoke-person all` and with recovery (4.6, 5.7)", () => {
	/** Connect Bea's agent with a refresh token, through the consent page's approval. */
	async function connected(): Promise<void> {
		const bea = await as('bea@example.com');
		const { query, verifier } = authorizeQuery({ scope: 'loam:read loam:write offline_access' });
		const location = new URL(
			(await bea.call(`/oauth2/authorize?${query}`)).headers.get('location') ?? '',
			ORIGIN
		);
		const url = location.href.startsWith(REDIRECT)
			? location.href
			: (
					(
						await bea.call('/oauth2/consent', {
							body: { accept: true, oauth_query: location.search.slice(1) },
						})
					).body as { url: string }
				).url;
		await provider.auth.handler(
			new Request(`${ISSUER}/oauth2/token`, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					grant_type: 'authorization_code',
					code: new URL(url).searchParams.get('code') as string,
					redirect_uri: REDIRECT,
					client_id: clientId,
					code_verifier: verifier,
					resource: RESOURCE,
				}),
			})
		);
	}
	const bea = () => provider.people['bea@example.com'] as string;
	const consents = () => database.prepare('SELECT * FROM oauthConsent WHERE userId = ?').all(bea());
	const live = () =>
		database
			.prepare('SELECT * FROM oauthRefreshToken WHERE userId = ? AND revoked IS NULL')
			.all(bea());

	it("P3-E3: at the provider, `revoke-person all` deletes the person's consents, revokes their refresh tokens and suspends their agents", async () => {
		await connected();
		expect(consents().length).toBeGreaterThan(0);
		expect(live().length).toBeGreaterThan(0);
		const page = await as('bea@example.com');
		expect((await page.call('/loam/revoke-person', { body: { target: 'all' } })).status).toBe(200);
		expect(consents()).toEqual([]);
		expect(live()).toEqual([]);
		// The record stays, suspended (4.3): the person's own next approval makes it active again.
		const row = database
			.prepare('SELECT status, suspended FROM loam_connected_agent WHERE sponsor = ?')
			.get(bea()) as { status: string; suspended: string };
		expect(row).toEqual({ status: 'suspended', suspended: 'disconnected' });
	});

	it("P3-E18: at the provider, recovery suspends the person's connected agents and ends their connections", async () => {
		await connected();
		const context = (await provider.auth.$context) as unknown as { adapter: never };
		await recoverPerson(context.adapter, bea());
		expect(consents()).toEqual([]);
		expect(live()).toEqual([]);
		const row = database
			.prepare('SELECT status, suspended FROM loam_connected_agent WHERE sponsor = ?')
			.get(bea()) as { status: string; suspended: string };
		expect(row).toEqual({ status: 'suspended', suspended: 'disconnected' });
		// The person may reconnect it: their own approval makes it active again.
		await connected();
		expect(
			(
				database
					.prepare('SELECT status FROM loam_connected_agent WHERE sponsor = ?')
					.get(bea()) as {
					status: string;
				}
			).status
		).toBe('active');
	});
});

describe("The reviews' fixes: what ends a connection, and what never makes one (4.3, 7.5, 9.2)", () => {
	/** Connect `email`'s agent with a refresh token, through the consent page's approval. */
	async function connect(
		email: string,
		scope = 'loam:read loam:write offline_access'
	): Promise<TestBrowser> {
		const page = await as(email);
		const { query, verifier } = authorizeQuery({ scope });
		const location = new URL(
			(await page.call(`/oauth2/authorize?${query}`)).headers.get('location') ?? '',
			ORIGIN
		);
		const url = location.href.startsWith(REDIRECT)
			? location.href
			: (
					(
						await page.call('/oauth2/consent', {
							body: { accept: true, oauth_query: location.search.slice(1) },
						})
					).body as { url: string }
				).url;
		await provider.auth.handler(
			new Request(`${ISSUER}/oauth2/token`, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					grant_type: 'authorization_code',
					code: new URL(url).searchParams.get('code') as string,
					redirect_uri: REDIRECT,
					client_id: clientId,
					code_verifier: verifier,
					resource: RESOURCE,
				}),
			})
		);
		return page;
	}
	const of = (email: string) => provider.people[email] as string;
	const live = (email: string) =>
		database
			.prepare('SELECT * FROM oauthRefreshToken WHERE userId = ? AND revoked IS NULL')
			.all(of(email));
	const status = (email: string) =>
		database
			.prepare('SELECT status, suspended FROM loam_connected_agent WHERE sponsor = ?')
			.get(of(email)) as { status: string; suspended: string | null } | undefined;

	it("`revoke-person others` ends the person's grants and suspends their connected agents, as `all` does (4.3)", async () => {
		const page = await connect('bea@example.com');
		expect(live('bea@example.com').length).toBeGreaterThan(0);
		expect((await page.call('/loam/revoke-person', { body: { target: 'others' } })).status).toBe(
			200
		);
		expect(live('bea@example.com')).toEqual([]);
		expect(status('bea@example.com')).toEqual({ status: 'suspended', suspended: 'disconnected' });
		// Their own approval lifts it.
		await connect('bea@example.com');
		expect(status('bea@example.com')?.status).toBe('active');
	});

	it("a member's removal ends their grants and suspends their connected agents (7.5)", async () => {
		await connect('cy@example.com');
		expect(live('cy@example.com').length).toBeGreaterThan(0);
		const owner = await as('olu@example.com');
		const member = database
			.prepare('SELECT id FROM member WHERE userId = ?')
			.get(of('cy@example.com')) as { id: string };
		const removed = await owner.call('/organization/remove-member', {
			body: { memberIdOrEmail: member.id, organizationId: provider.organizationId },
		});
		expect(removed.status).toBe(200);
		expect(live('cy@example.com')).toEqual([]);
		expect(status('cy@example.com')).toEqual({ status: 'suspended', suspended: 'disconnected' });
	});

	it('a consent the provider refuses (a scope the client never asked for) connects nothing', async () => {
		database.prepare('DELETE FROM loam_connected_agent').run();
		database.prepare('DELETE FROM oauthConsent').run();
		const page = await as('olu@example.com');
		const { query } = authorizeQuery({ scope: 'loam:read' });
		const location = new URL(
			(await page.call(`/oauth2/authorize?${query}`)).headers.get('location') ?? '',
			ORIGIN
		);
		const answered = await page.call('/oauth2/consent', {
			body: { accept: true, scope: 'loam:read loam:write', oauth_query: location.search.slice(1) },
		});
		expect(answered.status).toBeGreaterThanOrEqual(400);
		expect(database.prepare('SELECT * FROM loam_connected_agent').all()).toEqual([]);
	});

	it("9.3's resolver: only AFD's discovery tools are reads outside the registry", () => {
		const resolver = loamScopes((name) => (name === 'project-list' ? false : undefined));
		const reader = { scopes: ['loam:read'] } as never;
		expect(resolver.resolve('project-list', {}, reader)).toBe('allowed');
		for (const tool of DISCOVERY_TOOLS) expect(resolver.resolve(tool, {}, reader)).toBe('allowed');
		for (const name of ['afd-call', 'afd-anything', 'mounted-write'])
			expect(resolver.resolve(name, {}, reader)).toEqual({ missing: ['loam:write'] });
	});
});
