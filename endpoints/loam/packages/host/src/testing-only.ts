/**
 * @fileoverview Test-only seams, imported by this package's own tests and never exported from its entry
 * (step 2's `/testing` may re-export them for its harness). Step 3 removes `SERVE_STATIC_DEPLOYMENT`.
 */

import type { AddressInfo } from 'node:net';

/**
 * Serve a `local` deployment of versions 1 to 3, read as `static`, until step 3 brings version 4 and its
 * `[host] kind = "hosted"` (phase 6 specification, 20, row 1).
 */
export const SERVE_STATIC_DEPLOYMENT: unique symbol = Symbol('loam-host.serveStaticDeployment');

export interface TestOnlyOptions {
	[SERVE_STATIC_DEPLOYMENT]?: true;
}

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
