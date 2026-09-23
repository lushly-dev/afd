import type { McpClient } from '@lushly-dev/afd-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const handlers = new Map<string, (...args: unknown[]) => unknown>();
	const readline = {
		prompt: vi.fn(),
		setPrompt: vi.fn(),
		on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
			handlers.set(event, handler);
			return readline;
		}),
	};
	return {
		handlers,
		readline,
		currentClient: null as McpClient | null,
		createClient: vi.fn(),
		setConfig: vi.fn(),
	};
});

vi.mock('node:readline', () => ({ createInterface: () => mocks.readline }));
vi.mock('@lushly-dev/afd-client', () => ({ createClient: mocks.createClient }));
vi.mock('../config.js', () => ({
	getConfig: () => ({}),
	setConfig: mocks.setConfig,
	deleteConfig: vi.fn(),
}));
vi.mock('../connection.js', () => ({
	getClient: () => mocks.currentClient,
	setClient: (client: McpClient | null) => {
		mocks.currentClient = client;
	},
	ensureConnected: vi.fn(),
}));

import { createCli } from '../cli.js';

function connectedClient(): McpClient {
	return {
		connect: vi.fn().mockResolvedValue({ serverInfo: { name: 'shell', version: '1' } }),
		disconnect: vi.fn().mockResolvedValue(undefined),
		isConnected: vi.fn().mockReturnValue(true),
		getStatus: vi.fn().mockReturnValue({
			state: 'connected',
			url: 'http://shell/mcp',
			serverInfo: { name: 'shell', version: '1' },
		}),
		getTools: vi.fn().mockReturnValue([]),
		refreshTools: vi.fn().mockResolvedValue([
			{ name: 'todo.create', description: 'Create todo', inputSchema: { type: 'object' } },
			{ name: 'user.get', inputSchema: { type: 'object' } },
		]),
		call: vi.fn().mockResolvedValue({ success: true, data: { id: '1' } }),
	} as unknown as McpClient;
}

async function line(value: string): Promise<void> {
	const handler = mocks.handlers.get('line');
	if (!handler) throw new Error('line handler was not registered');
	await handler(value);
}

/**
 * Start the shell. Its command only finishes once readline closes, so the
 * returned `done` promise is awaited after `closeInput()`.
 */
async function startShell(...args: string[]): Promise<{ done: Promise<void> }> {
	const done = createCli()
		.exitOverride()
		.parseAsync(['shell', ...args], { from: 'user' })
		.then(() => undefined);
	await vi.waitFor(() => {
		if (!mocks.handlers.has('close')) throw new Error('shell has not started');
	});
	return { done };
}

function closeInput(): void {
	const handler = mocks.handlers.get('close');
	if (!handler) throw new Error('close handler was not registered');
	handler();
}

describe('interactive shell', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.handlers.clear();
		mocks.currentClient = null;
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.spyOn(console, 'clear').mockImplementation(() => undefined);
		vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
	});

	afterEach(() => vi.restoreAllMocks());

	it('drives connection, discovery, calls, status, and disconnect from readline input', async () => {
		const client = connectedClient();
		mocks.createClient.mockReturnValue(client);

		const { done } = await startShell();
		await line('');
		await line('help');
		await line('unknown');
		await line('status');
		await line('connect');
		await line('connect http://shell/mcp');
		await line('status');
		await line('tools todo');
		await line('call todo.create {"title":"Test"}');
		await line('todo.create count=2 label=hello');
		await line('clear');
		await line('disconnect');
		await line('disconnect');
		await line('tools');
		await line('call');
		closeInput();
		await done;

		expect(console.log).toHaveBeenCalledWith('Goodbye!');
		expect(client.connect).toHaveBeenCalled();
		expect(client.refreshTools).toHaveBeenCalled();
		expect(client.call).toHaveBeenNthCalledWith(1, 'todo.create', { title: 'Test' });
		expect(client.call).toHaveBeenNthCalledWith(2, 'todo.create', {
			count: 2,
			label: 'hello',
		});
		expect(client.disconnect).toHaveBeenCalled();
		expect(console.clear).toHaveBeenCalled();
		expect(mocks.readline.setPrompt).toHaveBeenCalled();
	});

	it('handles auto-connect, invalid input, failures, and exit aliases', async () => {
		const client = connectedClient();
		(client.call as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('call failed'));
		mocks.createClient.mockReturnValue(client);

		const { done } = await startShell('--url', 'http://auto/mcp');
		await line('call todo.create {broken');
		await line('call todo.create {}');
		await line('?');
		await line('list');
		await line('q');
		closeInput();
		await done;

		expect(mocks.setConfig).toHaveBeenCalledWith('serverUrl', 'http://auto/mcp');
		expect(console.error).toHaveBeenCalledWith(
			expect.anything(),
			'Invalid arguments. Use JSON or key=value format.'
		);
		expect(process.exit).toHaveBeenCalledWith(0);
	});

	it('keeps the shell available when connection attempts fail', async () => {
		const failed = connectedClient();
		(failed.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));
		mocks.createClient.mockReturnValue(failed);

		const { done } = await startShell('--url', 'http://offline/mcp');
		await line('connect http://offline/mcp');
		closeInput();
		await done;

		expect(console.error).toHaveBeenCalledWith(expect.anything(), 'Auto-connect failed');
		expect(console.error).toHaveBeenCalledWith(expect.anything(), 'Connection failed');
		expect(mocks.readline.prompt).toHaveBeenCalled();
	});

	it('stays running until input closes, then finishes queued commands first', async () => {
		const client = connectedClient();
		let release: () => void = () => undefined;
		(client.call as ReturnType<typeof vi.fn>).mockReturnValueOnce(
			new Promise((resolve) => {
				release = () => resolve({ success: true, data: { id: '1' } });
			})
		);
		mocks.createClient.mockReturnValue(client);

		const { done } = await startShell('--url', 'http://auto/mcp');
		let finished = false;
		void done.then(() => {
			finished = true;
		});

		const inFlight = line('call todo-create');
		const queued = line('status');
		closeInput();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(finished).toBe(false);
		expect(client.disconnect).not.toHaveBeenCalled();

		const promptsBeforeRelease = mocks.readline.prompt.mock.calls.length;
		release();
		await Promise.all([inFlight, queued, done]);

		expect(finished).toBe(true);
		expect(console.log).toHaveBeenLastCalledWith('Goodbye!');
		// No prompt is redrawn once the input has closed.
		expect(mocks.readline.prompt).toHaveBeenCalledTimes(promptsBeforeRelease);
	});
});
