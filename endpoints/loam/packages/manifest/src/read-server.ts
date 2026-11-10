/**
 * @fileoverview `loam.server.toml`'s reader (phase 6 specification, 3.2): what can be said from the file
 * alone. Whatever needs the file system or the environment (a secret's value, a file's mode), or the
 * deployment file (its sandbox origin, its sign-in methods), is the hosted server's check.
 */

import { getDomain } from 'tldts';
import type { ServerConfigV1 } from './_generated/types.js';
import { keyOf, suggestKey } from './pointers.js';
import type { Refusal } from './types.js';
import { validateServerConfig } from './validate-server.generated.js';
import { pointerOf, reportedErrors, type ValidatorError } from './validator-errors.js';

export type { ServerConfigV1 };

/** A code `readServerConfig` can refuse with: each is also one of `@lushly-dev/loam-host`'s `HostErrorCode`. */
export type ServerConfigRefusalCode =
	| 'HOST_CONFIG_INVALID'
	| 'HOST_ORIGIN_INSECURE'
	| 'HOST_LISTEN_INSECURE'
	| 'HOST_SECRET_UNAVAILABLE'
	| 'HOST_SANDBOX_INVALID'
	| 'HOST_MAIL_SINK_EXPOSED';

export type ServerConfigRefusal = Refusal<ServerConfigRefusalCode>;

/** `[limits]` with every default filled in (3.2). */
export type ServerLimitsV1 = Required<NonNullable<ServerConfigV1['limits']>>;

/** `[discovery]` with every default filled in (3.2, Q2). */
export type ServerDiscoveryV1 = Required<NonNullable<ServerConfigV1['discovery']>>;

export const SERVER_LIMITS_V1: Readonly<ServerLimitsV1> = Object.freeze({
	request_body_bytes: 1_048_576,
	relay_response_bytes: 4_194_304,
	relay_concurrency_per_person: 16,
	relay_timeout_ms: 60_000,
	relay_session_idle_ms: 900_000,
});

export const SERVER_DISCOVERY_V1: Readonly<ServerDiscoveryV1> = Object.freeze({
	server_card: true,
	ai_catalog: false,
	agent_guide: false,
});

export type ServerConfigRead =
	| {
			ok: true;
			server: ServerConfigV1;
			limits: ServerLimitsV1;
			discovery: ServerDiscoveryV1;
			warnings: ServerConfigRefusal[];
	  }
	| { ok: false; refusals: ServerConfigRefusal[]; warnings: ServerConfigRefusal[] };

/** The keys each table admits, for a suggestion when a key is unknown; a unit holds it to the schema. */
export const SERVER_ADMITTED_KEYS_V1: Readonly<Record<string, readonly string[]>> = {
	'': [
		'server_version',
		'origin',
		'listen',
		'data',
		'tls',
		'sandbox',
		'auth',
		'mail',
		'oidc',
		'limits',
		'discovery',
	],
	'/tls': ['cert_file', 'key_file'],
	'/sandbox': ['origin', 'listen'],
	'/auth': ['secret_file', 'secret_env'],
	'/mail': ['transport', 'from', 'smtp_url_env', 'smtp_url_file'],
	'/oidc/*': ['issuer', 'client_id', 'client_secret_file', 'client_secret_env'],
	'/limits': Object.keys(SERVER_LIMITS_V1),
	'/discovery': Object.keys(SERVER_DISCOVERY_V1),
};

function admittedFor(table: string): readonly string[] {
	return SERVER_ADMITTED_KEYS_V1[table.replace(/^\/oidc\/[^/]+$/, '/oidc/*')] ?? [];
}

function schemaRefusal(error: ValidatorError): ServerConfigRefusal {
	const pointer = pointerOf(error);
	const key = keyOf(pointer);
	if (error.keyword === 'additionalProperties') {
		const name = pointer.split('/').at(-1) ?? '';
		return {
			code: 'HOST_CONFIG_INVALID',
			key,
			message: `\`${key}\` is not a key of \`loam.server.toml\`.`,
			suggestion: suggestKey(name, admittedFor(error.instancePath)),
		};
	}
	if (error.keyword === 'required') {
		return {
			code: 'HOST_CONFIG_INVALID',
			key,
			message: `\`${key}\` is required.`,
			suggestion: `Add \`${key}\`.`,
		};
	}
	if (pointer === '/server_version') {
		return {
			code: 'HOST_CONFIG_INVALID',
			key,
			message: '`server_version` must be 1.',
			suggestion: 'Set `server_version = 1`; this server reads version 1 only.',
		};
	}
	return {
		code: 'HOST_CONFIG_INVALID',
		key,
		message: `\`${key}\` ${error.message ?? 'is not valid'}.`,
		suggestion:
			'Fix the value; the server configuration is documented in the phase 6 specification, 3.2.',
	};
}

