/**
 * @fileoverview What `dev` and `start` hand `createLoamHost` beyond its configuration: for the development
 * profile (phase 6 specification, 5.1), the lock it took first, the sockets it bound before the configuration
 * existed, and the sandbox origin it wrote the site with; for `start`, its own refusals (3.1). Kept off the
 * package's entry.
 */

import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { DataLock } from './lock.js';
import type { TestOAuthV1 } from './provider.js';

export const HOST_INTERNALS: unique symbol = Symbol('loam-host.internals');

export interface HostInternals {
	[HOST_INTERNALS]?: {
		/** Taken by the caller; from here the host owns it, and releases it on a failed start or `close()`. */
		lock?: DataLock;
		/** Bound by the caller and not yet serving; from here the host owns them too. */
		servers?: { shell: Server; sandbox?: Server };
		/** The deployment is read, checked and written as if its `[sandbox] origin` were this one. */
		sandboxOrigin?: string;
		/**
		 * `loam-host start`'s own refusals (3.1, 3.3): a `local` deployment (`HOST_IDENTITY_LOCAL`), and a `provider`
		 * deployment whose organization was never bootstrapped (`HOST_NOT_BOOTSTRAPPED`). `dev` serves both.
		 */
		start?: true;
		/** Tests only, through `dev`: the provider's rate limit, raised for a suite (never off). */
		rateLimit?: { window: number; max: number };
		/** Tests only, through `dev`: phase 3's step 10's authorization server options (`TestOAuthV1`). */
		testOAuth?: TestOAuthV1;
	};
}

export interface TlsMaterial {
	readonly cert: Buffer;
	readonly key: Buffer;
}

/**
 * A server with no handler yet: `node:https` with the certificate when TLS is given, else `node:http`. A
 * request with no `Host` reaches the gate, which answers it 421, not Node's own 400.
 */
export function createHostServer(tls?: TlsMaterial): Server {
	return tls
		? createHttpsServer({ cert: tls.cert, key: tls.key, requireHostHeader: false })
		: createHttpServer({ requireHostHeader: false });
}

/** Binds `server` to `host:port`, resolving once it listens and rejecting with the bind's error. */
export function bindServer(server: Server, host: string, port: number): Promise<void> {
	return new Promise((done, fail) => {
		const failed = (error: Error) => {
			server.off('listening', listening);
			fail(error);
		};
		const listening = () => {
			server.off('error', failed);
			done();
		};
		server.once('error', failed);
		server.once('listening', listening);
		server.listen(port, host);
	});
}
