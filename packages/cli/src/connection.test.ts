import type { McpClient } from '@lushly-dev/afd-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	config: {
		serverUrl: 'http://saved.example/mcp',
		transport: 'sse' as const,
		timeout: 4321,
		autoReconnect: false as boolean,
	},
	createClient: vi.fn(),
}));

vi.mock('@lushly-dev/afd-client', () => ({ createClient: mocks.createClient }));
vi.mock('./config.js', () => ({ getConfig: () => mocks.config }));

import {
	closeClient,
	createCliClient,
	ensureConnected,
	getClient,
	headersOrExit,
	inferTransport,
	requireClient,
	setClient,
	tryConnect,
} from './connection.js';

function makeClient() {
	return {
		connect: vi.fn().mockResolvedValue({}),
		disconnect: vi.fn().mockResolvedValue(undefined),
		getStatus: vi.fn().mockReturnValue({ url: 'http://saved.example/mcp' }),
		isConnected: vi.fn().mockReturnValue(false),
	} as unknown as McpClient;
}

describe('ensureConnected', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setClient(null);
	});

	it('recreates a connection with all persisted settings', async () => {
		const client = makeClient();
		mocks.createClient.mockReturnValue(client);

		expect(await ensureConnected()).toBe(client);
		expect(mocks.createClient).toHaveBeenCalledWith({
			url: 'http://saved.example/mcp',
			transport: 'sse',
			timeout: 4321,
			autoReconnect: false,
		});
		expect(getClient()).toBe(client);
	});

	it('uses an explicit per-command URL without changing stored configuration', async () => {
		const client = makeClient();
		mocks.createClient.mockReturnValue(client);

		await ensureConnected({ url: 'http://scenario.example/mcp', transport: 'http', timeout: 99 });

		expect(mocks.createClient).toHaveBeenCalledWith({
			url: 'http://scenario.example/mcp',
			transport: 'http',
			timeout: 99,
			autoReconnect: false,
		});
		expect(mocks.config.serverUrl).toBe('http://saved.example/mcp');
	});

	it('returns null and closes a client that cannot connect', async () => {
		const client = makeClient();
		vi.mocked(client.connect).mockRejectedValue(new Error('offline'));
		mocks.createClient.mockReturnValue(client);

		expect(await ensureConnected()).toBeNull();
		expect(client.disconnect).toHaveBeenCalled();
	});

	it('never auto-reconnects, even when the saved connection enabled it', async () => {
		mocks.createClient.mockReturnValue(makeClient());
		mocks.config.autoReconnect = true;
		try {
			await ensureConnected();
		} finally {
			mocks.config.autoReconnect = false;
		}

		expect(mocks.createClient).toHaveBeenCalledWith(
			expect.objectContaining({ autoReconnect: false })
		);
	});

	it('disconnects the client it replaces', async () => {
		const previous = makeClient();
		const next = makeClient();
		setClient(previous);
		mocks.createClient.mockReturnValue(next);

		expect(await ensureConnected()).toBe(next);
		expect(previous.disconnect).toHaveBeenCalled();
		expect(next.disconnect).not.toHaveBeenCalled();
	});
});

describe('closeClient', () => {
	beforeEach(() => {
		setClient(null);
	});

	it('disconnects and forgets the active client', async () => {
		const client = makeClient();
		setClient(client);

		await closeClient();

		expect(client.disconnect).toHaveBeenCalledTimes(1);
		expect(getClient()).toBeNull();
	});

	it('is a no-op without a client and ignores disconnect failures', async () => {
		await expect(closeClient()).resolves.toBeUndefined();

		const client = makeClient();
		vi.mocked(client.disconnect).mockRejectedValue(new Error('already closed'));
		setClient(client);

		await expect(closeClient()).resolves.toBeUndefined();
		expect(getClient()).toBeNull();
	});
});

