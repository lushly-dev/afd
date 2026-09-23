import type { McpClient } from '@lushly-dev/afd-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { closeClient, ensureConnected, getClient, setClient } from './connection.js';

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
