/**
 * @fileoverview The child process `startDevHost` runs (phase 6 specification, 5.2): the development profile,
 * with the test-only option that serves a version 1 to 3 deployment until step 3. It reports one line,
 * `ready` or `failed`, then serves until `SIGTERM`, when it closes the host and releases the lock.
 */

import { runDev } from '../dev.js';
import { SERVE_STATIC_DEPLOYMENT } from '../testing-only.js';
import { type ChildReady, FAILED, READY } from './protocol.js';

async function main(): Promise<void> {
	const options = JSON.parse(process.argv[2] ?? '{}') as { deployment: string; data?: string };
	try {
		const profile = await runDev({ ...options, [SERVE_STATIC_DEPLOYMENT]: true });
		const { origin, sandboxOrigin, spki, certificate, mail, data } = profile;
		const ready: ChildReady = { origin, sandboxOrigin, spki, certificate, mail, data };
		process.stdout.write(`${READY} ${JSON.stringify(ready)}\n`);
		const stop = () => {
			void profile.host.close().then(() => process.exit(0));
		};
		process.once('SIGTERM', stop);
		process.once('SIGINT', stop);
	} catch (cause) {
		const { code, message } = cause as { code?: string; message?: string };
		process.stdout.write(`${FAILED} ${JSON.stringify({ code: code ?? 'DEV_FAILED', message })}\n`);
		process.exit(1);
	}
}

await main();
