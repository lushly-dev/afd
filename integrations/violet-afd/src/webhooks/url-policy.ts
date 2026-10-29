/**
 * Webhook URL policy (SSRF protection)
 *
 * One shared validator used at registration/update time (syntactic + literal-IP
 * checks, no network) and by the dispatcher immediately before every delivery
 * (DNS re-resolution, so DNS rebinding after registration is blocked).
 *
 * Rules:
 * - https is required. Plain http is allowed ONLY for the explicit dev loopback
 *   hosts in {@link DEV_LOOPBACK_HOSTS} (localhost, 127.0.0.1, [::1]).
 * - URLs carrying credentials (user:pass@host) are rejected.
 * - Hosts that are, or resolve to, private / loopback / link-local / CGNAT /
 *   metadata / multicast / reserved addresses are rejected. The dev loopback
 *   hosts above are the only exception (matched by name, never by resolution:
 *   a public hostname that resolves to 127.0.0.1 is rejected).
 *
 * Opt-in for private networks (local development, self-hosted receivers on an
 * internal network): set `VIOLET_WEBHOOK_ALLOW_PRIVATE=1`, or pass
 * `allowPrivate: true` to the dispatcher / validator. This disables ONLY the
 * address-range checks; protocol and credential checks still apply.
 *
 * @module webhooks/url-policy
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Hostnames (as exposed by `URL.hostname`) that may be used for local
 * development, over http or https, without any address-range check.
 */
export const DEV_LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/** Environment variable that opts in to private/internal destinations. */
export const ALLOW_PRIVATE_ENV = 'VIOLET_WEBHOOK_ALLOW_PRIVATE';

/** Resolved address, shape-compatible with `dns.promises.lookup(..., { all: true })` */
export interface ResolvedAddress {
	address: string;
	family: number;
}

/** Injectable DNS resolver (returns ALL addresses for the host) */
export type LookupFn = (hostname: string) => Promise<ResolvedAddress[]>;

/** Default resolver: dns.lookup with all: true (honours /etc/hosts like fetch does) */
export const defaultLookup: LookupFn = async (hostname) =>
	dnsLookup(hostname, { all: true, verbatim: true });

export interface UrlPolicyOptions {
	/** Allow private/internal address ranges. Defaults to VIOLET_WEBHOOK_ALLOW_PRIVATE=1. */
	allowPrivate?: boolean;
	/** DNS resolver (injectable for tests). Defaults to dns.lookup. */
	lookup?: LookupFn;
}

export type UrlPolicyResult = { ok: true; url: URL } | { ok: false; reason: string };

/** Whether the opt-in env var is set */
export function isPrivateAllowedByEnv(): boolean {
	return process.env[ALLOW_PRIVATE_ENV] === '1';
}

/** True for the explicit development loopback host names */
export function isDevLoopbackHost(hostname: string): boolean {
	return DEV_LOOPBACK_HOSTS.includes(hostname.toLowerCase());
}

// -----------------------------------------------------------------------------
// IP classification
// -----------------------------------------------------------------------------

function parseIPv4(address: string): [number, number, number, number] | null {
	const parts = address.split('.');
	if (parts.length !== 4) return null;
	const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN));
	if (octets.some((o) => Number.isNaN(o) || o > 255)) return null;
	return octets as [number, number, number, number];
}

/** Expands an IPv6 literal to eight 16-bit groups (supports embedded dotted quads). */
function parseIPv6(input: string): number[] | null {
	let address = input;
	const zone = address.indexOf('%');
	if (zone !== -1) address = address.slice(0, zone);

	// Convert trailing dotted quad into two hex groups
	const lastColon = address.lastIndexOf(':');
	const tail = address.slice(lastColon + 1);
	if (tail.includes('.')) {
		const v4 = parseIPv4(tail);
		if (!v4) return null;
		const hi = ((v4[0] << 8) | v4[1]).toString(16);
		const lo = ((v4[2] << 8) | v4[3]).toString(16);
		address = `${address.slice(0, lastColon + 1)}${hi}:${lo}`;
	}

	const halves = address.split('::');
	if (halves.length > 2) return null;
	const head = halves[0] ? halves[0].split(':') : [];
	const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
	let groups: string[];
	if (halves.length === 2) {
		const missing = 8 - head.length - rest.length;
		if (missing < 1) return null;
		groups = [...head, ...Array<string>(missing).fill('0'), ...rest];
	} else {
		groups = head;
	}
	if (groups.length !== 8) return null;
	const out = groups.map((g) =>
		/^[0-9a-fA-F]{1,4}$/.test(g) ? Number.parseInt(g, 16) : Number.NaN,
	);
	return out.some(Number.isNaN) ? null : out;
}

/** Blocked IPv4 ranges as [network address, prefix length, description] */
const BLOCKED_IPV4: ReadonlyArray<readonly [string, number, string]> = [
	['0.0.0.0', 8, 'unspecified/"this network" address'],
	['10.0.0.0', 8, 'private network address (10.0.0.0/8)'],
	['100.64.0.0', 10, 'carrier-grade NAT address (100.64.0.0/10)'],
	['127.0.0.0', 8, 'loopback address'],
	['169.254.0.0', 16, 'link-local/metadata address (169.254.0.0/16)'],
	['172.16.0.0', 12, 'private network address (172.16.0.0/12)'],
	['192.0.0.0', 24, 'IETF protocol assignment address (192.0.0.0/24)'],
	['192.168.0.0', 16, 'private network address (192.168.0.0/16)'],
	['198.18.0.0', 15, 'benchmarking address (198.18.0.0/15)'],
	['224.0.0.0', 4, 'multicast address'],
	['240.0.0.0', 4, 'reserved address'],
];

