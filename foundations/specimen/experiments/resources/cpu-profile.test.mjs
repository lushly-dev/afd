import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

// The bounded fallback kills the fixture's POSIX process group.
it.skipIf(process.platform === 'win32')(
	'profiles coordinator and execArgv-empty fork through inherited NODE_OPTIONS and both barriers',
	async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), 'specimen-cpu-profile-test-')));
		const preload = new URL('./cpu-profile-preload.mjs', import.meta.url).href;
		const control = new URL('./cpu-profile-control.mjs', import.meta.url).href;
		const coordinatorPath = join(root, 'run-batches.mjs');
		let child;
		let exited;
		let deadline;
		let stderr = '';
		try {
			await writeFile(join(root, 'package.json'), '{"type":"module"}');
			await writeFile(
				join(root, 'bench-worker.js'),
				`
import { performance } from 'node:perf_hooks';
process.on('message', () => {
  const until = performance.now() + 50;
  let total = 0;
  while (performance.now() < until) total += Math.sqrt(total + 1);
  process.send({ pid: process.pid, execArgv: process.execArgv, total });
});
`
			);
			await writeFile(
				coordinatorPath,
				`
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createCpuProfileControl } from ${JSON.stringify(control)};
const child = fork(new URL('./bench-worker.js', import.meta.url), [], { execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
const exited = once(child, 'exit');
try {
  const control = createCpuProfileControl(process.env.SPECIMEN_CPU_PROFILE_DIRECTORY, 'process');
  const started = await control.start();
  assert.equal(started.length, 2);
  const message = once(child, 'message');
  child.send('work');
  const until = performance.now() + 50;
  let total = 0;
  while (performance.now() < until) total += Math.sqrt(total + 1);
  const [worker] = await message;
  const stopped = await control.stop();
  await writeFile(new URL('./job.json', import.meta.url), JSON.stringify({ started, stopped, worker, total }));
} finally {
  child.kill();
  await exited;
}
`
			);
			child = spawn(process.execPath, [coordinatorPath], {
				detached: true,
				stdio: ['ignore', 'ignore', 'pipe'],
				env: {
					...process.env,
					NODE_OPTIONS: `--import=${JSON.stringify(preload)}`,
					SPECIMEN_CPU_PROFILE_DIRECTORY: root,
				},
			});
			child.stderr.setEncoding('utf8');
			child.stderr.on('data', (chunk) => {
				stderr = (stderr + chunk).slice(-10_000);
			});
			exited = new Promise((resolveExit, rejectExit) => {
				child.once('error', rejectExit);
				child.once('close', (code, signal) => resolveExit({ code, signal }));
			});
			deadline = setTimeout(() => {
				try {
					process.kill(-child.pid, 'SIGKILL');
				} catch {
					/* The fixture may already have exited. */
				}
			}, 15_000);
			const outcome = await exited;
			clearTimeout(deadline);
			expect(outcome, stderr).toEqual({ code: 0, signal: null });
			const job = JSON.parse(await readFile(join(root, 'job.json'), 'utf8'));
			expect(job.worker.execArgv).toEqual([]);
			expect(job.started.map((row) => row.role)).toEqual(['coordinator', 'worker']);
			const start = JSON.parse(await readFile(join(root, 'start.json'), 'utf8'));
			const stop = JSON.parse(await readFile(join(root, 'stop.json'), 'utf8'));
			expect(stop.nonce).toBe(start.nonce);
			for (const row of job.stopped) {
				const expectedPid = row.role === 'coordinator' ? child.pid : job.worker.pid;
				expect(row.pid).toBe(expectedPid);
				expect(row.ppid).toBe(row.role === 'coordinator' ? process.pid : child.pid);
				expect(row.node).toBe(process.version);
				expect(row.nonce).toBe(start.nonce);
				expect(row.profilePath).toBe(join(root, `${row.role}-${expectedPid}.cpuprofile`));
				expect(pathToFileURL(row.argv1).pathname).toBe(
					pathToFileURL(
						join(root, row.role === 'coordinator' ? 'run-batches.mjs' : 'bench-worker.js')
					).pathname
				);
				const started = job.started.find((entry) => entry.pid === row.pid);
				expect(started.nonce).toBe(row.nonce);
				expect(started.samplingIntervalUs).toBe(1000);
				expect(row.timestampMs).toBeGreaterThanOrEqual(started.timestampMs);
				const profile = JSON.parse(await readFile(row.profilePath, 'utf8'));
				expect(profile.samples.length).toBeGreaterThan(0);
				expect(row.sampleCount).toBe(profile.samples.length);
				expect(profile.endTime).toBeGreaterThan(profile.startTime);
				expect(
					profile.nodes.some((node) =>
						node.callFrame.url.endsWith(
							row.role === 'coordinator' ? 'run-batches.mjs' : 'bench-worker.js'
						)
					)
				).toBe(true);
			}
			const files = await readdir(root);
			expect(files.filter((name) => name.endsWith('.ready.json'))).toHaveLength(2);
			expect(files.filter((name) => name.endsWith('.error.json') || name.endsWith('.tmp'))).toEqual(
				[]
			);
		} finally {
			clearTimeout(deadline);
			if (child?.pid) {
				try {
					process.kill(-child.pid, 'SIGKILL');
				} catch {
					/* No fixture processes remain. */
				}
			}
			if (exited) await exited;
			await rm(root, { recursive: true, force: true });
		}
	},
	20_000
);
