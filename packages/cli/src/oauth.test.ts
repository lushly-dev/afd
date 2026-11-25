import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { redactHeaders, redactSecrets } from './credentials.js';
import {
	discoverOAuthMetadata,
	loginWithOAuth,
	OAUTH_ISSUER_ENV,
	OAuthFlowError,
	resolveClientRegistration,
	resolveOAuthBearerToken,
	sanitizeOAuthErrorCode,
	startLoopbackCallbackServer,
} from './oauth-client.js';
import {
	assertAllowedOAuthUrl,
	DEFAULT_CLI_CLIENT_METADATA_URL,
	generateOAuthState,
	generatePkcePair,
	isTokenExpiring,
	pkceChallengeS256,
	resolveRequestedScope,
	selectTokenAuthMethod,
	validateAuthorizationServerMetadata,
	validateProtectedResourceMetadata,
	validateTokenResponse,
} from './oauth-protocol.js';
import { getStoredToken, restrictWindowsAcl, saveStoredToken } from './token-store.js';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...headers },
	});
}

describe('OAuth protocol validation and security rules (M9)', () => {
	it('refuses non-loopback HTTP and HTTPS-to-HTTP downgrades', () => {
		expect(() => assertAllowedOAuthUrl('resource', 'http://example.com/mcp', false)).toThrow(
			/HTTPS is required/
		);
		expect(() => assertAllowedOAuthUrl('resource', 'http://example.com/mcp', true)).toThrow(
			/HTTPS is required/
		);
		expect(() =>
			assertAllowedOAuthUrl('token_endpoint', 'http://127.0.0.1:8080/token', false)
		).toThrow(/HTTPS is required/);
		expect(assertAllowedOAuthUrl('token_endpoint', 'http://127.0.0.1:8080/token', true).href).toBe(
			'http://127.0.0.1:8080/token'
		);
		expect(() =>
			assertAllowedOAuthUrl('token_endpoint', 'https://user:pass@auth.example.com/token', false)
		).toThrow(/userinfo/);
		expect(() =>
			assertAllowedOAuthUrl('token_endpoint', 'https://auth.example.com/token?a=1', false)
		).toThrow(/query/);
		expect(() =>
			assertAllowedOAuthUrl('authorization_endpoint', 'https://auth.example.com/auth#frag', false, {
				allowQuery: true,
			})
		).toThrow(/fragment/);
	});

	it('generates valid PKCE S256 verifier/challenge pairs and high-entropy state', () => {
		const pair = generatePkcePair();
		expect(pair.method).toBe('S256');
		expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
		expect(pkceChallengeS256(pair.verifier)).toBe(pair.challenge);
		expect(generateOAuthState()).not.toBe(generateOAuthState());
	});

	it('validates protected-resource metadata strictly (resource match, bearer header, no mTLS)', () => {
		const valid = validateProtectedResourceMetadata(
			{
				resource: 'https://todo.example.com/mcp',
				authorization_servers: ['https://auth.example.com'],
				scopes_supported: ['todo:read'],
				bearer_methods_supported: ['header'],
			},
			'https://todo.example.com/mcp',
			false
		);
		expect(valid.authorizationServers).toEqual(['https://auth.example.com']);

		expect(() =>
			validateProtectedResourceMetadata(
				{
					resource: 'https://other.example.com/mcp',
					authorization_servers: ['https://auth.example.com'],
				},
				'https://todo.example.com/mcp',
				false
			)
		).toThrow(/does not match/);

		expect(() =>
			validateProtectedResourceMetadata(
				{
					resource: 'https://todo.example.com/mcp',
					authorization_servers: ['https://auth.example.com'],
					bearer_methods_supported: ['query'],
				},
				'https://todo.example.com/mcp',
				false
			)
		).toThrow(/Authorization header/);

		expect(() =>
			validateProtectedResourceMetadata(
				{
					resource: 'https://todo.example.com/mcp',
					authorization_servers: ['https://auth.example.com'],
					tls_client_certificate_bound_access_tokens: true,
				},
				'https://todo.example.com/mcp',
				false
			)
		).toThrow(/certificate-bound/);
	});

	it('validates AS metadata strictly (RFC 8414 issuer echo and mandatory PKCE S256)', () => {
		const base = {
			issuer: 'https://auth.example.com',
			authorization_endpoint: 'https://auth.example.com/authorize',
			token_endpoint: 'https://auth.example.com/token',
			code_challenge_methods_supported: ['S256'],
		};
		expect(
			validateAuthorizationServerMetadata(base, 'https://auth.example.com', false).issuer
		).toBe('https://auth.example.com');

		expect(() =>
			validateAuthorizationServerMetadata(
				{ ...base, issuer: 'https://evil.example.com' },
				'https://auth.example.com',
				false
			)
		).toThrow(/issuer/);

		expect(() =>
			validateAuthorizationServerMetadata(
				{ ...base, code_challenge_methods_supported: ['plain'] },
				'https://auth.example.com',
				false
			)
		).toThrow(/S256/);

		expect(() =>
			validateAuthorizationServerMetadata(
				{ ...base, token_endpoint: 'http://127.0.0.1:9999/token' },
				'https://auth.example.com',
				false
			)
		).toThrow(/HTTPS is required/);
	});

	it('validates token responses and refuses non-Bearer token_type (e.g. DPoP)', () => {
		const parsed = validateTokenResponse(
			{
				access_token: 'abc.def.ghi',
				token_type: 'bearer',
				expires_in: 600,
				refresh_token: 'rt-1',
				scope: 'loam:read loam:write',
			},
			1000
		);
		expect(parsed).toEqual({
			accessToken: 'abc.def.ghi',
			tokenType: 'Bearer',
			expiresAt: 1600,
			refreshToken: 'rt-1',
			scope: 'loam:read loam:write',
		});
		expect(isTokenExpiring(1600, 1569, 30)).toBe(false);
		expect(isTokenExpiring(1600, 1570, 30)).toBe(true);

		expect(() => validateTokenResponse({ access_token: 'abc', token_type: 'DPoP' }, 1000)).toThrow(
			/Bearer/
		);
		expect(() =>
			validateTokenResponse({ access_token: 'has spaces', token_type: 'Bearer' }, 1000)
		).toThrow(/access_token/);
	});

	it('selects client auth method and scopes properly', () => {
		expect(selectTokenAuthMethod(false, ['none'])).toBe('none');
		expect(() => selectTokenAuthMethod(false, ['client_secret_basic'])).toThrow(/public clients/);
		expect(selectTokenAuthMethod(true, ['client_secret_post', 'client_secret_basic'])).toBe(
			'client_secret_basic'
		);
		expect(selectTokenAuthMethod(true, ['client_secret_post'])).toBe('client_secret_post');
		expect(() => selectTokenAuthMethod(true, ['private_key_jwt'])).toThrow(
			/client_secret_basic or client_secret_post/
		);

		expect(
			resolveRequestedScope({
				resourceScopes: ['loam:read'],
				asScopes: ['loam:read', 'offline_access'],
			})
		).toBe('loam:read offline_access');
		expect(
			resolveRequestedScope({
				explicitScope: 'loam:read',
				asScopes: ['loam:read', 'offline_access'],
				offline: false,
			})
		).toBe('loam:read');
	});

	it('redacts sensitive headers and arbitrary secret substrings', () => {
		expect(
			redactHeaders({
				Authorization: 'Bearer secret-token',
				'X-Api-Key': 'api-key-val',
				Cookie: 'sid=123',
				'X-Tenant': 'acme',
			})
		).toEqual({
			Authorization: '[redacted]',
			'X-Api-Key': '[redacted]',
			Cookie: '[redacted]',
			'X-Tenant': 'acme',
		});
		expect(redactSecrets('failed with tok_secret_123 in body', ['tok_secret_123'])).toBe(
			'failed with [redacted] in body'
		);
	});
});

