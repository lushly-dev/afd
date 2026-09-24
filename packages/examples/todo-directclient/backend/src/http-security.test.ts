import { describe, expect, it } from 'vitest';
import {
	defaultAllowedOrigins,
	getClientAddress,
	isHostAllowed,
	isOriginAllowed,
	loadChatServerConfig,
	parseBoolean,
	RateLimiter,
} from './http-security.js';

describe('loadChatServerConfig', () => {
	it('defaults to loopback: bind 127.0.0.1, localhost origins, no proxy trust', () => {
		const config = loadChatServerConfig({});

		expect(config.host).toBe('127.0.0.1');
		expect(config.port).toBe(3201);
		expect(config.allowedOrigins).toEqual([
			'http://localhost:3201',
			'http://127.0.0.1:3201',
			'http://[::1]:3201',
		]);
		expect(config.allowedHosts).toEqual(['localhost', '127.0.0.1', '[::1]']);
		expect(config.trustProxy).toBe(false);
	});

	it('reads overrides from the environment', () => {
		const config = loadChatServerConfig({
			CHAT_HOST: '0.0.0.0',
			CHAT_PORT: '4000',
			ALLOWED_ORIGINS: 'http://localhost:5173, https://app.example.com',
			ALLOWED_HOSTS: 'chat.example.com',
			TRUST_PROXY: 'true',
			RATE_LIMIT_MAX_CLIENTS: '50',
		});

		expect(config.host).toBe('0.0.0.0');
		expect(config.port).toBe(4000);
		expect(config.allowedOrigins).toEqual([
			...defaultAllowedOrigins(4000),
			'http://localhost:5173',
			'https://app.example.com',
		]);
		expect(config.allowedHosts).toContain('chat.example.com');
		expect(config.allowedHosts).toContain('0.0.0.0');
		expect(config.trustProxy).toBe(true);
		expect(config.rateLimitMaxClients).toBe(50);
	});

	it('brackets an IPv6 bind address for the Host allowlist', () => {
		expect(loadChatServerConfig({ CHAT_HOST: '::1' }).allowedHosts).toContain('[::1]');
	});

	it.each(['*', 'null', 'NULL', 'http://localhost:3000/', 'localhost:3000', 'ftp://example.com'])(
		'rejects ALLOWED_ORIGINS=%s',
		(origin) => {
			expect(() => loadChatServerConfig({ ALLOWED_ORIGINS: origin })).toThrow(/ALLOWED_ORIGINS/);
		}
	);

	it('rejects invalid numbers', () => {
		expect(() => loadChatServerConfig({ CHAT_PORT: 'abc' })).toThrow(/CHAT_PORT/);
		expect(() => loadChatServerConfig({ MAX_BODY_SIZE: '-1' })).toThrow(/MAX_BODY_SIZE/);
	});

	it('parses boolean settings strictly', () => {
		expect(parseBoolean('1')).toBe(true);
		expect(parseBoolean('Yes')).toBe(true);
		expect(parseBoolean('false')).toBe(false);
		expect(parseBoolean(undefined)).toBe(false);
		expect(parseBoolean('trusted')).toBe(false);
	});
});

describe('isOriginAllowed', () => {
	const allowed = defaultAllowedOrigins(3201);

	it('accepts an exact allowed origin', () => {
		expect(isOriginAllowed({ origin: 'http://localhost:3201' }, allowed)).toBe(true);
	});

	it('rejects other origins, including look-alikes', () => {
		expect(isOriginAllowed({ origin: 'https://evil.example' }, allowed)).toBe(false);
		expect(isOriginAllowed({ origin: 'http://localhost:3201.evil.example' }, allowed)).toBe(false);
		expect(isOriginAllowed({ origin: 'http://localhost:9999' }, allowed)).toBe(false);
	});

	it('rejects the null origin (file://, sandboxed frames)', () => {
		expect(isOriginAllowed({ origin: 'null' }, allowed)).toBe(false);
		expect(isOriginAllowed({ origin: 'null' }, [...allowed, 'null'])).toBe(false);
	});

	it('accepts requests without Origin from non-browser clients', () => {
		expect(isOriginAllowed({}, allowed)).toBe(true);
		expect(isOriginAllowed({ 'sec-fetch-site': 'same-origin' }, allowed)).toBe(true);
		expect(isOriginAllowed({ 'sec-fetch-site': 'none' }, allowed)).toBe(true);
	});

	it('rejects cross-site browser requests that omit Origin', () => {
		expect(isOriginAllowed({ 'sec-fetch-site': 'cross-site' }, allowed)).toBe(false);
		expect(isOriginAllowed({ 'sec-fetch-site': 'same-site' }, allowed)).toBe(false);
	});
});

