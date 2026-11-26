/**
 * The authorization server's two test-only options (phase 3 specification, step 10; phase 6's step 4 follow-up):
 * `otherResources`, for P3-H1's token for another audience from the profile's own provider, and `accessTokenSeconds`,
 * for P3-H4's last access token refused once it expires. Neither may loosen anything: another resource is never the one
 * resource, and a lifetime is never longer than 10 minutes.
 */

import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCESS_TOKEN_SECONDS, accessTokenSecondsOf, oauthResources } from './oauth.js';
import { createTestProvider } from './testing/provider.js';
import { TestBrowser } from './testing/requests.js';

const ORIGIN = 'https://acme.example';
const ISSUER = `${ORIGIN}/api/auth`;
const RESOURCE = `${ORIGIN}/mcp`;
const OTHER = 'https://other.example/mcp';
const REDIRECT = 'http://127.0.0.1:43125/callback';
const PASSWORD = 'correct horse battery staple';
const SECONDS = 7;
const database = new DatabaseSync(':memory:');
let provider: Awaited<ReturnType<typeof createTestProvider>>;
let clientId: string;

async function as(email: string): Promise<TestBrowser> {
	const page = new TestBrowser((request) => provider.auth.handler(request), ORIGIN);
	expect((await page.signIn(email, PASSWORD)).status).toBe(200);
	return page;
}

/** The code flow for `resource`, approved on the consent route: the token endpoint's answer, as JSON. */
async function tokenFor(resource: string): Promise<{ access_token?: string; error?: string }> {
	const bea = await as('bea@example.com');
	const verifier = randomBytes(32).toString('base64url');
	const query = new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: REDIRECT,
		scope: 'loam:read loam:write',
		state: 's',
		code_challenge: createHash('sha256').update(verifier).digest('base64url'),
		code_challenge_method: 'S256',
		resource,
	});
	const authorized = await bea.call(`/oauth2/authorize?${query}`);
	const location = new URL(authorized.headers.get('location') ?? '', ORIGIN);
	const redirect = location.href.startsWith(REDIRECT)
		? location.href
		: (
				(
					await bea.call('/oauth2/consent', {
						body: { accept: true, oauth_query: location.search.slice(1) },
					})
				).body as { url?: string }
			).url;
	const code = redirect ? new URL(redirect).searchParams.get('code') : null;
	if (!code) return { error: `no code: ${redirect ?? authorized.status}` };
	return (await (
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
					resource,
				}),
			})
		)
	).json()) as { access_token?: string; error?: string };
}

const claimsOf = (token: string) =>
	JSON.parse(Buffer.from(token.split('.')[1] as string, 'base64url').toString()) as {
		aud: string;
		exp: number;
		iat: number;
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
		],
		methods: ['passkey', 'password'],
		send: async () => {},
		oauth: { resource: RESOURCE, otherResources: [OTHER], accessTokenSeconds: SECONDS },
	});
	const owner = await as('olu@example.com');
	const admin = (
		provider.auth.api as unknown as Record<
			'adminCreateOAuthClient',
			(input: unknown) => Promise<{ client_id: string }>
		>
	).adminCreateOAuthClient;
	clientId = (
		await admin({
			headers: new Headers({ cookie: owner.cookie }),
			body: {
				client_name: 'P3-H1 agent',
				redirect_uris: [REDIRECT],
				token_endpoint_auth_method: 'none',
				application_type: 'native',
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
			},
		})
	).client_id;
});
afterAll(() => database.close());

describe("The authorization server's test-only options (step 10)", () => {
	it('issues a token for another configured resource, its audience that resource, at the shorter lifetime', async () => {
		const other = await tokenFor(OTHER);
		expect(other.access_token, JSON.stringify(other)).toBeTypeOf('string');
		const claims = claimsOf(other.access_token as string);
		expect(claims.aud).toBe(OTHER);
		expect(claims.exp - claims.iat).toBe(SECONDS);
	});

	it('still issues the one resource its own token, at the shorter lifetime', async () => {
		const own = await tokenFor(RESOURCE);
		const claims = claimsOf(own.access_token as string);
		expect(claims.aud).toBe(RESOURCE);
		expect(claims.exp - claims.iat).toBe(SECONDS);
	});

	it('refuses a resource that is not configured', async () => {
		const refused = await tokenFor('https://third.example/mcp');
		expect(refused.access_token).toBeUndefined();
	});

	it('takes the other resources only as absolute URIs other than the one, each once', () => {
		expect(oauthResources(RESOURCE, {})).toEqual([RESOURCE]);
		expect(oauthResources(RESOURCE, { otherResources: [OTHER] })).toEqual([RESOURCE, OTHER]);
		expect(() => oauthResources(RESOURCE, { otherResources: [RESOURCE] })).toThrow(
			'other than `resource`'
		);
		expect(() => oauthResources(RESOURCE, { otherResources: ['other/mcp'] })).toThrow(
			'absolute URI'
		);
		expect(() => oauthResources(RESOURCE, { otherResources: [OTHER, OTHER] })).toThrow('twice');
	});

	it('takes a lifetime only as a whole number of seconds, never longer than 10 minutes', () => {
		expect(accessTokenSecondsOf({})).toBe(ACCESS_TOKEN_SECONDS);
		expect(accessTokenSecondsOf({ accessTokenSeconds: 1 })).toBe(1);
		expect(accessTokenSecondsOf({ accessTokenSeconds: ACCESS_TOKEN_SECONDS })).toBe(
			ACCESS_TOKEN_SECONDS
		);
		for (const seconds of [0, -1, 1.5, ACCESS_TOKEN_SECONDS + 1, Number.NaN])
			expect(() => accessTokenSecondsOf({ accessTokenSeconds: seconds }), String(seconds)).toThrow(
				'whole number'
			);
	});
});
