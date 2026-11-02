#!/usr/bin/env node
/**
 * T05's consumer check: a consumer's retained stories through both runners, on a prepared
 * snapshot. Specimen discovers the consumer's whole story set with its preview and manifest, and
 * every identity must equal the consumer's own `storybook index`. The incumbent then runs T04's
 * representative selection through the consumer's Storybook Vitest path (incumbent.mjs), with
 * recorded fonts, and Specimen runs the same stories; each must end the same way in both, for
 * the same kind of reason. `--plugin` installs the FAST-AF plugin and inspects every component
 * in the selection. `--mode identities` stops after the identity check; `--mode full` runs
 * every story instead of the selection, with `--workers` (default 2) capping the incumbent's.
 *
 * The snapshot stays read-only apart from the Vite caches the incumbent writes and, with
 * `--plugin`, `.specimen-t05/`: a plugin module must be inside the bench root.
 */
import { cp, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { incumbents, runIncumbent, writeWrapperConfig } from './incumbent.mjs';
import { startFontServer } from './inputs/remote-fonts.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(name);
	return index === -1 ? fallback : args[index + 1];
};
const json = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

/** What each consumer's `.storybook/main.ts` and preview declare. */
const consumers = {
	'fast-af': {
		stories: ['packages/violet-elements/src/**/*.stories.ts'],
		preview: '.storybook/preview.ts',
		manifest: 'packages/violet-elements/custom-elements.json',
	},
	lushly: {
		stories: ['apps/web/src/components/**/*.stories.ts'],
		preview: '.storybook/preview.ts',
		manifest: 'custom-elements.json',
		staticDirs: [
			{ from: 'apps/web/public/site', to: '/site' },
			{ from: 'apps/web/public/field-notes', to: '/field-notes' },
		],
	},
};

const consumer = option('--consumer');
if (!consumers[consumer]) throw new Error('--consumer must be fast-af or lushly');
const declared = consumers[consumer];
const snapshot = await realpath(resolve(option('--snapshot') ?? ''));
const index = resolve(option('--index') ?? '');
const fontStore = resolve(option('--fonts') ?? '');
const output = resolve(option('--out', `test-results/specimens-t05-retained-${Date.now()}`));
const plugin = option('--plugin');
const api = option('--api', new URL('../dist/index.js', import.meta.url).href);
const mode = option('--mode', 'all');
if (!['all', 'identities', 'full'].includes(mode))
	throw new Error('--mode must be all, identities or full');
const workers = option('--workers', '2');
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error('Evidence output must be empty');

async function pluginModule() {
	if (!plugin) return undefined;
	const directory = join(snapshot, '.specimen-t05');
	await cp(resolve(plugin), join(directory, 'specimen-fast-af'), { recursive: true });
	const file = join(directory, 'fast-af.plugin.js');
	await writeFile(
		file,
		"// Written by experiments/run-retained.mjs: the FAST-AF plugin with its defaults.\nimport { fastAf } from './specimen-fast-af/index.js';\nexport default fastAf();\n"
	);
	return file;
}

/** A bench over the consumer's stories, configured from outside the snapshot. */
async function bench(stories, plugins) {
	const configFile = join(output, `specimen.${plugins.length ? 'plugin' : 'core'}.config.json`);
	await json(configFile, {
		stories: stories.map((path) => join(snapshot, path)),
		preview: join(snapshot, declared.preview),
		manifest: join(snapshot, declared.manifest),
		...(declared.staticDirs
			? {
					staticDirs: declared.staticDirs.map(({ from, to }) => ({
						from: join(snapshot, from),
						to,
					})),
				}
			: {}),
		...(plugins.length ? { plugins } : {}),
	});
	const { createSpecimenBench } = await import(api);
	return createSpecimenBench({ root: snapshot, configFile });
}

const fields = (entry) => ({
	id: entry.id,
	title: entry.title,
	name: entry.name,
	importPath: entry.importPath,
	tags: [...entry.tags].sort(),
});

/** Every story Specimen discovers equals the consumer's own index entry for it. */
async function identities() {
	const storybook = Object.values(JSON.parse(await readFile(index, 'utf8')).entries).filter(
		(entry) => entry.type === 'story'
	);
	const discovered = await bench(declared.stories, []);
	try {
		const report = await discovered.validate();
		const specimen = discovered.list().map((entry) => ({
			id: entry.id,
			title: entry.title,
			name: entry.story.name,
			importPath: entry.module,
			tags: [...entry.story.tags].sort(),
		}));
		const byId = new Map(specimen.map((entry) => [entry.id, entry]));
		const mismatches = [];
		for (const expected of storybook.map(fields)) {
			const actual = byId.get(expected.id);
			byId.delete(expected.id);
			if (JSON.stringify(actual) !== JSON.stringify(expected))
				mismatches.push({ expected, actual: actual ?? null });
		}
		for (const extra of byId.values()) mismatches.push({ expected: null, actual: extra });
		return {
			storybook: storybook.length,
			specimen: specimen.length,
			mismatches,
			validation: {
				valid: report.valid,
				issues: report.issues.map(({ code, severity, importPath, exportName, message }) => ({
					code,
					severity,
					importPath,
					exportName,
					message,
				})),
			},
		};
	} finally {
		await discovered.close();
	}
}

