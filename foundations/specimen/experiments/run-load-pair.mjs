#!/usr/bin/env node
/**
 * Controlled synthetic-load pair (T02 follow-up). Each consumer runs the same ordinary
 * reused-worker batch job ABBA: without load, with N busy loops outside the job's process
 * family, and again. If host contention explains the CPU differences seen across sessions,
 * the loaded jobs cost more CPU for identical verified work while the probes taken outside the
 * load stay in band. Start it only after `resources/quiet.mjs --wait` reports a quiet window.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, release, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { gitEnvironment } from './consumer-project.mjs';
import { loadEffect, probeBand } from './resources/pairs.mjs';
import { speedProbe } from './resources/speed-probe.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(name);
	return index === -1 ? fallback : args[index + 1];
};
const afd = resolve(import.meta.dirname, '../../..');
const out = resolve(option('--out', `test-results/specimens-load-pair-${Date.now()}`));
const load = Number(option('--load', '5'));
const batches = Number(option('--batches', '10'));
if (!Number.isInteger(load) || load < 1 || load > cpus().length - 3)
	throw new Error('--load must leave the admission reserve and the job at least one core');
const roots = { lushly: option('--lushly'), 'fast-af': option('--fast-af') };
const consumers = Object.entries(roots).filter(([, root]) => root);
if (!consumers.length) throw new Error('Pass --lushly and/or --fast-af consumer roots');
if (existsSync(out) && readdirSync(out).length) throw new Error('--out must be empty');
mkdirSync(out, { recursive: true });

const policy = JSON.parse(
	readFileSync(join(import.meta.dirname, 'inputs/baseline-policy.json'), 'utf8')
);
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const git = (...command) =>
	spawnSync('git', ['-C', afd, ...command], {
		encoding: 'utf8',
		env: gitEnvironment(),
	}).stdout.trim();
const study = {
	purpose:
		'Controlled synthetic-load pair: does background CPU load raise job CPU for identical work?',
	createdUtc: new Date().toISOString(),
	host: {
		cpu: cpus()[0]?.model,
		logicalCores: cpus().length,
		totalBytes: totalmem(),
		kernel: release(),
	},
	node: process.version,
	afd: { revision: git('rev-parse', 'HEAD'), status: git('status', '--porcelain=v1') },
	driverSha256: sha(import.meta.filename),
	apiSha256: sha(join(afd, 'foundations/specimen/dist/index.js')),
	frozenManifests: (process.env.SPECIMEN_FROZEN_MANIFESTS ?? '').split(':').filter(Boolean),
	roots,
	load,
	batches,
	hostCondition: policy.hostCondition,
	jobs: [],
};
const save = () => writeFileSync(join(out, 'study.json'), `${JSON.stringify(study, null, 2)}\n`);

const plan = consumers.flatMap(([consumer]) =>
	[0, load, load, 0].map((n) => ({ consumer, load: n }))
);
for (const [index, job] of plan.entries()) {
	for (let attempt = 1; attempt <= 6; attempt++) {
		const name = `${String(index + 1).padStart(2, '0')}-${job.consumer}-load${job.load}-a${attempt}`;
		const directory = join(out, name);
		mkdirSync(directory);
		const record = { ...job, name, attempt, startedUtc: new Date().toISOString() };
		record.probeBefore = speedProbe();
		const loaders = Array.from({ length: job.load }, () =>
			spawn(process.execPath, ['-e', 'for (;;) {}'], { stdio: 'ignore' })
		);
		if (loaders.length) spawnSync('sleep', ['2']);
		const run = spawnSync(
			process.execPath,
			[
				join(import.meta.dirname, 'run-resources.mjs'),
				'--consumer',
				job.consumer,
				`--${job.consumer}`,
				roots[job.consumer],
				'--workload',
				'batches',
				'--batches',
				String(batches),
				'--lifetime',
				'reuse',
				'--isolation',
				'process',
				'--out',
				directory,
			],
			{ encoding: 'utf8', env: process.env }
		);
		record.probeUnderLoad = loaders.length ? speedProbe() : undefined;
		for (const loader of loaders) loader.kill('SIGKILL');
		record.probeAfter = speedProbe();
		record.exit = run.status;
		let report = {};
		try {
			report = JSON.parse(readFileSync(join(directory, 'resource-report.json'), 'utf8'));
		} catch (error) {
			record.error = `No resource report: ${error.message}; ${(run.stderr ?? '').split('\n')[0]}`;
		}
		const consumer = report.consumers?.[0];
		record.status = report.status ?? 'failed';
		record.held =
			Boolean(report.admission && !report.admission.admitted) ||
			Boolean(consumer?.admission && !consumer.admission.admitted);
		record.error ??= (consumer?.error ?? report.error ?? '').split('\n')[0] || undefined;
		record.cpuSeconds = consumer?.resources?.cpu?.waitedTree?.totalSeconds ?? null;
		record.verifiedCaptures = consumer?.resources?.workflow?.verifiedCaptures ?? null;
		record.peakFootprintBytes = consumer?.resources?.memory?.peakFootprintBytes ?? null;
		record.hostBefore = consumer?.hostBefore ?? report.hostBefore ?? null;
		study.jobs.push(record);
		save();
		process.stdout.write(
			`${name}: ${record.status}${record.held ? ' (held)' : ''} cpu=${record.cpuSeconds} captures=${record.verifiedCaptures} probe=${record.probeBefore.cpuSeconds?.toFixed(3)}/${record.probeAfter.cpuSeconds?.toFixed(3)} ${record.error ?? ''}\n`
		);
		if (!record.held) break;
		spawnSync('sleep', ['60']);
	}
}
study.band = probeBand(study.jobs, policy.hostCondition.maxProbeRatio);
study.effect = loadEffect(study.jobs, study.band);
study.finishedUtc = new Date().toISOString();
save();
for (const row of study.effect)
	process.stdout.write(
		`${row.consumer}: unloaded ${row.unloadedMedian} loaded ${row.loadedMedian} ratio ${row.ratio?.toFixed(3) ?? 'none'}\n`
	);
