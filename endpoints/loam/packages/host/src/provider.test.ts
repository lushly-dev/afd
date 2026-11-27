/**
 * The provider mounted in `loam-host` (phase 6 specification, 3.7; phase 3's 2.6 and 5.8), proved by direct requests
 * against the real host, over TLS, on the development profile in this process, never against mocks: every route the
 * mounted instance serves is 5.8's, each route 5.8 does not serve answers 404, the origin and CSRF checks refuse a
 * foreign `Origin`, the session cookie is host-only, A7's address header comes from the socket alone, and the
 * provider's answers are `no-store`. Bootstrap and `start`'s refusals are here too (3.1, 3.7, D95).
 */

import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LOAM_DISABLED_PATHS } from '@lushly-dev/loam-identity';
import { seedTestPeople, TEST_RATE_LIMIT } from '@lushly-dev/loam-identity/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	runBootstrap as rawRunBootstrap,
	withBootstrapProvider as rawWithBootstrapProvider,
} from './bootstrap.js';
import { environmentFindings } from './check.js';
import { runHostCli as rawRunHostCli } from './cli.js';
import { type DevProfile, runDev as rawRunDev } from './dev.js';
import { CLIENT_ADDRESS_HEADER, setClientAddress } from './gate.js';
import { INERT_POLICY } from './headers.js';
import { createLoamHost } from './host.js';
import { HOST_INTERNALS } from './internal.js';
import { AUTH_DATABASE } from './provider.js';
import {
	deploymentFile,
	expectMode,
	fixtureDist,
	type RawAnswer,
	raw,
	temporaryDirectory,
} from './test-support.js';
import { providerOf } from './testing-only.js';

const PROVIDER =
	'[workspace]\nid = "acme"\n\n[identity]\nmode = "provider"\norganization = "acme"\nmethods = ["passkey", "password"]\n\n';
const PASSWORD = 'correct horse battery staple';
const running: DevProfile[] = [];
/**
 * Tracks every lock-acquiring helper call so `afterEach` can settle in-flight operations and reject any
 * continuation a timed-out test attempts after teardown begins, before `rm` runs on Windows (#2760).
 */
function createTeardownTracker() {
	const inFlight: Promise<unknown>[] = [];
	let closed = false;
	return {
		reset() {
			closed = false;
		},
		run<T>(start: () => Promise<T>): Promise<T> {
			if (closed) return Promise.reject(new Error('test teardown already started'));
			const promise = start();
			inFlight.push(
				promise.then(
					() => undefined,
					() => undefined
				)
			);
			return promise;
		},
		async drain(closeRunning: () => Promise<void>): Promise<void> {
			closed = true;
			while (inFlight.length > 0 || running.length > 0) {
				await Promise.allSettled(inFlight.splice(0));
				await closeRunning();
			}
		},
	};
}

const tracker = createTeardownTracker();
const runBootstrap: typeof rawRunBootstrap = (...args) =>
	tracker.run(() => rawRunBootstrap(...args));
const withBootstrapProvider: typeof rawWithBootstrapProvider = (...args) =>
	tracker.run(() => rawWithBootstrapProvider(...args));
const runHostCli: typeof rawRunHostCli = (...args) => tracker.run(() => rawRunHostCli(...args));
const runDev: typeof rawRunDev = (...args) => tracker.run(() => rawRunDev(...args));

beforeEach(() => {
	tracker.reset();
});

afterEach(async () => {
	await tracker.drain(async () => {
		await Promise.all(running.splice(0).map((profile) => profile.host.close()));
	});
});

async function setup(body = PROVIDER) {
	const root = await temporaryDirectory();
	const deployment = await deploymentFile(root, body);
	return { root, deployment, dist: await fixtureDist(root), data: join(root, '.loam-dev') };
}

/** Bootstraps the profile's organization and seeds a member who signs in with a password, as `startDevHost` does. */
async function bootstrapped(deployment: string) {
	const report = await runBootstrap({
		form: 'dev',
		deployment,
		slug: 'acme',
		name: 'Acme',
		ownerEmail: 'first@acme.example',
	});
	await withBootstrapProvider({ form: 'dev', deployment }, ({ provider }) =>
		seedTestPeople(provider.auth, report.organization.id, [
			{ email: 'bea@acme.example', name: 'Bea', role: 'member', password: PASSWORD },
		])
	);
	return report;
}

/**
 * Better Auth's limiter keeps one in-memory store per process, shared by every provider these units start, so each
 * profile raises the limit explicitly, as a test may (never turning it off); the limit's own test passes `null`.
 */
async function dev(
	deployment: string,
	dist: string,
	rateLimit: { window: number; max: number } | null = TEST_RATE_LIMIT
): Promise<DevProfile> {
	return await tracker.run(async () => {
		const profile = await rawRunDev({ deployment, dist, ...(rateLimit ? { rateLimit } : {}) });
		running.push(profile);
		return profile;
	});
}

