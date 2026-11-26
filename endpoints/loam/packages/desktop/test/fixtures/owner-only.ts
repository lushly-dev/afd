/**
 * A file only its owner may read, as the Rust host requires of a key file (phase 5 specification, 4.2): mode 0600
 * on Unix; on Windows the user's own SID as its owner and its one allow entry, with inheritance removed, since a file
 * in `%TEMP%` inherits SYSTEM's and the Administrators' entries, which the host refuses.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const windows = process.platform === 'win32';
/** Windows' own tools, by path: another `whoami` on `PATH` (Git's) takes other arguments. */
export const system = () => join(process.env.SystemRoot ?? process.env.windir ?? '', 'System32');

export function restrict(path: string): void {
	if (!windows) {
		const done = spawnSync('chmod', ['600', path]);
		if (done.status !== 0) throw new Error('chmod 600 failed');
		return;
	}
	const sid = /"(S-1-[0-9-]+)"\s*$/.exec(
		spawnSync(join(system(), 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {
			encoding: 'utf8',
		}).stdout.trim()
	)?.[1];
	if (!sid) throw new Error('whoami named no SID');
	const icacls = join(system(), 'icacls.exe');
	const reset = spawnSync(icacls, [path, '/reset']);
	if (reset.status !== 0) throw new Error('icacls /reset failed');
	const done = spawnSync(icacls, [path, '/inheritance:r', '/grant:r', `*${sid}:F`]);
	if (done.status !== 0) throw new Error('icacls failed');
	const owned = spawnSync(icacls, [path, '/setowner', `*${sid}`]);
	if (owned.status !== 0) throw new Error('icacls /setowner failed');
}
