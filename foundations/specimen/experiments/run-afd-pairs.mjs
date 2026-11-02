#!/usr/bin/env node
/**
 * T08's qualifying pairs for AFD's own FAST-AF stories: Storybook against Specimen, on the same
 * stories and components. AFD has no Storybook, so that side is an overlay prepared outside the
 * repository: upstream's Storybook configuration and dependencies, with AFD's `src`, `tokens`,
 * manifest and built packages over them, and Storybook's helpers restored in each story. Specimen's
 * side is AFD's own configuration, as `pnpm test:stories` runs it. Every pair must agree on every
 * story, with nothing changing between them.
 *
 * node experiments/run-afd-pairs.mjs --overlay DIR --index FILE --fonts DIR --out DIR [--pairs 3] [--workers 2]
 */
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createSpecimenBench } from '../dist/index.js';

const run = promisify(execFile);
const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(name);
	return index === -1 ? fallback : args[index + 1];
};
const required = (name) => {
	const value = option(name);
	if (!value) throw new Error(`${name} is required`);
	return resolve(value);
};
const overlay = required('--overlay');
const index = required('--index');
const fonts = required('--fonts');
const output = required('--out');
const pairs = Number(option('--pairs', '3'));
const workers = option('--workers', '2');
const repository = resolve(import.meta.dirname, '../../..');
const stories = join(repository, 'foundations/fast-af/packages/violet-elements');
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error('Evidence output must be empty');

// Spawned tools must not inherit a hook's Git environment.
const env = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
);
const git = async (...command) =>
	(await run('git', command, { cwd: repository, env })).stdout.trim();

/** Storybook's Vitest run on the overlay, through the same harness as every consumer's. */
async function storybook(directory) {
	await run(
		process.execPath,
		[
			join(import.meta.dirname, 'run-retained.mjs'),
			'--consumer',
			'fast-af',
			'--snapshot',
			overlay,
			'--index',
			index,
			'--fonts',
			fonts,
			'--mode',
			'full',
			'--only',
			'incumbent',
			'--workers',
			workers,
			'--out',
			directory,
		],
		{ env, maxBuffer: 1 << 28 }
	).catch((error) => {
		// A failing story fails the run; the report says which.
		if (error.code !== 1) throw error;
	});
	const { tests } = JSON.parse(await readFile(join(directory, 'retained.json'), 'utf8'));
	return tests;
}

/** The two runners' results over every story, by the rule `run-retained.mjs` applies. */
function compare(tests, entries, suite) {
	const prefix = './packages/violet-elements/';
	const disagreements = [];
	const remaining = new Map(
		tests.map((test) => [`${test.file.replace(prefix, './')}::${test.name}`, test])
	);
	for (const [position, entry] of entries.entries()) {
		const attempt = suite.stories[position].attempts.at(-1);
		const key = `${entry.module}::${entry.story.name}`;
		const test = remaining.get(key);
		remaining.delete(key);
		const category = attempt.failures[0]?.category ?? null;
		const agrees =
			attempt.status === 'excluded'
				? test === undefined
				: test !== undefined &&
					attempt.status === test.status &&
					(attempt.status !== 'failed' || (category === 'a11y') === test.accessibility);
		if (!agrees)
			disagreements.push({
				id: entry.id,
				specimen: attempt.status,
				storybook: test?.status ?? null,
				message: attempt.failures[0]?.message?.split('\n')[0] ?? test?.message ?? '',
			});
	}
	for (const [key, test] of remaining)
		disagreements.push({ id: key, specimen: null, storybook: test.status, message: test.message });
	return disagreements;
}

/** Each story's identity in Storybook's own index of the overlay, against AFD's discovery. */
async function identityMismatches(entries) {
	const indexed = Object.values(JSON.parse(await readFile(index, 'utf8')).entries).filter(
		(entry) => entry.type === 'story'
	);
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const mismatches = [];
	for (const expected of indexed) {
		const actual = byId.get(expected.id);
		byId.delete(expected.id);
		if (
			!actual ||
			actual.title !== expected.title ||
			actual.story.name !== expected.name ||
			JSON.stringify([...actual.story.tags].sort()) !== JSON.stringify([...expected.tags].sort())
		)
			mismatches.push(expected.id);
	}
	return [...mismatches, ...byId.keys()];
}

const revision = await git('rev-parse', 'HEAD');
const results = [];
for (let pair = 1; pair <= pairs; pair++) {
	const directory = join(output, `pair-${pair}`);
	const tests = await storybook(join(directory, 'storybook'));
	const bench = await createSpecimenBench({ root: stories });
	try {
		const entries = bench.list();
		const suite = await bench.runSuite({ workers: Number(workers) });
		if (suite.sourcesChanged) throw new Error('A source changed during the run');
		const result = {
			pair,
			stories: entries.length,
			tests: tests.length,
			counts: suite.counts,
			identityMismatches: await identityMismatches(entries),
			disagreements: compare(tests, entries, suite),
			revision: await git('rev-parse', 'HEAD'),
			dirty: (await git('status', '--porcelain')).length > 0,
		};
		results.push(result);
		console.log(
			`pair ${pair}: ${result.stories} stories, ${result.counts.passed} passed, ${result.disagreements.length} disagreements, ${result.identityMismatches.length} identity mismatches`
		);
	} finally {
		await bench.close();
	}
}
const agreed = results.every(
	(result) =>
		result.disagreements.length === 0 &&
		result.identityMismatches.length === 0 &&
		result.revision === revision &&
		!result.dirty
);
await writeFile(
	join(output, 'pairs.json'),
	`${JSON.stringify({ revision, agreed, results }, null, 2)}\n`
);
process.exitCode = agreed ? 0 : 1;
