import { describe, expect, it } from 'vitest';
import {
	isLoopbackHost,
	readServerConfig,
	SERVER_DISCOVERY_V1,
	SERVER_LIMITS_V1,
	siteOf,
} from './server.js';

const BASE = {
	server_version: 1,
	origin: 'https://loam.example.com',
	listen: '127.0.0.1:8443',
	data: '/var/lib/loam',
};

const codes = (json: unknown) => {
	const read = readServerConfig(json);
	return read.ok ? [] : read.refusals.map(({ code, key }) => `${code} ${key}`);
};

describe('P6-E1: the server configuration, version 1 (3.2)', () => {
	it('P6-E1: reads the smallest file, with the defaults of [limits] and [discovery]', () => {
		const read = readServerConfig(BASE);
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.limits).toEqual(SERVER_LIMITS_V1);
		expect(read.limits.request_body_bytes).toBe(1_048_576);
		expect(read.discovery).toEqual(SERVER_DISCOVERY_V1);
		expect(read.discovery).toEqual({ server_card: true, ai_catalog: false, agent_guide: false });
	});

	it('P6-E1: reads the full example of 3.2', () => {
		const read = readServerConfig({
			...BASE,
			listen: '127.0.0.1:8443',
			tls: { cert_file: '/etc/loam/fullchain.pem', key_file: '/etc/loam/privkey.pem' },
			sandbox: { origin: 'https://loam-sandbox.example.net', listen: '127.0.0.1:8444' },
			auth: { secret_file: '/etc/loam/auth-secret' },
			mail: {
				transport: 'smtp',
				from: 'Acme Loam <loam@example.com>',
				smtp_url_env: 'LOAM_SMTP_URL',
			},
			oidc: {
				corp: {
					issuer: 'https://login.example.com',
					client_id: 'loam',
					client_secret_file: '/etc/loam/oidc-corp',
				},
			},
			limits: { relay_timeout_ms: 30_000 },
			discovery: { ai_catalog: true },
		});
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.limits.relay_timeout_ms).toBe(30_000);
		expect(read.limits.relay_session_idle_ms).toBe(900_000);
		expect(read.discovery.ai_catalog).toBe(true);
	});

	it.each([
		['an unknown key', { ...BASE, origni: 'x' }, 'HOST_CONFIG_INVALID origni'],
		[
			'an unknown key in a table',
			{ ...BASE, tls: { cert_file: 'a', key_file: 'b', chain: 'c' } },
			'HOST_CONFIG_INVALID tls.chain',
		],
		['a wrong type', { ...BASE, data: 7 }, 'HOST_CONFIG_INVALID data'],
		['server_version 2', { ...BASE, server_version: 2 }, 'HOST_CONFIG_INVALID server_version'],
		[
			'no server_version',
			{ origin: BASE.origin, listen: BASE.listen, data: BASE.data },
			'HOST_CONFIG_INVALID server_version',
		],
		['a listen with no port', { ...BASE, listen: '127.0.0.1' }, 'HOST_CONFIG_INVALID listen'],
		['a port past 65535', { ...BASE, listen: '127.0.0.1:70000' }, 'HOST_CONFIG_INVALID listen'],
		[
			'a limit of 0',
			{ ...BASE, limits: { request_body_bytes: 0 } },
			'HOST_CONFIG_INVALID limits.request_body_bytes',
		],
		[
			'a non-canonical origin',
			{ ...BASE, origin: 'https://Loam.example.com' },
			'HOST_CONFIG_INVALID origin',
		],
		[
			'an origin spelling port 443',
			{ ...BASE, origin: 'https://loam.example.com:443' },
			'HOST_CONFIG_INVALID origin',
		],
	])('P6-E1: refuses %s with HOST_CONFIG_INVALID', (_name, json, expected) => {
		expect(codes(json)).toContain(expected);
	});

	it('P6-E1: names the closest key for an unknown one', () => {
		const read = readServerConfig({ ...BASE, origni: 'x' });
		expect(read.ok).toBe(false);
		if (read.ok) return;
		expect(read.refusals[0]?.suggestion).toContain('Did you mean `origin`?');
	});

	it.each([
		['an http origin', 'http://loam.example.com'],
		['a non-https localhost origin', 'http://localhost:8443'],
		['a path', 'https://loam.example.com/loam'],
		['a trailing slash', 'https://loam.example.com/'],
		['a query', 'https://loam.example.com?x=1'],
		['a fragment', 'https://loam.example.com#top'],
		['userinfo', 'https://user@loam.example.com'],
	])('P6-E1: refuses an origin with %s as HOST_ORIGIN_INSECURE', (_name, origin) => {
		expect(codes({ ...BASE, origin })).toEqual(['HOST_ORIGIN_INSECURE origin']);
	});

	it('P6-E1: takes https://localhost', () => {
		expect(codes({ ...BASE, origin: 'https://localhost:8443' })).toEqual([]);
	});

	it.each([
		['listen', { ...BASE, listen: '0.0.0.0:8443' }, 'HOST_LISTEN_INSECURE listen'],
		['listen on a name', { ...BASE, listen: 'loam.internal:8443' }, 'HOST_LISTEN_INSECURE listen'],
		[
			'sandbox.listen',
			{ ...BASE, sandbox: { origin: 'https://loam-sandbox.example.net', listen: '10.0.0.4:8444' } },
			'HOST_LISTEN_INSECURE sandbox.listen',
		],
	])(
		'P6-E1: refuses a non-loopback %s without [tls] as HOST_LISTEN_INSECURE',
		(_name, json, expected) => {
			expect(codes(json)).toEqual([expected]);
		}
	);

	it('P6-E1: takes any listen with [tls], and a loopback one without', () => {
		const tls = { cert_file: '/c', key_file: '/k' };
		expect(codes({ ...BASE, listen: '0.0.0.0:8443', tls })).toEqual([]);
		for (const listen of ['127.0.0.1:1', '127.8.9.10:443', '[::1]:8443', 'localhost:8443'])
			expect(codes({ ...BASE, listen }), listen).toEqual([]);
	});

	it.each([
		[
			'given both ways',
			{ auth: { secret_file: '/s', secret_env: 'LOAM_AUTH_SECRET' } },
			'HOST_SECRET_UNAVAILABLE auth',
		],
		['given neither way', { auth: {} }, 'HOST_SECRET_UNAVAILABLE auth'],
		[
			"an OIDC client's, given neither way",
			{ oidc: { corp: { issuer: 'https://login.example.com', client_id: 'loam' } } },
			'HOST_SECRET_UNAVAILABLE oidc.corp',
		],
		[
			'the SMTP URL, given both ways',
			{
				mail: { transport: 'smtp', from: 'a@example.com', smtp_url_env: 'U', smtp_url_file: '/u' },
			},
			'HOST_SECRET_UNAVAILABLE mail',
		],
		[
			'the SMTP URL, given neither way',
			{ mail: { transport: 'smtp', from: 'a@example.com' } },
			'HOST_SECRET_UNAVAILABLE mail',
		],
	])('P6-E1: refuses a secret %s as HOST_SECRET_UNAVAILABLE', (_name, extra, expected) => {
		expect(codes({ ...BASE, ...extra })).toContain(expected);
	});

	it.each([
		['http:', 'http://loam-sandbox.example.net'],
		['with a path', 'https://loam-sandbox.example.net/sandbox'],
	])('P6-E1: refuses a sandbox origin %s as HOST_SANDBOX_INVALID', (_name, origin) => {
		expect(codes({ ...BASE, sandbox: { origin } })).toEqual([
			'HOST_SANDBOX_INVALID sandbox.origin',
		]);
	});

	it.each([
		['another port on the same host', 'https://loam.example.com', 'https://loam.example.com:8444'],
		[
			'a subdomain of the same registrable domain',
			'https://loam.example.com',
			'https://sandbox.example.com',
		],
		[
			'the same registrable domain under a two-label suffix',
			'https://loam.acme.co.uk',
			'https://views.acme.co.uk',
		],
		['localhost on another port', 'https://localhost:8443', 'https://localhost:8444'],
		['the same IP address', 'https://127.0.0.1:8443', 'https://127.0.0.1:8444'],
	])(
		'P6-E1: refuses a same-site sandbox, %s, as HOST_SANDBOX_INVALID',
		(_name, origin, sandbox) => {
			expect(codes({ ...BASE, origin, sandbox: { origin: sandbox } })).toEqual([
				'HOST_SANDBOX_INVALID sandbox.origin',
			]);
		}
	);

	it.each([
		['another registrable domain', 'https://loam.example.com', 'https://loam-sandbox.example.net'],
		["the development profile's", 'https://localhost:8443', 'https://127.0.0.1:8444'],
		['two private-suffix registrations', 'https://acme.github.io', 'https://acme-views.github.io'],
		[
			'two registrable domains under a two-label suffix',
			'https://acme.co.uk',
			'https://acme-views.co.uk',
		],
	])('P6-E1: takes a cross-site sandbox, %s', (_name, origin, sandbox) => {
		expect(codes({ ...BASE, origin, sandbox: { origin: sandbox } })).toEqual([]);
	});

	it('P6-E1: refuses a mail sink on any origin but localhost as HOST_MAIL_SINK_EXPOSED', () => {
		expect(codes({ ...BASE, mail: { transport: 'sink' } })).toEqual([
			'HOST_MAIL_SINK_EXPOSED mail.transport',
		]);
		expect(
			codes({ ...BASE, origin: 'https://127.0.0.1:8443', mail: { transport: 'sink' } })
		).toEqual(['HOST_MAIL_SINK_EXPOSED mail.transport']);
		expect(
			codes({ ...BASE, origin: 'https://localhost:8443', mail: { transport: 'sink' } })
		).toEqual([]);
	});

	it('P6-E1: refuses SMTP keys on a sink, and an SMTP transport with no sender', () => {
		expect(
			codes({
				...BASE,
				origin: 'https://localhost:8443',
				mail: { transport: 'sink', smtp_url_env: 'U' },
			})
		).toEqual(['HOST_CONFIG_INVALID mail']);
		expect(codes({ ...BASE, mail: { transport: 'smtp', smtp_url_env: 'U' } })).toEqual([
			'HOST_CONFIG_INVALID mail.from',
		]);
	});
});

describe('the helpers of 3.2', () => {
	it('reads loopback hosts', () => {
		for (const host of ['localhost', '127.0.0.1', '127.255.0.9', '[::1]', '::1', 'LOCALHOST'])
			expect(isLoopbackHost(host), host).toBe(true);
		for (const host of ['0.0.0.0', '10.0.0.1', 'loam.example.com', '[::]', '128.0.0.1'])
			expect(isLoopbackHost(host), host).toBe(false);
	});

	it('reads a site as its registrable domain, or the host itself', () => {
		expect(siteOf('loam.example.com')).toBe('example.com');
		expect(siteOf('Views.Acme.co.uk.')).toBe('acme.co.uk');
		expect(siteOf('acme.github.io')).toBe('acme.github.io');
		expect(siteOf('localhost')).toBe('localhost');
		expect(siteOf('127.0.0.1')).toBe('127.0.0.1');
		expect(siteOf('[::1]')).toBe('[::1]');
		expect(siteOf('github.io')).toBe('github.io');
	});
});
