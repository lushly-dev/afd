import type { McpClient } from '@lushly-dev/afd-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	config: {} as { serverUrl?: string },
	loginWithOAuth: vi.fn(),
	resolveOAuthBearerToken: vi.fn(),
	listStoredTokens: vi.fn(),
	deleteStoredToken: vi.fn(),
	clearStoredTokens: vi.fn(),
	getTokenStorePath: vi.fn(() => '/tmp/afd-cli/tokens.json'),
	createClient: vi.fn(),
}));

vi.mock('@lushly-dev/afd-client', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@lushly-dev/afd-client')>();
	return { ...actual, createClient: mocks.createClient };
});
vi.mock('../config.js', () => ({
	getConfig: () => mocks.config,
	getConfigPath: () => '/tmp/afd-cli/config.json',
}));
vi.mock('../oauth-client.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../oauth-client.js')>();
	return {
		...actual,
		loginWithOAuth: mocks.loginWithOAuth,
		resolveOAuthBearerToken: mocks.resolveOAuthBearerToken,
	};
});
vi.mock('../token-store.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../token-store.js')>();
	return {
		...actual,
		listStoredTokens: mocks.listStoredTokens,
		deleteStoredToken: mocks.deleteStoredToken,
		clearStoredTokens: mocks.clearStoredTokens,
		getTokenStorePath: mocks.getTokenStorePath,
	};
});

import { createCli } from '../cli.js';
import {
	callWithOAuthRetry,
	connectWithAuth,
	isUnauthorizedError,
	resolveConnectionAuth,
	setActiveClientAuth,
	setClient,
} from '../connection.js';
import { stripOAuthUrlCredentials } from '../credentials.js';
import { OAuthFlowError } from '../oauth-client.js';

class ExitSignal extends Error {
	constructor(readonly code: number) {
		super(`process.exit(${code})`);
	}
}

function printed(): string {
	return [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls]
		.flat()
		.join('\n');
}

async function run(...args: string[]): Promise<number | null> {
	try {
		await createCli().exitOverride().parseAsync(args, { from: 'user' });
		return null;
	} catch (error) {
		if (error instanceof ExitSignal) return error.code;
		throw error;
	}
}

