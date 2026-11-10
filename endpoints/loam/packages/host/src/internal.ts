/**
 * @fileoverview What the development profile hands `createLoamHost` that a production start does not
 * (phase 6 specification, 5.1): the lock it took first, the sockets it bound before the configuration
 * existed, and the sandbox origin it wrote the site with. Kept off the package's entry; only `dev` uses it.
 */

import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { DataLock } from './lock.js';

export const HOST_INTERNALS: unique symbol = Symbol('loam-host.internals');

export interface HostInternals {
	[HOST_INTERNALS]?: {
		/** Taken by the caller; from here the host owns it, and releases it on a failed start or `close()`. */
		lock?: DataLock;
		/** Bound by the caller and not yet serving; from here the host owns them too. */
		servers?: { shell: Server; sandbox?: Server };
		/** The deployment is read, checked and written as if its `[sandbox] origin` were this one. */
		sandboxOrigin?: string;
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
