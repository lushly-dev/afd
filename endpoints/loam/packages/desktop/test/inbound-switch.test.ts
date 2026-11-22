/**
 * P6-D6's switch (phase 6 specification, 10.8): it fails closed. `[host] inbound = false`, or no `mounts.json`, binds
 * nothing. A file of its own, so each app here starts with no other instance of the app alive.
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { desktopDeployment, openDesktop } from './harness';
import { connectionFile } from './inbound';

describe('P6-D6: the switch fails closed', () => {
	for (const [what, options] of [
		[
			'[host] inbound = false',
			{
				deployment: desktopDeployment().replace(
					'kind = "desktop"',
					'kind = "desktop"\ninbound = false'
				),
			},
		],
		[
			'no mounts.json',
			{
				async prepare(data: string) {
					rmSync(join(data, 'mounts.json'));
				},
			},
		],
	] as const) {
		it(`P6-D6: ${what} binds nothing`, async () => {
			const off = await openDesktop(options);
			try {
				// The shell is ready, so the host's setup, which starts the endpoint before the window, is long past.
				expect(existsSync(connectionFile(off.data))).toBe(false);
			} finally {
				await off.close();
			}
		}, 180_000);
	}
});