/** One request to the profile over TLS, with its own `Host`, its `Origin` unless told otherwise. */
function call(
	profile: DevProfile,
	path: string,
	options: { method?: string; json?: unknown; headers?: Record<string, string> } = {}
): Promise<RawAnswer> {
	const url = new URL(profile.origin);
	return raw(Number(url.port), path, {
		tls: true,
		host: url.host,
		method: options.method ?? (options.json === undefined ? 'GET' : 'POST'),
		headers: { origin: profile.origin, ...options.headers },
		...(options.json === undefined ? {} : { json: options.json }),
	});
}

const cookiesOf = (answer: RawAnswer): string[] => answer.headers['set-cookie'] ?? [];
const cookieHeader = (answer: RawAnswer): string =>
	cookiesOf(answer)
		.map((cookie) => cookie.split(';')[0])
		.join('; ');

async function signIn(profile: DevProfile, headers: Record<string, string> = {}) {
	const answer = await call(profile, '/api/auth/sign-in/email', {
		json: { email: 'bea@acme.example', password: PASSWORD },
		headers,
	});
	expect(answer.status, answer.body).toBe(200);
	return answer;
}

/**
 * Every route Better Auth 1.7.18 builds from `createLoamAuthOptions`, by 5.8's account: served, each with its reason;
 * and not served (`LOAM_DISABLED_PATHS`). `/loam/*` is Loam's own, each route with the section that holds it.
 */
const SERVED: Record<string, string> = {
	'/get-session': "the client's session read, without `session.token`",
	'/sign-in/email': 'a password sign-in, refused when `methods` lacks `password`',
	'/sign-in/social': 'single sign-on, refused with no `oidc:` method',
	'/callback/:id':
		"single sign-on's callback; the one path a first OIDC sign-in creates a user on (5.6)",
	'/sign-out': 'needs nothing',
	'/passkey/generate-authenticate-options': 'passkey sign-in',
	'/passkey/verify-authentication': 'passkey sign-in',
	'/passkey/generate-register-options': "5.8's rows, by Loam's before-hook",
	'/passkey/verify-registration': "5.8's rows, again in `afterVerification`",
	'/passkey/delete-passkey': "5.8's first row's freshness and passkey rule",
	'/passkey/list-user-passkeys': "one's own passkeys",
	'/passkey/update-passkey': 'a rename, which changes no credential',
	'/send-verification-email': 'invitations need a verified email',
	'/verify-email': 'invitations need a verified email',
	'/update-user': 'name and image (5.4); email change is off',
	'/ok': 'a health answer, no session',
	'/error': "Better Auth's error page, no session",
	'/loam/whoami': '4.2: the session and the membership of the bound organization',
	'/loam/binding': '2.3: the binding, to an owner alone',
	'/loam/leave':
		"phase 6's S4: the session's person leaves on removal's path, the last owner refused",
	'/loam/sessions': '4.6: the sessions by handle',
	'/loam/revoke-person': "4.6: freshness for any session but the caller's own",
	'/loam/join/check': '5.6: the invitation, to the link holder',
	'/loam/join/name': "5.6: the joining person's name, checked as the token is",
	'/loam/join/password': '5.6: join with a password where `methods` allows one',
	'/loam/recover/request': '5.7: the same answer after the same delay',
	'/loam/recover/check': '5.7',
	'/loam/recover/password': '5.7: the recovery transaction',
	'/loam/recover/oidc/start': "5.7: single sign-on's ceremony",
	'/loam/recover/oidc/complete': "5.7: single sign-on's ceremony",
	'/loam/account': "5.1: the person's own account",
	'/loam/members': '7.2: emails to an owner only',
	'/loam/invitations': "5.3: the person's own",
	'/organization/create': '7.5: refused',
	'/organization/update': '7.5: refused',
	'/organization/delete': '7.5: refused',
	'/organization/invite-member': "7.5: owners'",
	'/organization/update-member-role': "7.5: owners'; the last owner",
	'/organization/remove-member': "7.5: owners'; the last owner",
	'/organization/accept-invitation': "Better Auth's: the invitee, verified",
	'/organization/reject-invitation': "Better Auth's: the invitee only",
	'/organization/cancel-invitation': "Better Auth's: the invitation permission",
	'/organization/get-organization': "Better Auth's: a member only",
	'/organization/get-active-member': "Better Auth's: the caller's own",
	'/organization/get-active-member-role': "Better Auth's: the caller's own",
	'/organization/get-invitation': "Better Auth's: the invitee only",
	'/organization/list': "Better Auth's: the caller's own",
	'/organization/list-invitations': "Better Auth's: owners'",
	'/organization/list-user-invitations': "Better Auth's: the caller's own",
	'/organization/has-permission': "Better Auth's: the caller's own role",
	'/organization/check-slug': "Better Auth's: whether a slug is taken",
	// Step 7's authorization server (9.4) and connected agents (9.2).
	'/.well-known/oauth-authorization-server': "RFC 8414's metadata: public, no session",
	'/jwks': "the signing keys' public halves, which the MCP verifier reads",
	'/oauth2/authorize':
		'9.4: to the login page signed out, to the consent page signed in; PKCE for every client',
	'/oauth2/consent':
		"9.4: the person's approval; Loam's hooks refuse a non-member and an owner's removal",
	'/oauth2/continue': "9.4: a session's continuation of the signed request",
	'/oauth2/token': "9.4: `authorization_code` and `refresh_token` only; PKCE's verifier",
	'/oauth2/introspect': "a client's own token, by the client's authentication",
	'/oauth2/revoke': "a client's own token, by the client's authentication",
	'/oauth2/userinfo': "a token's subject; no profile or email scope is served (9.3)",
	'/oauth2/end-session': "RP-initiated sign-out, by the client's ID token",
	'/oauth2/end-session/confirm': "RP-initiated sign-out's confirmation, by the session",
	'/oauth2/register': '9.4: dynamic registration, refused unless the deployer turns it on',
	'/oauth2/public-client': "a client's public name, to a session: the consent page's",
	'/oauth2/public-client-prelogin': "a client's public name before sign-in, by the signed request",
	'/oauth2/get-client': "a client's public fields, to a session",
	'/oauth2/get-clients':
		"the clients a session's person registered: none, since no page registers one",
	'/oauth2/get-consent': "the person's own consent",
	'/oauth2/get-consents': "the person's own consents",
	'/loam/connected-agents':
		"9.2: the workspace's connected agents, to a member; scopes only for their own",
	'/loam/connected-agents/disconnect': "5.3: the sponsor's own, never one an owner removed",
	'/loam/connected-agents/remove': "9.2: an owner's, kept `suspended: 'owner'` or forgotten",
};

