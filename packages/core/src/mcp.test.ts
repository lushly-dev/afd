import { describe, expect, it } from 'vitest';
import {
	createMcpErrorResponse,
	createMcpRequest,
	createMcpResponse,
	isMcpNotification,
	isMcpRequest,
	isMcpResponse,
	textContent,
} from './mcp.js';

describe('createMcpRequest', () => {
	it('creates request with auto-incrementing IDs', () => {
		const req1 = createMcpRequest('tools/list');
		const req2 = createMcpRequest('tools/call');
		expect(req2.id).toBeGreaterThan(req1.id as number);
	});

	it('sets jsonrpc to 2.0', () => {
		const req = createMcpRequest('test/method');
		expect(req.jsonrpc).toBe('2.0');
	});

	it('sets method correctly', () => {
		const req = createMcpRequest('tools/list');
		expect(req.method).toBe('tools/list');
	});

	it('includes params when provided', () => {
		const req = createMcpRequest('tools/call', { name: 'my-tool' });
		expect(req.params).toEqual({ name: 'my-tool' });
	});

	it('omits params when not provided', () => {
		const req = createMcpRequest('test');
		expect(req.params).toBeUndefined();
	});
});

describe('createMcpResponse', () => {
	it('creates success response with result', () => {
		const res = createMcpResponse(1, { data: 'hello' });
		expect(res.jsonrpc).toBe('2.0');
		expect(res.id).toBe(1);
		expect(res.result).toEqual({ data: 'hello' });
		expect(res.error).toBeUndefined();
	});

	it('accepts string IDs', () => {
		const res = createMcpResponse('abc-123', null);
		expect(res.id).toBe('abc-123');
	});
});

describe('createMcpErrorResponse', () => {
	it('creates error response with code and message', () => {
		const res = createMcpErrorResponse(1, -32601, 'Method not found');
		expect(res.jsonrpc).toBe('2.0');
		expect(res.id).toBe(1);
		expect(res.error).toEqual({ code: -32601, message: 'Method not found', data: undefined });
		expect(res.result).toBeUndefined();
	});

	it('includes data in error when provided', () => {
		const res = createMcpErrorResponse(2, -32602, 'Invalid params', { missing: 'name' });
		expect(res.error?.data).toEqual({ missing: 'name' });
	});
});

describe('textContent', () => {
	it('creates text content object', () => {
		const content = textContent('hello world');
		expect(content.type).toBe('text');
		expect(content.text).toBe('hello world');
	});

	it('handles empty string', () => {
		const content = textContent('');
		expect(content.text).toBe('');
	});
});

describe('isMcpRequest', () => {
	it('returns true for valid requests', () => {
		expect(isMcpRequest({ jsonrpc: '2.0', id: 1, method: 'test' })).toBe(true);
	});

	it('returns true for requests with params', () => {
		expect(isMcpRequest({ jsonrpc: '2.0', id: 1, method: 'test', params: {} })).toBe(true);
	});

	it('returns false for non-2.0 jsonrpc', () => {
		expect(isMcpRequest({ jsonrpc: '1.0', id: 1, method: 'test' })).toBe(false);
	});

	it('returns false for missing id', () => {
		expect(isMcpRequest({ jsonrpc: '2.0', method: 'test' })).toBe(false);
	});

	it('returns false for missing method', () => {
		expect(isMcpRequest({ jsonrpc: '2.0', id: 1 })).toBe(false);
	});

	it('returns false for null', () => {
		expect(isMcpRequest(null)).toBe(false);
	});

	it('returns false for primitives', () => {
		expect(isMcpRequest('string')).toBe(false);
		expect(isMcpRequest(42)).toBe(false);
	});
});

describe('isMcpResponse', () => {
	it('returns true for success response', () => {
		expect(isMcpResponse({ jsonrpc: '2.0', id: 1, result: {} })).toBe(true);
	});

	it('returns true for error response', () => {
		expect(isMcpResponse({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'err' } })).toBe(
			true
		);
	});

	it('returns false for notification (no id)', () => {
		expect(isMcpResponse({ jsonrpc: '2.0', result: {} })).toBe(false);
	});

	it('returns false for missing both result and error', () => {
		expect(isMcpResponse({ jsonrpc: '2.0', id: 1 })).toBe(false);
	});

	it('returns false for request (has method, no result/error)', () => {
		expect(isMcpResponse({ jsonrpc: '2.0', id: 1, method: 'test' })).toBe(false);
	});

	it('returns false for null', () => {
		expect(isMcpResponse(null)).toBe(false);
	});
});

describe('isMcpNotification', () => {
	it('returns true for valid notification', () => {
		expect(isMcpNotification({ jsonrpc: '2.0', method: 'notify' })).toBe(true);
	});

	it('returns true for notification with params', () => {
		expect(isMcpNotification({ jsonrpc: '2.0', method: 'notify', params: { a: 1 } })).toBe(true);
	});

	it('returns false for request (has id)', () => {
		expect(isMcpNotification({ jsonrpc: '2.0', id: 1, method: 'test' })).toBe(false);
	});

	it('returns false for missing method', () => {
		expect(isMcpNotification({ jsonrpc: '2.0' })).toBe(false);
	});

	it('returns false for non-2.0 jsonrpc', () => {
		expect(isMcpNotification({ jsonrpc: '1.0', method: 'test' })).toBe(false);
	});

	it('returns false for null', () => {
		expect(isMcpNotification(null)).toBe(false);
	});
});
