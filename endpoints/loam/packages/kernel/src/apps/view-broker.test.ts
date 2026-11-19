import { success } from '@lushly-dev/afd-core';
import type { ManifestV1 } from '@lushly-dev/loam-manifest';
import { describe, expect, it, vi } from 'vitest';
import { createKernelLimits, LIMIT_DEFAULTS } from '../limits.js';
import type { LinkedCallV1 } from '../types.js';
import { createLimitGuard } from './limit-guard.js';
import { createViewBroker, READS_IN_FLIGHT } from './view-broker.js';

const RESOURCE = 'ui://probe/main';
/** The scope a surface was made in, and its calls ran in. */
const AT = { workspace: 'w', project: 'prj_atlas' };

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
	const view = createViewBroker({ manifest, sandboxOrigin: 'https://s.test' });
	const broker = view.brokerFor(call as never, readResource, AT);
	return { call, readResource, broker, notifyCall: view.notifyCall };
}

describe('the view broker', () => {
	it('sends tools/call through the port, and shapes the answer as MCP does', async () => {
		const { broker, call } = setup();
		const answer = await broker.toolsCall({ name: 'other-add', arguments: { amount: 1 } });
		expect(call).toHaveBeenCalledWith('other-add', { amount: 1 });
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

	it('refuses arguments that are not JSON, since the journal could not write them', async () => {
		const { broker, call } = setup();
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		for (const args of [{ x: 1n }, cycle]) {
			await expect(
				broker.toolsCall({ name: 'probe-plain', arguments: args })
			).rejects.toMatchObject({ details: { rpcCode: -32602 } });
		}
		expect(call).not.toHaveBeenCalled();
	});

	it('shows no trace ID, which counts every call in the kernel', async () => {
		const { broker, call } = setup();
		call.mockResolvedValueOnce(success({ ok: true }, { metadata: { traceId: 'loam-x-9', a: 1 } }));
		const answer = await broker.toolsCall({ name: 'probe-plain' });
		expect(JSON.stringify(answer)).not.toContain('loam-x-9');
		expect(answer.structuredContent).toMatchObject({ metadata: { a: 1 } });
	});

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
		notifyCall('probe-plain', {}, success({}), undefined, AT);
		notifyCall('probe-linked', { a: 1 }, success({ b: 2 }), signal, AT);
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
		notifyCall('probe-linked', {}, success({}), undefined, AT);
		expect(heard.length).toBe(1);
	});

	it('T4: tells a surface only of a linked call in its own scope, so nothing of Beacon reaches a view in Atlas', () => {
		const call = vi.fn(async () => success({}));
		const view = createViewBroker({ manifest, sandboxOrigin: 'https://s.test' });
		const atlas = view.brokerFor(call as never, vi.fn(), { workspace: 'w', project: 'prj_atlas' });
		const beacon = view.brokerFor(call as never, vi.fn(), {
			workspace: 'w',
			project: 'prj_beacon',
		});
		const workspace = view.brokerFor(call as never, vi.fn(), { workspace: 'w' });
		const heard: string[] = [];
		atlas.onLinkedCall(RESOURCE, () => heard.push('atlas'));
		beacon.onLinkedCall(RESOURCE, () => heard.push('beacon'));
		workspace.onLinkedCall(RESOURCE, () => heard.push('workspace'));
		// A call that ran in Beacon, as a nested summary for Beacon's home would.
		view.notifyCall('probe-linked', {}, success({}), undefined, {
			workspace: 'w',
			project: 'prj_beacon',
		});
		expect(heard).toEqual(['beacon']);
		heard.length = 0;
		view.notifyCall('probe-linked', {}, success({}), undefined, { workspace: 'w' });
		expect(heard).toEqual(['workspace']);
	});

	it('T4: fails closed: a broker with no surface, or a call with no scope, is told nothing', () => {
		const view = createViewBroker({ manifest, sandboxOrigin: 'https://s.test' });
		const heard: string[] = [];
		view.brokerFor(vi.fn() as never, vi.fn()).onLinkedCall(RESOURCE, () => heard.push('unbound'));
		view.brokerFor(vi.fn() as never, vi.fn(), AT).onLinkedCall(RESOURCE, () => heard.push('atlas'));
		// No scope on the call: nobody hears it.
		view.notifyCall('probe-linked', {}, success({}));
		expect(heard).toEqual([]);
		// A call in Atlas reaches the surface of Atlas, and not the port's unbound broker.
		view.notifyCall('probe-linked', {}, success({}), undefined, AT);
		expect(heard).toEqual(['atlas']);
	});
});