describe('afd auth commands', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.config = {};
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
			throw new ExitSignal(code ?? 0);
		}) as never);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('logs in (text and json), prints authorization URL, and validates timeout/port options', async () => {
		const summary = {
			resource: 'https://loam.example.com/mcp',
			issuer: 'https://auth.example.com',
			clientId: 'https://afd.dev/oauth/cli-client.json',
			clientAuthMethod: 'none' as const,
			scope: 'loam:read offline_access',
			expiresAt: Math.floor(Date.now() / 1000) + 600,
			hasRefreshToken: true,
			updatedAt: '2026-11-24T00:00:00.000Z',
		};
		mocks.loginWithOAuth.mockImplementation(
			async (opts: { onAuthorizationUrl?: (u: string) => void }) => {
				opts.onAuthorizationUrl?.('https://auth.example.com/authorize?client_id=test');
				return { summary, registrationMode: 'cimd', browserOpened: false };
			}
		);

		expect(
			await run(
				'auth',
				'login',
				'https://loam.example.com/mcp',
				'--no-browser',
				'--redirect-port',
				'8123'
			)
		).toBeNull();
		expect(printed()).toContain('https://auth.example.com/authorize?client_id=test');
		expect(printed()).toContain('Tokens stored separately from config');

		vi.mocked(console.log).mockClear();
		vi.mocked(console.error).mockClear();
		expect(
			await run('auth', 'login', 'https://loam.example.com/mcp', '--no-browser', '--format', 'json')
		).toBeNull();
		const jsonOut = JSON.parse(vi.mocked(console.log).mock.calls[0]?.[0] as string) as {
			success: boolean;
			registrationMode: string;
		};
		expect(jsonOut.success).toBe(true);
		expect(jsonOut.registrationMode).toBe('cimd');

		// Validation errors
		expect(await run('auth', 'login', 'https://loam.example.com/mcp', '--timeout', '-1')).toBe(1);
		expect(
			await run('auth', 'login', 'https://loam.example.com/mcp', '--redirect-port', '99999')
		).toBe(1);
		expect(await run('auth', 'login')).toBe(1);

		// OAuthFlowError reporting
		mocks.loginWithOAuth.mockRejectedValueOnce(
			new OAuthFlowError('OAUTH_DISCOVERY_FAILED', 'Discovery failed', 'Check server URL.')
		);
		expect(await run('auth', 'login', 'https://loam.example.com/mcp')).toBe(1);
		expect(printed()).toContain('Discovery failed');
		expect(printed()).toContain('Check server URL.');
	});

	it('renders auth status in text and json for empty, valid, expiring, expired, and filtered entries', async () => {
		mocks.listStoredTokens.mockReturnValueOnce([]);
		expect(await run('auth', 'status')).toBeNull();
		expect(printed()).toContain('No stored OAuth sessions.');

		const now = Math.floor(Date.now() / 1000);
		mocks.listStoredTokens.mockReturnValue([
			{
				resource: 'https://valid.example.com/mcp',
				issuer: 'https://auth.example.com',
				clientId: 'c1',
				clientAuthMethod: 'none',
				scope: 'loam:read',
				expiresAt: now + 600,
				hasRefreshToken: true,
				updatedAt: '2026-11-24T00:00:00.000Z',
			},
			{
				resource: 'https://expiring.example.com/mcp',
				issuer: 'https://auth.example.com',
				clientId: 'c2',
				clientAuthMethod: 'none',
				expiresAt: now + 10,
				hasRefreshToken: false,
				updatedAt: '2026-11-24T00:00:00.000Z',
			},
			{
				resource: 'https://expired.example.com/mcp',
				issuer: 'https://auth.example.com',
				clientId: 'c3',
				clientAuthMethod: 'none',
				expiresAt: now - 10,
				hasRefreshToken: false,
				updatedAt: '2026-11-24T00:00:00.000Z',
			},
			{
				resource: 'https://noexp.example.com/mcp',
				issuer: 'https://auth.example.com',
				clientId: 'c4',
				clientAuthMethod: 'none',
				hasRefreshToken: false,
				updatedAt: '2026-11-24T00:00:00.000Z',
			},
		]);

		vi.mocked(console.log).mockClear();
		expect(await run('auth', 'status')).toBeNull();
		const text = printed();
		expect(text).toContain('Stored OAuth Sessions (4)');
		expect(text).toContain('valid');
		expect(text).toContain('expiring soon');
		expect(text).toContain('expired');
		expect(text).toContain('no expiry');

		vi.mocked(console.log).mockClear();
		expect(
			await run('auth', 'status', 'https://valid.example.com/mcp', '--format', 'json')
		).toBeNull();
		const parsed = JSON.parse(vi.mocked(console.log).mock.calls[0]?.[0] as string) as {
			sessions: Array<{ resource: string; state: string }>;
		};
		expect(parsed.sessions).toHaveLength(1);
		expect(parsed.sessions[0]).toMatchObject({
			resource: 'https://valid.example.com/mcp',
			state: 'valid',
		});
	});

	it('refreshes stored tokens (text, json, missing, error) and logs out (single and --all)', async () => {
		mocks.config = { serverUrl: 'https://loam.example.com/mcp' };

		mocks.resolveOAuthBearerToken.mockResolvedValueOnce(undefined);
		expect(await run('auth', 'refresh')).toBe(1);
		expect(printed()).toContain('No stored OAuth session');

		mocks.resolveOAuthBearerToken.mockResolvedValue({
			token: 'secret-never-printed-token',
			refreshed: true,
			entry: {
				resource: 'https://loam.example.com/mcp',
				issuer: 'https://auth.example.com',
				tokenEndpoint: 'https://auth.example.com/token',
				clientId: 'cli-1',
				clientAuthMethod: 'none',
				accessToken: 'secret-never-printed-token',
				refreshToken: 'secret-refresh-never-printed',
				expiresAt: Math.floor(Date.now() / 1000) + 600,
				scope: 'loam:read',
				updatedAt: '2026-11-24T00:00:00.000Z',
			},
		});

		vi.mocked(console.log).mockClear();
		expect(await run('auth', 'refresh')).toBeNull();
		expect(printed()).not.toContain('secret-never-printed-token');
		expect(printed()).not.toContain('secret-refresh-never-printed');

		vi.mocked(console.log).mockClear();
		expect(await run('auth', 'refresh', '--format', 'json')).toBeNull();
		const refreshedJson = vi.mocked(console.log).mock.calls[0]?.[0] as string;
		expect(JSON.parse(refreshedJson)).toMatchObject({ success: true, hasRefreshToken: true });
		expect(refreshedJson).not.toContain('secret-never-printed-token');

		mocks.resolveOAuthBearerToken.mockRejectedValueOnce(new Error('network error'));
		expect(await run('auth', 'refresh')).toBe(1);

		// Logout single and --all
		mocks.deleteStoredToken.mockReturnValueOnce(true).mockReturnValueOnce(false);
		expect(await run('auth', 'logout')).toBeNull();
		expect(await run('auth', 'logout')).toBeNull();

		mocks.clearStoredTokens.mockReturnValueOnce(2).mockReturnValueOnce(0);
		expect(await run('auth', 'logout', '--all')).toBeNull();
		expect(await run('auth', 'logout', '--all')).toBeNull();
	});

	it('retries connectWithAuth once with forceRefresh on initial HTTP 401', async () => {
		expect(isUnauthorizedError({ status: 401 })).toBe(true);
		expect(isUnauthorizedError({ name: 'UnauthorizedError' })).toBe(true);
		expect(isUnauthorizedError(new Error('HTTP 401 Unauthorized'))).toBe(true);
		expect(isUnauthorizedError({ cause: { status: 401 } })).toBe(true);
		expect(isUnauthorizedError(new Error('500 Internal Server Error'))).toBe(false);

		const firstClient = {
			connect: vi.fn().mockRejectedValue(Object.assign(new Error('HTTP 401'), { status: 401 })),
			disconnect: vi.fn().mockResolvedValue(undefined),
		} as unknown as McpClient;
		const secondClient = {
			connect: vi.fn().mockResolvedValue({ serverInfo: { name: 'ok', version: '1' } }),
			disconnect: vi.fn().mockResolvedValue(undefined),
		} as unknown as McpClient;
		mocks.createClient.mockReturnValueOnce(firstClient).mockReturnValueOnce(secondClient);

		mocks.resolveOAuthBearerToken
			.mockResolvedValueOnce({
				token: 'stale-token',
				refreshed: false,
				entry: {
					resource: 'https://loam.example.com/mcp',
					issuer: 'https://auth.example.com',
					tokenEndpoint: 'https://auth.example.com/token',
					clientId: 'cli',
					clientAuthMethod: 'none',
					accessToken: 'stale-token',
					refreshToken: 'rt-1',
					updatedAt: '2026-11-24T00:00:00.000Z',
				},
			})
			.mockResolvedValueOnce({
				token: 'fresh-token',
				refreshed: true,
				entry: {
					resource: 'https://loam.example.com/mcp',
					issuer: 'https://auth.example.com',
					tokenEndpoint: 'https://auth.example.com/token',
					clientId: 'cli',
					clientAuthMethod: 'none',
					accessToken: 'fresh-token',
					refreshToken: 'rt-2',
					updatedAt: '2026-11-24T00:00:00.000Z',
				},
			});

		const result = await connectWithAuth(
			{
				url: 'https://loam.example.com/mcp',
				transport: 'streamable-http',
				timeout: 5000,
				autoReconnect: false,
			},
			{ storePath: '/tmp/afd-cli/tokens.json' }
		);

		expect(result.client).toBe(secondClient);
		expect(firstClient.disconnect).toHaveBeenCalledTimes(1);
		expect(mocks.resolveOAuthBearerToken).toHaveBeenCalledTimes(2);
		expect(mocks.resolveOAuthBearerToken).toHaveBeenNthCalledWith(
			2,
			'https://loam.example.com/mcp',
			expect.objectContaining({ forceRefresh: true })
		);

		// A second 401 after refresh stops without looping.
		const thirdClient = {
			connect: vi.fn().mockRejectedValue(Object.assign(new Error('HTTP 401'), { status: 401 })),
			disconnect: vi.fn().mockResolvedValue(undefined),
		} as unknown as McpClient;
		const fourthClient = {
			connect: vi
				.fn()
				.mockRejectedValue(Object.assign(new Error('HTTP 401 again'), { status: 401 })),
			disconnect: vi.fn().mockResolvedValue(undefined),
		} as unknown as McpClient;
		mocks.createClient.mockReturnValueOnce(thirdClient).mockReturnValueOnce(fourthClient);
		mocks.resolveOAuthBearerToken
			.mockResolvedValueOnce({
				token: 'stale-2',
				refreshed: false,
				entry: {
					resource: 'https://loam.example.com/mcp',
					issuer: 'https://auth.example.com',
					tokenEndpoint: 'https://auth.example.com/token',
					clientId: 'cli',
					clientAuthMethod: 'none',
					accessToken: 'stale-2',
					refreshToken: 'rt-1',
					updatedAt: '2026-11-24T00:00:00.000Z',
				},
			})
			.mockResolvedValueOnce({
				token: 'still-rejected',
				refreshed: true,
				entry: {
					resource: 'https://loam.example.com/mcp',
					issuer: 'https://auth.example.com',
					tokenEndpoint: 'https://auth.example.com/token',
					clientId: 'cli',
					clientAuthMethod: 'none',
					accessToken: 'still-rejected',
					refreshToken: 'rt-2',
					updatedAt: '2026-11-24T00:00:00.000Z',
				},
			});

		await expect(
			connectWithAuth(
				{
					url: 'https://loam.example.com/mcp',
					transport: 'streamable-http',
					timeout: 5000,
					autoReconnect: false,
				},
				{ storePath: '/tmp/afd-cli/tokens.json' }
			)
		).rejects.toThrow(/401 again/);
		expect(fourthClient.disconnect).toHaveBeenCalledTimes(1);
	});

	it('skips browser launch automatically when non-interactive (stdin/stdout not a TTY)', async () => {
		const origStdinTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
		const origStdoutTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
		Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
		Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
		mocks.loginWithOAuth.mockResolvedValueOnce({
			summary: {
				resource: 'https://loam.example.com/mcp',
				issuer: 'https://auth.example.com',
				clientId: 'https://afd.dev/oauth/cli-client.json',
				clientAuthMethod: 'none',
				hasRefreshToken: false,
				updatedAt: '2026-11-24T00:00:00.000Z',
			},
			registrationMode: 'cimd',
			browserOpened: false,
		});
		try {
			expect(await run('auth', 'login', 'https://loam.example.com/mcp')).toBeNull();
			expect(mocks.loginWithOAuth).toHaveBeenCalledWith(
				expect.objectContaining({ noBrowser: true })
			);
		} finally {
			if (origStdinTty) Object.defineProperty(process.stdin, 'isTTY', origStdinTty);
			if (origStdoutTty) Object.defineProperty(process.stdout, 'isTTY', origStdoutTty);
		}
	});

	it('distinguishes real transport HTTP 401 from application HTTP_401 in callWithOAuthRetry', async () => {
		// 1. Application tool result with error code HTTP_401 MUST NOT replay or refresh.
		const appClient = {
			callTool: vi.fn().mockResolvedValue({
				content: [
					{
						type: 'text',
						text: JSON.stringify({
							success: false,
							error: { code: 'HTTP_401', message: 'Upstream partner API returned 401' },
						}),
					},
				],
			}),
			call: vi.fn(),
			disconnect: vi.fn().mockResolvedValue(undefined),
		} as unknown as McpClient;
		setClient(appClient);
		setActiveClientAuth({
			url: 'https://loam.example.com/mcp',
			transport: 'streamable-http',
			timeout: 5000,
			autoReconnect: false,
			storePath: '/tmp/afd-cli/tokens.json',
			usedOAuth: true,
			hasRefreshToken: true,
		});

		const appRes = await callWithOAuthRetry(appClient, 'partner-mutate', { id: 1 });
		expect(appRes.success).toBe(false);
		expect(appRes.error?.code).toBe('HTTP_401');
		expect(appClient.callTool).toHaveBeenCalledTimes(1);
		expect(mocks.resolveOAuthBearerToken).not.toHaveBeenCalled();

		// 2. Real transport HTTP 401 throw from callTool refreshes ONCE and retries.
		const transport401Client = {
			callTool: vi
				.fn()
				.mockRejectedValue(
					Object.assign(new Error('HTTP error: 401 Unauthorized'), { status: 401 })
				),
			call: vi.fn(),
			disconnect: vi.fn().mockResolvedValue(undefined),
		} as unknown as McpClient;
		const refreshedClient = {
			connect: vi.fn().mockResolvedValue({ serverInfo: { name: 'ok', version: '1' } }),
			call: vi.fn().mockResolvedValue({ success: true, data: { ok: true } }),
			disconnect: vi.fn().mockResolvedValue(undefined),
		} as unknown as McpClient;
		mocks.createClient.mockReturnValueOnce(refreshedClient);
		mocks.resolveOAuthBearerToken.mockResolvedValueOnce({
			token: 'refreshed-tok',
			refreshed: true,
			entry: {
				resource: 'https://loam.example.com/mcp',
				issuer: 'https://auth.example.com',
				tokenEndpoint: 'https://auth.example.com/token',
				clientId: 'cli',
				clientAuthMethod: 'none',
				accessToken: 'refreshed-tok',
				refreshToken: 'rt-new',
				updatedAt: '2026-11-24T00:00:00.000Z',
			},
		});
		setClient(transport401Client);
		setActiveClientAuth({
			url: 'https://loam.example.com/mcp',
			transport: 'streamable-http',
			timeout: 5000,
			autoReconnect: false,
			storePath: '/tmp/afd-cli/tokens.json',
			usedOAuth: true,
			hasRefreshToken: true,
		});

		const retried = await callWithOAuthRetry(transport401Client, 'whoami-get', {});
		expect(retried).toEqual({ success: true, data: { ok: true } });
		expect(transport401Client.disconnect).toHaveBeenCalledTimes(1);
		expect(refreshedClient.call).toHaveBeenCalledTimes(1);

		// 3. Non-401 errors preserve HTTP_403 and OUTCOME_UNKNOWN classification for mutations.
		const { HttpStatusError, RequestTimeoutError } = await import('@lushly-dev/afd-client');
		const forbiddenClient = {
			callTool: vi.fn().mockRejectedValue(new HttpStatusError(403, 'Forbidden')),
			getTools: vi.fn().mockReturnValue([]),
			call: vi.fn(),
			disconnect: vi.fn().mockResolvedValue(undefined),
		} as unknown as McpClient;
		setClient(forbiddenClient);
		setActiveClientAuth({
			url: 'https://loam.example.com/mcp',
			transport: 'streamable-http',
			timeout: 5000,
			autoReconnect: false,
			storePath: '/tmp/afd-cli/tokens.json',
			usedOAuth: true,
			hasRefreshToken: true,
		});
		const forbiddenRes = await callWithOAuthRetry(forbiddenClient, 'admin-write', {});
		expect(forbiddenRes.success).toBe(false);
		expect(forbiddenRes.error?.code).toBe('HTTP_403');
		expect(forbiddenRes.error?.retryable).toBe(false);

		const timeoutClient = {
			callTool: vi.fn().mockRejectedValue(new RequestTimeoutError('tools/call', 5000)),
			getTools: vi.fn().mockReturnValue([{ name: 'doc-delete', _meta: { mutation: true } }]),
			call: vi.fn(),
			disconnect: vi.fn().mockResolvedValue(undefined),
		} as unknown as McpClient;
		setClient(timeoutClient);
		setActiveClientAuth({
			url: 'https://loam.example.com/mcp',
			transport: 'streamable-http',
			timeout: 5000,
			autoReconnect: false,
			storePath: '/tmp/afd-cli/tokens.json',
			usedOAuth: true,
			hasRefreshToken: true,
		});
		const timeoutRes = await callWithOAuthRetry(timeoutClient, 'doc-delete', {});
		expect(timeoutRes.success).toBe(false);
		expect(timeoutRes.error?.code).toBe('OUTCOME_UNKNOWN');
		expect(timeoutRes.error?.retryable).toBe(false);
		setClient(null);
	});

	it('strips OAuth query/fragment credentials before persisting URLs and refuses derived routes for stored OAuth tokens', async () => {
		expect(
			stripOAuthUrlCredentials(
				'https://loam.example.com/mcp?code=abc&access_token=tok&refresh_token=rt&keep=1#id_token=idt'
			)
		).toEqual({
			url: 'https://loam.example.com/mcp?keep=1',
			stripped: true,
		});
		expect(stripOAuthUrlCredentials('https://loam.example.com/mcp?page=2')).toEqual({
			url: 'https://loam.example.com/mcp?page=2',
			stripped: false,
		});

		// Derived routes without an explicit Authorization header refuse stored OAuth tokens.
		const storeModule = await import('../token-store.js');
		const getSpy = vi.spyOn(storeModule, 'getStoredToken').mockReturnValue({
			resource: 'https://loam.example.com/mcp',
			issuer: 'https://auth.example.com',
			tokenEndpoint: 'https://auth.example.com/token',
			clientId: 'cli',
			clientAuthMethod: 'none',
			accessToken: 'tok-abc',
			updatedAt: '2026-11-24T00:00:00.000Z',
		});
		try {
			await expect(
				resolveConnectionAuth('https://loam.example.com/mcp', undefined, {
					storePath: '/tmp/afd-cli/tokens.json',
					derivedRoute: true,
					transport: 'streamable-http',
				})
			).rejects.toMatchObject({ code: 'OAUTH_DERIVED_ROUTE_REFUSED' });

			await expect(
				resolveConnectionAuth('https://loam.example.com/mcp', undefined, {
					storePath: '/tmp/afd-cli/tokens.json',
					transport: 'http',
				})
			).rejects.toMatchObject({ code: 'OAUTH_DERIVED_ROUTE_REFUSED' });

			// Explicit --header still works on derived routes.
			const explicit = await resolveConnectionAuth(
				'https://loam.example.com/mcp',
				{ Authorization: 'Bearer explicit-tok' },
				{ storePath: '/tmp/afd-cli/tokens.json', derivedRoute: true }
			);
			expect(explicit.usedOAuth).toBe(false);
		} finally {
			getSpy.mockRestore();
		}
	});
});
