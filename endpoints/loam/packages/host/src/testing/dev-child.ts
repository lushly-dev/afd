/**
 * @fileoverview The child process `startDevHost` runs (phase 6 specification, 5.2): the development profile,
 * as the bin's `dev` runs it. It reports one line,
 * `ready` or `failed`, then serves until `SIGTERM`, when it closes the host and releases the lock. It runs
 * only in a child, so `vitest.config.ts` leaves it out of the units' coverage; the hosted suite runs it.
 */

import { type DevOptions, runDev } from '../dev.js';
import { type ChildReady, FAILED, READY } from './protocol.js';

async function main(): Promise<void> {
	const options = JSON.parse(process.argv[2] ?? '{}') as DevOptions;
	try {
		const profile = await runDev(options);
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