/**
 * The authorization server's admin routes (9.4): `SERVER_ONLY`, so the deployer's pre-registration through the server
 * API reaches them, by an owner's session, and no HTTP request does.
 */
const SERVER_ONLY = [
	// Not an admin route, but answered 404 by the provider itself: no `openid` scope is served (9.3), so it is no OpenID
	// provider, only an OAuth one.
	'/.well-known/openid-configuration',
	'/admin/oauth2/create-client',
	'/admin/oauth2/update-client',
	'/admin/oauth2/resources',
	'/admin/oauth2/resources/:identifier',
	'/admin/oauth2/resources/:identifier/clients/:client_id',
];

/**
 * 5.8's routes that are not served and that this instance builds (`/forget-password/email-otp` it does not; the JWT
 * plugin's `/token` it does from step 7, disabled).
 */
const NOT_SERVED = LOAM_DISABLED_PATHS.filter((path) => path !== '/forget-password/email-otp');

/** The mounted instance's routes, with each one's methods. */
function routesOf(profile: DevProfile): Map<string, string[]> {
	const api = providerOf(profile.host).auth.api as Record<
		string,
		{ path?: string; options?: { method?: string | string[] } }
	>;
	const routes = new Map<string, string[]>();
	for (const endpoint of Object.values(api)) {
		if (typeof endpoint.path !== 'string') continue;
		routes.set(endpoint.path, [endpoint.options?.method ?? 'GET'].flat());
	}
	return routes;
}

/** A route's path with a value for each parameter. */
const concrete = (path: string) => path.replace(/:[a-z]+/gi, 'x');

describe("the provider mounted in loam-host: the routes are 5.8's, by the mounted instance (3.7)", () => {
	it("lists the routes from the instance the host serves, and they are exactly 5.8's, served and not served", async () => {
		const { deployment, dist } = await setup();
		const profile = await dev(deployment, dist);
		const routes = [...routesOf(profile).keys()].sort();
		expect(routes).toEqual([...Object.keys(SERVED), ...NOT_SERVED, ...SERVER_ONLY].sort());
		for (const path of Object.keys(SERVED)) expect(LOAM_DISABLED_PATHS, path).not.toContain(path);
	});

	it('answers 404 to every route 5.8 does not serve, by a direct request to the real host, signed in or not', async () => {
		const { deployment, dist } = await setup();
		await bootstrapped(deployment);
		const profile = await dev(deployment, dist);
		const cookie = cookieHeader(await signIn(profile));
		const routes = routesOf(profile);
		for (const path of NOT_SERVED) {
			for (const method of routes.get(path) ?? []) {
				for (const headers of [{}, { cookie }] as Record<string, string>[]) {
					const answer = await call(profile, `/api/auth${concrete(path)}`, {
						method,
						headers,
						...(method === 'POST' ? { json: {} } : {}),
					});
					// Better Auth's own answer for a disabled path, not the router's empty miss: the route exists and is refused.
					expect([answer.status, answer.body], `${method} ${path}`).toEqual([404, 'Not Found']);
					expect(answer.headers['cache-control'], path).toBe('no-store');
				}
			}
		}
		// A disabled path with a parameter is refused for any value (the re-check of step 3's NEW-4).
		expect((await call(profile, '/api/auth/reset-password/some-token')).status).toBe(404);
	});

	it('answers no HTTP request on a server-only admin route, nor OpenID discovery (9.3, 9.4)', async () => {
		const { deployment, dist } = await setup();
		await bootstrapped(deployment);
		const profile = await dev(deployment, dist);
		const cookie = cookieHeader(await signIn(profile));
		const routes = routesOf(profile);
		for (const path of SERVER_ONLY) {
			for (const method of routes.get(path) ?? []) {
				const answer = await call(profile, `/api/auth${concrete(path)}`, {
					method,
					headers: { cookie },
					...(method === 'POST' || method === 'PATCH' ? { json: {} } : {}),
				});
				// Not reached at all, never reached and refused: Better Auth answers a server-only route 404 over HTTP.
				expect(answer.status, `${method} ${path}`).toBe(404);
			}
		}
	});

	it("reaches every route 5.8 serves: none answers the router's 404", async () => {
		const { deployment, dist } = await setup();
		await bootstrapped(deployment);
		const profile = await dev(deployment, dist);
		const routes = routesOf(profile);
		for (const path of Object.keys(SERVED)) {
			const method = routes.get(path)?.[0] ?? 'GET';
			const answer = await call(profile, `/api/auth${concrete(path)}`, {
				method,
				...(method === 'POST' ? { json: {} } : {}),
			});
			// An endpoint refuses bad input with 400, no session with 401, a rule with 403, an unknown link with its own
			// 404 and code, or redirects: it is reached. Neither the router's empty miss nor a disabled path's answer.
			const missed = answer.status === 404 && (answer.body === '' || answer.body === 'Not Found');
			expect(missed, `${method} ${path}: ${answer.status} ${answer.body.slice(0, 80)}`).toBe(false);
			expect(answer.headers['cache-control'], path).toBe('no-store');
			// Step 1's deviation 1: a response on the shell's origin that is not a shell page is inert.
			expect(answer.headers['content-security-policy'], path).toBe(INERT_POLICY);
		}
	});
});

