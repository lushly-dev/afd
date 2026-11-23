import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSpecimenBench, type SpecimenBench } from './bench.js';

/** A one-pixel GIF, so an allowed image loads. */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/**
 * Reaches `target` from the page with fetch, an image, a frame and a WebSocket, and from a
 * dedicated worker. The frame and the socket settle either way; the server's hits tell.
 */
const probe = (target: string) => `const target = ${JSON.stringify(target)};
const status = (response) => response.status + ' ' + (response.ok ? 'ok' : 'refused');
const attempt = (label, run) =>
	run().then((value) => label + ': ' + value, (error) => label + ': failed ' + (error?.message ?? error));
const image = () => new Promise((resolve, reject) => {
	const element = new Image();
	element.onload = () => resolve('loaded');
	element.onerror = () => reject(new Error('to load'));
	element.src = target + '/image.gif';
});
const worker = () => new Promise((resolve, reject) => {
	const source = "fetch(" + JSON.stringify(target + '/worker') + ").then((response) => postMessage(response.status + ' ' + (response.ok ? 'ok' : 'refused')), (error) => postMessage('failed ' + error.message));";
	const running = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
	running.onmessage = (event) => { resolve(event.data); running.terminate(); };
	running.onerror = () => reject(new Error('worker error'));
});
const frame = (element) => new Promise((resolve) => {
	const child = document.createElement('iframe');
	child.onload = () => resolve('settled');
	child.src = target + '/frame';
	element.append(child);
});
const socket = () => new Promise((resolve) => {
	const opened = new WebSocket(target.replace('http', 'ws') + '/socket');
	opened.onclose = () => resolve('settled');
});
export const Reach = {
	render() {
		const element = document.createElement('div');
		const text = document.createElement('pre');
		element.append(text);
		const ready = Promise.all([
			attempt('fetch', () => fetch(target + '/fetch').then(status)),
			attempt('image', image),
			attempt('worker', worker),
			attempt('frame', () => frame(element)),
			attempt('socket', socket),
		]).then((lines) => { text.textContent = lines.join('\\n'); });
		return { element, ready };
	},
};
`;

/** A server on `host` that records each request it gets, a WebSocket handshake included. */
async function listen(host: string): Promise<{ server: Server; port: number; hits: string[] }> {
	const hits: string[] = [];
	const server = createServer((request, response) => {
		hits.push(request.url ?? '');
		response.setHeader('access-control-allow-origin', '*');
		if (request.url === '/image.gif') {
			response.setHeader('content-type', 'image/gif');
			response.end(PIXEL);
		} else response.end('reached');
	});
	server.on('upgrade', (request, connection) => {
		hits.push(request.url ?? '');
		connection.destroy();
	});
	await new Promise<void>((listening) => server.listen(0, host, listening));
	return { server, port: (server.address() as AddressInfo).port, hits };
}

describe('what a rendered page can reach', () => {
	// Other origins on loopback, which Chromium would reach directly without a proxy.
	let other: Awaited<ReturnType<typeof listen>>;
	let second: Awaited<ReturnType<typeof listen>>;
	let ipv6: Awaited<ReturnType<typeof listen>>;
	let target: string;
	const roots: string[] = [];
	const benches: SpecimenBench[] = [];

	/** A bench rendering one probe per target (`reach-0`, `reach-1`, …), with `network`. */
	async function bench(targets: string[], network?: { allow: string[] }): Promise<SpecimenBench> {
		const root = await realpath(await mkdtemp(join(tmpdir(), 'specimen-network-')));
		roots.push(root);
		for (const [index, each] of targets.entries())
			await writeFile(join(root, `reach-${index}.js`), probe(each));
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify({
				specimens: targets.map((_, index) => ({
					id: `reach-${index}`,
					title: `Reach ${index}`,
					module: `./reach-${index}.js`,
					exportName: 'Reach',
				})),
				...(network ? { network } : {}),
			})
		);
		const created = await createSpecimenBench({ root });
		benches.push(created);
		return created;
	}

	beforeAll(async () => {
		other = await listen('127.0.0.1');
		second = await listen('127.0.0.1');
		ipv6 = await listen('::1');
		target = `http://127.0.0.1:${other.port}`;
	});

	beforeEach(() => {
		for (const server of [other, second, ipv6]) server.hits.length = 0;
	});

	afterAll(async () => {
		for (const created of benches) await created.close();
		for (const { server } of [other, second, ipv6])
			await new Promise((closed) => server?.close(closed));
		for (const root of roots) await rm(root, { recursive: true, force: true, maxRetries: 10 });
	});

	it('reaches no origin but the bench’s own by default', async () => {
		const observation = await (await bench([target])).render({ id: 'reach-0' });
		expect(observation.channels.dom.raw).toContain('fetch: 403 refused');
		expect(observation.channels.dom.raw).toContain('image: failed to load');
		expect(observation.channels.dom.raw).toContain('worker: 403 refused');
		expect(other.hits).toEqual([]);
	});

	it('reaches an origin the configuration allows', async () => {
		const observation = await (await bench([target], { allow: [target] })).render({
			id: 'reach-0',
		});
		expect(observation.channels.dom.raw).toContain('fetch: 200 ok');
		expect(observation.channels.dom.raw).toContain('image: loaded');
		expect(observation.channels.dom.raw).toContain('worker: 200 ok');
		expect([...other.hits].sort()).toEqual([
			'/fetch',
			'/frame',
			'/image.gif',
			'/socket',
			'/worker',
		]);
	});

	it('admits only the allowed port of an allowed host', async () => {
		const allowed = `http://localhost:${other.port}`;
		const created = await bench([allowed, `http://localhost:${second.port}`], {
			allow: [allowed],
		});
		expect((await created.render({ id: 'reach-0' })).channels.dom.raw).toContain('fetch: 200 ok');
		expect(other.hits).toContain('/fetch');
		const refused = await created.render({ id: 'reach-1' });
		expect(refused.channels.dom.raw).toContain('fetch: 403 refused');
		expect(refused.channels.dom.raw).toContain('worker: 403 refused');
		expect(second.hits).toEqual([]);
	});

	it('refuses a host starting with a dot, which would admit every subdomain', async () => {
		await expect(
			(async () => {
				const created = await bench([target], { allow: ['http://.localhost:4000'] });
				await created.render({ id: 'reach-0' });
			})()
		).rejects.toThrow('every subdomain');
		expect(other.hits).toEqual([]);
	});

	it('reaches an allowed IPv6 literal origin', async () => {
		const allowed = `http://[::1]:${ipv6.port}`;
		const observation = await (await bench([allowed], { allow: [allowed] })).render({
			id: 'reach-0',
		});
		expect(observation.channels.dom.raw).toContain('fetch: 200 ok');
		expect(observation.channels.dom.raw).toContain('worker: 200 ok');
		expect(ipv6.hits).toContain('/fetch');
	});
});