/** A guard over a fake host, whose `runAs` counts what `app-limit-refuse` would. */
function guarded(messageBytes = 65_536) {
	const limits = createKernelLimits();
	limits.set({ ...LIMIT_DEFAULTS, messageBytes });
	const runAs = vi.fn(async (_name: string, input: unknown, _options: unknown, fields: unknown) => {
		const { limit } = input as { limit: 'messageBytes' };
		limits.refused((fields as { caller: string }).caller, limit, 5);
		return { success: false, error: { code: 'X', message: 'refused', suggestion: 'wait' } };
	});
	const guard = createLimitGuard({ limits, clock: () => 5, runAs: runAs as never }, 'probe');
	const call = vi.fn(async () => success({ ok: true }));
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const readResource = vi.fn(async () => {
		await gate;
		return '<h1>Probe</h1>';
	});
	const view = createViewBroker({ manifest, sandboxOrigin: 'https://s.test', guard });
	const broker = view.brokerFor(call as never, readResource, AT);
	return { limits, runAs, guard, call, broker, release };
}

const tokens = (limits: ReturnType<typeof createKernelLimits>) => limits.rates.get('probe')?.tokens;

describe("the view broker's message bound (phase 4 specification, section 11)", () => {
	it('drops a message over messageBytes before it reaches the port, tells the frame, journals and counts it', async () => {
		const { limits, runAs, call, broker } = guarded();
		const params = { name: 'probe-plain', arguments: { text: 'x'.repeat(65_536) } };
		await expect(broker.toolsCall(params)).rejects.toMatchObject({
			code: 'INPUT_TOO_LARGE',
			suggestion: expect.stringContaining('loam.limits.messageBytes'),
			details: { limit: 65_536, rpcCode: -32602 },
		});
		expect(runAs).toHaveBeenCalledWith(
			'app-limit-refuse',
			{ command: 'probe-plain', limit: 'messageBytes', bound: 65_536 },
			undefined,
			{ caller: 'probe' }
		);
		// The refused call took its place in the rate, once.
		expect(tokens(limits)).toBe(199);
		await expect(
			broker.resourcesRead({ uri: RESOURCE, pad: 'x'.repeat(65_536) })
		).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' });
		expect(call).not.toHaveBeenCalled();
		expect(limits.counts('probe', 5).messageBytes).toBe(2);
		// A tools/call the port takes is charged there, not here.
		await broker.toolsCall({ name: 'probe-plain', arguments: { text: 'small' } });
		expect(call).toHaveBeenCalledOnce();
		expect(tokens(limits)).toBe(199);
	});

	it('refuses a message with no JSON form as over every limit, never measuring it as 0 (R2)', async () => {
		const { guard, broker, call, limits } = guarded();
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		expect(
			guard.admit({ jsonrpc: '2.0', method: 'tools/call', params: { arguments: cycle } })
		).toMatchObject({
			code: 'VALIDATION_ERROR',
			rpcCode: -32602,
		});
		await expect(
			broker.toolsCall({ name: 'probe-plain', arguments: { n: 1n } })
		).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
		expect(call).not.toHaveBeenCalled();
		expect(limits.counts('probe', 5).messageBytes).toBe(2);
		// A notification is gated too: admit answers for any message.
		expect(
			guard.admit({
				jsonrpc: '2.0',
				method: 'ui/notifications/initialized',
				params: { pad: 'x'.repeat(70_000) },
			})
		).toMatchObject({ code: 'INPUT_TOO_LARGE' });
	});

	it('charges the rate once for a tools/call the broker itself refuses', async () => {
		const { broker, limits } = guarded();
		await expect(broker.toolsCall({ arguments: {} })).rejects.toMatchObject({
			code: 'VIEW_CALL_REFUSED',
		});
		await expect(broker.toolsCall({ name: 'probe-model' })).rejects.toMatchObject({
			code: 'VIEW_CALL_REFUSED',
		});
		expect(tokens(limits)).toBe(198);
	});

	it('bounds the resource reads in flight per instance', async () => {
		const { broker, runAs, release } = guarded();
		const reads = Array.from({ length: READS_IN_FLIGHT }, () =>
			broker.resourcesRead({ uri: RESOURCE })
		);
		await expect(broker.resourcesRead({ uri: RESOURCE })).rejects.toMatchObject({
			code: 'RATE_LIMITED',
			details: { limit: READS_IN_FLIGHT, retryAfterMs: 100, rpcCode: -32602 },
		});
		expect(runAs).toHaveBeenCalledWith(
			'app-limit-refuse',
			{
				command: RESOURCE,
				limit: 'callsPerSecond',
				bound: READS_IN_FLIGHT,
				reason: 'reads',
				retryAfterMs: 100,
			},
			undefined,
			{ caller: 'probe' }
		);
		release();
		await Promise.all(reads);
		await expect(broker.resourcesRead({ uri: RESOURCE })).resolves.toBeDefined();
	});

	it('holds to the default with no guard given', async () => {
		const { broker, call } = setup();
		await expect(
			broker.toolsCall({
				name: 'probe-plain',
				arguments: { text: 'x'.repeat(LIMIT_DEFAULTS.messageBytes) },
			})
		).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' });
		expect(call).not.toHaveBeenCalled();
	});
});