/** Storybook's Vitest run of the selection, test by test. */
async function incumbent() {
	const fontRecord = join(fontStore, 'remote-fonts.json');
	const fonts = await startFontServer(JSON.parse(await readFile(fontRecord, 'utf8')), fontStore);
	try {
		const report = join(output, 'incumbent-report.json');
		const run = await runIncumbent({
			snapshot,
			consumer,
			wrapper: await writeWrapperConfig({ snapshot, consumer, directory: output }),
			kind: 'warm',
			report,
			fonts: { record: fontRecord, base: fonts.url },
			env: { STORYBOOK_DISABLE_TELEMETRY: '1' },
			...(mode === 'full' ? { files: [], extraArgs: [`--maxWorkers=${workers}`] } : {}),
		});
		const results = JSON.parse(
			await readFile(report, 'utf8').catch(() => {
				throw new Error(`The incumbent wrote no report (exit ${run.code}):\n${run.output}`);
			})
		);
		return {
			run,
			fonts: fonts.stats(),
			tests: results.testResults.flatMap((file) =>
				file.assertionResults.map((test) => ({
					file: `./${relative(snapshot, file.name).replaceAll('\\', '/')}`,
					name: test.title,
					status: test.status,
					accessibility: test.failureMessages.some((message) =>
						message.includes('toHaveNoViolations')
					),
					message: test.failureMessages[0]?.split('\n')[0] ?? '',
				}))
			),
		};
	} finally {
		await fonts.close();
	}
}

/** Specimen's run of the same stories, and with the plugin, each component's inspection. */
async function candidate(plugins) {
	const startedAt = performance.now();
	const selected = await bench(
		mode === 'full' ? declared.stories : incumbents[consumer].files,
		plugins
	);
	try {
		const stories = [];
		const entries = selected.list();
		for (const [index, entry] of entries.entries()) {
			if (index % 50 === 0) console.log(`Specimen: ${index} of ${entries.length}`);
			let outcome;
			try {
				({ outcome } = await selected.run({ id: entry.id }));
			} catch (error) {
				// A run that throws is a finding of its own; the rest of the suite still runs.
				outcome = {
					status: 'error',
					play: 'none',
					failures: [{ category: 'host', message: String(error?.message ?? error) }],
					a11y: { status: 'not-run', policy: 'manual', violations: [] },
				};
			}
			stories.push({
				id: entry.id,
				file: entry.module,
				name: entry.story.name,
				component: entry.component ?? null,
				status: outcome.status,
				category: outcome.failures[0]?.category ?? null,
				message: outcome.failures[0]?.message?.split('\n')[0] ?? '',
				play: outcome.play,
				a11y: {
					status: outcome.a11y.status,
					policy: outcome.a11y.policy,
					violations: (outcome.a11y.violations ?? []).map((violation) => violation.id),
				},
			});
		}
		const inspected = [];
		if (plugins.length) {
			const components = new Map();
			for (const entry of selected.list())
				if (entry.component && !components.has(entry.component))
					components.set(entry.component, entry.id);
			for (const [component, id] of components) {
				const result = await selected.inspect({ id });
				inspected.push({
					component,
					id,
					sources: result.schema?.sources ?? [],
					properties: result.schema?.properties.length ?? 0,
					finite: result.schema?.properties.filter((item) => item.values).length ?? 0,
					events: result.schema?.events.length ?? 0,
					commands: result.schema?.commands.map((command) => command.id) ?? [],
					unknown: result.schema?.unknown ?? [],
					plugins: result.plugins,
				});
			}
		}
		return { stories, inspected, elapsedMs: performance.now() - startedAt };
	} finally {
		await selected.close();
	}
}

const result = { consumer, snapshot, api, startedAt: new Date().toISOString() };
result.identities = await identities();
if (mode === 'identities') {
	await json(join(output, 'retained.json'), result);
	console.log(
		`${consumer}: ${result.identities.specimen} discovered, ${result.identities.storybook} indexed, ${result.identities.mismatches.length} identity mismatches`
	);
	process.exit(result.identities.mismatches.length ? 1 : 0);
}
// One runner at a time, to keep the shared host's load bounded.
const reference = await incumbent();
const plugins = plugin ? [await pluginModule()] : [];
const { stories, inspected, elapsedMs } = await candidate(plugins);
result.candidate = { elapsedMs };
result.incumbent = { run: reference.run, fonts: reference.fonts, tests: reference.tests.length };
result.stories = stories.map((story) => {
	const test = reference.tests.find((item) => item.file === story.file && item.name === story.name);
	const agrees =
		story.status === 'excluded'
			? test === undefined
			: test !== undefined &&
				story.status === test.status &&
				(story.status !== 'failed' || (story.category === 'a11y') === test.accessibility);
	return { ...story, incumbent: test ?? null, agrees };
});
result.unmatched = reference.tests.filter(
	(test) => !stories.some((story) => story.file === test.file && story.name === test.name)
);
result.inspected = inspected;
result.agree =
	result.identities.mismatches.length === 0 &&
	result.stories.every((story) => story.agrees) &&
	result.unmatched.length === 0;
await json(join(output, 'retained.json'), result);

const count = (status) => result.stories.filter((story) => story.status === status).length;
console.log(
	`${consumer}: ${result.identities.specimen} discovered, ${result.identities.storybook} indexed, ${result.identities.mismatches.length} identity mismatches; ` +
		`${result.stories.length} run (${count('passed')} passed, ${count('failed')} failed, ${count('skipped')} skipped), ` +
		`${result.stories.filter((story) => !story.agrees).length + result.unmatched.length} disagreements`
);
console.log(`Evidence: ${pathToFileURL(join(output, 'retained.json')).href}`);
process.exitCode = result.agree ? 0 : 1;
