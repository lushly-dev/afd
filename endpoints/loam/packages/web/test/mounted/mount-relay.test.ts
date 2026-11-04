/**
 * P2-E6's relay log (B3): what each request asked, read from its body, so a test can hold that only a
 * command's `tools/call` carries `dev.loam/scope`. A batch is logged as one, so none of its requests slips
 * past a filter on the method.
 */
import { describe, expect, it } from 'vitest';
import { callOf } from './mount-relay';

const body = (value: unknown) => Buffer.from(JSON.stringify(value));

describe('P2-E6: the relay logs each body as JSON-RPC', () => {
	it('reads a request, its tool and its `_meta`', () => {
		expect(
			callOf(
				body({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: {
						name: 'hello-greet',
						arguments: {},
						_meta: { 'dev.loam/scope': { workspace: 'w' } },
					},
				})
			)
		).toEqual({
			method: 'tools/call',
			name: 'hello-greet',
			meta: { 'dev.loam/scope': { workspace: 'w' } },
		});
		expect(callOf(body({ jsonrpc: '2.0', method: 'notifications/initialized' }))).toEqual({
			method: 'notifications/initialized',
		});
	});

	it('logs a batch as a batch, each request read', () => {
		expect(
			callOf(
				body([
					{
						jsonrpc: '2.0',
						id: 1,
						method: 'tools/call',
						params: { name: 'afd-help', _meta: { k: 1 } },
					},
					{ jsonrpc: '2.0', method: 'notifications/initialized' },
					'not a request',
				])
			)
		).toEqual({
			method: 'batch',
			batch: [
				{ method: 'tools/call', name: 'afd-help', meta: { k: 1 } },
				{ method: 'notifications/initialized' },
			],
		});
	});

	it('logs nothing for a body that is not JSON-RPC', () => {
		expect(callOf(Buffer.from(''))).toBeUndefined();
		expect(callOf(body({ result: 1 }))).toBeUndefined();
	});
});
