#!/usr/bin/env node
/**
 * T04 incumbent/candidate pairs. Per consumer, ABBA: the incumbent's Storybook Vitest samples
 * (run-incumbent.mjs) and the candidate's native samples (run-consumers.mjs), each five cold
 * and five warm, each under the whole-process recorder (run-resources.mjs), on one frozen
 * snapshot. Both runners load the same recorded fonts from a server in this process, outside
 * both measured families, and both run on the incumbent's Chromium build. The session starts
 * after the quiet-window gate, and the baseline policy decides which comparisons count.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gitEnvironment } from './consumer-project.mjs';
import { startFontServer } from './inputs/remote-fonts.mjs';
import { compare } from './resources/comparison.mjs';
import { probeBand } from './resources/pairs.mjs';
import { quietPolicy, waitForQuiet } from './resources/quiet.mjs';
import { directoryDigest, hostDetails, sha256File } from './resources/session.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(name);
	return index === -1 ? fallback : args[index + 1];
};
const afd = resolve(import.meta.dirname, '../../..');
const out = resolve(option('--out', `test-results/specimens-t04-pairs-${Date.now()}`));
const samples = option('--samples', '5');
const fontsRoot = resolve(option('--fonts', ''));
const roots = { lushly: option('--lushly'), 'fast-af': option('--fast-af') };
const consumers = Object.keys(roots).filter((name) => roots[name]);
if (!consumers.length) throw new Error('Pass --lushly and/or --fast-af frozen snapshot roots');
if (existsSync(out) && readdirSync(out).length) throw new Error('--out must be empty');
mkdirSync(out, { recursive: true });

const policy = JSON.parse(
	readFileSync(join(import.meta.dirname, 'inputs/baseline-policy.json'), 'utf8')
);
const manifests = (process.env.SPECIMEN_FROZEN_MANIFESTS ?? '').split(':').filter(Boolean);
const manifestFor = (root) => {
	for (const file of manifests) {
		const manifest = JSON.parse(readFileSync(file, 'utf8'));
		if (resolve(manifest.snapshot) === resolve(root)) return { file, manifest };
	}
	throw new Error(`No frozen manifest lists ${root}; set SPECIMEN_FROZEN_MANIFESTS`);
};
/** The incumbent's own headless Chromium, from the browsers its freeze manifest recorded. */
function incumbentBrowser(manifest) {
	const shell = manifest.browsers?.find((entry) => entry.name === 'chromium-headless-shell');
	const executable =
		shell && join(shell.installPath, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
	if (!executable || !existsSync(executable))
		throw new Error(`Incumbent headless shell is not installed: ${executable ?? 'unrecorded'}`);
	return { ...shell, executable };
}
const git = (...command) =>
	spawnSync('git', ['-C', afd, ...command], {
		encoding: 'utf8',
		env: gitEnvironment(),
	}).stdout.trim();

const study = {
	purpose: 'T04 incumbent/candidate representative pairs under the baseline policy',
	createdUtc: new Date().toISOString(),
	host: hostDetails(),
	node: process.version,
	afd: { revision: git('rev-parse', 'HEAD'), status: git('status', '--porcelain=v1') },
	driverSha256: sha256File(import.meta.filename),
	dist: directoryDigest(join(afd, 'foundations/specimen/dist')),
	samples: Number(samples),
	policy: { hostCondition: policy.hostCondition, tolerances: policy.tolerances },
	consumers: {},
	jobs: [],
};
const save = () => writeFileSync(join(out, 'study.json'), `${JSON.stringify(study, null, 2)}\n`);

const servers = {};
for (const consumer of consumers) {
	const { file, manifest } = manifestFor(roots[consumer]);
	const store = join(fontsRoot, consumer);
	const record = JSON.parse(readFileSync(join(store, 'remote-fonts.json'), 'utf8'));
	servers[consumer] = await startFontServer(record, store);
	study.consumers[consumer] = {
		snapshot: resolve(roots[consumer]),
		manifest: file,
		manifestSha256: sha256File(file),
		revision: manifest.source.revision,
		snapshotSha256: manifest.source.snapshotDigest?.sha256,
		browser: incumbentBrowser(manifest),
		fonts: {
			record: sha256File(join(store, 'remote-fonts.json')),
			stylesheets: record.stylesheets.map((sheet) => sheet.sha256),
			matchesFreeze: record.stylesheets.map((sheet) => sheet.matchesFreeze),
		},
	};
}
process.on('exit', () => {
	for (const server of Object.values(servers)) void server.close();
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

// The font servers live in this process, so jobs must run without blocking its event loop.
function runJob(command, commandArgs, options) {
	return new Promise((resolveRun) => {
		const child = spawn(command, commandArgs, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
		let stderr = '';
		child.stdout.resume();
		child.stderr.on('data', (chunk) => {
			stderr = `${stderr}${chunk}`.slice(-8000);
		});
		const timer = setTimeout(() => child.kill('SIGTERM'), options.timeout);
		child.on('error', (error) => {
			clearTimeout(timer);
			resolveRun({ status: null, error, stderr });
		});
		child.on('close', (status, signal) => {
			clearTimeout(timer);
			resolveRun({ status, signal, stderr });
		});
	});
}
function captureBrowsers(directory) {
	if (!existsSync(directory)) return [];
	return [
		...new Set(
			readdirSync(directory)
				.filter((file) => file.endsWith('.json'))
				.map((file) => readJson(join(directory, file))?.manifest?.browser?.version)
				.filter(Boolean)
		),
	];
}
const pause = (ms) => new Promise((resolvePause) => setTimeout(resolvePause, ms));

const readJson = (file) => {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return null;
	}
};
const plan = consumers.flatMap((consumer) =>
	['incumbent', 'candidate', 'candidate', 'incumbent'].map((path) => ({ consumer, path }))
);
for (const [index, job] of plan.entries()) {
	const details = study.consumers[job.consumer];
	const server = servers[job.consumer];
	for (let attempt = 1; attempt <= 6; attempt++) {
		const name = `${String(index + 1).padStart(2, '0')}-${job.consumer}-${job.path}-a${attempt}`;
		const directory = join(out, name);
		mkdirSync(directory);
		const fontsBefore = server.stats();
		const env = {
			...process.env,
			...(job.path === 'incumbent'
				? { SPECIMEN_FONT_BASE: server.url }
				: {
						SPECIMEN_FONT_STYLESHEETS: JSON.stringify(
							details.fonts.stylesheets.map((sha) => `${server.url}/css/${sha}`)
						),
						SPECIMEN_BENCH_EXECUTABLE: details.browser.executable,
					}),
		};
		const run = await runJob(
			process.execPath,
			[
				join(import.meta.dirname, 'run-resources.mjs'),
				'--consumer',
				job.consumer,
				`--${job.consumer}`,
				details.snapshot,
				'--workload',
				job.path === 'incumbent' ? 'incumbent' : 'consumer',
				'--samples',
				samples,
				...(job.path === 'incumbent' ? ['--fonts', join(fontsRoot, job.consumer)] : []),
				'--out',
				directory,
			],
			{ env, timeout: 15 * 60_000 }
		);
		const fontsAfter = server.stats();
		const report = readJson(join(directory, 'resource-report.json')) ?? {};
		const profile = report.consumers?.[0];
		const workload = profile?.probeReport ? readJson(profile.probeReport) : null;
		const receipt = workload?.consumers?.[0];
		const postClose = profile?.resources?.phases?.filter(
			(phase) => phase.name === 'post-close-idle'
		);
		const record = {
			...job,
			name,
			attempt,
			finishedUtc: new Date().toISOString(),
			exit: run.status,
			status: report.status ?? 'failed',
			held:
				Boolean(report.admission && !report.admission.admitted) ||
				Boolean(profile?.admission && !profile.admission.admitted),
			error:
				String(profile?.error ?? receipt?.error ?? report.error ?? run.error?.message ?? '').split(
					'\n'
				)[0] || undefined,
			probeBefore: profile?.speedProbe?.before ?? null,
			probeAfter: profile?.speedProbe?.after ?? null,
			cpuSeconds: profile?.resources?.cpu?.waitedTree?.totalSeconds ?? null,
			verifiedCases: profile?.resources?.workflow?.successfulRenders ?? null,
			verifiedCaptures: profile?.resources?.workflow?.verifiedCaptures ?? null,
			peakFootprintBytes: profile?.resources?.memory?.peakFootprintBytes ?? null,
			postCloseFootprintBytes: postClose?.at(-1)?.memory?.medianFootprintBytes ?? null,
			coldMs: receipt?.coldMilliseconds?.median ?? null,
			warmMs: receipt?.warmMilliseconds?.median ?? null,
			storiesPerRun: receipt?.storiesPerRun ?? null,
			// Candidate captures record the browser they ran on; the incumbent runs its own build.
			browserVersions: captureBrowsers(join(directory, job.consumer, 'probe', job.consumer)),
			fonts: {
				stylesheets: fontsAfter.stylesheets - fontsBefore.stylesheets,
				files: fontsAfter.fonts - fontsBefore.fonts,
				bytes: fontsAfter.bytes - fontsBefore.bytes,
				missing: fontsAfter.missing.slice(fontsBefore.missing.length),
			},
			hostBefore: profile?.hostBefore ?? report.hostBefore ?? null,
		};
		if (record.fonts.missing.length) {
			record.status = 'failed';
			record.error ??= `Unrecorded font requests: ${record.fonts.missing.join(', ')}`;
		}
		study.jobs.push(record);
		save();
		process.stdout.write(
			`${name}: ${record.status}${record.held ? ' (held)' : ''} cpu=${record.cpuSeconds} cases=${record.verifiedCases} probe=${record.probeBefore?.cpuSeconds?.toFixed(3)}/${record.probeAfter?.cpuSeconds?.toFixed(3)} fonts=${record.fonts.files} ${record.error ?? ''}\n`
		);
		if (!record.held) break;
		await pause(60_000);
	}
}
study.band = probeBand(study.jobs, policy.hostCondition.maxProbeRatio);
study.comparison = compare(study.jobs, study.band, {
	maxSpreadPercent: policy.tolerances.repeatability.cpuSpreadPercent,
	noiseFloorPercent: policy.tolerances.noiseFloorPercent,
});
study.finishedUtc = new Date().toISOString();
save();
for (const row of study.comparison) {
	process.stdout.write(
		`${row.consumer}${row.held.length ? ` held: ${row.held.join('; ')}` : ''}\n`
	);
	for (const entry of row.results)
		process.stdout.write(
			`  ${entry.label}: incumbent ${entry.incumbent} candidate ${entry.candidate} ratio ${entry.ratio?.toFixed(3)} ${entry.verdict}\n`
		);
}
for (const server of Object.values(servers)) await server.close();
