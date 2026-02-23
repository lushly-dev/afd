import { describe, expect, it, vi } from 'vitest';
import { McpClient } from './client.js';

describe('McpClient - constructor', () => {
	it('throws without url or endpoint', () => {
		expect(() => new McpClient({})).toThrow('Either url or endpoint must be provided');
	});

	it('accepts url', () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		expect(client.getStatus().state).toBe('disconnected');
	});

	it('accepts endpoint as url alias', () => {
		const client = new McpClient({ endpoint: 'http://localhost:3100/message' });
		expect(client.getStatus().state).toBe('disconnected');
	});
});

describe('McpClient - status', () => {
	it('initial status is disconnected', () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		const status = client.getStatus();
		expect(status.state).toBe('disconnected');
		expect(status.url).toBeNull();
		expect(status.serverInfo).toBeNull();
		expect(status.capabilities).toBeNull();
		expect(status.connectedAt).toBeNull();
		expect(status.reconnectAttempts).toBe(0);
		expect(status.pendingRequests).toBe(0);
	});

	it('isConnected returns false when disconnected', () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		expect(client.isConnected()).toBe(false);
	});
});

describe('McpClient - events', () => {
	it('on/off subscribe and unsubscribe', () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		const handler = vi.fn();
		const unsubscribe = client.on('error', handler);

		// Unsubscribe
		unsubscribe();
		// After unsubscribe, handler should not be called
		// (we can't trigger events without connecting, but verify the API works)
		expect(typeof unsubscribe).toBe('function');
	});
});

describe('McpClient - call', () => {
	it('returns failure when callTool throws', async () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		// request() will throw "Not connected"
		const result = await client.call('test-cmd', { a: 1 });
		expect(result.success).toBe(false);
	});
});

describe('McpClient - batch', () => {
	it('returns failed batch when callTool throws', async () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		const result = await client.batch([{ command: 'test-cmd', input: { a: 1 } }]);
		expect(result.success).toBe(false);
		expect(result.summary.failureCount).toBe(1);
		expect(result.error?.code).toBe('BATCH_ERROR');
	});
});

describe('McpClient - pipe', () => {
	it('normalizes array steps to PipelineRequest', async () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		const result = await client.pipe([{ command: 'user-get', input: { id: 1 }, as: 'user' }]);
		// Not connected, so it catches and returns error pipeline result
		expect(result.metadata.confidence).toBe(0);
		expect(result.steps).toHaveLength(1);
		expect(result.steps[0]?.command).toBe('user-get');
	});

	it('accepts full PipelineRequest object', async () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		const result = await client.pipe({
			steps: [{ command: 'test-cmd', input: {} }],
		});
		expect(result.metadata.totalSteps).toBe(1);
	});
});

describe('McpClient - disconnect', () => {
	it('can disconnect even when not connected', async () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		await client.disconnect();
		expect(client.getStatus().state).toBe('disconnected');
	});
});

describe('McpClient - getTools', () => {
	it('returns empty array initially', () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		expect(client.getTools()).toEqual([]);
	});
});
