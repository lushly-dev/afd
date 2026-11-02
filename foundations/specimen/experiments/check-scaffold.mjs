#!/usr/bin/env node
/**
 * T06's check that a consumer's tooling still holds with Specimen beside it, on a throwaway
 * copy-on-write clone of a prepared Lushly snapshot (macOS `cp -c`, removed at the end). Its CEM
 * determinism check and story typecheck run first. Its scaffold then adds a component, the
 * manifest is regenerated, and the new story must keep its identity and end the same way under
 * Specimen and under the consumer's Storybook Vitest path. Specimen only reads the consumer: the
 * consumer's commands run exactly as its package scripts run them.
 *
 * node experiments/check-scaffold.mjs --snapshot DIR --fonts DIR --out DIR
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { runIncumbent, writeWrapperConfig } from './incumbent.mjs';
import { startFontServer } from './inputs/remote-fonts.mjs';

const run = promisify(execFile);
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const source = resolve(option('--snapshot'));
const fontStore = resolve(option('--fonts'));
const output = resolve(option('--out'));
const clone = join(output, 'clone');
const COMPONENT = 'shared/lushly-specimen-probe';
const STORY =
	'apps/web/src/components/shared/lushly-specimen-probe/lushly-specimen-probe.stories.ts';

// Spawned tools must not inherit a hook's Git environment.
const env = {
	...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
	STORYBOOK_DISABLE_TELEMETRY: '1',
	CI: '1',
};

async function step(label, command, commandArgs) {
	const started = Date.now();
	try {
		const { stdout } = await run(command, commandArgs, {
			cwd: clone,
			env,
			maxBuffer: 64 * 1024 * 1024,
		});
		return { label, exit: 0, seconds: (Date.now() - started) / 1000, tail: stdout.slice(-300) };
	} catch (error) {
		return {
			label,
			exit: error.code ?? 1,
			seconds: (Date.now() - started) / 1000,
			tail: `${error.stdout ?? ''}${error.stderr ?? ''}`.slice(-1200),
		};
	}
}

await mkdir(output, { recursive: true });
await run('cp', ['-cR', source, clone], { env });
const result = { source, component: COMPONENT, steps: [] };
const record = async (...call) => {
	const done = await step(...call);
	result.steps.push(done);
	console.log(`${done.label}: exit ${done.exit} in ${done.seconds.toFixed(1)} s`);
	return done;
};
try {
	await record('check:cem, before', 'pnpm', ['run', '--silent', 'check:cem']);
	await record('typecheck, before', 'pnpm', [
		'exec',
		'tsc',
		'-p',
		'.storybook/tsconfig.json',
		'--noEmit',
	]);
	await record('component:new', 'pnpm', ['run', '--silent', 'component:new', COMPONENT]);
	await record('git add', 'git', [
		'add',
		'-A',
		'apps/web/src/components/shared/lushly-specimen-probe',
	]);
	await record('cem:analyze', 'pnpm', ['run', '--silent', 'cem:analyze']);
	await record('typecheck, after', 'pnpm', [
		'exec',
		'tsc',
		'-p',
		'.storybook/tsconfig.json',
		'--noEmit',
	]);
	// The typecheck has teeth: an argument of the wrong type in the new story fails it.
	const story = await readFile(join(clone, STORY), 'utf8');
	await writeFile(
		join(clone, STORY),
		`${story}\nexport const brokenArgs: LushlySpecimenProbeStoryArgs = { content: 1 };\n`
	);
	await record('typecheck, with a wrong argument type', 'pnpm', [
		'exec',
		'tsc',
		'-p',
		'.storybook/tsconfig.json',
		'--noEmit',
	]);
	await writeFile(join(clone, STORY), story);
	const index = join(output, 'storybook-index.json');
	await record('storybook index', 'pnpm', [
		'exec',
		'storybook',
		'index',
		'-c',
		'.storybook',
		'-o',
		index,
	]);
	const storybook = Object.values(JSON.parse(await readFile(index, 'utf8')).entries).filter(
		(entry) => entry.type === 'story' && entry.importPath === `./${STORY}`
	);

	const configFile = join(output, 'specimen.config.json');
	await writeFile(
		configFile,
		JSON.stringify({
			stories: [join(clone, 'apps/web/src/components/**/*.stories.ts')],
			preview: join(clone, '.storybook/preview.ts'),
			manifest: join(clone, 'custom-elements.json'),
		})
	);
	const { createSpecimenBench } = await import(new URL('../dist/index.js', import.meta.url).href);
	const bench = await createSpecimenBench({ root: clone, configFile });
	let suite;
	let specimen;
	try {
		const report = await bench.validate();
		result.validation = {
			valid: report.valid,
			issuesInScaffold: report.issues.filter((issue) => issue.importPath === `./${STORY}`),
		};
		specimen = bench.list().filter((entry) => entry.module === `./${STORY}`);
		suite = await bench.runSuite({ filter: { file: STORY }, workers: 1 });
	} finally {
		await bench.close();
	}
	result.identities = {
		storybook: storybook.map((entry) => ({ id: entry.id, title: entry.title, name: entry.name })),
		specimen: specimen.map((entry) => ({
			id: entry.id,
			title: entry.title,
			name: entry.story.name,
		})),
	};
	result.specimen = suite.stories.map((story) => ({
		id: story.id,
		status: story.status,
		play: story.attempts.at(-1)?.play,
		a11y: story.attempts.at(-1)?.a11y.status,
	}));
	result.schema = specimen[0]?.component ?? null;

	const fontRecord = join(fontStore, 'remote-fonts.json');
	const fonts = await startFontServer(JSON.parse(await readFile(fontRecord, 'utf8')), fontStore);
	try {
		const report = join(output, 'incumbent-report.json');
		await runIncumbent({
			snapshot: clone,
			consumer: 'lushly',
			wrapper: await writeWrapperConfig({ snapshot: clone, consumer: 'lushly', directory: output }),
			kind: 'warm',
			report,
			fonts: { record: fontRecord, base: fonts.url },
			env: { STORYBOOK_DISABLE_TELEMETRY: '1' },
			files: [STORY],
			extraArgs: ['--maxWorkers=1'],
		});
		const reported = JSON.parse(await readFile(report, 'utf8'));
		result.incumbent = reported.testResults.flatMap((file) =>
			file.assertionResults.map((test) => ({
				file: relative(clone, file.name),
				name: test.title,
				status: test.status,
			}))
		);
	} finally {
		await fonts.close();
	}
	result.agree =
		JSON.stringify(result.identities.storybook) === JSON.stringify(result.identities.specimen) &&
		result.specimen.length === result.incumbent.length &&
		result.specimen.every((story, index) => story.status === result.incumbent[index]?.status);
} finally {
	await writeFile(join(output, 'scaffold.json'), `${JSON.stringify(result, null, 2)}\n`);
	await rm(clone, { recursive: true, force: true });
}
console.log(
	JSON.stringify({
		agree: result.agree,
		identities: result.identities,
		specimen: result.specimen,
		incumbent: result.incumbent,
		validation: result.validation,
	})
);