describe('isHostAllowed', () => {
	const hosts = loadChatServerConfig({}).allowedHosts;

	it('accepts loopback names with any port', () => {
		expect(isHostAllowed('localhost:3201', hosts)).toBe(true);
		expect(isHostAllowed('127.0.0.1:3201', hosts)).toBe(true);
		expect(isHostAllowed('[::1]:3201', hosts)).toBe(true);
		expect(isHostAllowed('LOCALHOST', hosts)).toBe(true);
	});

	it('rejects rebinding domains and malformed hosts', () => {
		expect(isHostAllowed('rebind.evil.example:3201', hosts)).toBe(false);
		expect(isHostAllowed('localhost.evil.example', hosts)).toBe(false);
		expect(isHostAllowed('localhost@evil.example', hosts)).toBe(false);
		expect(isHostAllowed('', hosts)).toBe(false);
		expect(isHostAllowed(undefined, hosts)).toBe(false);
	});
});

describe('getClientAddress', () => {
	const request = (xff?: string) => ({
		headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
		socket: { remoteAddress: '10.0.0.5' },
	});

	it('ignores X-Forwarded-For unless the proxy is trusted', () => {
		expect(getClientAddress(request('1.2.3.4'), false)).toBe('10.0.0.5');
	});

	it('uses the entry the trusted proxy appended, not client-supplied ones', () => {
		// The client sent "X-Forwarded-For: 6.6.6.6"; the proxy appended the real address.
		expect(getClientAddress(request('6.6.6.6, 203.0.113.7'), true)).toBe('203.0.113.7');
	});

	it('falls back to the socket address when a trusted proxy sent no header', () => {
		expect(getClientAddress(request(), true)).toBe('10.0.0.5');
		expect(getClientAddress(request(' , '), true)).toBe('10.0.0.5');
	});
});

describe('RateLimiter', () => {
	function clock(start = 0) {
		let time = start;
		return {
			now: () => time,
			advance: (ms: number) => {
				time += ms;
			},
		};
	}

	it('allows up to the limit, then reports when to retry', () => {
		const time = clock();
		const limiter = new RateLimiter({ now: time.now, windowMs: 60_000 });

		expect(limiter.check('a', 2).allowed).toBe(true);
		expect(limiter.check('a', 2).allowed).toBe(true);
		time.advance(15_000);
		expect(limiter.check('a', 2)).toEqual({ allowed: false, retryAfter: 45 });
		expect(limiter.check('b', 2).allowed).toBe(true);
	});

	it('starts a new window after the old one expires', () => {
		const time = clock();
		const limiter = new RateLimiter({ now: time.now, windowMs: 1000 });
		limiter.check('a', 1);
		expect(limiter.check('a', 1).allowed).toBe(false);
		time.advance(1000);
		expect(limiter.check('a', 1).allowed).toBe(true);
	});

	it('sweeps expired windows', () => {
		const time = clock();
		const limiter = new RateLimiter({ now: time.now, windowMs: 1000 });
		limiter.check('a', 5);
		limiter.check('b', 5);
		time.advance(500);
		limiter.check('c', 5);
		time.advance(500);

		expect(limiter.sweep()).toBe(2);
		expect(limiter.size).toBe(1);
	});

	it('never tracks more than maxKeys clients', () => {
		const time = clock();
		const limiter = new RateLimiter({ now: time.now, maxKeys: 3 });
		for (let i = 0; i < 1000; i++) {
			limiter.check(`client-${i}`, 5);
			time.advance(1);
		}
		expect(limiter.size).toBe(3);
	});

	it('evicts expired windows before live ones when full', () => {
		const time = clock();
		const limiter = new RateLimiter({ now: time.now, windowMs: 1000, maxKeys: 2 });
		limiter.check('old', 1);
		time.advance(600);
		limiter.check('live', 1);
		time.advance(600);
		limiter.check('new', 1);

		// "old" expired and was swept; "live" keeps its window and stays limited.
		expect(limiter.size).toBe(2);
		expect(limiter.check('live', 1).allowed).toBe(false);
	});
});
