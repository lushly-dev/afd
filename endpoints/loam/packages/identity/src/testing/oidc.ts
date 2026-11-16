/**
 * @fileoverview A test-only OpenID provider (phase 3 specification, 18's E17 and E18): the deployer's single sign-on
 * in the test host's place, on loopback HTTP. It serves discovery, a JWKS, an authorization endpoint that signs in as
 * whoever the test chose and redirects straight back, a token endpoint that checks the code and its PKCE verifier and
 * answers an RS256 ID token, and userinfo. It stands in for an identity provider as the test-only auth host stands in
 * for phase 6's hosted lane, and proves nothing of a real one.
 */

import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server } from 'node:http';

/** Whom the next sign-in is: the ID token's claims. */
export interface TestOidcPersonV1 {
	sub: string;
	email: string;
	/** Default true. */
	emailVerified?: boolean;
	name?: string;
}

export interface TestOidcProvider {
	/** `http://127.0.0.1:<port>`, the issuer. */
	readonly issuer: string;
	readonly discoveryUrl: string;
	readonly clientId: string;
	readonly clientSecret: string;
	/** Sign the next authorization in as this person. */
	as(person: TestOidcPersonV1): void;
	close(): Promise<void>;
}

const b64url = (data: Buffer | string): string => Buffer.from(data).toString('base64url');

function jwt(key: KeyObject, kid: string, claims: Record<string, unknown>): string {
	const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
	const body = b64url(JSON.stringify(claims));
	const signature = sign('sha256', Buffer.from(`${head}.${body}`), key);
	return `${head}.${body}.${b64url(signature)}`;
}

async function bodyOf(request: IncomingMessage): Promise<URLSearchParams> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(chunk as Buffer);
	return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

/** Start the provider on a free loopback port. */
export async function startTestOidcProvider(
	options: { clientId?: string; clientSecret?: string } = {}
): Promise<TestOidcProvider> {
	const clientId = options.clientId ?? 'loam-test-client';
	const clientSecret = options.clientSecret ?? randomBytes(16).toString('hex');
	const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
	const kid = randomBytes(8).toString('hex');
	const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid, alg: 'RS256', use: 'sig' };
	let person: TestOidcPersonV1 = { sub: 'oidc-person', email: 'person@example.com' };
	const codes = new Map<
		string,
		{ person: TestOidcPersonV1; nonce?: string; challenge?: string; redirect: string }
	>();
	let issuer = '';
	const server: Server = createServer(async (request, response) => {
		const url = new URL(request.url ?? '/', issuer);
		const json = (status: number, body: unknown) => {
			response.writeHead(status, { 'content-type': 'application/json' });
			response.end(JSON.stringify(body));
		};
		try {
			if (url.pathname === '/.well-known/openid-configuration') {
				return json(200, {
					issuer,
					authorization_endpoint: `${issuer}/authorize`,
					token_endpoint: `${issuer}/token`,
					userinfo_endpoint: `${issuer}/userinfo`,
					jwks_uri: `${issuer}/jwks`,
					response_types_supported: ['code'],
					subject_types_supported: ['public'],
					id_token_signing_alg_values_supported: ['RS256'],
					scopes_supported: ['openid', 'email', 'profile'],
					code_challenge_methods_supported: ['S256'],
					token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
				});
			}
			if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
			if (url.pathname === '/authorize') {
				const redirect = url.searchParams.get('redirect_uri') ?? '';
				if (url.searchParams.get('client_id') !== clientId || !redirect)
					return json(400, { error: 'invalid_request' });
				const code = randomBytes(16).toString('hex');
				codes.set(code, {
					person,
					redirect,
					...(url.searchParams.get('nonce')
						? { nonce: url.searchParams.get('nonce') as string }
						: {}),
					...(url.searchParams.get('code_challenge')
						? { challenge: url.searchParams.get('code_challenge') as string }
						: {}),
				});
				const back = new URL(redirect);
				back.searchParams.set('code', code);
				const state = url.searchParams.get('state');
				if (state) back.searchParams.set('state', state);
				response.writeHead(302, { location: back.href });
				return response.end();
			}
			if (url.pathname === '/token' && request.method === 'POST') {
				const form = await bodyOf(request);
				const basic = request.headers.authorization?.startsWith('Basic ')
					? Buffer.from(request.headers.authorization.slice(6), 'base64').toString().split(':')
					: [];
				const id = decodeURIComponent(basic[0] ?? form.get('client_id') ?? '');
				const secret = decodeURIComponent(basic[1] ?? form.get('client_secret') ?? '');
				const held = codes.get(form.get('code') ?? '');
				if (id !== clientId || secret !== clientSecret || !held)
					return json(400, { error: 'invalid_grant' });
				codes.delete(form.get('code') ?? '');
				if (held.redirect !== form.get('redirect_uri'))
					return json(400, { error: 'invalid_grant' });
				if (held.challenge) {
					const verifier = form.get('code_verifier') ?? '';
					if (b64url(createHash('sha256').update(verifier).digest()) !== held.challenge)
						return json(400, { error: 'invalid_grant' });
				}
				const now = Math.floor(Date.now() / 1_000);
				const claims = {
					iss: issuer,
					aud: clientId,
					sub: held.person.sub,
					email: held.person.email,
					email_verified: held.person.emailVerified ?? true,
					name: held.person.name ?? held.person.email.split('@')[0],
					iat: now,
					exp: now + 600,
					...(held.nonce ? { nonce: held.nonce } : {}),
				};
				return json(200, {
					access_token: b64url(randomBytes(24)),
					token_type: 'Bearer',
					expires_in: 600,
					scope: 'openid email profile',
					id_token: jwt(privateKey, kid, claims),
				});
			}
			if (url.pathname === '/userinfo') {
				return json(200, {
					sub: person.sub,
					email: person.email,
					email_verified: person.emailVerified ?? true,
					name: person.name ?? person.email.split('@')[0],
				});
			}
			json(404, { error: 'not_found' });
		} catch (cause) {
			json(500, { error: String(cause) });
		}
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('No port');
	issuer = `http://127.0.0.1:${address.port}`;
	return {
		issuer,
		discoveryUrl: `${issuer}/.well-known/openid-configuration`,
		clientId,
		clientSecret,
		as(next) {
			person = next;
		},
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}
