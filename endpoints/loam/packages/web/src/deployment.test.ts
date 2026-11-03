import type { HandlerFrameV1 } from '@lushly-dev/loam-kernel';
import { describe, expect, it, vi } from 'vitest';
import { readOrNotice } from './deployment.js';
import { webPorts } from './ports.js';

const page = {} as Document;
/** The deployment's root, from the entry's URL, which a deep link does not move (phase 2 specification, 6.2). */
const BASE = 'https://shell.example/loam/';
const noView = () => Promise.reject(new Error('No view chunk here'));
const noMount = () => Promise.reject(new Error('No mount chunk here'));
const EMPTY = {
	deployment_version: 2,
	generation: 'test',
	workspace: { id: 'personal', name: 'Personal' },
	sandbox_origin: null,
};

describe('readOrNotice', () => {
	it('gives the kernel a checked projection and its ports', () => {
		const read = readOrNotice(
			{
				...EMPTY,
				apps: [{ instance: 'hello', app: 'hello', package: 'apps/hello/' }],
			},
			page,
			BASE,
			noView,
			noMount
		);
		if ('refused' in read) throw new Error(read.refused);
		expect(read.deployment.apps[0]?.instance).toBe('hello');
		expect(read.ports.baseUrl).toBe(BASE);
	});

	it('refuses a projection holding a key that must never reach a page', () => {
		const read = readOrNotice(
			{
				...EMPTY,
				apps: [{ instance: 'x', app: 'x', package: 'apps/x/', url: 'http://secret' }],
			},
			page,
			BASE,
			noView,
			noMount
		);
		if (!('refused' in read)) throw new Error('expected a refusal');
		expect(read.refused).toContain('DEPLOYMENT_INVALID');
		expect(read.refused).not.toContain('http://secret');
	});

	it('refuses what did not parse', () => {
		expect('refused' in readOrNotice(undefined, page, BASE, noView, noMount)).toBe(true);
		// Version 1 is not read: `dist` and its projection are written together.
		const v1 = { deployment_version: 1, sandbox_origin: null, apps: [] };
		expect('refused' in readOrNotice(v1, page, BASE, noView, noMount)).toBe(true);
	});
});

describe('webPorts', () => {
	it('opens a handler frame from the view chunk, on the sandbox origin, only when asked', async () => {
		const frame = {} as HandlerFrameV1;
		const openHandlerFrame = vi.fn(() => frame);
		const loadView = vi.fn(async () => ({ openHandlerFrame }));
		const ports = webPorts(page, BASE, 'https://sandbox.example', loadView, noMount);
		expect(loadView).not.toHaveBeenCalled();
		await expect(ports.openHandlerFrame('hello', '<p>')).resolves.toBe(frame);
		expect(openHandlerFrame).toHaveBeenCalledWith({
			document: page,
			sandboxOrigin: 'https://sandbox.example',
			title: 'hello handlers',
			html: '<p>',
		});
	});

	it('loads the mount chunk only when asked, and rejects what cannot be served', async () => {
		const ports = webPorts(page, BASE, null, noView, noMount);
		await expect(ports.openHandlerFrame('x', '')).rejects.toThrow(/sandbox origin/);
		await expect(ports.mountTransport({} as never, '')).rejects.toThrow(/No mount chunk/);
		const fetched = globalThis.fetch;
		globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch;
		try {
			await expect(ports.fetchJson('https://shell.example/x.json')).rejects.toThrow(/404/);
			await expect(ports.fetchText('https://shell.example/x.html')).rejects.toThrow(/404/);
		} finally {
			globalThis.fetch = fetched;
		}
	});
});
