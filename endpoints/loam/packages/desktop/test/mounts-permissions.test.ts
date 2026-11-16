/**
 * P6-D2 (phase 6 specification, 10.3): a `mounts.json` others can read is refused, and the desktop mounts
 * nothing (`DESKTOP_MOUNTS_PERMISSIONS`). Its own app, since the desktop is single-instance.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureTable } from './frames';
import { desktopDeployment, openDesktop, untilInstance } from './harness';

describe('P6-D2: a mounts.json others can read', () => {
	it('P6-D2: is refused, and nothing is mounted', async () => {
		const loose = await openDesktop({
			deployment: desktopDeployment(await fixtureTable()),
			async prepare(data) {
				const file = join(data, 'mounts.json');
				if (process.platform === 'win32')
					spawnSync(join(String(process.env.SystemRoot), 'System32', 'icacls.exe'), [
						file,
						'/grant',
						'*S-1-5-32-545:R',
					]);
				else spawnSync('chmod', ['644', file]);
			},
		});
		try {
			const refused = await loose.browser.execute(async () => {
				const internals = (
					window as unknown as {
						__TAURI_INTERNALS__: { invoke(command: string, args: unknown): Promise<unknown> };
					}
				).__TAURI_INTERNALS__;
				try {
					await internals.invoke('mount_open', { instance: 'fixture' });
					return 'opened';
				} catch (error) {
					return String(error);
				}
			});
			expect(refused).toBe('DESKTOP_MOUNTS_PERMISSIONS');
			const fixture = await untilInstance(loose, 'fixture', 'failed');
			expect(fixture.error?.code).toBe('MOUNT_UNREACHABLE');
		} finally {
			await loose.close();
		}
	});
});