describe('OAuth discovery and registration (M9.1 & M9.2)', () => {
	it('probes the MCP endpoint first with Streamable HTTP headers, then falls back to RFC 9728 and OIDC metadata', async () => {
		const requested: string[] = [];
		let probeHeaders: Record<string, string> | undefined;
		const mockFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
			const url = String(input);
			requested.push(url);
			if (url === 'https://loam.example.com/mcp' && init?.method === 'POST') {
				probeHeaders = init.headers as Record<string, string>;
				return new Response('', { status: 401 });
			}
			if (url === 'https://loam.example.com/.well-known/oauth-protected-resource/mcp') {
				return new Response('', { status: 404 });
			}
			if (url === 'https://loam.example.com/.well-known/oauth-protected-resource') {
				return jsonResponse({
					resource: 'https://loam.example.com/mcp',
					authorization_servers: ['https://auth.example.com/tenant'],
					scopes_supported: ['loam:read', 'loam:write'],
				});
			}
			if (url === 'https://auth.example.com/.well-known/oauth-authorization-server/tenant') {
				return new Response('', { status: 404 });
			}
			if (url === 'https://auth.example.com/.well-known/openid-configuration/tenant') {
				return jsonResponse({
					issuer: 'https://auth.example.com/tenant',
					authorization_endpoint: 'https://auth.example.com/tenant/authorize',
					token_endpoint: 'https://auth.example.com/tenant/token',
					code_challenge_methods_supported: ['S256'],
					client_id_metadata_document_supported: true,
				});
			}
			return new Response('', { status: 404 });
		}) as unknown as typeof fetch;

		const discovered = await discoverOAuthMetadata('https://loam.example.com/mcp', {
			fetchFn: mockFetch,
		});
		expect(probeHeaders?.Accept).toContain('text/event-stream');
		expect(probeHeaders?.['MCP-Protocol-Version']).toBe('2026-07-28');
		expect(probeHeaders?.['Mcp-Method']).toBe('server/discover');
		expect(discovered.asMetadata.tokenEndpoint).toBe('https://auth.example.com/tenant/token');
		expect(requested).toEqual([
			'https://loam.example.com/mcp',
			'https://loam.example.com/.well-known/oauth-protected-resource/mcp',
			'https://loam.example.com/.well-known/oauth-protected-resource',
			'https://auth.example.com/.well-known/oauth-authorization-server/tenant',
			'https://auth.example.com/.well-known/openid-configuration/tenant',
		]);
	});

	it('refuses cross-origin resource_metadata, 3xx redirects, and oversized metadata bodies', async () => {
		await expect(
			discoverOAuthMetadata('https://loam.example.com/mcp', {
				challenge: {
					scheme: 'Bearer',
					resourceMetadata: 'https://evil.example.com/.well-known/oauth-protected-resource/mcp',
				},
				fetchFn: vi.fn() as unknown as typeof fetch,
			})
		).rejects.toMatchObject({ code: 'OAUTH_METADATA_ORIGIN_MISMATCH' });

		const redirectFetch = vi.fn(
			async () =>
				new Response(null, { status: 302, headers: { Location: 'https://evil.example.com/meta' } })
		) as unknown as typeof fetch;
		await expect(
			discoverOAuthMetadata('https://loam.example.com/mcp', { fetchFn: redirectFetch })
		).rejects.toMatchObject({ code: 'OAUTH_REDIRECT_REFUSED' });

		const hugeFetch = vi.fn(
			async () => new Response('x'.repeat(300_000), { status: 200 })
		) as unknown as typeof fetch;
		await expect(
			discoverOAuthMetadata('https://loam.example.com/mcp', { fetchFn: hugeFetch })
		).rejects.toMatchObject({ code: 'OAUTH_RESPONSE_TOO_LARGE' });
	});

	it('resolves CIMD vs pre-registered clients, enforces CIMD rules, and requires issuer binding for confidential secrets', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'afd-cli-reg-'));
		try {
			const secretPath = join(dir, 'secret.txt');
			await writeFile(secretPath, 'pre-reg-secret\n', { mode: 0o600 });
			if (process.platform === 'win32') restrictWindowsAcl(secretPath);

			const cimdAs = {
				issuer: 'https://auth.example.com',
				authorizationEndpoint: 'https://auth.example.com/authorize',
				tokenEndpoint: 'https://auth.example.com/token',
				codeChallengeMethodsSupported: ['S256'],
				clientIdMetadataDocumentSupported: true,
			};
			expect(resolveClientRegistration(cimdAs, { env: {} })).toEqual({
				clientId: DEFAULT_CLI_CLIENT_METADATA_URL,
				authMethod: 'none',
				mode: 'cimd',
			});

			expect(() =>
				resolveClientRegistration(cimdAs, {
					clientId: 'https://afd.dev/oauth/cli-client.json',
					clientSecretFile: secretPath,
					env: {},
				})
			).toThrow(OAuthFlowError);

			// Confidential client without issuer binding MUST be refused.
			expect(() =>
				resolveClientRegistration(
					{ ...cimdAs, clientIdMetadataDocumentSupported: false },
					{ clientId: 'my-client', clientSecretFile: secretPath, env: {} }
				)
			).toThrow(/explicit authorization server issuer/);

			// Confidential client bound to a different issuer MUST be refused.
			expect(() =>
				resolveClientRegistration(
					{ ...cimdAs, clientIdMetadataDocumentSupported: false },
					{
						clientId: 'my-client',
						clientSecretFile: secretPath,
						env: { [OAUTH_ISSUER_ENV]: 'https://other-issuer.example.com' },
					}
				)
			).toThrow(/bound to/);

			// Confidential client bound to the exact issuer succeeds.
			expect(
				resolveClientRegistration(
					{ ...cimdAs, clientIdMetadataDocumentSupported: false },
					{
						clientId: 'my-client',
						clientSecretFile: secretPath,
						issuer: 'https://auth.example.com',
						env: {},
					}
				)
			).toEqual({
				clientId: 'my-client',
				clientSecret: 'pre-reg-secret',
				authMethod: 'client_secret_basic',
				mode: 'pre-registered',
			});

			expect(() =>
				resolveClientRegistration(
					{ ...cimdAs, clientIdMetadataDocumentSupported: false },
					{ clientId: 'https://afd.dev/oauth/cli-client.json', env: {} }
				)
			).toThrow(/does not support Client ID Metadata Documents/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('Loopback callback server (M9.3)', () => {
	it('ignores wrong state, validates RFC 9207 iss, returns static CSP HTML, and resolves code', async () => {
		const cb = await startLoopbackCallbackServer({
			expectedState: 'state-123',
			expectedIssuer: 'https://auth.example.com',
			requireIssuer: true,
			timeoutMs: 5_000,
		});
		try {
			const badState = await fetch(`${cb.redirectUri}?code=evil&state=wrong`);
			expect(badState.status).toBe(400);
			expect(badState.headers.get('content-security-policy')).toBe("default-src 'none'");
			expect(badState.headers.get('cache-control')).toBe('no-store');
			expect(await badState.text()).not.toContain('evil');

			const notFound = await fetch(`http://127.0.0.1:${cb.port}/favicon.ico`);
			expect(notFound.status).toBe(404);

			const good = await fetch(
				`${cb.redirectUri}?code=good-code&state=state-123&iss=${encodeURIComponent('https://auth.example.com')}`
			);
			expect(good.status).toBe(200);
			const html = await good.text();
			expect(html).not.toContain('good-code');
			expect(html).not.toContain('state-123');
			expect(await cb.waitForCode()).toEqual({ code: 'good-code' });
		} finally {
			await cb.close();
		}
	});

	it('rejects RFC 9207 issuer mismatch without accepting the authorization code', async () => {
		const cb = await startLoopbackCallbackServer({
			expectedState: 'state-abc',
			expectedIssuer: 'https://auth.example.com',
			requireIssuer: true,
			timeoutMs: 5_000,
		});
		try {
			const waitPromise = cb.waitForCode();
			const res = await fetch(
				`${cb.redirectUri}?code=stolen&state=state-abc&iss=${encodeURIComponent('https://evil.example.com')}`
			);
			expect(res.status).toBe(400);
			await expect(waitPromise).rejects.toMatchObject({ code: 'OAUTH_ISSUER_MISMATCH' });
		} finally {
			await cb.close();
		}
	});
});

describe('Token refresh, rotation and invalidation (M9.4)', () => {
	let dir: string;
	let storePath: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'afd-cli-refresh-'));
		storePath = join(dir, 'tokens.json');
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('refreshes expiring tokens automatically, rotates refresh_token, and clears invalid_grant', async () => {
		saveStoredToken(
			{
				resource: 'https://loam.example.com/mcp',
				issuer: 'https://auth.example.com',
				tokenEndpoint: 'https://auth.example.com/oauth2/token',
				clientId: 'cli-client',
				clientAuthMethod: 'none',
				accessToken: 'old-access-token',
				refreshToken: 'rt-1',
				expiresAt: 1020,
				scope: 'loam:read offline_access',
				updatedAt: '2026-11-24T00:00:00.000Z',
			},
			storePath
		);

		let lastBody = '';
		const mockFetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
			lastBody = String(init?.body ?? '');
			return jsonResponse({
				access_token: 'new-access-token',
				token_type: 'Bearer',
				expires_in: 600,
				refresh_token: 'rt-2',
			});
		}) as unknown as typeof fetch;

		const resolved = await resolveOAuthBearerToken('https://loam.example.com/mcp', {
			storePath,
			fetchFn: mockFetch,
			now: () => 1000, // within 30s skew of 1020
		});
		expect(resolved?.refreshed).toBe(true);
		expect(resolved?.token).toBe('new-access-token');
		expect(lastBody).toContain('grant_type=refresh_token');
		expect(lastBody).toContain('refresh_token=rt-1');
		expect(lastBody).toContain(`resource=${encodeURIComponent('https://loam.example.com/mcp')}`);
		expect(getStoredToken('https://loam.example.com/mcp', storePath)?.refreshToken).toBe('rt-2');

		// Revoked refresh token clears the stored entry cleanly.
		const failFetch = vi.fn(async () =>
			jsonResponse({ error: 'invalid_grant' }, 400)
		) as unknown as typeof fetch;
		await expect(
			resolveOAuthBearerToken('https://loam.example.com/mcp', {
				storePath,
				fetchFn: failFetch,
				forceRefresh: true,
				now: () => 1200,
			})
		).rejects.toMatchObject({ code: 'OAUTH_REFRESH_FAILED' });
		expect(getStoredToken('https://loam.example.com/mcp', storePath)).toBeUndefined();
	});

	it('completes loginWithOAuth against a mocked loopback HTTP OAuth server', async () => {
		const capturedTokenParams = new Map<string, string>();
		const mockFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === 'http://127.0.0.1:4444/.well-known/oauth-protected-resource/mcp') {
				return jsonResponse({
					resource: 'http://127.0.0.1:4444/mcp',
					authorization_servers: ['http://127.0.0.1:4444/auth'],
					scopes_supported: ['todo:read'],
				});
			}
			if (url === 'http://127.0.0.1:4444/.well-known/oauth-authorization-server/auth') {
				return jsonResponse({
					issuer: 'http://127.0.0.1:4444/auth',
					authorization_endpoint: 'http://127.0.0.1:4444/auth/authorize',
					token_endpoint: 'http://127.0.0.1:4444/auth/token',
					code_challenge_methods_supported: ['S256'],
					client_id_metadata_document_supported: true,
					authorization_response_iss_parameter_supported: true,
				});
			}
			if (url === 'http://127.0.0.1:4444/auth/token') {
				for (const [k, v] of new URLSearchParams(String(init?.body ?? ''))) {
					capturedTokenParams.set(k, v);
				}
				return jsonResponse({
					access_token: 'issued-access-token',
					token_type: 'Bearer',
					expires_in: 600,
					refresh_token: 'issued-refresh-token',
				});
			}
			return new Response('', { status: 404 });
		}) as unknown as typeof fetch;

		const result = await loginWithOAuth({
			serverUrl: 'http://127.0.0.1:4444/mcp',
			noBrowser: true,
			storePath,
			fetchFn: mockFetch,
			onAuthorizationUrl: async (authUrl) => {
				const parsed = new URL(authUrl);
				const redirectUri = parsed.searchParams.get('redirect_uri') as string;
				const state = parsed.searchParams.get('state') as string;
				expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
				expect(parsed.searchParams.get('resource')).toBe('http://127.0.0.1:4444/mcp');
				// Simulate the browser following the authorization server's redirect back to 127.0.0.1.
				void fetch(
					`${redirectUri}?code=test-auth-code&state=${encodeURIComponent(state)}&iss=${encodeURIComponent('http://127.0.0.1:4444/auth')}`
				);
			},
		});

		expect(result.registrationMode).toBe('cimd');
		expect(result.summary.hasRefreshToken).toBe(true);
		expect(capturedTokenParams.get('grant_type')).toBe('authorization_code');
		expect(capturedTokenParams.get('code')).toBe('test-auth-code');
		expect(capturedTokenParams.get('resource')).toBe('http://127.0.0.1:4444/mcp');
		expect(capturedTokenParams.get('code_verifier')).toBeTruthy();
		expect(getStoredToken('http://127.0.0.1:4444/mcp', storePath)?.accessToken).toBe(
			'issued-access-token'
		);
	});

	it('discovers PRM via 401 WWW-Authenticate probe fallback and handles client_secret_post and no-refresh expiry', async () => {
		const mockFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === 'https://probe.example.com/.well-known/oauth-protected-resource/mcp') {
				return new Response('', { status: 404 });
			}
			if (url === 'https://probe.example.com/.well-known/oauth-protected-resource') {
				return new Response('', { status: 404 });
			}
			if (url === 'https://probe.example.com/mcp' && init?.method === 'POST') {
				return new Response('', {
					status: 401,
					headers: {
						'WWW-Authenticate':
							'Bearer resource_metadata="https://probe.example.com/custom-prm.json", scope="loam:read"',
					},
				});
			}
			if (url === 'https://probe.example.com/custom-prm.json') {
				return jsonResponse({
					resource: 'https://probe.example.com/mcp',
					authorization_servers: ['https://auth.example.com'],
				});
			}
			if (url === 'https://auth.example.com/.well-known/oauth-authorization-server') {
				return jsonResponse({
					issuer: 'https://auth.example.com',
					authorization_endpoint: 'https://auth.example.com/authorize',
					token_endpoint: 'https://auth.example.com/token',
					code_challenge_methods_supported: ['S256'],
					token_endpoint_auth_methods_supported: ['client_secret_post'],
				});
			}
			if (url === 'https://auth.example.com/token') {
				const body = new URLSearchParams(String(init?.body ?? ''));
				expect(body.get('client_id')).toBe('post-client');
				expect(body.get('client_secret')).toBe('post-secret');
				return jsonResponse({
					access_token: 'post-access-token',
					token_type: 'Bearer',
					expires_in: 60,
				});
			}
			return new Response('', { status: 404 });
		}) as unknown as typeof fetch;

		const discovered = await discoverOAuthMetadata('https://probe.example.com/mcp', {
			fetchFn: mockFetch,
		});
		expect(discovered.challenge?.scope).toBe('loam:read');

		const result = await loginWithOAuth({
			serverUrl: 'https://probe.example.com/mcp',
			clientId: 'post-client',
			clientSecret: 'post-secret',
			issuer: 'https://auth.example.com',
			noBrowser: true,
			storePath,
			fetchFn: mockFetch,
			now: () => 2000,
			onAuthorizationUrl: async (authUrl) => {
				const parsed = new URL(authUrl);
				const redirectUri = parsed.searchParams.get('redirect_uri') as string;
				const state = parsed.searchParams.get('state') as string;
				void fetch(`${redirectUri}?code=post-code&state=${encodeURIComponent(state)}`);
			},
		});
		expect(result.registrationMode).toBe('pre-registered');
		expect(result.summary.clientAuthMethod).toBe('client_secret_post');

		// Expired token with no refresh token throws OAUTH_TOKEN_EXPIRED.
		await expect(
			resolveOAuthBearerToken('https://probe.example.com/mcp', {
				storePath,
				now: () => 2100,
			})
		).rejects.toMatchObject({ code: 'OAUTH_TOKEN_EXPIRED' });
	});

	it('validates RFC 9207 iss BEFORE callback error, caps invalid callbacks, closes listener before token exchange, and sanitizes echoed secrets', async () => {
		// 1. Callback error with wrong iss MUST fail with OAUTH_ISSUER_MISMATCH, not OAUTH_AUTHORIZATION_DENIED.
		const cbWrongIss = await startLoopbackCallbackServer({
			expectedState: 'st-iss-err',
			expectedIssuer: 'https://auth.example.com',
			requireIssuer: true,
			timeoutMs: 5_000,
		});
		try {
			const wait = cbWrongIss.waitForCode();
			const res = await fetch(
				`${cbWrongIss.redirectUri}?error=access_denied&state=st-iss-err&iss=${encodeURIComponent('https://evil.example.com')}`
			);
			expect(res.status).toBe(400);
			await expect(wait).rejects.toMatchObject({ code: 'OAUTH_ISSUER_MISMATCH' });
		} finally {
			await cbWrongIss.close();
		}

		// 2. Callback error omitting required iss MUST also fail with OAUTH_ISSUER_MISMATCH.
		const cbMissingIss = await startLoopbackCallbackServer({
			expectedState: 'st-iss-miss',
			expectedIssuer: 'https://auth.example.com',
			requireIssuer: true,
			timeoutMs: 5_000,
		});
		try {
			const wait = cbMissingIss.waitForCode();
			const res = await fetch(`${cbMissingIss.redirectUri}?error=access_denied&state=st-iss-miss`);
			expect(res.status).toBe(400);
			await expect(wait).rejects.toMatchObject({ code: 'OAUTH_ISSUER_MISMATCH' });
		} finally {
			await cbMissingIss.close();
		}

		// 3. 10 invalid-state callbacks abort with OAUTH_STATE_MISMATCH.
		const cbFlood = await startLoopbackCallbackServer({
			expectedState: 'st-good',
			expectedIssuer: 'https://auth.example.com',
			requireIssuer: false,
			timeoutMs: 5_000,
		});
		try {
			const wait = cbFlood.waitForCode();
			for (let i = 0; i < 10; i += 1) {
				const res = await fetch(`${cbFlood.redirectUri}?code=x&state=wrong-${i}`);
				expect(res.status).toBe(400);
			}
			await expect(wait).rejects.toMatchObject({ code: 'OAUTH_STATE_MISMATCH' });
		} finally {
			await cbFlood.close();
		}

		// 4. Sanitize OAuth error codes so hostile echoed secrets never leak.
		expect(sanitizeOAuthErrorCode('invalid_grant')).toBe('invalid_grant');
		expect(sanitizeOAuthErrorCode('echoed-secret-xyz', ['echoed-secret-xyz'])).toBe(
			'unknown_error'
		);
		expect(sanitizeOAuthErrorCode('arbitrary\x1b[31m_injection')).toBe('unknown_error');

		// 5. Credential-bearing authorization_endpoint is refused by validateAuthorizationServerMetadata.
		expect(() =>
			validateAuthorizationServerMetadata(
				{
					issuer: 'https://auth.example.com',
					authorization_endpoint: 'https://auth.example.com/authorize?client_secret=leaked',
					token_endpoint: 'https://auth.example.com/token',
					code_challenge_methods_supported: ['S256'],
				},
				'https://auth.example.com',
				false
			)
		).toThrow(/credential/);

		// 6. Token endpoint echoing submitted refresh_token in `error` never leaks it in thrown OAuthFlowError.
		saveStoredToken(
			{
				resource: 'https://echo.example.com/mcp',
				issuer: 'https://auth.example.com',
				tokenEndpoint: 'https://auth.example.com/token',
				clientId: 'cli',
				clientAuthMethod: 'none',
				accessToken: 'old-tok',
				refreshToken: 'rt-super-secret-value',
				expiresAt: 100,
				updatedAt: '2026-11-24T00:00:00.000Z',
			},
			storePath
		);
		const echoFetch = vi.fn(async () =>
			jsonResponse({ error: 'failed: rt-super-secret-value' }, 400)
		) as unknown as typeof fetch;
		try {
			await resolveOAuthBearerToken('https://echo.example.com/mcp', {
				storePath,
				fetchFn: echoFetch,
				now: () => 500,
			});
			expect.unreachable('should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(OAuthFlowError);
			expect((error as Error).message).not.toContain('rt-super-secret-value');
			expect((error as OAuthFlowError).oauthErrorCode).toBe('unknown_error');
		}

		// 7. Refresh response omitting refresh_token preserves existing refreshToken (RFC 6749 §6).
		const preserveFetch = vi.fn(async () =>
			jsonResponse({
				access_token: 'rotated-access-only',
				token_type: 'Bearer',
				expires_in: 600,
			})
		) as unknown as typeof fetch;
		const preserved = await resolveOAuthBearerToken('https://echo.example.com/mcp', {
			storePath,
			fetchFn: preserveFetch,
			now: () => 500,
		});
		expect(preserved?.token).toBe('rotated-access-only');
		expect(getStoredToken('https://echo.example.com/mcp', storePath)?.refreshToken).toBe(
			'rt-super-secret-value'
		);

		// 8. Loopback listener is closed BEFORE exchangeAuthorizationCode runs.
		let callbackUrlDuringExchange = '';
		const closeCheckFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === 'http://127.0.0.1:4455/mcp' && init?.method === 'POST') {
				return new Response('', { status: 401 });
			}
			if (url === 'http://127.0.0.1:4455/.well-known/oauth-protected-resource/mcp') {
				return jsonResponse({
					resource: 'http://127.0.0.1:4455/mcp',
					authorization_servers: ['http://127.0.0.1:4455/auth'],
				});
			}
			if (url === 'http://127.0.0.1:4455/.well-known/oauth-authorization-server/auth') {
				return jsonResponse({
					issuer: 'http://127.0.0.1:4455/auth',
					authorization_endpoint: 'http://127.0.0.1:4455/auth/authorize',
					token_endpoint: 'http://127.0.0.1:4455/auth/token',
					code_challenge_methods_supported: ['S256'],
					client_id_metadata_document_supported: true,
				});
			}
			if (url === 'http://127.0.0.1:4455/auth/token') {
				// Listener MUST already be closed before token exchange starts.
				await expect(fetch(callbackUrlDuringExchange)).rejects.toThrow();
				return jsonResponse({
					access_token: 'closed-first-tok',
					token_type: 'Bearer',
					expires_in: 600,
				});
			}
			return new Response('', { status: 404 });
		}) as unknown as typeof fetch;

		await loginWithOAuth({
			serverUrl: 'http://127.0.0.1:4455/mcp',
			noBrowser: true,
			storePath,
			fetchFn: closeCheckFetch,
			onAuthorizationUrl: async (authUrl) => {
				const parsed = new URL(authUrl);
				callbackUrlDuringExchange = parsed.searchParams.get('redirect_uri') as string;
				const state = parsed.searchParams.get('state') as string;
				void fetch(`${callbackUrlDuringExchange}?code=ok-code&state=${encodeURIComponent(state)}`);
			},
		});
	});

	it('serializes concurrent refresh and reuses already-rotated token without clobbering on stale invalid_grant', async () => {
		saveStoredToken(
			{
				resource: 'https://race.example.com/mcp',
				issuer: 'https://auth.example.com',
				tokenEndpoint: 'https://auth.example.com/token',
				clientId: 'cli',
				clientAuthMethod: 'none',
				accessToken: 'stale-tok',
				refreshToken: 'rt-v1',
				expiresAt: 100,
				updatedAt: '2026-11-24T00:00:00.000Z',
			},
			storePath
		);

		let calls = 0;
		const raceFetch = vi.fn(async () => {
			calls += 1;
			await new Promise((r) => setTimeout(r, 40));
			return jsonResponse({
				access_token: `fresh-tok-${calls}`,
				token_type: 'Bearer',
				expires_in: 600,
				refresh_token: `rt-v${calls + 1}`,
			});
		}) as unknown as typeof fetch;

		const [a, b] = await Promise.all([
			resolveOAuthBearerToken('https://race.example.com/mcp', {
				storePath,
				fetchFn: raceFetch,
				now: () => 500,
			}),
			resolveOAuthBearerToken('https://race.example.com/mcp', {
				storePath,
				fetchFn: raceFetch,
				now: () => 500,
			}),
		]);

		// Only one refresh HTTP request ran; the second caller reused the rotated token from disk.
		expect(calls).toBe(1);
		expect(a?.token).toBe('fresh-tok-1');
		expect(b?.token).toBe('fresh-tok-1');
	});

	it('handles callback 405, access_denied, missing code, and abort cancellation cleanly', async () => {
		const cbDenied = await startLoopbackCallbackServer({
			expectedState: 'st-deny',
			expectedIssuer: 'https://auth.example.com',
			requireIssuer: false,
			timeoutMs: 5_000,
		});
		try {
			const postRes = await fetch(cbDenied.redirectUri, { method: 'POST' });
			expect(postRes.status).toBe(405);
			const deniedWait = cbDenied.waitForCode();
			const denyRes = await fetch(`${cbDenied.redirectUri}?error=access_denied&state=st-deny`);
			expect(denyRes.status).toBe(200);
			await expect(deniedWait).rejects.toMatchObject({
				code: 'OAUTH_AUTHORIZATION_DENIED',
				oauthErrorCode: 'access_denied',
			});
		} finally {
			await cbDenied.close();
		}

		const cbMissing = await startLoopbackCallbackServer({
			expectedState: 'st-miss',
			expectedIssuer: 'https://auth.example.com',
			requireIssuer: false,
			timeoutMs: 5_000,
		});
		try {
			const missWait = cbMissing.waitForCode();
			const missRes = await fetch(`${cbMissing.redirectUri}?state=st-miss`);
			expect(missRes.status).toBe(400);
			await expect(missWait).rejects.toMatchObject({ code: 'OAUTH_MISSING_CODE' });
		} finally {
			await cbMissing.close();
		}

		const controller = new AbortController();
		const cbAbort = await startLoopbackCallbackServer({
			expectedState: 'st-abort',
			expectedIssuer: 'https://auth.example.com',
			requireIssuer: false,
			timeoutMs: 5_000,
			signal: controller.signal,
		});
		try {
			const abortWait = cbAbort.waitForCode();
			controller.abort();
			await expect(abortWait).rejects.toMatchObject({ code: 'OAUTH_LOGIN_CANCELLED' });
		} finally {
			await cbAbort.close();
		}
	});
});