describe("the provider's trust rules, by direct requests against the real host (phase 3's 2.6 and 5.8)", () => {
	it("signs in on the deployment's own origin with a host-only, Secure, HttpOnly cookie", async () => {
		const { deployment, dist } = await setup();
		await bootstrapped(deployment);
		const profile = await dev(deployment, dist);
		const answer = await signIn(profile);
		const session = cookiesOf(answer).find((cookie) => cookie.includes('session_token='));
		expect(session).toMatch(/^__Secure-/);
		expect(session).toMatch(/; Secure/i);
		expect(session).toMatch(/; HttpOnly/i);
		expect(session).not.toMatch(/; Domain=/i);
		const who = await call(profile, '/api/auth/loam/whoami', {
			headers: { cookie: cookieHeader(answer) },
		});
		expect(JSON.parse(who.body)).toMatchObject({
			user: { email: 'bea@acme.example' },
			membership: { role: 'member' },
		});
		expect(who.headers['cache-control']).toBe('no-store');
	});

	it('refuses a foreign Origin, with or without a session: INVALID_ORIGIN, nothing run (the explicit origin and CSRF checks)', async () => {
		const { deployment, dist } = await setup();
		await bootstrapped(deployment);
		const profile = await dev(deployment, dist);
		const signedIn = await signIn(profile);
		const cookie = cookieHeader(signedIn);
		const foreign = await call(profile, '/api/auth/sign-in/email', {
			json: { email: 'bea@acme.example', password: PASSWORD },
			headers: { origin: 'https://evil.example' },
		});
		expect(foreign.status).toBe(403);
		expect(foreign.body).toContain('INVALID_ORIGIN');
		expect(cookiesOf(foreign).some((value) => value.includes('session_token='))).toBe(false);
		const revoke = await call(profile, '/api/auth/loam/revoke-person', {
			json: { target: 'all' },
			headers: { origin: 'https://evil.example', cookie },
		});
		expect(revoke.status).toBe(403);
		// The session survives: the refusal ran nothing.
		const who = await call(profile, '/api/auth/loam/whoami', { headers: { cookie } });
		expect(JSON.parse(who.body)).toMatchObject({ user: { email: 'bea@acme.example' } });
	});

	it("A7: records the socket's address, never a forged X-Forwarded-For or X-Loam-Client-Ip", async () => {
		const { deployment, dist, data } = await setup();
		await bootstrapped(deployment);
		const profile = await dev(deployment, dist);
		await signIn(profile, {
			'x-forwarded-for': '198.51.100.7',
			'X-Loam-Client-Ip': '203.0.113.9',
		});
		const database = new DatabaseSync(join(data, AUTH_DATABASE), { readOnly: true });
		const addresses = database.prepare('SELECT ipAddress FROM session').all();
		database.close();
		expect(addresses).toEqual([{ ipAddress: '127.0.0.1' }]);
	});

	it("A7: the provider receives exactly one x-loam-client-ip, the socket's, and no x-forwarded-for, in every header list it can read (raw headers included)", async () => {
		const { deployment, dist } = await setup();
		const profile = await dev(deployment, dist);
		const auth = providerOf(profile.host).auth as { handler(request: Request): Promise<Response> };
		const seen: Array<[string, string]>[] = [];
		const handler = auth.handler.bind(auth);
		auth.handler = (request: Request) => {
			// `entries()` makes `@hono/node-server` build the list from `rawHeaders`, which `get()` would not show.
			seen.push([...request.headers.entries()]);
			return handler(request);
		};
		const answer = await call(profile, '/api/auth/ok', {
			headers: {
				'x-forwarded-for': '198.51.100.7',
				'X-Loam-Client-Ip': '203.0.113.9',
				'x-LOAM-client-ip': '192.0.2.1',
			},
		});
		expect(answer.status).toBe(200);
		const [entries] = seen;
		const named = (name: string) =>
			(entries ?? []).filter(([key]) => key === name).map(([, value]) => value);
		expect(named('x-forwarded-for')).toEqual([]);
		expect(named('x-loam-client-ip')).toHaveLength(1);
		expect(named('x-loam-client-ip')[0]).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
		expect((entries ?? []).map(([, value]) => value).join(' ')).not.toMatch(
			/198\.51\.100\.7|203\.0\.113\.9|192\.0\.2\.1/
		);
	});

	it('limits sign-ins per socket, on in every mode: a forged X-Forwarded-For or X-Loam-Client-Ip neither picks nor escapes the bucket', async () => {
		const { deployment, dist } = await setup();
		await bootstrapped(deployment);
		// The provider's own limit: three sign-ins per address in ten seconds (Better Auth's rule for `/sign-in`).
		const profile = await dev(deployment, dist, null);
		const attempt = (forged: number) =>
			call(profile, '/api/auth/sign-in/email', {
				json: { email: 'bea@acme.example', password: 'not the password' },
				headers: {
					'x-forwarded-for': `198.51.100.${forged}`,
					'x-loam-client-ip': `203.0.113.${forged}`,
				},
			});
		// The store is the process's, so this socket's earlier sign-ins may already count: the bucket fills within three
		// attempts, each with a header forged afresh, and stays full whatever the next ones forge.
		const statuses: number[] = [];
		for (let forged = 1; forged <= 4; forged++) statuses.push((await attempt(forged)).status);
		expect(
			statuses.every((status) => status === 401 || status === 429),
			String(statuses)
		).toBe(true);
		expect(statuses.at(-1), String(statuses)).toBe(429);
		for (let forged = 5; forged <= 7; forged++)
			expect((await attempt(forged)).status, String(forged)).toBe(429);
	});

	it("serves only GET and POST under the provider's path, refuses a path a parser would read as another, and keeps the site's routes", async () => {
		const { deployment, dist } = await setup();
		const profile = await dev(deployment, dist);
		expect((await call(profile, '/api/auth/ok')).status).toBe(200);
		for (const method of ['PUT', 'DELETE', 'PATCH']) {
			const answer = await call(profile, '/api/auth/ok', { method });
			expect(answer.status, method).toBe(404);
			expect(answer.headers['cache-control']).toBe('no-store');
		}
		for (const path of [
			'/api/auth/../index.html',
			'/api/auth/%2e%2e/ok',
			'/api/auth/x/%2E%2E/ok',
			'/api/auth/x%2fok',
			'/api/auth/x%5cok',
			'/api/auth/./ok',
		]) {
			const answer = await call(profile, path);
			expect(answer.status, path).toBe(404);
		}
		// `api/authx` is not the provider's: it is the site's, which answers a non-HTML request 404.
		expect((await call(profile, '/api/authx')).status).toBe(404);
		expect((await call(profile, '/api/health')).status).toBe(200);
	});
});

