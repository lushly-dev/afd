/**
 * @fileoverview The launcher `startDevHost` uses: the profile in a child process, `dev-child.js`, as
 * `startTestAuthHost` runs its host. It runs only end to end, since the child is the built `dist`: the
 * hosted suite (`web`'s `test:hosted`) exercises it, and `vitest.config.ts` leaves it out of the units'
 * coverage for that reason.
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { Launcher } from './launcher.js';
import { lineSplitter, readChildLine } from './protocol.js';

const CHILD = fileURLToPath(new URL('./dev-child.js', import.meta.url));
const READY_TIMEOUT_MS = 60_000;

export const childLauncher: Launcher = (deployment, env, logs) => {
	const child = spawn(process.execPath, [CHILD, JSON.stringify({ deployment })], {
		env: { ...process.env, ...env },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const stop = async (signal: NodeJS.Signals): Promise<void> => {
		if (child.exitCode !== null || child.signalCode !== null) return;
		const exited = once(child, 'exit');
		child.kill(signal);
		const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
		await exited;
		clearTimeout(timer);
	};
	return new Promise((done, fail) => {
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			fail(new Error(`The development profile did not report within ${READY_TIMEOUT_MS} ms.`));
		}, READY_TIMEOUT_MS);
		child.stdout?.on(
			'data',
			(
				(split) => (chunk: Buffer) =>
					split(chunk.toString('utf8'))
			)(
				lineSplitter((line) => {
					logs.push(line);
					const read = readChildLine(line);
					if (read.kind === 'ready') {
						clearTimeout(timer);
						done({ ready: read.ready, stop });
					} else if (read.kind === 'failed') {
						clearTimeout(timer);
						fail(read.error);
					}
				})
			)
		);
		child.stderr?.on('data', (chunk: Buffer) => {
			for (const line of chunk.toString('utf8').split('\n')) if (line) logs.push(line);
		});
		child.once('exit', (code) => {
			clearTimeout(timer);
			fail(new Error(`The development profile exited with ${code} before it was ready.`));
		});
	});
};
