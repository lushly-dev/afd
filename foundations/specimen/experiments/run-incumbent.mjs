#!/usr/bin/env node
/**
 * Incumbent representative samples (T04): five cold and five warm runs of the consumer's own
 * Storybook Vitest path over the stories for the native wrappers' components, with recorded fonts.
 * Writes the same report shape as run-consumers.mjs, so run-resources.mjs can measure it.
 */
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { readGitState as git } from './consumer-project.mjs';
import { incumbents, runIncumbent, writeWrapperConfig } from './incumbent.mjs';
import { startFontServer } from './inputs/remote-fonts.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(name);
	return index === -1 ? fallback : args[index + 1];
};
const consumer = option('--consumer');
if (!incumbents[consumer]) throw new Error('--consumer must be fast-af or lushly');
const snapshot = resolve(option(`--${consumer}`) ?? '');
const fontStore = resolve(option('--fonts') ?? '');
const output = resolve(option('--out', `test-results/specimens-incumbent-${Date.now()}`));
const samples = Number(option('--samples', '5'));
if (!Number.isInteger(samples) || samples < 1 || samples > 20)
	throw new Error('--samples must be 1..20');
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error('Evidence output must be empty');

const resourceEvents = process.env.SPECIMEN_RESOURCE_EVENTS;
const idleMs = resourceEvents ? Number(process.env.SPECIMEN_RESOURCE_IDLE_MS ?? '1000') : 0;
let phaseId = 0;
async function phase(name, work, details = {}) {
	if (!resourceEvents) return work();
	const id = ++phaseId;
	const record = (event) =>
		appendFile(
			resourceEvents,
			`${JSON.stringify({ type: 'phase', id, name, event, consumer, ...details, timestampMs: Date.now() })}\n`
		);
	await record('start');
	try {
		return await work();
	} finally {
		await record('end');
	}
}
const json = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
const summary = (values) => {
	const sorted = values.toSorted((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return {
		median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
		min: sorted[0],
		max: sorted.at(-1),
	};
};

const driverReadback = process.env.SPECIMEN_DRIVER_READBACK === '1';
const fontRecord = join(fontStore, 'remote-fonts.json');
// A pair driver serves fonts from outside both measured families and passes its URL; a direct
// run starts its own server, inside the job.
const external = process.env.SPECIMEN_FONT_BASE;
const fonts = external
	? { url: external, stats: () => ({ server: 'external' }), close: async () => {} }
	: await startFontServer(JSON.parse(await readFile(fontRecord, 'utf8')), fontStore);
const result = {
	name: consumer,
	status: 'failed',
	path: 'incumbent',
	selection: incumbents[consumer],
	// A pair driver reads the snapshot back outside the job, as it does for the candidate.
	provenance: driverReadback ? { readback: 'driver' } : { before: await git(snapshot) },
	runs: [],
};
const report = {
	formatVersion: 1,
	purpose:
		'Incumbent representative samples: the consumer Storybook Vitest path over matched stories',
	createdUtc: new Date().toISOString(),
	afd: await git(resolve(import.meta.dirname, '../../..')),
	runtime: { node: process.version, executable: process.execPath },
	host: {
		platform: platform(),
		release: release(),
		cpus: cpus().length,
		cpu: cpus()[0]?.model,
		totalBytes: totalmem(),
	},
	conditions: {
		samples,
		order: 'cold then warm, repeated',
		cold: 'Storybook and Vite caches removed from the snapshot before the run',
		warm: 'Immediate rerun of the same selection',
		fonts: 'Recorded Google Fonts served from 127.0.0.1; preconnects removed',
	},
	consumers: [result],
};
try {
	const wrapper = await writeWrapperConfig({ snapshot, consumer, directory: output });
	if (resourceEvents)
		await phase('baseline-idle', () => new Promise((done) => setTimeout(done, idleMs)));
	for (let index = 0; index < samples; index++)
		for (const kind of ['cold', 'warm']) {
			const run = await phase(
				`incumbent-${kind}`,
				() =>
					runIncumbent({
						snapshot,
						consumer,
						wrapper,
						kind,
						report: join(output, `${kind}-${index}.json`),
						fonts: { record: fontRecord, base: fonts.url },
					}),
				{ kind, index }
			);
			result.runs.push({ ...run, index });
			if (run.code !== 0 || !run.total || run.passed !== run.total)
				throw new Error(`${kind} run ${index} did not pass every story: ${run.output ?? ''}`);
		}
	if (resourceEvents)
		await phase('post-close-idle', () => new Promise((done) => setTimeout(done, idleMs)));
	const of = (kind) => result.runs.filter((run) => run.kind === kind);
	result.coldMilliseconds = summary(of('cold').map((run) => run.elapsedMs));
	result.warmMilliseconds = summary(of('warm').map((run) => run.elapsedMs));
	// A passing story is one verified case; each run renders every selected story.
	result.successfulRenders = result.runs.reduce((sum, run) => sum + run.passed, 0);
	result.verifiedCaptures = result.successfulRenders;
	result.storiesPerRun = result.runs[0]?.total ?? null;
	result.status = 'passed';
} catch (error) {
	result.error = error instanceof Error ? error.stack : String(error);
} finally {
	result.fonts = fonts.stats();
	await fonts.close();
	if (result.fonts.missing?.length) {
		result.status = 'failed';
		result.error ??= `Unrecorded font requests: ${result.fonts.missing.join(', ')}`;
	}
	if (!driverReadback) result.consumerAfter = await git(snapshot);
	if (
		!driverReadback &&
		JSON.stringify(result.provenance.before) !== JSON.stringify(result.consumerAfter)
	) {
		result.status = 'failed';
		result.checkoutChanged = true;
	}
	await json(join(output, 'receipt.json'), result);
	await json(join(output, 'report.json'), report);
}
process.stdout.write(`${consumer}: ${result.status}\nEvidence: ${output}\n`);
if (result.status !== 'passed') process.exitCode = 1;
