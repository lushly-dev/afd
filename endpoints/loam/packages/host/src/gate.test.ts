import type { IncomingMessage } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
	authorityOf,
	gate,
	type NodeListener,
	requestAuthority,
	withoutDefaultPort,
} from './gate.js';
import { raw } from './test-support.js';

function request(url: string, ...hosts: string[]): IncomingMessage {
	return { url, headersDistinct: { host: hosts } } as unknown as IncomingMessage;
}

describe("the Host check's reading of a request (3.2)", () => {
	it("compares an origin's authority as a browser sends it, the default port left out", () => {
		expect(authorityOf('https://loam.example.com')).toBe('loam.example.com');
		expect(authorityOf('https://localhost:8443')).toBe('localhost:8443');
	});

	it('normalizes :443 away from the Host, and keeps any other port', () => {
		expect(requestAuthority(request('/', 'loam.example.com:443'))).toBe('loam.example.com');
		expect(requestAuthority(request('/', 'LOAM.example.com:443'))).toBe('loam.example.com');
		expect(requestAuthority(request('/', 'loam.example.com'))).toBe('loam.example.com');
		expect(requestAuthority(request('/', 'localhost:8443'))).toBe('localhost:8443');
		expect(requestAuthority(request('/', 'localhost:4430'))).toBe('localhost:4430');
		expect(requestAuthority(request('/', '[::1]:443'))).toBe('[::1]');
	});

	it('leaves :443 on a host that already names another port', () => {
		expect(withoutDefaultPort('localhost:8443:443')).toBe('localhost:8443:443');
		expect(requestAuthority(request('/', 'localhost:8443:443'))).toBe('localhost:8443:443');
		expect(withoutDefaultPort('[::1]:8443:443')).toBe('[::1]:8443:443');
	});

	it("hands the adapter's route the authority it decided, in the Request's own Host", async () => {
		const app = new Hono();
		app.all('*', (c) => c.text(c.req.header('host') ?? ''));
		const server = createServer(
			gate(new Set(['loam.example.test']), {}, getRequestListener(app.fetch) as NodeListener)
		);
		await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
		try {
			const port = (server.address() as AddressInfo).port;
			const answer = await raw(port, '/', { host: 'loam.example.test:443' });
			expect(answer.status).toBe(200);
			expect(answer.body).toBe('loam.example.test');
		} finally {
			await new Promise<void>((done) => server.close(() => done()));
		}
	});

	it('reads no Host, or two, as none', () => {
		expect(requestAuthority(request('/'))).toBeUndefined();
		expect(requestAuthority(request('/', 'a.example', 'a.example'))).toBeUndefined();
	});

	it("takes an absolute target only when its authority is the Host's, and rewrites it unnormalized", () => {
		const same = request('https://loam.example.com:443/a/../b?x', 'loam.example.com');
		expect(requestAuthority(same)).toBe('loam.example.com');
		expect(same.url).toBe('/a/../b?x');
		expect(requestAuthority(request('https://evil.example/', 'loam.example.com'))).toBeUndefined();
		const bare = request('https://loam.example.com', 'loam.example.com');
		expect(requestAuthority(bare)).toBe('loam.example.com');
		expect(bare.url).toBe('/');
	});
});
