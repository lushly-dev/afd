import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { runCollected } from './native.mjs';

it.skipIf(process.platform === 'win32')(
	'bounds shutdown when an observer ignores termination',
	async () => {
		const root = await mkdtemp(join(tmpdir(), 'specimen-watchdog-'));
		try {
			const executable = join(root, 'observer');
			await writeFile(
				executable,
				`#!${process.execPath}
import {writeFileSync} from 'node:fs';
const out = process.argv[process.argv.indexOf('--out') + 1];
writeFileSync(out, JSON.stringify({type:'start'})+'\\n');
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`
			);
			await chmod(executable, 0o700);
			const start = performance.now();
			const result = await runCollected({
				collector: { binary: executable },
				directory: join(root, 'run'),
				command: process.execPath,
				timeoutMs: 1000,
				shutdownMs: 100,
			});
			expect(result.timedOut).toBe(true);
			expect(result.forcedKill).toBe(true);
			expect(result.timeoutCleanup.status).toBe('unverified');
			expect(result.events).toHaveLength(1);
			expect(performance.now() - start).toBeLessThan(5000);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}
);