describe('A7: the gate sets the client address from the socket alone', () => {
	it("deletes every incoming copy of x-forwarded-for and x-loam-client-ip, in headers and raw headers, then sets the socket's", () => {
		const incoming = {
			headers: {
				host: 'localhost',
				'x-forwarded-for': '198.51.100.7',
				'x-loam-client-ip': '203.0.113.9',
			} as Record<string, string>,
			rawHeaders: [
				'Host',
				'localhost',
				'X-Forwarded-For',
				'198.51.100.7',
				'x-loam-client-ip',
				'203.0.113.9',
				'X-LOAM-CLIENT-IP',
				'192.0.2.1',
			],
			socket: { remoteAddress: '::ffff:127.0.0.1' },
		};
		setClientAddress(incoming as never);
		expect(incoming.headers).toEqual({
			host: 'localhost',
			[CLIENT_ADDRESS_HEADER]: '::ffff:127.0.0.1',
		});
		expect(incoming.rawHeaders).toEqual([
			'Host',
			'localhost',
			CLIENT_ADDRESS_HEADER,
			'::ffff:127.0.0.1',
		]);
	});

	it('names the header `createLoamAuthOptions` reads, and no other', async () => {
		const { CLIENT_ADDRESS_HEADER: read } = await import('@lushly-dev/loam-identity');
		expect(CLIENT_ADDRESS_HEADER).toBe(read);
	});
});

