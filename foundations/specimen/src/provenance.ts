import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { digest } from './config.js';

const run = promisify(execFile);
export async function sourceState(
	root: string
): Promise<{ revision: string | null; dirty: boolean | null }> {
	try {
		const [revision, status] = await Promise.all([
			run('git', ['rev-parse', 'HEAD'], { cwd: root }),
			run('git', ['status', '--porcelain=v1'], { cwd: root }),
		]);
		return { revision: revision.stdout.trim(), dirty: status.stdout.length > 0 };
	} catch {
		return { revision: null, dirty: null };
	}
}
export async function dependencyIdentity(root: string): Promise<string> {
	let directory = root;
	while (true) {
		for (const name of ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']) {
			try {
				return digest(await readFile(join(directory, name)));
			} catch {
				/* Try the next manifest. */
			}
		}
		const parent = dirname(directory);
		if (parent === directory) return 'unknown:no-lockfile';
		directory = parent;
	}
}
