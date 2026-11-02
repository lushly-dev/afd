import type { HandlerFrameV1 } from '@lushly-dev/loam-kernel';
import { describe, expect, it, vi } from 'vitest';
import { readOrNotice } from './deployment.js';
import { webPorts } from './ports.js';

const page = { baseURI: 'https://shell.example/' } as Document;
const noView = () => Promise.reject(new Error('No view chunk here'));
const noMount = () => Promise.reject(new Error('No mount chunk here'));

describe('readOrNotice', () => {
	it('gives the kernel a checked projection and its ports', () => {
		const read = readOrNotice(
			{
				deployment_version: 1,
				sandbox_origin: null,
				apps: [{ instance: 'hello', app: 'hello', package: 'apps/hello/' }],
			},
			page,
			noView,
			noMount
		);
		if (!read.ok) throw new Error(read.message);
		expect(read.apps.deployment?.apps[0]?.instance).toBe('hello');
		expect(read.apps.ports?.baseUrl).toBe('https://shell.example/');
	});

	it('refuses a projection holding a key that must never reach a page', () => {
		const read = readOrNotice(
			{
				deployment_version: 1,
				sandbox_origin: null,
				apps: [{ instance: 'x', app: 'x', package: 'apps/x/', url: 'http://secret' }],
			},
			page,
			noView,
			noMount
		);
		expect(read.ok).toBe(false);
		if (read.ok) return;
		expect(read.message).toContain('DEPLOYMENT_INVALID');
		expect(read.message).not.toContain('http://secret');
	});

	it('refuses what did not parse', () => {
		const read = readOrNotice(undefined, page, noView, noMount);
		expect(read.ok).toBe(false);
	});
});

describe('webPorts', () => {
	it('opens a handler frame from the view chunk, on the sandbox origin, only when asked', async () => {
		const frame = {} as HandlerFrameV1;
		const openHandlerFrame = vi.fn(() => frame);
		const loadView = vi.fn(async () => ({ openHandlerFrame }));
		const ports = webPorts(page, 'https://sandbox.example', loadView, noMount);
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
		const ports = webPorts(page, null, noView, noMount);
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
