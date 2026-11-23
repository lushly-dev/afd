/**
 * Cleanup for the interop run that cannot hide the run's own failure (#1653).
 *
 * A backend that is still exiting can write a SQLite `-wal` or `-shm` file into the temporary
 * directory while it is being removed, so the removal fails with `ENOTEMPTY`. An error thrown from
 * a `finally` replaces the one the `try` threw, and the run then reported only `ENOTEMPTY`.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Remove `dir`, retrying while a process that is exiting still writes into it. */
export const removeDir = (dir: string): Promise<void> =>
	rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });

/**
 * Run `body` in a new temporary directory, then remove it. A failed removal is logged and never
 * thrown, so the result or the error of `body` is what the caller sees.
 */
export async function withTempDir<T>(
	prefix: string,
	body: (dir: string) => Promise<T>,
	remove: (dir: string) => Promise<void> = removeDir,
	warn: (message: string) => void = console.warn
): Promise<T> {
	const dir = await mkdtemp(path.join(tmpdir(), prefix));
	try {
		return await body(dir);
	} finally {
		try {
			await remove(dir);
		} catch (error) {
			warn(`Could not remove ${dir}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

/** Resolve once the process `pid` has exited, or after `timeoutMs`; true when it exited. */
export async function exited(pid: number | null | undefined, timeoutMs = 5000): Promise<boolean> {
	if (pid == null) return true;
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			process.kill(pid, 0);
		} catch (error) {
			// ESRCH: no such process. EPERM means it exists under another user, so keep waiting.
			if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
		}
		if (Date.now() >= deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}