function ipv4ToInt(o: readonly number[]): number {
	return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
}

function blockedIPv4(o: [number, number, number, number]): string | null {
	const ip = ipv4ToInt(o);
	for (const [network, bits, reason] of BLOCKED_IPV4) {
		const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
		const net = ipv4ToInt(parseIPv4(network) as number[]);
		if ((ip & mask) >>> 0 === (net & mask) >>> 0) return reason;
	}
	return null;
}

function embeddedV4(hi: number, lo: number): [number, number, number, number] {
	return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

/** Blocked IPv6 prefixes on the first group: [mask, value, description] */
const BLOCKED_IPV6_FIRST_GROUP: ReadonlyArray<readonly [number, number, string]> = [
	[0xfe00, 0xfc00, 'unique-local address (fc00::/7)'],
	[0xffc0, 0xfe80, 'link-local address (fe80::/10)'],
	[0xffc0, 0xfec0, 'site-local address (fec0::/10)'],
	[0xff00, 0xff00, 'multicast address'],
];

function blockedIPv6(g: number[]): string | null {
	const zeroPrefix = (n: number) => g.slice(0, n).every((x) => x === 0);

	if (zeroPrefix(7)) {
		if (g[7] === 0) return 'unspecified address';
		if (g[7] === 1) return 'loopback address';
	}
	// Addresses embedding an IPv4 address take that address's verdict:
	// IPv4-mapped ::ffff:a.b.c.d, IPv4-compatible ::a.b.c.d (deprecated),
	// NAT64 64:ff9b::/96, and 6to4 2002::/16 (IPv4 in groups 1-2).
	if (zeroPrefix(5) && g[5] === 0xffff) return blockedIPv4(embeddedV4(g[6], g[7]));
	if (zeroPrefix(6)) return blockedIPv4(embeddedV4(g[6], g[7])) ?? 'IPv4-compatible address';
	if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
		return blockedIPv4(embeddedV4(g[6], g[7]));
	}
	if (g[0] === 0x2002) return blockedIPv4(embeddedV4(g[1], g[2]));

	for (const [mask, value, reason] of BLOCKED_IPV6_FIRST_GROUP) {
		if ((g[0] & mask) === value) return reason;
	}
	return null;
}

/**
 * Returns a human-readable reason if `address` is a non-public address, or
 * null if it is a routable public address. Unparseable input is blocked.
 */
export function classifyBlockedAddress(address: string): string | null {
	const bare = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
	const family = isIP(bare);
	if (family === 4) {
		const octets = parseIPv4(bare);
		return octets ? blockedIPv4(octets) : 'invalid IPv4 address';
	}
	if (family === 6) {
		const groups = parseIPv6(bare);
		return groups ? blockedIPv6(groups) : 'invalid IPv6 address';
	}
	return 'invalid IP address';
}

// -----------------------------------------------------------------------------
// URL validation
// -----------------------------------------------------------------------------

function shouldAllowPrivate(options?: UrlPolicyOptions): boolean {
	return options?.allowPrivate ?? isPrivateAllowedByEnv();
}

/**
 * Synchronous validation: protocol, credentials, and literal-IP / obviously
 * local hostnames. Performs no DNS lookups. Used at registration and update.
 */
export function validateWebhookUrl(rawUrl: string, options?: UrlPolicyOptions): UrlPolicyResult {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return { ok: false, reason: 'Invalid URL format' };
	}

	const devHost = isDevLoopbackHost(url.hostname);

	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && devHost)) {
		return {
			ok: false,
			reason: 'Webhook URL must use HTTPS (http is only allowed for localhost/127.0.0.1/[::1])',
		};
	}

	if (url.username || url.password) {
		return { ok: false, reason: 'Webhook URL must not contain credentials' };
	}

	if (devHost || shouldAllowPrivate(options)) {
		return { ok: true, url };
	}

	const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
	if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
		return { ok: false, reason: 'Webhook URL host resolves to a loopback address' };
	}

	if (isIP(hostname.startsWith('[') ? hostname.slice(1, -1) : hostname) !== 0) {
		const reason = classifyBlockedAddress(hostname);
		if (reason) {
			return { ok: false, reason: `Webhook URL host is a non-public address: ${reason}` };
		}
	}

	return { ok: true, url };
}

/**
 * Full validation including DNS: everything in {@link validateWebhookUrl}, plus
 * every address the hostname currently resolves to must be public. Called by the
 * dispatcher immediately before each delivery to defeat DNS rebinding.
 */
export async function assertWebhookUrlSafe(
	rawUrl: string,
	options?: UrlPolicyOptions,
): Promise<UrlPolicyResult> {
	const syntactic = validateWebhookUrl(rawUrl, options);
	if (!syntactic.ok) return syntactic;

	const { url } = syntactic;
	const hostname = url.hostname;

	// Dev loopback hosts and the explicit private opt-in skip resolution checks.
	if (isDevLoopbackHost(hostname) || shouldAllowPrivate(options)) return syntactic;

	// Literal IPs were fully classified by validateWebhookUrl.
	if (isIP(hostname.startsWith('[') ? hostname.slice(1, -1) : hostname) !== 0) return syntactic;

	let addresses: ResolvedAddress[];
	try {
		addresses = await (options?.lookup ?? defaultLookup)(hostname);
	} catch {
		return { ok: false, reason: 'DNS lookup failed' };
	}

	if (addresses.length === 0) {
		return { ok: false, reason: 'DNS lookup returned no addresses' };
	}

	for (const { address } of addresses) {
		const reason = classifyBlockedAddress(address);
		if (reason) {
			return { ok: false, reason: `Webhook URL host resolves to a non-public address: ${reason}` };
		}
	}

	return syntactic;
}
