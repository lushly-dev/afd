import { spawnSync } from 'node:child_process';

// Fixed single-threaded work in a separate process, outside any measured family: hashing and
// JSON round trips. On a contended host the CPU seconds for identical work rise with job CPU,
// so receipts from different host conditions can be told apart. It is a covariate, not a
// correction factor.
const source = `
const { createHash } = require('node:crypto');
const start = process.hrtime.bigint();
const cpu = process.cpuUsage();
const buffer = Buffer.alloc(32 * 1024 * 1024, 7);
let digest = '';
for (let i = 0; i < 12; i++) digest = createHash('sha256').update(buffer).update(digest).digest('hex');
const data = Array.from({ length: 200000 }, (_, i) => ({ i, s: 'x' + i, n: [i, i * 2] }));
for (let i = 0; i < 6; i++) JSON.parse(JSON.stringify(data));
const used = process.cpuUsage(cpu);
process.stdout.write(JSON.stringify({
	cpuSeconds: (used.user + used.system) / 1e6,
	wallSeconds: Number(process.hrtime.bigint() - start) / 1e9,
	digest: digest.slice(0, 16),
}));`;

function probeOnce() {
	const run = spawnSync(process.execPath, ['-e', source], { encoding: 'utf8', timeout: 30_000 });
	if (run.status !== 0)
		return { status: 'failed', error: (run.stderr || run.error?.message || '').trim() };
	try {
		return { status: 'complete', ...JSON.parse(run.stdout) };
	} catch (error) {
		return { status: 'failed', error: `Unreadable probe output: ${error.message}` };
	}
}

/** One run by default; `runs` takes the fastest of several separate runs for diagnosis. */
export function speedProbe({ runs = 1 } = {}) {
	const timestampUtc = new Date().toISOString();
	const results = Array.from({ length: runs }, probeOnce);
	const failed = results.find((result) => result.status !== 'complete');
	if (failed) return { ...failed, timestampUtc, runs: results };
	const fastest = results.reduce((best, result) =>
		result.cpuSeconds < best.cpuSeconds ? result : best
	);
	return {
		status: 'complete',
		timestampUtc,
		cpuSeconds: fastest.cpuSeconds,
		wallSeconds: fastest.wallSeconds,
		digest: fastest.digest,
		runs: results.map(({ cpuSeconds, wallSeconds }) => ({ cpuSeconds, wallSeconds })),
	};
}
