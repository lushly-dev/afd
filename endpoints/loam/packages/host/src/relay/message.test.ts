import { DISCOVERY_LIMITS } from '@lushly-dev/loam-kernel/mounted';
import { describe, expect, it } from 'vitest';
import { type ParsedMessage, parseMessage } from './message.js';
import type { RelayRefusal } from './refusals.js';

const WORKSPACE = 'acme';
const parse = (value: unknown) =>
	parseMessage(typeof value === 'string' ? value : JSON.stringify(value), {
		depth: DISCOVERY_LIMITS.depth,
		workspace: WORKSPACE,
	});
const codeOf = (value: unknown) => (parse(value) as RelayRefusal).code;
const call = (params: Record<string, unknown>, id: unknown = 1) => ({
	jsonrpc: '2.0',
	id,
	method: 'tools/call',
	params,
});
const SCOPE_A = { workspace: WORKSPACE, project: 'prj_atlas0000' };
const SCOPE_B = { workspace: WORKSPACE, project: 'prj_beacon000' };

describe('P6-E5: the parse (8.1 steps 5 to 8)', () => {
	it('P6-E5: one message: a batch is MOUNT_BATCH_REFUSED, anything else not one JSON-RPC object REQUEST_INVALID', () => {
		expect(codeOf([call({ name: 'x' })])).toBe('MOUNT_BATCH_REFUSED');
		expect(codeOf('not json')).toBe('REQUEST_INVALID');
		expect(codeOf({ id: 1, method: 'ping' })).toBe('REQUEST_INVALID');
		expect(codeOf({ jsonrpc: '1.0', id: 1, method: 'ping' })).toBe('REQUEST_INVALID');
		expect(codeOf('"ping"')).toBe('REQUEST_INVALID');
	});

	it('P6-E5: a message nested past `DISCOVERY_LIMITS.depth` is REQUEST_INVALID', () => {
		let deep: unknown = 'x';
		for (let level = 0; level < DISCOVERY_LIMITS.depth + 2; level++) deep = { deep };
		expect(codeOf(call({ name: 'x', arguments: { deep } }))).toBe('REQUEST_INVALID');
	});

	it('P6-E5: six methods accepted; `resources/read`, `tools/list`, `tasks/get`, `logging/setLevel` and a bare JSON-RPC response refused', () => {
		for (const method of [
			'resources/read',
			'tools/list',
			'tasks/get',
			'logging/setLevel',
			'prompts/get',
		])
			expect(codeOf({ jsonrpc: '2.0', id: 1, method })).toBe('MOUNT_METHOD_REFUSED');
		expect(codeOf({ jsonrpc: '2.0', id: 1, result: {} })).toBe('MOUNT_METHOD_REFUSED');
		expect(codeOf({ jsonrpc: '2.0', id: 1, error: { code: 1, message: 'x' } })).toBe(
			'MOUNT_METHOD_REFUSED'
		);
		expect(parse({ jsonrpc: '2.0', id: 1, method: 'ping' })).toMatchObject({
			method: 'ping',
			id: 1,
		});
	});

	it('P6-E5: ids: a request with none or a non-safe-integer one, a notification with one, a cancellation whose `requestId` is neither, each REQUEST_INVALID', () => {
		expect(codeOf({ jsonrpc: '2.0', method: 'ping' })).toBe('REQUEST_INVALID');
		expect(codeOf({ jsonrpc: '2.0', id: null, method: 'ping' })).toBe('REQUEST_INVALID');
		expect(codeOf({ jsonrpc: '2.0', id: 1.5, method: 'ping' })).toBe('REQUEST_INVALID');
		expect(codeOf({ jsonrpc: '2.0', id: 2 ** 60, method: 'ping' })).toBe('REQUEST_INVALID');
		expect(codeOf({ jsonrpc: '2.0', id: {}, method: 'ping' })).toBe('REQUEST_INVALID');
		expect(codeOf({ jsonrpc: '2.0', id: 1, method: 'notifications/initialized' })).toBe(
			'REQUEST_INVALID'
		);
		for (const requestId of [null, 1.5, {}, true])
			expect(
				codeOf({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId } })
			).toBe('REQUEST_INVALID');
		expect(
			parse({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'r1' } })
		).toMatchObject({ cancelled: 'r1' });
		expect(parse({ jsonrpc: '2.0', id: 'abc', method: 'ping' })).toMatchObject({ id: 'abc' });
	});

	it('P6-E5: the fields read: a non-string `params.name`, non-object `arguments` or `_meta`, a bad `progressToken`, each REQUEST_INVALID', () => {
		expect(codeOf(call({ name: 7 }))).toBe('REQUEST_INVALID');
		expect(codeOf(call({ name: 'x', arguments: [] }))).toBe('REQUEST_INVALID');
		expect(codeOf(call({ name: 'x', _meta: 'x' }))).toBe('REQUEST_INVALID');
		expect(codeOf(call({ name: 'x', _meta: { progressToken: 1.5 } }))).toBe('REQUEST_INVALID');
		expect(codeOf({ jsonrpc: '2.0', id: 1, method: 'ping', params: [] })).toBe('REQUEST_INVALID');
		expect(parse(call({ name: 'x', _meta: { progressToken: 'p' } }))).toMatchObject({
			name: 'x',
			arguments: {},
			progressToken: 'p',
		});
	});

	it('P6-E5: `initialize` needs its version and client; `server/discover` the modern version, each read from where its era puts it', () => {
		expect(codeOf({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).toBe(
			'REQUEST_INVALID'
		);
		expect(
			parse({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2025-11-25',
					clientInfo: { name: 'loam', version: '1' },
					capabilities: { sampling: {} },
				},
			})
		).toMatchObject({
			initialize: { protocolVersion: '2025-11-25', clientInfo: { name: 'loam', version: '1' } },
		});
		expect(codeOf({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} })).toBe(
			'REQUEST_INVALID'
		);
		const modern = parse({
			jsonrpc: '2.0',
			id: 1,
			method: 'server/discover',
			params: {
				_meta: {
					'io.modelcontextprotocol/protocolVersion': '2026-07-28',
					'io.modelcontextprotocol/clientInfo': { name: 'loam', version: '1' },
				},
			},
		}) as ParsedMessage;
		expect(modern.modern).toEqual({
			protocolVersion: '2026-07-28',
			clientInfo: { name: 'loam', version: '1' },
		});
		expect(
			codeOf({
				jsonrpc: '2.0',
				id: 1,
				method: 'ping',
				params: {
					_meta: {
						'io.modelcontextprotocol/clientInfo': {},
						'io.modelcontextprotocol/protocolVersion': '2026-07-28',
					},
				},
			})
		).toBe('REQUEST_INVALID');
	});

	it('P6-E5: scope from `_meta`, and from `arguments.meta` only for `afd-call` and `afd-detail`; `null` is absent', () => {
		expect(parse(call({ name: 'x', _meta: { 'dev.loam/scope': SCOPE_A } }))).toMatchObject({
			scope: SCOPE_A,
		});
		expect(
			parse(call({ name: 'afd-call', arguments: { meta: { 'dev.loam/scope': SCOPE_A } } }))
		).toMatchObject({ scope: SCOPE_A });
		expect(
			parse(call({ name: 'afd-detail', arguments: { meta: { 'dev.loam/scope': SCOPE_A } } }))
		).toMatchObject({ scope: SCOPE_A });
		// A first-class tool's `arguments.meta` is never read as scope, by AFD or by the relay.
		expect(
			(
				parse(
					call({ name: 'notes-get', arguments: { meta: { 'dev.loam/scope': SCOPE_A } } })
				) as ParsedMessage
			).scope
		).toBeUndefined();
		expect(
			(parse(call({ name: 'x', _meta: { 'dev.loam/scope': null } })) as ParsedMessage).scope
		).toBeUndefined();
	});

	it("P6-E5: the two places differing, a scope off `SCOPE_V1`'s shape and another workspace, each REQUEST_INVALID", () => {
		expect(
			codeOf(
				call({
					name: 'afd-call',
					arguments: { meta: { 'dev.loam/scope': SCOPE_B } },
					_meta: { 'dev.loam/scope': SCOPE_A },
				})
			)
		).toBe('REQUEST_INVALID');
		expect(
			parse(
				call({
					name: 'afd-call',
					arguments: { meta: { 'dev.loam/scope': SCOPE_A } },
					_meta: { 'dev.loam/scope': SCOPE_A },
				})
			)
		).toMatchObject({ scope: SCOPE_A });
		for (const scope of [
			{ workspace: WORKSPACE, project: 'x', extra: 1 },
			{ project: 'x' },
			{ workspace: '' },
			'acme',
			{ workspace: 'other' },
		])
			expect(codeOf(call({ name: 'x', _meta: { 'dev.loam/scope': scope } }))).toBe(
				'REQUEST_INVALID'
			);
	});
});