/** `host` is a loopback address: 127.0.0.0/8, `::1` or `localhost`. */
export function isLoopbackHost(host: string): boolean {
	const bare = host.toLowerCase().replace(/^\[(.*)\]$/, '$1');
	return bare === 'localhost' || bare === '::1' || /^127(\.\d{1,3}){3}$/.test(bare);
}

/** Splits `host:port`; the host keeps an IPv6 address's brackets. */
export function splitListen(listen: string): { host: string; port: number } {
	const at = listen.lastIndexOf(':');
	return { host: listen.slice(0, at), port: Number(listen.slice(at + 1)) };
}

/**
 * The site a host belongs to: its registrable domain under the Public Suffix List (private entries
 * included, as browsers read it), or the host itself for an IP address, `localhost`, or a host that is a
 * public suffix itself (3.2: "the same registrable domain, or the same host for an IP address or
 * `localhost`").
 */
export function siteOf(host: string): string {
	const bare = host.toLowerCase().replace(/\.$/, '');
	if (bare.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(bare) || bare === 'localhost')
		return bare;
	return getDomain(bare, { allowPrivateDomains: true }) ?? bare;
}

type OriginProblem = 'unparsable' | 'scheme' | 'parts' | 'canonical';

/** What is wrong with an origin as 3.2 reads one, or undefined. */
function originProblem(value: string): OriginProblem | undefined {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return 'unparsable';
	}
	if (url.protocol !== 'https:') return 'scheme';
	if (value === url.origin) return undefined;
	// A path (a bare `/` included), a query, a fragment or userinfo; anything else is only its spelling.
	const extra = ['/', '?', '#'].some((mark) =>
		value.toLowerCase().startsWith(`${url.origin}${mark}`)
	);
	return url.username || url.password || url.search || url.hash || url.pathname !== '/' || extra
		? 'parts'
		: 'canonical';
}

function originRefusals(server: ServerConfigV1): ServerConfigRefusal[] {
	const refusals: ServerConfigRefusal[] = [];
	const problem = originProblem(server.origin);
	if (problem === 'scheme' || problem === 'parts') {
		refusals.push({
			code: 'HOST_ORIGIN_INSECURE',
			key: 'origin',
			message:
				problem === 'scheme'
					? '`origin` must be `https:`, `localhost` included.'
					: '`origin` is an origin only: no path, query, fragment or user name.',
			suggestion:
				'Use `https://<host>[:<port>]`; put TLS in front of the server, or give it `[tls]`.',
		});
	} else if (problem) {
		refusals.push({
			code: 'HOST_CONFIG_INVALID',
			key: 'origin',
			message: '`origin` is not an origin in its canonical form.',
			suggestion:
				'Write it as a browser does: a lowercase host, and no port when it is 443, such as `https://loam.example.com`.',
		});
	}
	const sandbox = server.sandbox?.origin;
	if (sandbox !== undefined) {
		const sandboxProblem = originProblem(sandbox);
		if (sandboxProblem) {
			refusals.push({
				code: 'HOST_SANDBOX_INVALID',
				key: 'sandbox.origin',
				message: '`sandbox.origin` must be an `https:` origin in its canonical form.',
				suggestion: 'Use another site, such as `https://loam-sandbox.example.net`.',
			});
		} else if (
			!problem &&
			siteOf(new URL(sandbox).hostname) === siteOf(new URL(server.origin).hostname)
		) {
			refusals.push({
				code: 'HOST_SANDBOX_INVALID',
				key: 'sandbox.origin',
				message:
					"`sandbox.origin` is the same site as `origin`, so a view's frame would be sent the shell's cookies.",
				suggestion:
					'Use another registrable domain, such as `https://loam-sandbox.example.net`; for `localhost`, `https://127.0.0.1:<port>`.',
			});
		}
	}
	return refusals;
}

