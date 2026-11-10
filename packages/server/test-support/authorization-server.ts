/**
 * TEST ONLY authorization server for afd-server's MCP authorization suites
 * (`spec/authorization.md`, M3). It is not part of the package: the build compiles `src/` alone.
 *
 * It makes its own keys (RS256, PS256, ES256, ES384 and EdDSA on Ed25519), issues RFC 9068 JWT
 * access tokens and opaque tokens, and serves, on loopback HTTP, its JWKS (`/jwks`) and RFC 7662
 * introspection (`/introspect`). It counts the requests to each, so a suite can see what the
 * verifier fetched. Nothing here is a hosted identity provider.
 */

import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';

/** A private signing key, as `jose` makes it. */
export type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

/** The algorithms the fixture signs with, each under a key of its own. */
export const FIXTURE_ALGORITHMS = ['RS256', 'PS256', 'ES256', 'ES384', 'EdDSA'] as const;
export type FixtureAlgorithm = (typeof FIXTURE_ALGORITHMS)[number];

export interface FixtureKey {
	alg: FixtureAlgorithm;
	kid: string;
	privateKey: SigningKey;
	/** The public JWK as the JWKS publishes it, with `kid`, `alg` and `use`. */
	publicJwk: JWK;
}

export interface IssueOptions {
	/** The key to sign with. Default: RS256's. */
	alg?: FixtureAlgorithm;
	/** Members that replace the protected header's (`typ: "at+jwt"`, `alg`, `kid`). */
	header?: Record<string, unknown>;
	/** Claims over the defaults; a member set to `undefined` is left out. */
	claims?: Record<string, unknown>;
	/** Sign with this key instead of the published one of `alg` (a forged token). */
	signWith?: SigningKey;
}

export interface TestAuthorizationServer {
	/** The issuer string its tokens carry in `iss`. */
	readonly issuer: string;
	/** The audience its tokens carry by default. */
	readonly resource: string;
	/** `http://127.0.0.1:<port>/jwks`. */
	readonly jwksUrl: string;
	/** `http://127.0.0.1:<port>/introspect`. */
	readonly introspectionUrl: string;
	readonly keys: Readonly<Record<FixtureAlgorithm, FixtureKey>>;
	/** Requests served, by path. */
	readonly requests: { jwks: number; introspect: number };
	/** The JWKS document. */
	jwks(): { keys: JWK[] };
	/** Replace the published JWKS (a rotation), or `null` to answer 503. */
	publish(keys: JWK[] | null): void;
	/** A signed JWT access token: `iss`, `aud`, `sub`, `client_id`, `jti`, `iat`, `exp`, `scope`. */
	issue(options?: IssueOptions): Promise<string>;
	/** An opaque token, introspected as active with these claims over the defaults. */
	issueOpaque(claims?: Record<string, unknown>): string;
	/** Make an opaque token introspect as `active: false`. */
	revoke(token: string): void;
	/** The default claims at `now` (seconds). */
	claims(now?: number): Record<string, unknown>;
	close(): Promise<void>;
}

export interface TestAuthorizationServerOptions {
	issuer?: string;
	resource?: string;
	/** Seconds since the epoch the default claims use. Default: the system clock. */
	now?: () => number;
}

async function makeKey(alg: FixtureAlgorithm): Promise<FixtureKey> {
	const { privateKey, publicKey } = await generateKeyPair(alg, {
		...(alg === 'EdDSA' ? { crv: 'Ed25519' } : {}),
		extractable: true,
	});
	const kid = `${alg.toLowerCase()}-${randomBytes(4).toString('hex')}`;
	const publicJwk = { ...(await exportJWK(publicKey)), kid, alg, use: 'sig' };
	return { alg, kid, privateKey, publicJwk };
}

async function readBody(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString('utf8');
}

/** Start the fixture on an ephemeral loopback port. */
export async function startTestAuthorizationServer(
	options: TestAuthorizationServerOptions = {}
): Promise<TestAuthorizationServer> {
	const issuer = options.issuer ?? 'https://auth.test.example';
	const resource = options.resource ?? 'https://mcp.test.example/mcp';
	const now = options.now ?? (() => Math.floor(Date.now() / 1000));
	const keys = Object.fromEntries(
		await Promise.all(FIXTURE_ALGORITHMS.map(async (alg) => [alg, await makeKey(alg)] as const))
	) as Record<FixtureAlgorithm, FixtureKey>;
	let published: JWK[] | null = Object.values(keys).map((key) => key.publicJwk);
	const opaque = new Map<string, { claims: Record<string, unknown>; active: boolean }>();
	const requests = { jwks: 0, introspect: 0 };

	const defaults = (at = now()): Record<string, unknown> => ({
		iss: issuer,
		aud: resource,
		sub: 'user-1',
		client_id: 'agent-1',
		jti: randomBytes(8).toString('hex'),
		iat: at,
		exp: at + 600,
		scope: 'todo:read',
	});

	const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
		const send = (status: number, body: unknown) => {
			res.writeHead(status, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(body));
		};
		if (req.url === '/jwks' && req.method === 'GET') {
			requests.jwks += 1;
			if (published === null) send(503, { error: 'unavailable' });
			else send(200, { keys: published });
			return;
		}
		if (req.url === '/introspect' && req.method === 'POST') {
			requests.introspect += 1;
			const token = new URLSearchParams(await readBody(req)).get('token') ?? '';
			const entry = opaque.get(token);
			send(200, entry?.active ? { active: true, ...entry.claims } : { active: false });
			return;
		}
		send(404, { error: 'not_found' });
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

	return {
		issuer,
		resource,
		jwksUrl: `${origin}/jwks`,
		introspectionUrl: `${origin}/introspect`,
		keys,
		requests,
		jwks: () => ({ keys: published ?? [] }),
		publish(next) {
			published = next;
		},
		claims: defaults,
		async issue({ alg = 'RS256', header = {}, claims = {}, signWith } = {}) {
			const key = keys[alg];
			const payload = Object.fromEntries(
				Object.entries({ ...defaults(), ...claims }).filter(([, value]) => value !== undefined)
			);
			return new SignJWT(payload)
				.setProtectedHeader({ alg, typ: 'at+jwt', kid: key.kid, ...header } as never)
				.sign(signWith ?? key.privateKey);
		},
		issueOpaque(claims = {}) {
			const token = randomBytes(24).toString('base64url');
			opaque.set(token, { claims: { ...defaults(), ...claims }, active: true });
			return token;
		},
		revoke(token) {
			const entry = opaque.get(token);
			if (entry) entry.active = false;
		},
		async close() {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