describe('bootstrap (3.7): both forms, one path', () => {
	it('--dev on an empty directory makes the certificate, the secret and the ports, binds the organization and mails the first owner, all private', async () => {
		const { deployment, data } = await setup();
		const report = await runBootstrap({
			form: 'dev',
			deployment,
			slug: 'acme',
			name: 'Acme',
			ownerEmail: 'First@Acme.example',
		});
		expect(report).toMatchObject({
			organization: { slug: 'acme' },
			invited: 'first@acme.example',
			reissued: false,
		});
		for (const file of [
			'tls/cert.pem',
			'tls/key.pem',
			'secrets/auth',
			'dev.json',
			'mail.jsonl',
			AUTH_DATABASE,
		])
			expectMode(join(data, file), 0o600, file);
		expectMode(data, 0o700, 'data directory');
		const [message] = readFileSync(join(data, 'mail.jsonl'), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		const port = (JSON.parse(readFileSync(join(data, 'dev.json'), 'utf8')) as { port: number })
			.port;
		expect(message).toMatchObject({ to: 'first@acme.example' });
		expect(message.text).toContain(`https://localhost:${port}/~/join?invitation=`);
	});

	it('is HOST_DATA_LOCKED while dev holds the directory, then succeeds; and dev keeps the ports it recorded', async () => {
		const { deployment, dist } = await setup();
		const profile = await dev(deployment, dist);
		await expect(
			runBootstrap({
				form: 'dev',
				deployment,
				slug: 'acme',
				name: 'Acme',
				ownerEmail: 'a@acme.example',
			})
		).rejects.toMatchObject({ code: 'HOST_DATA_LOCKED' });
		await profile.host.close();
		running.splice(0);
		await runBootstrap({
			form: 'dev',
			deployment,
			slug: 'acme',
			name: 'Acme',
			ownerEmail: 'a@acme.example',
		});
		expect((await dev(deployment, dist)).origin).toBe(profile.origin);
	});

	it('sends a new link while the organization has no member, ending the earlier one, and is HOST_ALREADY_BOOTSTRAPPED once it has one', async () => {
		const { deployment, dist } = await setup();
		const input = {
			form: 'dev' as const,
			deployment,
			slug: 'acme',
			name: 'Acme',
			ownerEmail: 'a@acme.example',
		};
		const first = await runBootstrap(input);
		const second = await runBootstrap(input);
		expect(second).toMatchObject({ organization: { id: first.organization.id }, reissued: true });
		const profile = await dev(deployment, dist);
		const links = readFileSync(join(profile.data, 'mail.jsonl'), 'utf8')
			.trim()
			.split('\n')
			.map((line) => new URL(/https:\/\/\S+/.exec(JSON.parse(line).text)?.[0] as string));
		const check = (link: URL) =>
			call(
				profile,
				`/api/auth/loam/join/check?invitation=${link.searchParams.get('invitation')}&token=${link.searchParams.get('token')}`
			);
		expect((await check(links[0] as URL)).status).not.toBe(200);
		expect((await check(links[1] as URL)).status).toBe(200);
		await profile.host.close();
		running.splice(0);
		await withBootstrapProvider({ form: 'dev', deployment }, ({ provider }) =>
			seedTestPeople(provider.auth, first.organization.id, [
				{ email: 'olu@acme.example', name: 'Olu', role: 'owner' },
			])
		);
		await expect(runBootstrap(input)).rejects.toMatchObject({ code: 'HOST_ALREADY_BOOTSTRAPPED' });
	});

	it("refuses a slug other than the deployment's as DEPLOYMENT_IDENTITY_INVALID, and a local deployment as HOST_IDENTITY_LOCAL", async () => {
		const { deployment } = await setup();
		const refused = runBootstrap({
			form: 'dev',
			deployment,
			slug: 'other',
			name: 'Other',
			ownerEmail: 'a@b.example',
		});
		await expect(refused).rejects.toMatchObject({ code: 'DEPLOYMENT_IDENTITY_INVALID' });
		const local = await setup('');
		await expect(
			runBootstrap({
				form: 'dev',
				deployment: local.deployment,
				slug: 'acme',
				name: 'Acme',
				ownerEmail: 'a@b.example',
			})
		).rejects.toMatchObject({ code: 'HOST_IDENTITY_LOCAL' });
	});

	it('runs from the bin in both forms, printing a CommandResult with no secret, and refuses mixing them', async () => {
		const { root, deployment, data } = await setup();
		let text = '';
		const code = await runHostCli(
			[
				'bootstrap',
				'--dev',
				'--deployment',
				deployment,
				'--slug',
				'acme',
				'--name',
				'Acme',
				'--owner-email',
				'a@acme.example',
			],
			{ stdout: (chunk) => (text += chunk) }
		);
		expect(code).toBe(0);
		const result = JSON.parse(text);
		expect(result.data).toMatchObject({
			organization: { slug: 'acme' },
			invited: 'a@acme.example',
		});
		expect(text).not.toContain(readFileSync(join(data, 'secrets', 'auth'), 'utf8').trim());
		expect(text).not.toContain('token=');
		// The production form, with the server stopped, against a configuration file.
		const server = join(root, 'loam.server.toml');
		const port = (JSON.parse(readFileSync(join(data, 'dev.json'), 'utf8')) as { port: number })
			.port;
		await writeFile(
			server,
			`server_version = 1\norigin = "https://localhost:${port}"\nlisten = "127.0.0.1:${port}"\ndata = ${JSON.stringify(data)}\n\n[tls]\ncert_file = ${JSON.stringify(join(data, 'tls', 'cert.pem'))}\nkey_file = ${JSON.stringify(join(data, 'tls', 'key.pem'))}\n\n[auth]\nsecret_file = ${JSON.stringify(join(data, 'secrets', 'auth'))}\n\n[mail]\ntransport = "sink"\n`
		);
		text = '';
		expect(
			await runHostCli(
				[
					'bootstrap',
					'--server',
					server,
					'--deployment',
					deployment,
					'--slug',
					'acme',
					'--name',
					'Acme',
					'--owner-email',
					'a@acme.example',
				],
				{ stdout: (chunk) => (text += chunk) }
			)
		).toBe(0);
		expect(JSON.parse(text).data).toMatchObject({ reissued: true });
		text = '';
		expect(
			await runHostCli(
				[
					'bootstrap',
					'--server',
					server,
					'--dev',
					'--deployment',
					deployment,
					'--slug',
					'acme',
					'--name',
					'Acme',
					'--owner-email',
					'a@acme.example',
				],
				{ stdout: (chunk) => (text += chunk) }
			)
		).toBe(1);
		expect(JSON.parse(text).error.code).toBe('CLI_USAGE');
	});
});

describe('start (3.1, 3.3): its own refusals', () => {
	async function serverFile(root: string, data: string, port: number): Promise<string> {
		const path = join(root, 'loam.server.toml');
		await writeFile(
			path,
			`server_version = 1\norigin = "https://localhost:${port}"\nlisten = "127.0.0.1:0"\ndata = ${JSON.stringify(data)}\n\n[tls]\ncert_file = ${JSON.stringify(join(data, 'tls', 'cert.pem'))}\nkey_file = ${JSON.stringify(join(data, 'tls', 'key.pem'))}\n\n[auth]\nsecret_file = ${JSON.stringify(join(data, 'secrets', 'auth'))}\n\n[mail]\ntransport = "sink"\n`
		);
		return path;
	}

	it('refuses an organization never bootstrapped as HOST_NOT_BOOTSTRAPPED, naming the bootstrap, and starts once it is', async () => {
		const { root, deployment, dist, data } = await setup();
		// The profile's files, made by a dev that never bootstrapped.
		const profile = await dev(deployment, dist);
		const port = Number(new URL(profile.origin).port);
		await profile.host.close();
		running.splice(0);
		const server = await serverFile(root, data, port);
		let text = '';
		const code = await runHostCli(
			['start', '--server', server, '--deployment', deployment, '--dist', dist],
			{
				stdout: (chunk) => (text += chunk),
				untilStopped: async () => {},
			}
		);
		expect(code).toBe(1);
		const { error } = JSON.parse(text);
		expect(error.code).toBe('HOST_NOT_BOOTSTRAPPED');
		expect(error.suggestion).toContain('loam-host bootstrap');
		await runBootstrap({
			form: 'dev',
			deployment,
			slug: 'acme',
			name: 'Acme',
			ownerEmail: 'a@acme.example',
		});
		text = '';
		expect(
			await runHostCli(['start', '--server', server, '--deployment', deployment, '--dist', dist], {
				stdout: (chunk) => (text += chunk),
				untilStopped: async () => {},
			})
		).toBe(0);
		expect(JSON.parse(text).data.origin).toBe(`https://localhost:${port}`);
	});

	it('refuses a provider deployment with a stdio instance (D95), however the file reached it, before taking the lock', async () => {
		const { root, dist } = await setup();
		const deployment = await deploymentFile(
			root,
			`${PROVIDER}[apps.tools]\napp = "tools"\npackage = "./tools"\naudience = "person"\ntransport = "stdio"\ncommand = ["tools"]\n`
		);
		const data = join(root, 'data');
		const host = createLoamHost({
			server: {
				server_version: 1,
				origin: 'https://localhost:8443',
				listen: '127.0.0.1:0',
				data,
			},
			deployment,
			dist,
			[HOST_INTERNALS]: { start: true },
		});
		await expect(host).rejects.toMatchObject({ code: 'DEPLOYMENT_STDIO_TEAM' });
	});
});

describe("B1: Better Auth's environment variables never override what Loam trusts (the coordinator's decision, 2026-11-16)", () => {
	/** Runs `use` with `name` set in this process's environment, as a host or container might carry it. */
	async function withVariable<T>(name: string, value: string, use: () => Promise<T>): Promise<T> {
		const held = process.env[name];
		process.env[name] = value;
		try {
			return await use();
		} finally {
			if (held === undefined) delete process.env[name];
			else process.env[name] = held;
		}
	}
	const VALUES: Record<string, string> = {
		BETTER_AUTH_TRUSTED_ORIGINS: 'https://evil.example',
		BETTER_AUTH_SECRETS: `1:${'e'.repeat(40)}`,
		BETTER_AUTH_TELEMETRY: '1',
	};

	it('dev, start, check and bootstrap each refuse to run while one is set, HOST_ENV_OVERRIDE naming it, and write nothing', async () => {
		for (const [name, value] of Object.entries(VALUES)) {
			const { root, deployment, dist, data } = await setup();
			await withVariable(name, value, async () => {
				const refused = runDev({ deployment, dist });
				await expect(refused, name).rejects.toMatchObject({ code: 'HOST_ENV_OVERRIDE' });
				await expect(
					runBootstrap({
						form: 'dev',
						deployment,
						slug: 'acme',
						name: 'Acme',
						ownerEmail: 'a@acme.example',
					})
				).rejects.toMatchObject({ code: 'HOST_ENV_OVERRIDE' });
				expect(existsSync(data), name).toBe(false);
				const server = join(root, 'loam.server.toml');
				await writeFile(
					server,
					`server_version = 1\norigin = "https://localhost:8443"\nlisten = "127.0.0.1:0"\ndata = "data"\n\n[mail]\ntransport = "sink"\n\n[auth]\nsecret_env = "LOAM_TEST_AUTH_SECRET"\n`
				);
				for (const command of ['check', 'start']) {
					let text = '';
					const code = await runHostCli(
						[command, '--server', server, '--deployment', deployment, '--dist', dist],
						{ stdout: (chunk) => (text += chunk), untilStopped: async () => {} }
					);
					expect(code, `${command} ${name}`).toBe(1);
					const refusals = JSON.parse(text).error.details.refusals as Array<{
						code: string;
						key: string;
						suggestion: string;
					}>;
					expect(
						refusals.find(({ code }) => code === 'HOST_ENV_OVERRIDE'),
						`${command} ${name}`
					).toMatchObject({
						key: name,
						suggestion: expect.stringContaining(`Unset ${name}`),
					});
				}
			});
		}
	});

	it('an empty variable is no override, and the host starts', async () => {
		const { deployment, dist } = await setup();
		await withVariable('BETTER_AUTH_TRUSTED_ORIGINS', '', async () => {
			const profile = await dev(deployment, dist);
			expect(profile.origin).toMatch(/^https:\/\/localhost:/);
		});
	});

	it("BETTER_AUTH_TELEMETRY refuses only a value Better Auth reads as on: '0', 'false' and 'FALSE' start (NIT 1)", async () => {
		for (const value of ['0', 'false', 'FALSE', 'False']) {
			expect(environmentFindings({ BETTER_AUTH_TELEMETRY: value }), value).toEqual([]);
		}
		for (const value of ['1', 'true', 'yes', 'on', '00']) {
			expect(
				environmentFindings({ BETTER_AUTH_TELEMETRY: value }).map(({ code, key }) => [code, key]),
				value
			).toEqual([['HOST_ENV_OVERRIDE', 'BETTER_AUTH_TELEMETRY']]);
		}
		// The other two refuse any non-empty value, `0` included.
		expect(
			environmentFindings({ BETTER_AUTH_SECRETS: '0', BETTER_AUTH_TRUSTED_ORIGINS: 'false' })
		).toHaveLength(2);
		const { deployment, dist } = await setup();
		await withVariable('BETTER_AUTH_TELEMETRY', '0', async () => {
			const profile = await dev(deployment, dist);
			expect(profile.origin).toMatch(/^https:\/\/localhost:/);
		});
	});

	it('BETTER_AUTH_TRUSTED_ORIGINS set after start widens nothing: a foreign Origin is still 403 INVALID_ORIGIN (IMPROVEMENT 1)', async () => {
		const { deployment, dist } = await setup();
		await bootstrapped(deployment);
		const profile = await dev(deployment, dist);
		await withVariable('BETTER_AUTH_TRUSTED_ORIGINS', 'https://evil.example', async () => {
			const foreign = await call(profile, '/api/auth/sign-in/email', {
				json: { email: 'bea@acme.example', password: PASSWORD },
				headers: { origin: 'https://evil.example' },
			});
			expect(foreign.status).toBe(403);
			expect(foreign.body).toContain('INVALID_ORIGIN');
			expect(cookiesOf(foreign).some((value) => value.includes('session_token='))).toBe(false);
			// The deployment's own origin still signs in.
			expect((await signIn(profile)).status).toBe(200);
		});
	});
});

describe("I1: the provider's path never shadows the hosted server's own routes", () => {
	it('refuses a version 4 identity.path of api/health at start, and the default path leaves /api/health answering', async () => {
		const shadowing = await setup(
			PROVIDER.replace('organization = "acme"\n', 'organization = "acme"\npath = "api/health"\n')
		);
		await expect(
			runDev({ deployment: shadowing.deployment, dist: shadowing.dist })
		).rejects.toMatchObject({
			code: 'DEPLOYMENT_IDENTITY_INVALID',
		});
		const { deployment, dist } = await setup();
		const profile = await dev(deployment, dist);
		const health = await call(profile, '/api/health');
		expect([health.status, JSON.parse(health.body)]).toEqual([200, { ok: true }]);
		expect((await call(profile, '/api/auth/ok')).status).toBe(200);
	});
});

describe('teardown tracker (#2760)', () => {
	it('waits for a deferred bootstrap to finish and refuses follow-up resource acquisition after drain starts', async () => {
		const local = createTeardownTracker();
		let releaseBootstrap!: () => void;
		const events: string[] = [];
		let continuationStarted = false;

		const deferredFlow = (async () => {
			await local.run(
				() =>
					new Promise<void>((resolve) => {
						events.push('bootstrap-started');
						releaseBootstrap = () => {
							events.push('bootstrap-finished');
							resolve();
						};
					})
			);
			await local.run(async () => {
				continuationStarted = true;
				events.push('continuation-acquired');
			});
		})();

		const draining = local.drain(async () => {
			events.push('drained');
		});
		releaseBootstrap();

		await expect(deferredFlow).rejects.toThrow('test teardown already started');
		await draining;
		expect(continuationStarted).toBe(false);
		expect(events).toEqual(['bootstrap-started', 'bootstrap-finished', 'drained']);
	});
});
