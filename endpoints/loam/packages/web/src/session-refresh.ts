/**
 * @fileoverview The one session refresh of a `provider` deployment (phase 6 specification, 8.1; step 6's deviation 2):
 * phase 3's 4.3 refresh, `ProviderIdentity.refreshSession()`, handed by `main.ts` both to the mount transport, which runs
 * it on the hosted relay's own `401`, and to the trust-record transport, which runs it on `api/kernel/call`'s `401`. Out
 * of `main.ts` so a unit holds both paths to the same function; each chunk still loads on first use.
 */

import type { ServerCallV1 } from '@lushly-dev/loam-kernel';
import type { DesktopInvoke } from './desktop-ipc.js';

/** What `main.ts` hands stage B and the kernel, with the refresh in each. */
export function createSessionRefresh(base: string, desktopInvoke?: DesktopInvoke | null) {
	let provider: { refreshSession(): void } | undefined;
	/** Nothing until a provider is probed: a `local` deployment has no session to refresh. */
	const refreshSession = () => provider?.refreshSession();
	return {
		/** The probed provider, whose refresh both transports run from then on. */
		use(probed: { refreshSession(): void }) {
			provider = probed;
		},
		/** The `mount` chunk, its transport given the refresh: what stage B's reader loads. */
		async mountChunk() {
			const chunk = await import('./mount.js');
			return {
				...chunk,
				createMountTransport: (url: string) =>
					chunk.createMountTransport(url, undefined, { refreshSession }),
				createDesktopMountTransport: (instance: string, options?: { era?: 'modern' }) =>
					chunk.createDesktopMountTransport(
						instance,
						desktopInvoke === undefined ? options : { ...options, invoke: desktopInvoke }
					),
			};
		},
		/** The identity ports, and in a hosted deployment the transport's port, its chunk loaded on the first call (6.1). */
		identityPorts<P extends object>(ports: P, hosted: boolean): P & { serverCall?: ServerCallV1 } {
			return hosted
				? {
						...ports,
						serverCall: async (request) =>
							(await import('./server-call.js')).serverCall(
								{ url: new URL('api/kernel/call', base).href, refreshSession },
								request
							),
					}
				: ports;
		},
	};
}