describe('tryConnect', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setClient(null);
	});

	it('reports why there is no client', async () => {
		const saved = mocks.config.serverUrl;
		mocks.config.serverUrl = undefined as unknown as string;
		try {
			expect(await tryConnect()).toEqual({ client: null });
		} finally {
			mocks.config.serverUrl = saved;
		}

		const client = makeClient();
		vi.mocked(client.connect).mockRejectedValue('refused');
		mocks.createClient.mockReturnValue(client);
		const attempt = await tryConnect({ url: 'http://down.example/mcp' });
		expect(attempt).toMatchObject({ client: null, url: 'http://down.example/mcp' });
		expect(attempt.client === null && attempt.error?.message).toBe('refused');
	});

	it('passes request headers to the client only when there are some', async () => {
		mocks.createClient.mockReturnValue(makeClient());

		await tryConnect({ headers: { Authorization: 'Bearer abc' } });
		await tryConnect({ headers: {} });

		expect(mocks.createClient).toHaveBeenNthCalledWith(1, {
			url: 'http://saved.example/mcp',
			transport: 'sse',
			timeout: 4321,
			autoReconnect: false,
			headers: { Authorization: 'Bearer abc' },
		});
		expect(mocks.createClient.mock.calls[1]?.[0]).not.toHaveProperty('headers');
	});

	it('reuses the live client for the same URL', async () => {
		const live = makeClient();
		vi.mocked(live.isConnected).mockReturnValue(true);
		setClient(live);

		expect(await tryConnect()).toEqual({ client: live });
		expect(await tryConnect({ url: 'http://saved.example/mcp' })).toEqual({ client: live });
		expect(mocks.createClient).not.toHaveBeenCalled();
	});
});

describe('requireClient', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setClient(null);
		vi.stubEnv('AFD_HEADERS', '');
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`exit ${code}`);
		});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	function output(): string {
		return [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls]
			.flat()
			.join('\n');
	}

	it('returns a connected client with the --header and AFD_HEADERS headers', async () => {
		const client = makeClient();
		mocks.createClient.mockReturnValue(client);
		vi.stubEnv('AFD_HEADERS', 'X-Tenant: acme');

		expect(await requireClient({ header: ['Authorization: Bearer flag'] })).toBe(client);
		expect(mocks.createClient).toHaveBeenCalledWith(
			expect.objectContaining({
				headers: { 'X-Tenant': 'acme', Authorization: 'Bearer flag' },
			})
		);
	});

	it('exits with a hint to connect when no server is configured', async () => {
		const saved = mocks.config.serverUrl;
		mocks.config.serverUrl = undefined as unknown as string;
		try {
			await expect(requireClient({})).rejects.toThrow('exit 1');
		} finally {
			mocks.config.serverUrl = saved;
		}
		expect(output()).toContain('Not connected. Run "afd connect <url>" first.');
	});

	it('exits with the redacted URL, the reason and an authentication hint', async () => {
		const client = makeClient();
		vi.mocked(client.connect).mockRejectedValue(new Error('HTTP error: 401 Unauthorized'));
		mocks.createClient.mockReturnValue(client);

		await expect(
			requireClient({}, { url: 'http://u:pw@down.example/mcp?token=abc' })
		).rejects.toThrow('exit 1');

		const text = output();
		expect(text).toContain('Could not connect to http://***@down.example/mcp?token=***');
		expect(text).toContain('401 Unauthorized');
		expect(text).toContain('--header');
		expect(text).toContain('AFD_HEADERS');
		expect(text).not.toContain('pw@');
		expect(text).not.toContain('abc');
	});

	it('exits before connecting when AFD_HEADERS is malformed', async () => {
		vi.stubEnv('AFD_HEADERS', 'not a header');
		expect(() => headersOrExit(undefined)).toThrow('exit 1');
		expect(output()).toContain('AFD_HEADERS: Invalid header "not a header"');
		expect(mocks.createClient).not.toHaveBeenCalled();
	});
});

describe('client settings', () => {
	it('infers SSE only for a /sse endpoint', () => {
		expect(inferTransport('http://h:1/sse')).toBe('sse');
		expect(inferTransport('http://h:1/api/sse/?token=x')).toBe('sse');
		expect(inferTransport('http://h:1/message')).toBe('http');
		expect(inferTransport('http://h:1/ssе-lookalike')).toBe('http');
		expect(inferTransport('not a url')).toBe('http');
	});

	it('creates clients with exactly the given settings', () => {
		vi.clearAllMocks();
		createCliClient({ url: 'http://h/sse', transport: 'sse', timeout: 1, autoReconnect: true });
		expect(mocks.createClient).toHaveBeenCalledWith({
			url: 'http://h/sse',
			transport: 'sse',
			timeout: 1,
			autoReconnect: true,
		});
	});
});
