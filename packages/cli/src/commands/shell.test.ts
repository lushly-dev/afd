import type { McpClient } from '@lushly-dev/afd-client';
import type { McpTool } from '@lushly-dev/afd-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const handlers = new Map<string, (...args: unknown[]) => unknown>();
	const readline = {
		prompt: vi.fn(),
		setPrompt: vi.fn(),
		close: vi.fn(() => {
			handlers.get('close')?.();
		}),
		on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
			handlers.set(event, handler);
			return readline;
		}),
	};
	return {
		handlers,
		readline,
		createClient: vi.fn(),
		config: {} as Record<string, unknown>,
		saveConnection: vi.fn(),
	};
});

vi.mock('node:readline', () => ({ createInterface: () => mocks.readline }));
vi.mock('@lushly-dev/afd-client', () => ({ createClient: mocks.createClient }));
vi.mock('../config.js', () => ({
	getConfig: () => mocks.config,
	saveConnection: mocks.saveConnection,
	deleteConfig: vi.fn(),
}));

import { createCli } from '../cli.js';
import { getClient, setClient } from '../connection.js';

const TOOLS: McpTool[] = [
	{ name: 'todo.create', description: 'Create todo', inputSchema: { type: 'object' } },
	{ name: 'health-ping', description: 'Ping', inputSchema: { type: 'object' } },
	{ name: 'ping', description: 'Single-word tool', inputSchema: { type: 'object' } },
];

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
		refreshTools: vi.fn().mockResolvedValue(TOOLS),
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

function printed(): string {
	return [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls]
		.flat()
		.join('\n');
}

