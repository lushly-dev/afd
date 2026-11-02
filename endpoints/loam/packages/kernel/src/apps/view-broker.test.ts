import { success } from '@lushly-dev/afd-core';
import type { ManifestV1 } from '@lushly-dev/loam-manifest';
import { describe, expect, it, vi } from 'vitest';
import type { AppPortV1, LinkedCallV1 } from '../types.js';
import { createViewBroker } from './view-broker.js';

const RESOURCE = 'ui://probe/main';

const manifest = {
	view: { handlers: 'handlers.html' },
	commands: [
		{ name: 'probe-linked', tool_meta: { ui: { resourceUri: RESOURCE } } },
		{ name: 'probe-plain' },
		{ name: 'probe-model', tool_meta: { ui: { visibility: ['model'] } } },
	],
	ui: { resources: [{ uri: RESOURCE, path: 'main.html' }] },
} as unknown as ManifestV1;

function setup() {
	const call = vi.fn(async () => success({ ok: true }));
	const readResource = vi.fn(async () => '<h1>Probe</h1>');
	const port = { call, readResource } as unknown as AppPortV1;
	const view = createViewBroker({ manifest, sandboxOrigin: 'https://s.test', port: () => port });
	return { call, readResource, ...view };
}

describe('the view broker', () => {
	it('sends tools/call through the port, and shapes the answer as MCP does', async () => {
		const { broker, call } = setup();
		const answer = await broker.toolsCall({ name: 'tally-add', arguments: { amount: 1 } });
		expect(call).toHaveBeenCalledWith('tally-add', { amount: 1 });
		expect(answer).toEqual({
			content: [{ type: 'text', text: JSON.stringify(success({ ok: true })) }],
			structuredContent: success({ ok: true }),
			isError: false,
		});
		await broker.toolsCall({ name: 'probe-plain' });
		expect(call).toHaveBeenLastCalledWith('probe-plain', {});
	});

	it('ignores a view that names a call in flight: only a handler frame has one', async () => {
		const { broker, call } = setup();
		await broker.toolsCall({
			name: 'probe-plain',
			arguments: {},
			_meta: { 'dev.loam/call': 'someone-elses' },
		});
		expect(call).toHaveBeenCalledWith('probe-plain', {});
	});

	it.each([[undefined], [{}], [{ name: 7 }], ['probe-plain']])(
		'refuses a tools/call with no name: %j',
		async (params) => {
			const { broker, call } = setup();
			await expect(broker.toolsCall(params)).rejects.toMatchObject({
				code: 'VIEW_CALL_REFUSED',
				details: { rpcCode: -32602 },
			});
			expect(call).not.toHaveBeenCalled();
		}
	);

	it('refuses a command its visibility hides from the app', async () => {
		const { broker, call } = setup();
		await expect(broker.toolsCall({ name: 'probe-model' })).rejects.toMatchObject({
			code: 'VIEW_CALL_REFUSED',
			details: { rpcCode: -32602 },
		});
		expect(call).not.toHaveBeenCalled();
	});

	it('reads the resources the manifest declares, and not the handler page or a path', async () => {
		const { broker, readResource } = setup();
		await expect(broker.resourcesRead({ uri: RESOURCE })).resolves.toEqual({
			contents: [{ uri: RESOURCE, mimeType: 'text/html;profile=mcp-app', text: '<h1>Probe</h1>' }],
		});
		for (const uri of ['handlers.html', 'main.html', '../app-manifest.json', 7, undefined]) {
			await expect(broker.resourcesRead({ uri })).rejects.toMatchObject({
				details: { rpcCode: -32602 },
			});
		}
		expect(readResource).toHaveBeenCalledTimes(1);
	});

	it('runs a bound command with {} and its signal', async () => {
		const { broker, call } = setup();
		const { signal } = new AbortController();
		await broker.runBound('probe-linked', signal);
		expect(call).toHaveBeenCalledWith('probe-linked', {}, { signal });
	});

	it('tells only the listeners of the resource a finished command links to', () => {
		const { broker, notifyCall } = setup();
		const heard: LinkedCallV1[] = [];
		const stop = broker.onLinkedCall(RESOURCE, (call) => heard.push(call));
		const other = vi.fn();
		broker.onLinkedCall('ui://probe/other', other);
		const { signal } = new AbortController();
		notifyCall('probe-plain', {}, success({}));
		notifyCall('probe-linked', { a: 1 }, success({ b: 2 }), signal);
		expect(heard).toEqual([
			{
				command: 'probe-linked',
				input: { a: 1 },
				result: expect.objectContaining({ isError: false, structuredContent: success({ b: 2 }) }),
				signal,
			},
		]);
		expect(other).not.toHaveBeenCalled();
		stop();
		notifyCall('probe-linked', {}, success({}));
		expect(heard.length).toBe(1);
	});
});
