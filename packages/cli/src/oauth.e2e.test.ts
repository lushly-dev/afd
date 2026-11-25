/**
 * @fileoverview End-to-end OAuth 2.1 CLI tests: spawns the built CLI (`dist/bin.js`) against a
 * real AFD MCP server (`createMcpHandler({ auth })` with `JwtVerifier` and RFC 9728 metadata)
 * and a real loopback OAuth 2.1 authorization server issuing EdDSA `at+jwt` tokens.
 */

import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Credentials, createMcpHandler, defineCommand, success } from '@lushly-dev/afd-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { restrictWindowsAcl } from './token-store.js';

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const CIMD_DOC_PATH = fileURLToPath(
	new URL('../../../site/oauth/cli-client.json', import.meta.url)
);
const EXIT_DEADLINE_MS = 30_000;

interface CliRun {
	code: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', (chunk: Buffer) => chunks.push(chunk));
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

describe('CLI OAuth 2.1 end-to-end against auth-protected AFD MCP server (M9)', () => {
	let configHome: string;
	let authServer: Server;
	let mcpServer: Server;
	let mcpDispose: () => void;
	let issuer: string;
	let mcpResource: string;
	let tokenLifetimeSeconds = 600;
	const issuedSecrets: string[] = [];
	const preRegisteredClientId = 'pre-reg-cli';
	const preRegisteredClientSecret = 's3cr3t-client-value-xyz';

	// Ed25519 keypair for RFC 9068 `at+jwt` tokens signed directly with node:crypto.
	const { privateKey, publicKey } = generateKeyPairSync('ed25519');
	const kid = 'e2e-ed25519-1';
	const publicJwk = {
		...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
		kid,
		alg: 'EdDSA',
		use: 'sig',
	};

	const pendingCodes = new Map<
		string,
		{
			clientId: string;
			redirectUri: string;
			codeChallenge: string;
			resource: string;
			scope: string;
		}
	>();
	const activeRefreshTokens = new Map<
		string,
		{ clientId: string; resource: string; scope: string }
	>();
	let tokenRequests = 0;
	let app401Calls = 0;

	function issueJwt(claims: Record<string, unknown>): string {
		const part = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
		const header = { alg: 'EdDSA', typ: 'at+jwt', kid };
		const signingInput = `${part(header)}.${part(claims)}`;
		const sig = sign(null, Buffer.from(signingInput, 'ascii'), privateKey).toString('base64url');
		const jwt = `${signingInput}.${sig}`;
		issuedSecrets.push(jwt);
		return jwt;
	}

	function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun> {
		return new Promise((resolve, reject) => {
			const child = spawn(process.execPath, [BIN, ...args], {
				env: {
					...process.env,
					HOME: configHome,
					USERPROFILE: configHome,
					XDG_CONFIG_HOME: configHome,
					APPDATA: configHome,
					FORCE_COLOR: '0',
					NO_COLOR: '1',
					AFD_HEADERS: '',
					AFD_OAUTH_CLIENT_ID: '',
					AFD_OAUTH_CLIENT_SECRET: '',
					AFD_OAUTH_ISSUER: '',
					...env,
				},
				stdio: ['pipe', 'pipe', 'pipe'],
			});
			let stdout = '';
			let stderr = '';
			let timedOut = false;
			child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
				stdout += chunk;
			});
			child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
				stderr += chunk;
			});
			const timer = setTimeout(() => {
				timedOut = true;
				child.kill('SIGKILL');
			}, EXIT_DEADLINE_MS);
			child.once('error', (err) => {
				clearTimeout(timer);
				reject(err);
			});
			child.once('close', (code) => {
				clearTimeout(timer);
				resolve({ code, stdout, stderr, timedOut });
			});
			child.stdin.end();
		});
	}

	/** Spawn `afd auth login --no-browser ...`, watch stdout for the authorize URL, and approve it. */
	function runInteractiveLogin(args: string[], env: Record<string, string> = {}): Promise<CliRun> {
		return new Promise((resolve, reject) => {
			const child = spawn(process.execPath, [BIN, 'auth', 'login', '--no-browser', ...args], {
				env: {
					...process.env,
					HOME: configHome,
					USERPROFILE: configHome,
					XDG_CONFIG_HOME: configHome,
					APPDATA: configHome,
					FORCE_COLOR: '0',
					NO_COLOR: '1',
					AFD_HEADERS: '',
					AFD_OAUTH_CLIENT_ID: '',
					AFD_OAUTH_CLIENT_SECRET: '',
					AFD_OAUTH_ISSUER: '',
					...env,
				},
				stdio: ['pipe', 'pipe', 'pipe'],
			});
			let stdout = '';
			let stderr = '';
			let timedOut = false;
			let browserHandled = false;

			const maybeApprove = (chunk: string) => {
				if (browserHandled) return;
				const match = /(http:\/\/127\.0\.0\.1:\d+\/authorize\?\S+)/.exec(
					`${stdout}\n${stderr}${chunk}`
				);
				if (!match?.[1]) return;
				browserHandled = true;
				// Simulate the browser hitting /authorize and following the 302 redirect to 127.0.0.1/callback.
				void fetch(match[1], { redirect: 'follow' }).catch(() => undefined);
			};

			child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
				stdout += chunk;
				maybeApprove(chunk);
			});
			child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
				stderr += chunk;
				maybeApprove(chunk);
			});

			const timer = setTimeout(() => {
				timedOut = true;
				child.kill('SIGKILL');
			}, EXIT_DEADLINE_MS);
			child.once('error', (err) => {
				clearTimeout(timer);
				reject(err);
			});
			child.once('close', (code) => {
				clearTimeout(timer);
				resolve({ code, stdout, stderr, timedOut });
			});
			child.stdin.end();
		});
	}

	beforeAll(async () => {
		// 1. Start loopback OAuth 2.1 Authorization Server.
		authServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
			const url = new URL(req.url ?? '/', issuer);
			const sendJson = (status: number, body: unknown) => {
				res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
				res.end(JSON.stringify(body));
			};

			if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
				sendJson(200, {
					issuer,
					authorization_endpoint: `${issuer}/authorize`,
					token_endpoint: `${issuer}/token`,
					jwks_uri: `${issuer}/jwks`,
					response_types_supported: ['code'],
					grant_types_supported: ['authorization_code', 'refresh_token'],
					code_challenge_methods_supported: ['S256'],
					token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
					scopes_supported: ['loam:read', 'loam:write', 'offline_access'],
					client_id_metadata_document_supported: true,
					authorization_response_iss_parameter_supported: true,
				});
				return;
			}

			if (req.method === 'GET' && url.pathname === '/jwks') {
				sendJson(200, { keys: [publicJwk] });
				return;
			}

			if (req.method === 'GET' && url.pathname === '/authorize') {
				const clientId = url.searchParams.get('client_id') ?? '';
				const redirectUri = url.searchParams.get('redirect_uri') ?? '';
				const state = url.searchParams.get('state') ?? '';
				const codeChallenge = url.searchParams.get('code_challenge') ?? '';
				const method = url.searchParams.get('code_challenge_method') ?? '';
				const resource = url.searchParams.get('resource') ?? '';
				const scope = url.searchParams.get('scope') ?? 'loam:read';
				if (method !== 'S256' || !codeChallenge || !redirectUri || !clientId) {
					sendJson(400, { error: 'invalid_request' });
					return;
				}
				// Validate registered client metadata (CIMD document from site/oauth/cli-client.json or pre-registered client).
				const parsedRedirect = new URL(redirectUri);
				if (clientId === 'https://afd.dev/oauth/cli-client.json') {
					const cimdDoc = JSON.parse(await readFile(CIMD_DOC_PATH, 'utf8')) as {
						client_id: string;
						redirect_uris: string[];
						grant_types: string[];
						response_types: string[];
						token_endpoint_auth_method: string;
					};
					const redirectOk = cimdDoc.redirect_uris.some((registered) => {
						const reg = new URL(registered);
						return (
							reg.protocol === parsedRedirect.protocol &&
							reg.hostname === parsedRedirect.hostname &&
							reg.pathname === parsedRedirect.pathname &&
							parsedRedirect.hostname === '127.0.0.1'
						);
					});
					if (
						cimdDoc.client_id !== clientId ||
						cimdDoc.token_endpoint_auth_method !== 'none' ||
						!cimdDoc.grant_types.includes('authorization_code') ||
						!cimdDoc.response_types.includes('code') ||
						!redirectOk
					) {
						sendJson(400, { error: 'invalid_client' });
						return;
					}
				} else if (clientId !== preRegisteredClientId) {
					sendJson(400, { error: 'unauthorized_client' });
					return;
				}
				const code = `code-${randomBytes(12).toString('base64url')}`;
				issuedSecrets.push(code);
				pendingCodes.set(code, { clientId, redirectUri, codeChallenge, resource, scope });
				const target = new URL(redirectUri);
				target.searchParams.set('code', code);
				target.searchParams.set('state', state);
				target.searchParams.set('iss', issuer);
				res.writeHead(302, { Location: target.toString() });
				res.end();
				return;
			}

			if (req.method === 'POST' && url.pathname === '/token') {
				tokenRequests += 1;
				const params = new URLSearchParams(await readBody(req));
				const grantType = params.get('grant_type');
				const resource = params.get('resource') ?? '';

				// Check confidential Basic auth when used.
				let clientId = params.get('client_id') ?? '';
				const authHeader = req.headers.authorization;
				if (authHeader?.startsWith('Basic ')) {
					const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
					const idx = decoded.indexOf(':');
					const basicId = decodeURIComponent(decoded.slice(0, idx));
					const basicSecret = decodeURIComponent(decoded.slice(idx + 1));
					if (basicId !== preRegisteredClientId || basicSecret !== preRegisteredClientSecret) {
						sendJson(401, { error: 'invalid_client' });
						return;
					}
					clientId = basicId;
				} else if (clientId === preRegisteredClientId) {
					sendJson(401, { error: 'invalid_client' });
					return;
				}

				const now = Math.floor(Date.now() / 1000);
				if (grantType === 'authorization_code') {
					const code = params.get('code') ?? '';
					const verifier = params.get('code_verifier') ?? '';
					const redirectUri = params.get('redirect_uri') ?? '';
					const record = pendingCodes.get(code);
					pendingCodes.delete(code);
					if (!record || record.clientId !== clientId || record.redirectUri !== redirectUri) {
						sendJson(400, { error: 'invalid_grant' });
						return;
					}
					const expectedChallenge = createHash('sha256')
						.update(verifier, 'ascii')
						.digest('base64url');
					if (expectedChallenge !== record.codeChallenge || record.resource !== resource) {
						sendJson(400, { error: 'invalid_grant' });
						return;
					}
					const accessToken = issueJwt({
						iss: issuer,
						aud: resource,
						sub: 'person-1',
						client_id: clientId,
						jti: randomBytes(8).toString('hex'),
						iat: now,
						exp: now + tokenLifetimeSeconds,
						scope: record.scope,
					});
					const refreshToken = `rt-${randomBytes(12).toString('base64url')}`;
					issuedSecrets.push(refreshToken);
					activeRefreshTokens.set(refreshToken, { clientId, resource, scope: record.scope });
					sendJson(200, {
						access_token: accessToken,
						token_type: 'Bearer',
						expires_in: tokenLifetimeSeconds,
						refresh_token: refreshToken,
						scope: record.scope,
					});
					return;
				}

				if (grantType === 'refresh_token') {
					const rt = params.get('refresh_token') ?? '';
					const record = activeRefreshTokens.get(rt);
					if (!record || record.clientId !== clientId || record.resource !== resource) {
						sendJson(400, { error: 'invalid_grant' });
						return;
					}
					activeRefreshTokens.delete(rt);
					const nextRefresh = `rt-${randomBytes(12).toString('base64url')}`;
					issuedSecrets.push(nextRefresh);
					activeRefreshTokens.set(nextRefresh, record);
					const accessToken = issueJwt({
						iss: issuer,
						aud: resource,
						sub: 'person-1',
						client_id: clientId,
						jti: randomBytes(8).toString('hex'),
						iat: now,
						exp: now + tokenLifetimeSeconds,
						scope: record.scope,
					});
					sendJson(200, {
						access_token: accessToken,
						token_type: 'Bearer',
						expires_in: tokenLifetimeSeconds,
						refresh_token: nextRefresh,
						scope: record.scope,
					});
					return;
				}

				sendJson(400, { error: 'unsupported_grant_type' });
				return;
			}

			sendJson(404, { error: 'not_found' });
		});

		await new Promise<void>((resolve) => authServer.listen(0, '127.0.0.1', () => resolve()));
		const authPort = (authServer.address() as AddressInfo).port;
		issuer = `http://127.0.0.1:${authPort}`;

		// 2. Start a real AFD MCP server protected by Bearer verification + RFC 9728 metadata.
		// Note: createProtectedResource enforces https://, so our loopback HTTP test server serves
		// the exact RFC 9728 metadata document for its loopback resource URI and delegates `/mcp`
		// to `createMcpHandler` with a `JwtVerifier` configured for the loopback issuer & resource.
		const commands = [
			defineCommand({
				name: 'whoami-get',
				description: 'Return the authenticated caller subject and clientId',
				category: 'whoami',
				mutation: false,
				scopes: ['loam:read'],
				input: z.object({}),
				expose: { mcp: true },
				async handler(_input, ctx) {
					const creds = ctx.credentials as Credentials | undefined;
					return success({
						subject: creds?.subject ?? null,
						clientId: creds?.clientId ?? null,
						scopes: creds?.scopes ?? [],
					});
				},
			}),
			defineCommand({
				name: 'partner-fail',
				description: 'Simulate an application tool that returns error code HTTP_401',
				category: 'whoami',
				mutation: true,
				scopes: ['loam:read'],
				input: z.object({}),
				expose: { mcp: true },
				async handler() {
					app401Calls += 1;
					return {
						success: false as const,
						error: {
							code: 'HTTP_401',
							message: 'Upstream partner API rejected credentials',
							suggestion: 'Check partner API key',
						},
					};
				},
			}),
		];

		// Bind mcpServer first so we know its exact loopback port for the verifier audience.
		let mcpHandler!: ReturnType<typeof createMcpHandler>;
		mcpServer = createServer((req, res) => {
			const url = new URL(req.url ?? '/', mcpResource);
			if (
				req.method === 'GET' &&
				(url.pathname === '/.well-known/oauth-protected-resource/mcp' ||
					url.pathname === '/.well-known/oauth-protected-resource')
			) {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(
					JSON.stringify({
						resource: mcpResource,
						authorization_servers: [issuer],
						scopes_supported: ['loam:read', 'loam:write'],
						bearer_methods_supported: ['header'],
						tls_client_certificate_bound_access_tokens: false,
					})
				);
				return;
			}
			// Rewrite `https://loopback.test` in M5's WWW-Authenticate challenge to the bound loopback origin.
			const origWriteHead = res.writeHead.bind(res);
			res.writeHead = ((statusCode: number, ...rest: unknown[]) => {
				const last = rest[rest.length - 1];
				if (last && typeof last === 'object' && !Array.isArray(last)) {
					const headers = last as Record<string, string>;
					for (const key of Object.keys(headers)) {
						if (key.toLowerCase() === 'www-authenticate' && typeof headers[key] === 'string') {
							headers[key] = headers[key].replace(
								'https://loopback.test',
								`http://127.0.0.1:${mcpPort}`
							);
						}
					}
				}
				return (origWriteHead as (...args: unknown[]) => ServerResponse)(statusCode, ...rest);
			}) as typeof res.writeHead;
			void mcpHandler(req, res);
		});

		await new Promise<void>((resolve) => mcpServer.listen(0, '127.0.0.1', () => resolve()));
		const mcpPort = (mcpServer.address() as AddressInfo).port;
		mcpResource = `http://127.0.0.1:${mcpPort}/mcp`;

		// `createProtectedResource` enforces https:// per M7; our loopback verifier strictly verifies
		// the real `aud === mcpResource` (`http://127.0.0.1:<port>/mcp`) on the JWT, then passes the
		// handler's configured resource identifier to `createMcpHandler`'s admission check.
		const handlerResource = 'https://loopback.test/mcp';
		const loopbackVerifier = {
			async verify(token: string) {
				const parts = token.split('.');
				if (parts.length !== 3) return { ok: false as const, rule: 'token-malformed' as const };
				const sigOk = verify(
					null,
					Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'),
					publicKey,
					Buffer.from(parts[2] as string, 'base64url')
				);
				if (!sigOk) return { ok: false as const, rule: 'signature' as const };
				const header = JSON.parse(
					Buffer.from(parts[0] as string, 'base64url').toString('utf8')
				) as {
					alg?: string;
					typ?: string;
					kid?: string;
				};
				if (header.typ !== 'at+jwt' || header.alg !== 'EdDSA' || header.kid !== kid) {
					return { ok: false as const, rule: 'typ' as const };
				}
				const claims = JSON.parse(
					Buffer.from(parts[1] as string, 'base64url').toString('utf8')
				) as {
					iss: string;
					aud: string;
					sub: string;
					client_id: string;
					iat: number;
					exp: number;
					scope?: string;
				};
				if (claims.iss !== issuer) return { ok: false as const, rule: 'issuer' as const };
				if (claims.aud !== mcpResource) return { ok: false as const, rule: 'audience' as const };
				if (Math.floor(Date.now() / 1000) >= claims.exp) {
					return { ok: false as const, rule: 'expired' as const };
				}
				return {
					ok: true as const,
					credentials: {
						issuer: claims.iss,
						subject: claims.sub,
						clientId: claims.client_id,
						scopes: claims.scope ? claims.scope.split(' ') : [],
						resource: handlerResource,
						expiresAt: claims.exp,
						issuedAt: claims.iat,
					},
				};
			},
		};

		mcpHandler = createMcpHandler({
			name: 'oauth-e2e',
			version: '1.0.0',
			commands,
			host: '127.0.0.1',
			port: mcpPort,
			auth: {
				resource: handlerResource,
				authorizationServers: ['https://loopback-issuer.test'],
				verifier: loopbackVerifier,
			},
		});
		mcpDispose = mcpHandler.dispose;
	});

	afterAll(async () => {
		mcpDispose?.();
		mcpServer?.closeAllConnections?.();
		authServer?.closeAllConnections?.();
		await new Promise<void>((resolve) => mcpServer?.close(() => resolve()));
		await new Promise<void>((resolve) => authServer?.close(() => resolve()));
	});

	beforeEach(async () => {
		configHome = await mkdtemp(join(tmpdir(), 'afd-cli-oauth-e2e-'));
		tokenLifetimeSeconds = 600;
		tokenRequests = 0;
		issuedSecrets.length = 0;
		issuedSecrets.push(preRegisteredClientSecret);
	});

	afterEach(async () => {
		await rm(configHome, { recursive: true, force: true });
	});

	it('logs in via CIMD PKCE flow, stores tokens outside config.json, calls MCP, refreshes on expiry, and leaks no secrets', async () => {
		const transcripts: string[] = [];

		// 1. Login via CIMD (server advertises client_id_metadata_document_supported: true).
		const login = await runInteractiveLogin([mcpResource]);
		transcripts.push(login.stdout, login.stderr);
		expect(login.timedOut).toBe(false);
		expect(login.code, `${login.stdout}\n${login.stderr}`).toBe(0);
		expect(login.stdout + login.stderr).toContain('Authorized');

		// 2. Connect + call without passing --header or AFD_HEADERS!
		const connect = await runCli(['connect', mcpResource]);
		transcripts.push(connect.stdout, connect.stderr);
		expect(connect.code, `${connect.stdout}\n${connect.stderr}`).toBe(0);

		const call = await runCli(['call', 'whoami-get', '--format', 'json']);
		transcripts.push(call.stdout, call.stderr);
		expect(call.code, `${call.stdout}\n${call.stderr}`).toBe(0);
		const parsed = JSON.parse(call.stdout) as {
			success: boolean;
			data: { subject: string; clientId: string; scopes: string[] };
		};
		expect(parsed.success).toBe(true);
		expect(parsed.data).toMatchObject({
			subject: 'person-1',
			clientId: 'https://afd.dev/oauth/cli-client.json',
		});

		// 3. Status prints metadata only and never raw tokens.
		const status = await runCli(['auth', 'status', '--format', 'json']);
		transcripts.push(status.stdout, status.stderr);
		expect(status.code).toBe(0);
		const statusJson = JSON.parse(status.stdout) as {
			tokenStore: string;
			sessions: Array<{ resource: string; hasRefreshToken: boolean }>;
		};
		expect(statusJson.sessions).toHaveLength(1);
		expect(statusJson.sessions[0]?.hasRefreshToken).toBe(true);
		expect(existsSync(statusJson.tokenStore)).toBe(true);

		// 4. Verify config.json never contains any token or secret.
		const configPath = join(statusJson.tokenStore, '..', 'config.json');
		const configText = await readFile(configPath, 'utf8');
		transcripts.push(configText);

		// 5. Expire the stored access token and verify automatic refresh + rotation on next call!
		const storeRaw = JSON.parse(await readFile(statusJson.tokenStore, 'utf8')) as {
			version: number;
			entries: Record<string, { expiresAt?: number; refreshToken?: string }>;
		};
		const entry = storeRaw.entries[mcpResource];
		expect(entry).toBeDefined();
		const oldRefresh = entry?.refreshToken;
		if (entry) entry.expiresAt = Math.floor(Date.now() / 1000) - 5;
		await writeFile(statusJson.tokenStore, JSON.stringify(storeRaw, null, 2));

		const requestsBeforeRefresh = tokenRequests;
		const callAfterRefresh = await runCli(['call', 'whoami-get', '--format', 'json']);
		transcripts.push(callAfterRefresh.stdout, callAfterRefresh.stderr);
		expect(callAfterRefresh.code, `${callAfterRefresh.stdout}\n${callAfterRefresh.stderr}`).toBe(0);
		expect(tokenRequests).toBe(requestsBeforeRefresh + 1);

		const storeAfter = JSON.parse(await readFile(statusJson.tokenStore, 'utf8')) as {
			entries: Record<string, { refreshToken?: string }>;
		};
		expect(storeAfter.entries[mcpResource]?.refreshToken).not.toBe(oldRefresh);

		// 6. Application tool returning error code HTTP_401 executes ONCE and does not replay or refresh.
		const beforeApp401 = app401Calls;
		const beforeApp401TokenReqs = tokenRequests;
		const app401Run = await runCli(['call', 'partner-fail', '--format', 'json']);
		transcripts.push(app401Run.stdout, app401Run.stderr);
		expect(app401Run.code).toBe(1);
		expect(app401Calls).toBe(beforeApp401 + 1);
		expect(tokenRequests).toBe(beforeApp401TokenReqs);

		// 7. Derived route (`afd stream`) refuses to attach the `/mcp`-bound OAuth token automatically.
		const streamAttempt = await runCli(['stream', 'whoami-get']);
		transcripts.push(streamAttempt.stdout, streamAttempt.stderr);
		expect(streamAttempt.code).toBe(1);
		expect(streamAttempt.stdout + streamAttempt.stderr).toContain('derived route');

		// 7. Explicit --header overrides stored OAuth token (sending an invalid bearer fails 401).
		const overrideRun = await runCli([
			'call',
			'whoami-get',
			'--header',
			'Authorization: Bearer wrong-explicit-token',
		]);
		transcripts.push(overrideRun.stdout, overrideRun.stderr);
		expect(overrideRun.code).toBe(1);

		// 8. Logout clears the stored session so subsequent calls fail with login hint.
		const logout = await runCli(['auth', 'logout', mcpResource]);
		transcripts.push(logout.stdout, logout.stderr);
		expect(logout.code).toBe(0);

		const afterLogout = await runCli(['call', 'whoami-get']);
		transcripts.push(afterLogout.stdout, afterLogout.stderr);
		expect(afterLogout.code).toBe(1);
		expect(afterLogout.stdout + afterLogout.stderr).toContain('afd auth login');

		// 8. Secret canary: no issued JWT, refresh token, auth code or client secret in any output or config.json.
		const combined = transcripts.join('\n');
		for (const secret of issuedSecrets) {
			expect(combined).not.toContain(secret);
		}
	}, 60_000);

	it('supports pre-registered confidential client via --client-secret-file and AFD_OAUTH_CLIENT_SECRET with issuer binding', async () => {
		const secretFile = join(configHome, 'oauth.secret');
		await writeFile(secretFile, `${preRegisteredClientSecret}\n`, { mode: 0o600 });
		if (process.platform === 'win32') {
			restrictWindowsAcl(secretFile);
		}

		// Refuses confidential client secret without explicit issuer binding.
		const unbound = await runInteractiveLogin([
			mcpResource,
			'--client-id',
			preRegisteredClientId,
			'--client-secret-file',
			secretFile,
		]);
		expect(unbound.code).toBe(1);
		expect(unbound.stderr).toContain('explicit authorization server issuer');

		const login = await runInteractiveLogin([
			mcpResource,
			'--client-id',
			preRegisteredClientId,
			'--client-secret-file',
			secretFile,
			'--issuer',
			issuer,
		]);
		expect(login.code, `${login.stdout}\n${login.stderr}`).toBe(0);

		const call = await runCli(['call', 'whoami-get', '--connect', mcpResource, '--format', 'json']);
		expect(call.code, `${call.stdout}\n${call.stderr}`).toBe(0);
		const parsed = JSON.parse(call.stdout) as { success: boolean; data: { clientId: string } };
		expect(parsed.data.clientId).toBe(preRegisteredClientId);

		// Refresh with AFD_OAUTH_CLIENT_SECRET + AFD_OAUTH_ISSUER.
		const refresh = await runCli(['auth', 'refresh', mcpResource, '--format', 'json'], {
			AFD_OAUTH_CLIENT_SECRET: preRegisteredClientSecret,
			AFD_OAUTH_ISSUER: issuer,
		});
		expect(refresh.code, `${refresh.stdout}\n${refresh.stderr}`).toBe(0);
		expect(refresh.stdout).not.toContain(preRegisteredClientSecret);
	}, 60_000);
});
