import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readJsonLines, runCollected } from './native.mjs';
import { summarizeResources } from './summary.mjs';

const execFile = promisify(execFileCallback);

export async function calibrate(collector, directory, limits) {
	const run = await runCollected({
		collector,
		directory,
		command: process.execPath,
		args: [join(import.meta.dirname, 'workload.mjs')],
		...limits,
	});
	const summary = summarizeResources(run.events);
	const receipts = await readJsonLines(run.stdoutFile);
	const root = receipts.find((record) => record.type === 'calibration-root');
	const child = receipts.find((record) => record.type === 'calibration-child');
	const shortChildren = receipts.filter((record) => record.type === 'calibration-short-child');
	assert.equal(run.code, 0, 'Calibration collector/workload exit');
	assert.equal(run.timedOut, false);
	assert.ok(root && child, 'Controlled root and child receipts exist');
	assert.equal(shortChildren.length, 3);
	const reportedCpu = receipts.reduce(
		(total, record) => total + record.userSeconds + record.systemSeconds,
		0
	);
	const waitedCpu = summary.cpu.waitedTree.totalSeconds;
	assert.ok(waitedCpu >= reportedCpu - 0.02, 'Wait accounting includes reaped children');
	assert.ok(waitedCpu <= reportedCpu + 0.15, 'No repeated child CPU aggregation');
	const samples = run.events.filter((event) => event.type === 'sample');
	const childSamples = samples
		.flatMap((sample) => sample.processes)
		.filter((row) => row.pid === child.pid);
	const peakChildFootprint = Math.max(0, ...childSamples.map((row) => row.footprintBytes));
	const peakChildCpu = Math.max(0, ...childSamples.map((row) => (row.userNs + row.systemNs) / 1e9));
	const childCpu = child.userSeconds + child.systemSeconds;
	assert.ok(
		Math.abs(peakChildCpu - childCpu) <= 0.03,
		'Mach CPU units convert to independently reported seconds'
	);
	assert.ok(peakChildFootprint >= child.allocatedBytes, 'Touched child memory is visible');
	assert.ok(summary.processes.maxSimultaneous >= 2, 'Parent and child are observed together');
	assert.deepEqual(summary.collector.survivorsBeforeCleanup, [], 'Fixture leaves no orphan');
	assert.deepEqual(
		summary.collector.survivorsAfterCleanup,
		[],
		'Collector leaves no owned process'
	);
	assert.equal(summary.collector.readFailures, 0);
	const observed = new Set(samples.flatMap((sample) => sample.processes).map((row) => row.pid));
	const guardsBinary = join(directory, 'collector-checks');
	await execFile('xcrun', [
		'clang',
		'-std=c11',
		'-O2',
		'-Wall',
		'-Wextra',
		'-Werror',
		join(import.meta.dirname, 'collector-checks.c'),
		'-o',
		guardsBinary,
	]);
	const kernelGuards = JSON.parse((await execFile(guardsBinary)).stdout);
	assert.equal(kernelGuards.status, 'passed');
	const failedEnrollmentBinary = join(directory, 'collector-enrollment-negative');
	await execFile('xcrun', [
		'clang',
		'-std=c11',
		'-O2',
		'-Wall',
		'-Wextra',
		'-Werror',
		'-DSPECIMEN_TEST_ROOT_ENROLLMENT_FAILURE',
		collector.source,
		'-o',
		failedEnrollmentBinary,
	]);
	const marker = join(directory, 'must-not-execute');
	const negative = await runCollected({
		collector: { binary: failedEnrollmentBinary },
		directory: join(directory, 'enrollment-negative'),
		command: process.execPath,
		args: ['-e', 'require("node:fs").writeFileSync(process.argv[1], "ran")', marker],
		...limits,
	});
	assert.equal(negative.code, 125);
	assert.equal(
		negative.events.findLast((event) => event.type === 'summary').rootEnrollmentFailed,
		true
	);
	assert.equal(
		await access(marker).then(
			() => true,
			() => false
		),
		false,
		'Untracked workload never starts'
	);
	return {
		status: 'passed',
		kernelGuards,
		rootEnrollmentNegative: { status: 'passed', commandExecuted: false, exitCode: negative.code },
		checks: {
			reapedChildCpu: true,
			childAllocationBytes: child.allocatedBytes,
			peakObservedChildFootprintBytes: peakChildFootprint,
			peakObservedChildCpuSeconds: peakChildCpu,
			independentlyReportedChildCpuSeconds: childCpu,
			independentlyReportedCpuSeconds: reportedCpu,
			waitedTreeCpuSeconds: waitedCpu,
			shortChildren: shortChildren.length,
			shortChildrenObservedBySampling: shortChildren.filter((record) => observed.has(record.pid))
				.length,
			toleranceSeconds: { lower: 0.02, upper: 0.15 },
		},
		resources: summary,
	};
}
