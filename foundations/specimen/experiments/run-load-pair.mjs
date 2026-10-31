#!/usr/bin/env node
/**
 * Controlled synthetic-load pair (T02 follow-up). Each consumer runs the same ordinary
 * reused-worker batch job ABBA: without load, with N busy loops outside the job's process
 * family, and again. If host contention explains the CPU differences seen across sessions,
 * the loaded jobs cost more CPU for identical verified work while the probes taken outside the
 * load stay in band. It waits for the quiet-window gate itself, immediately before the first job.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { gitEnvironment } from './consumer-project.mjs';
import { loadEffect, probeBand } from './resources/pairs.mjs';
import { quietPolicy, waitForQuiet } from './resources/quiet.mjs';
import { directoryDigest, hostDetails, sha256File } from './resources/session.mjs';
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
// Admission reserves two cores, and the gate allows up to 1.5 busy before the job starts.
if (!Number.isInteger(load) || load < 1 || load > cpus().length - 4)
	throw new Error('--load must leave room for admission, ambient load and the job');
const roots = { lushly: option('--lushly'), 'fast-af': option('--fast-af') };
const consumers = Object.entries(roots).filter(([, root]) => root);
if (!consumers.length) throw new Error('Pass --lushly and/or --fast-af consumer roots');
if (existsSync(out) && readdirSync(out).length) throw new Error('--out must be empty');
mkdirSync(out, { recursive: true });

const policy = JSON.parse(
	readFileSync(join(import.meta.dirname, 'inputs/baseline-policy.json'), 'utf8')
);
const git = (...command) =>
	spawnSync('git', ['-C', afd, ...command], {
		encoding: 'utf8',
		env: gitEnvironment(),
	}).stdout.trim();
const study = {
	purpose:
		'Controlled synthetic-load pair: does background CPU load raise job CPU for identical work?',
	createdUtc: new Date().toISOString(),
	host: hostDetails(),
	node: process.version,
	afd: { revision: git('rev-parse', 'HEAD'), status: git('status', '--porcelain=v1') },
	driverSha256: sha256File(import.meta.filename),
	dist: directoryDigest(join(afd, 'foundations/specimen/dist')),
	frozenManifests: (process.env.SPECIMEN_FROZEN_MANIFESTS ?? '').split(':').filter(Boolean),
	roots,
	load,
	batches,
	hostCondition: policy.hostCondition,
	jobs: [],
};
const save = () => writeFileSync(join(out, 'study.json'), `${JSON.stringify(study, null, 2)}\n`);

// Loaders stop themselves once orphaned, so a killed driver cannot leave them burning cores.
const LOADER =
	'for (let i = 0; ; i++) if ((i & 0xffffff) === 0 && process.ppid === 1) process.exit(0);';
const live = new Set();
const stopLoaders = () => {
	for (const loader of live) loader.kill('SIGKILL');
	live.clear();
};
process.on('exit', stopLoaders);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
	process.on(signal, () => {
		stopLoaders();
		process.exit(128);
	});

if (args.includes('--skip-quiet')) study.quietGate = { skipped: true };
else {
	const gate = await waitForQuiet(
		quietPolicy({ windowSeconds: Number(option('--quiet-window', '600')) }),
		{ timeoutSeconds: Number(option('--quiet-timeout', '14400')) }
	);
	study.quietGate = {
		quiet: gate.quiet,
		reasons: gate.reasons,
		timedOut: gate.timedOut ?? false,
		firstUtc: gate.samples[0]?.timestampUtc,
		passedUtc: gate.samples.at(-1)?.timestampUtc,
		samples: gate.samples.slice(-gate.needed),
	};
	save();
	if (!gate.quiet) throw new Error(`Host never became quiet: ${gate.reasons.join(', ')}`);
}

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
		const loaders = Array.from({ length: job.load }, () => {
			const loader = spawn(process.execPath, ['-e', LOADER], { stdio: 'ignore' });
			live.add(loader);
			return loader;
		});
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
			// run-resources enforces its own 120-second workload limit; this bounds a hang outside it.
			{ encoding: 'utf8', env: process.env, timeout: 15 * 60_000 }
		);
		record.probeUnderLoad = loaders.length ? speedProbe() : undefined;
		stopLoaders();
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
		let workloadError;
		try {
			workloadError = JSON.parse(readFileSync(consumer?.probeReport ?? '', 'utf8')).consumers?.[0]
				?.error;
		} catch {
			// No workload report: the resource report's own error is all there is.
		}
		record.error ??=
			String(consumer?.error ?? workloadError ?? report.error ?? '').split('\n')[0] || undefined;
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
study.effect = loadEffect(study.jobs, study.band, {
	maxSpreadPercent: policy.tolerances.repeatability.cpuSpreadPercent,
});
study.finishedUtc = new Date().toISOString();
save();
for (const row of study.effect)
	process.stdout.write(
		`${row.consumer}: unloaded ${row.unloadedMedian} loaded ${row.loadedMedian} ratio ${row.ratio?.toFixed(3) ?? `held (${row.held.join('; ')})`}\n`
	);
