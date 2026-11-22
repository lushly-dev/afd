/**
 * @fileoverview `@lushly-dev/loam-host/testing` (phase 6 specification, 5.2): `startDevHost`, the development
 * profile in a child process a test can restart and kill, `scanSecrets`, and the Windows ACL helpers a
 * fixture needs (`readAcls`, `exposedTo`, `restrictAcls`). The `loam-host` bin never imports it.
 */

import { childLauncher } from './child-launcher.js';
import { createDevHost, type DevHost, type StartDevHostOptions } from './dev-host.js';

export { exposedTo, readAcls, restrictAcls } from '../acl.js';
export { HOSTED_MCP_COMMANDS } from '../mcp.js';
export type { DevHost, JournalEntry, StartDevHostOptions } from './dev-host.js';
export { trustingFetch } from './fetch.js';
export {
	type AgentTokenOptions,
	agentToken,
	type HostSend,
	registerTestClients,
	type TestClientV1,
} from './oauth.js';
export { type ScannedHost, type ScannedPage, scanSecrets } from './scan.js';

/**
 * The development profile in a child process, as `startTestAuthHost` runs its host, so a test can kill it,
 * with `NODE_EXTRA_CA_CERTS` set to its own certificate. Until step 3 it serves a `local` deployment of
 * version 1 or 2 through the test-only option.
 */
export function startDevHost(options: StartDevHostOptions): Promise<DevHost> {
	return createDevHost(options, childLauncher);
}