function listenRefusals(server: ServerConfigV1): ServerConfigRefusal[] {
	const refusals: ServerConfigRefusal[] = [];
	for (const [key, listen] of [
		['listen', server.listen],
		['sandbox.listen', server.sandbox?.listen],
	] as const) {
		if (listen === undefined) continue;
		const { host, port } = splitListen(listen);
		if (port > 65_535) {
			refusals.push({
				code: 'HOST_CONFIG_INVALID',
				key,
				message: `\`${key}\`'s port is past 65535.`,
				suggestion: 'Use a port from 1 to 65535.',
			});
		} else if (server.tls === undefined && !isLoopbackHost(host)) {
			refusals.push({
				code: 'HOST_LISTEN_INSECURE',
				key,
				message: `With no \`[tls]\`, \`${key}\` must be a loopback address: plain HTTP is only for a TLS proxy on the same machine.`,
				suggestion: 'Listen on `127.0.0.1:<port>` behind a TLS-terminating proxy, or add `[tls]`.',
			});
		}
	}
	return refusals;
}

function secretRefusal(key: string, both: boolean): ServerConfigRefusal {
	return {
		code: 'HOST_SECRET_UNAVAILABLE',
		key,
		message: both ? `\`${key}\` gives its secret both ways.` : `\`${key}\` gives no secret.`,
		suggestion: both
			? 'Keep the file or the environment variable, not both.'
			: 'Name a file of mode 0600, or an environment variable.',
	};
}

function oneOf(
	table: Record<string, unknown>,
	a: string,
	b: string
): 'both' | 'neither' | undefined {
	const has = (key: string) => table[key] !== undefined;
	if (has(a) && has(b)) return 'both';
	return has(a) || has(b) ? undefined : 'neither';
}

function secretRefusals(server: ServerConfigV1): ServerConfigRefusal[] {
	const refusals: ServerConfigRefusal[] = [];
	if (server.auth) {
		const found = oneOf(server.auth, 'secret_file', 'secret_env');
		if (found) refusals.push(secretRefusal('auth', found === 'both'));
	}
	for (const [id, table] of Object.entries(server.oidc ?? {})) {
		const found = oneOf(table, 'client_secret_file', 'client_secret_env');
		if (found) refusals.push(secretRefusal(`oidc.${id}`, found === 'both'));
	}
	const mail = server.mail;
	if (mail?.transport === 'smtp') {
		const found = oneOf(mail, 'smtp_url_file', 'smtp_url_env');
		if (found) refusals.push(secretRefusal('mail', found === 'both'));
		if (mail.from === undefined) {
			refusals.push({
				code: 'HOST_CONFIG_INVALID',
				key: 'mail.from',
				message: '`[mail] transport = "smtp"` needs a `from`.',
				suggestion: 'Add `from = "Name <address@example.com>"`.',
			});
		}
	}
	if (
		mail?.transport === 'sink' &&
		(mail.smtp_url_env !== undefined || mail.smtp_url_file !== undefined)
	) {
		refusals.push({
			code: 'HOST_CONFIG_INVALID',
			key: 'mail',
			message: 'A `sink` sends nothing, so it takes no SMTP URL.',
			suggestion: 'Remove `smtp_url_env` and `smtp_url_file`, or set `transport = "smtp"`.',
		});
	}
	return refusals;
}

function sinkRefusals(server: ServerConfigV1): ServerConfigRefusal[] {
	if (server.mail?.transport !== 'sink') return [];
	let host: string | undefined;
	try {
		host = new URL(server.origin).hostname;
	} catch {
		host = undefined;
	}
	if (host === 'localhost') return [];
	return [
		{
			code: 'HOST_MAIL_SINK_EXPOSED',
			key: 'mail.transport',
			message:
				'A mail sink keeps join and recovery links in a file, which only the development profile on `localhost` may do.',
			suggestion: 'Set `transport = "smtp"` with an SMTP URL, or serve on `https://localhost`.',
		},
	];
}

/**
 * Reads version 1 of `loam.server.toml`, parsed as JSON. It refuses what the file alone says is wrong
 * (3.2); `@lushly-dev/loam-host`'s check adds what needs the file system, the environment and the
 * deployment file.
 */
export function readServerConfig(json: unknown): ServerConfigRead {
	if (!validateServerConfig(json)) {
		return {
			ok: false,
			refusals: [...reportedErrors(validateServerConfig.errors ?? []).values()].map(schemaRefusal),
			warnings: [],
		};
	}
	const server = json as ServerConfigV1;
	const refusals = [
		...originRefusals(server),
		...listenRefusals(server),
		...secretRefusals(server),
		...sinkRefusals(server),
	];
	if (refusals.length > 0) return { ok: false, refusals, warnings: [] };
	return {
		ok: true,
		server,
		limits: { ...SERVER_LIMITS_V1, ...server.limits },
		discovery: { ...SERVER_DISCOVERY_V1, ...server.discovery },
		warnings: [],
	};
}
