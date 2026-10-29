/** Controlled, bounded process-family calibration; no consumer or browser code. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomFillSync } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function burnCpu(milliseconds) {
	const before = process.cpuUsage();
	while (true) {
		const usage = process.cpuUsage(before);
		if ((usage.user + usage.system) / 1000 >= milliseconds) break;
		Math.sqrt(performance.now());
	}
}
function receipt(type, extra = {}) {
	const cpu = process.cpuUsage();
	process.stdout.write(
		`${JSON.stringify({ type, pid: process.pid, userSeconds: cpu.user / 1e6, systemSeconds: cpu.system / 1e6, ...extra })}\n`
	);
}
if (process.argv.includes('--child')) {
	const memory = Buffer.allocUnsafe(64 * 1024 ** 2);
	randomFillSync(memory);
	burnCpu(150);
	await pause(450);
	assert.ok(memory[0] >= 0);
	receipt('calibration-child', { allocatedBytes: memory.length });
} else if (process.argv.includes('--short-child')) {
	burnCpu(10);
	receipt('calibration-short-child');
} else {
	burnCpu(80);
	for (const mode of ['--child', '--short-child', '--short-child', '--short-child']) {
		const child = spawn(process.execPath, [import.meta.filename, mode], { stdio: 'inherit' });
		const code = await new Promise((resolve, reject) => {
			child.once('error', reject);
			child.once('exit', resolve);
		});
		assert.equal(code, 0);
	}
	burnCpu(40);
	await pause(200);
	receipt('calibration-root');
}
