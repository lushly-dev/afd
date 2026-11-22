/**
 * @fileoverview Test-only seams, imported by this package's own tests and its `/testing` harness, and never
 * exported from its entry: each listener's bound address, and the provider a host mounted.
 */

import type { AddressInfo } from 'node:net';
import type { HostedMcp } from './mcp.js';
import type { HostProvider } from './provider.js';

/** Each listener's bound address, after `listen()`, so a test can bind port 0. */
export interface BoundAddresses {
	shell: AddressInfo;
	sandbox: AddressInfo | null;
}

const bound = new WeakMap<object, () => BoundAddresses | null>();

export function recordAddresses(host: object, read: () => BoundAddresses | null): void {
	bound.set(host, read);
}

export function boundAddresses(host: object): BoundAddresses {
	const addresses = bound.get(host)?.();
	if (!addresses) throw new Error('The host is not listening.');
	return addresses;
}

const providers = new WeakMap<object, HostProvider>();

export function recordProvider(host: object, provider: HostProvider): void {
	providers.set(host, provider);
}

/** The provider a host mounted, so a test lists its routes from the instance the host serves (5.8). */
export function providerOf(host: object): HostProvider {
	const provider = providers.get(host);
	if (!provider) throw new Error('The host mounts no provider: its deployment is `local`.');
	return provider;
}

const mounted = new WeakMap<object, HostedMcp>();

export function recordHostedMcp(host: object, mcp: HostedMcp): void {
	mounted.set(host, mcp);
}

/** The server kernel and MCP surface a host mounted (3.6), for its units. */
export function hostedMcpOf(host: object): HostedMcp {
	const held = mounted.get(host);
	if (!held) throw new Error('The host mounts no MCP route: its deployment is `local`.');
	return held;
}