describe('interactive shell', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.handlers.clear();
		mocks.config = {};
		setClient(null);
		vi.stubEnv('AFD_HEADERS', '');
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.spyOn(console, 'clear').mockImplementation(() => undefined);
		vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

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
		await line('tools health');
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
		expect(printed()).toContain('Unknown command: unknown');
		expect(printed()).toContain('health-ping');
		expect(printed()).toContain('Usage: connect <url> [sse|http]');
	});

	it('parses tool arguments from the raw line and resolves kebab-case shorthand', async () => {
		const client = connectedClient();
		mocks.createClient.mockReturnValue(client);
		mocks.config = { serverUrl: 'http://saved/message' };

		const { done } = await startShell();
		await line('health-ping {"echo":"two  spaces\\tand a tab"}');
		await line('call health-ping   {"echo": "  padded  "}');
		await line('call health-ping echo="Buy oat milk" count=2');
		await line('ping');
		await line('todo-create-later title=x');
		await line('bogus');
		closeInput();
		await done;

		expect(vi.mocked(client.call).mock.calls).toEqual([
			['health-ping', { echo: 'two  spaces\tand a tab' }],
			['health-ping', { echo: '  padded  ' }],
			['health-ping', { echo: 'Buy oat milk', count: 2 }],
			['ping', {}],
			// Not listed, but shaped like an AFD command name: grouped and lazy
			// servers do not list every command, so the server decides.
			['todo-create-later', { title: 'x' }],
		]);
		expect(printed()).toContain('Unknown command: bogus');
	});

	it('reports malformed arguments without calling the tool', async () => {
		const client = connectedClient();
		mocks.createClient.mockReturnValue(client);

		const { done } = await startShell('--url', 'http://auto/mcp');
		await line('call health-ping {broken');
		await line('health-ping loose-word');
		await line('health-ping note="unterminated');
		closeInput();
		await done;

		expect(client.call).not.toHaveBeenCalled();
		expect(printed()).toContain('Invalid arguments');
		expect(printed()).toContain('Expected key=value, got "loose-word"');
		expect(printed()).toContain('Unterminated " quote');
	});

	it('--url infers the transport, saves it with the URL, and sends --header values', async () => {
		const client = connectedClient();
		mocks.createClient.mockReturnValue(client);

		const { done } = await startShell(
			'--url',
			'http://auto/sse',
			'--header',
			'Authorization: Bearer shell-secret'
		);
		closeInput();
		await done;

		expect(mocks.createClient).toHaveBeenCalledWith({
			url: 'http://auto/sse',
			transport: 'sse',
			timeout: 30000,
			autoReconnect: true,
			headers: { Authorization: 'Bearer shell-secret' },
		});
		// The transport is saved with the URL, and the header is not saved at all.
		expect(mocks.saveConnection).toHaveBeenCalledWith({
			url: 'http://auto/sse',
			transport: 'sse',
			timeout: 30000,
			autoReconnect: true,
		});
		expect(JSON.stringify(mocks.saveConnection.mock.calls)).not.toContain('shell-secret');
	});

	it('honours --transport, --timeout and --no-reconnect', async () => {
		mocks.createClient.mockReturnValue(connectedClient());

		const { done } = await startShell(
			'--url',
			'http://auto/sse',
			'--transport',
			'http',
			'--timeout',
			'50',
			'--no-reconnect'
		);
		closeInput();
		await done;

		expect(mocks.createClient).toHaveBeenCalledWith({
			url: 'http://auto/sse',
			transport: 'http',
			timeout: 50,
			autoReconnect: false,
		});
	});

	it('reopens the saved connection with its transport, timeout and reconnect choice', async () => {
		mocks.createClient.mockReturnValue(connectedClient());
		mocks.config = {
			serverUrl: 'http://saved/sse',
			transport: 'http',
			timeout: 1234,
			autoReconnect: false,
		};

		const { done } = await startShell();
		closeInput();
		await done;

		expect(mocks.createClient).toHaveBeenCalledWith({
			url: 'http://saved/sse',
			transport: 'http',
			timeout: 1234,
			autoReconnect: false,
		});
		expect(mocks.saveConnection).not.toHaveBeenCalled();
	});

	it('connect takes an optional transport and redacts credentials when printing the URL', async () => {
		mocks.createClient.mockReturnValue(connectedClient());

		const { done } = await startShell();
		await line('connect http://shell/mcp websocket');
		await line('connect http://user:hunter2@shell/sse?token=abc123 http');
		closeInput();
		await done;

		expect(mocks.createClient).toHaveBeenCalledTimes(1);
		expect(mocks.createClient).toHaveBeenCalledWith(
			expect.objectContaining({ transport: 'http', autoReconnect: true })
		);
		expect(printed()).toContain('Usage: connect <url> [sse|http]');
		expect(printed()).toContain('http://***@shell/sse?token=***');
		expect(printed()).not.toContain('hunter2');
		expect(printed()).not.toContain('abc123');
	});

	it('exit closes the input: later lines are skipped and the client disconnects', async () => {
		const client = connectedClient();
		mocks.createClient.mockReturnValue(client);

		const { done } = await startShell('--url', 'http://auto/mcp');
		await line('?');
		await line('list');
		await line('q');
		await line('health-ping');
		await done;

		expect(mocks.readline.close).toHaveBeenCalled();
		expect(client.call).not.toHaveBeenCalled();
		expect(client.disconnect).toHaveBeenCalled();
		expect(getClient()).toBeNull();
		expect(process.exit).not.toHaveBeenCalled();
		expect(console.log).toHaveBeenLastCalledWith('Goodbye!');
	});

	it('keeps the shell available when connection attempts fail', async () => {
		const failed = connectedClient();
		vi.mocked(failed.connect).mockRejectedValue(new Error('offline'));
		mocks.createClient.mockReturnValue(failed);

		const { done } = await startShell('--url', 'http://offline/mcp');
		await line('connect http://offline/mcp');
		closeInput();
		await done;

		expect(
			vi.mocked(console.error).mock.calls.filter(([, text]) => text === 'Connection failed')
		).toHaveLength(2);
		expect(mocks.saveConnection).not.toHaveBeenCalled();
		expect(mocks.readline.prompt).toHaveBeenCalled();
	});

	it('reports a call that throws and keeps running', async () => {
		const client = connectedClient();
		vi.mocked(client.call).mockRejectedValueOnce(new Error('call failed'));
		mocks.createClient.mockReturnValue(client);

		const { done } = await startShell('--url', 'http://auto/mcp');
		await line('health-ping');
		await line('health-ping');
		closeInput();
		await done;

		expect(printed()).toContain('Call failed');
		expect(client.call).toHaveBeenCalledTimes(2);
	});

	it('stays running until input closes, then finishes queued commands first', async () => {
		const client = connectedClient();
		let release: () => void = () => undefined;
		vi.mocked(client.call).mockReturnValueOnce(
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
		expect(client.disconnect).toHaveBeenCalled();
		expect(console.log).toHaveBeenLastCalledWith('Goodbye!');
		// No prompt is redrawn once the input has closed.
		expect(mocks.readline.prompt).toHaveBeenCalledTimes(promptsBeforeRelease);
	});
});
