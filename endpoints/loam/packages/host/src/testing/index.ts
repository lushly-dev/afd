/**
 * @fileoverview `@lushly-dev/loam-host/testing` (phase 6 specification, 5.2): `startDevHost`, the development
 * profile in a child process a test can restart and kill, and `scanSecrets`. The `loam-host` bin never
 * imports it.
 */

import { childLauncher } from './child-launcher.js';
import { createDevHost, type DevHost, type StartDevHostOptions } from './dev-host.js';

export type { DevHost, JournalEntry, StartDevHostOptions } from './dev-host.js';
export { type ScannedHost, type ScannedPage, scanSecrets } from './scan.js';

/**
 * The development profile in a child process, as `startTestAuthHost` runs its host, so a test can kill it,
 * with `NODE_EXTRA_CA_CERTS` set to its own certificate. Until step 3 it serves a `local` deployment of
 * version 1 or 2 through the test-only option.
 */
export function startDevHost(options: StartDevHostOptions): Promise<DevHost> {
	return createDevHost(options, childLauncher);
}
