#!/usr/bin/env node
/**
 * T07's parity check: FAST-AF's Fastbot story contract and its replacement side by side. Both run
 * on a throwaway copy-on-write clone of a FAST-AF snapshot (macOS `cp -c`, removed at the end),
 * first as it is, where neither should object, and then with one rule deliberately broken at a
 * time, where each must report that rule. Each breakage is undone before the next.
 *
 * node experiments/check-contract.mjs --snapshot DIR --out FILE
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const source = resolve(option('--snapshot'));
const output = resolve(option('--out'));
const work = `${output}.work`;
const clone = join(work, 'clone');
const repository = resolve(import.meta.dirname, '../../..');
const elements = 'packages/violet-elements';
const storyOf = (name) => `${elements}/src/${name}/violet-${name}.stories.ts`;
const env = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
);

async function fastbot() {
	const { stdout } = await run(
		'uv',
		[
			'run',
			'--no-project',
			'--python',
			'3.12',
			'--with',
			'pydantic',
			'--with',
			'httpx',
			'--with',
			join(repository, 'python'),
			'python',
			join(import.meta.dirname, 'inputs/fastbot-contract.py'),
			clone,
		],
		{ env, maxBuffer: 64 * 1024 * 1024 }
	);
	const report = JSON.parse(stdout.trim().split('\n').at(-1));
	const { success: _success, ...raw } = report;
	return {
		raw,
		errors: report.errors ?? [],
		warnings: report.warnings ?? [],
		stats: report.stats ?? null,
	};
}

/** The contract's run, through the adapter FAST-AF could adopt: Fastbot's own output shape. */
async function adapted(report) {
	const input = join(work, 'contract.json');
	await writeFile(input, JSON.stringify(report));
	const { stdout } = await run(
		'python3',
		[
			'-I',
			join(import.meta.dirname, 'inputs/fastbot-adapter.py'),
			input,
			join(clone, elements, 'src'),
		],
		{ env }
	);
	return JSON.parse(stdout);
}

const { createSpecimenBench } = await import(new URL('../dist/index.js', import.meta.url).href);

async function specimen(request) {
	const configFile = join(work, 'specimen.config.json');
	await writeFile(
		configFile,
		JSON.stringify({
			stories: [join(clone, elements, 'src/**/*.stories.ts')],
			preview: join(clone, '.storybook/preview.ts'),
			manifest: join(clone, elements, 'custom-elements.json'),
		})
	);
	const bench = await createSpecimenBench({ root: clone, configFile });
	try {
		return await bench.contract({ timeoutMs: 15_000, ...request });
	} finally {
		await bench.close();
	}
}

/** One deliberate breakage: what changes on disk, and the rule both must report for it. */
const breakages = [
	{
		rule: 'MISSING_STORY',
		component: 'violet-badge',
		file: storyOf('badge'),
		change: () => null,
	},
	{
		rule: 'MISSING_GLOBAL_A11Y_ERROR_POLICY',
		component: 'violet-badge',
		file: '.storybook/preview.ts',
		change: (text) => text.replace(/test:\s*['"]error['"]/, "test: 'todo'"),
	},
	{
		rule: 'MISSING_AUTODOCS_TAG',
		component: 'violet-badge',
		file: storyOf('badge'),
		change: (text) => text.replaceAll('autodocs', 'not-docs'),
	},
	{
		rule: 'MISSING_PLAY_FUNCTION',
		component: 'violet-badge',
		file: storyOf('badge'),
		change: (text) => text.replace(/\bplay\s*:/g, 'unplayed:').replace(/\bplay\s*\(/g, 'unplayed('),
	},
	{
		rule: 'MISSING_DOCS_DESCRIPTION',
		severity: 'warning',
		component: 'violet-badge',
		file: storyOf('badge'),
		change: (text) => text.replaceAll('description', 'summaryText'),
	},
	{
		rule: 'MISSING_STORY_EXPORT',
		component: 'violet-badge',
		file: storyOf('badge'),
		change: () => "export default { title: 'Components/Badge' };\n",
	},
	{
		rule: 'MISSING_BASELINE_STORY',
		component: 'violet-badge',
		file: storyOf('badge'),
		change: (text) => text.replace(/\b(Overview|Default)\b/g, 'Plain'),
	},
	{
		rule: 'MISSING_STATE_STORY',
		component: 'violet-button',
		file: storyOf('button'),
		change: (text) => text.replace(/Disabled/g, 'Plain').replace(/\bdisabled\b/g, 'wasDisabled'),
	},
	{
		rule: 'MISSING_FORMDATA_ASSERTION',
		component: 'violet-text-field',
		file: storyOf('text-field'),
		change: (text) =>
			`const readForm = (form) => ({ get: (name) => [...form.elements].find((item) => item.getAttribute('name') === name)?.value ?? null });\n${text.replace(/new FormData\(/g, 'readForm(')}`,
	},
	{
		rule: 'MISSING_VALIDITY_ASSERTION',
		component: 'violet-text-field',
		file: storyOf('text-field'),
		change: (text) => text.replace(/\.checkValidity\(\)/g, ".matches(':valid')"),
	},
	{
		rule: 'UNDOCUMENTED_A11Y_EXCEPTION',
		component: 'violet-badge',
		file: storyOf('badge'),
		change: (text) =>
			text.replace(
				/(export const \w+\s*:\s*\w+\s*=\s*\{)/,
				"$1\n\tparameters: { a11y: { test: 'off' } },"
			),
	},
];

/**
 * Where the replacement is deliberately stronger. Fastbot accepts this story because its name
 * contains the word, and it never disables the calendar: its render ignores the arg.
 */
const KNOWN = [
	{ code: 'MISSING_STATE_STORY', component: 'violet-calendar', attribute: 'disabled' },
];
const isKnown = (finding) =>
	KNOWN.some(
		({ code, component, attribute }) =>
			finding.code === code && finding.component === component && finding.attribute === attribute
	);
const codes = (items) => [...new Set(items.map((item) => item.code))].sort();

await mkdir(work, { recursive: true });
await run('cp', ['-cR', source, clone], { env });
const result = { snapshot: source, startedAt: new Date().toISOString() };
try {
	const [before, after] = [await fastbot(), await specimen({ workers: 2 })];
	const shaped = await adapted(after);
	const shapeOf = (report) => Object.keys(report).sort().join();
	result.adapter = {
		shapeMatches: shapeOf(shaped) === shapeOf(before.raw),
		statsMatch: JSON.stringify(shaped.stats) === JSON.stringify(before.stats),
		keys: Object.keys(shaped).sort(),
	};
	result.unbroken = {
		fastbot: { errors: before.errors, warnings: before.warnings, stats: before.stats },
		specimen: {
			valid: after.valid,
			findings: after.findings,
			stats: after.stats,
			cases: after.cases,
			elapsedMs: after.elapsedMs,
		},
	};
	console.log(
		`unbroken: Fastbot ${before.errors.length} errors, ${before.warnings.length} warnings; Specimen ${after.counts.errors} errors, ${after.counts.warnings} warnings, ${after.cases.failed.length} cases failed`
	);
	result.broken = [];
	for (const { rule, severity, component, file, change } of breakages) {
		const path = join(clone, file);
		const original = await readFile(path, 'utf8');
		const changed = change(original);
		if (changed === original) throw new Error(`${rule}: the breakage changed nothing in ${file}`);
		if (changed === null) await rm(path);
		else await writeFile(path, changed);
		try {
			const bot = await fastbot();
			const fromBot = codes([...bot.errors, ...bot.warnings]);
			const report = await specimen({ component });
			const fromSpecimen = codes(report.findings);
			const shapedBroken = await adapted(report);
			const fromAdapter = codes([...shapedBroken.errors, ...shapedBroken.warnings]);
			const entry = {
				rule,
				component,
				fastbot: fromBot,
				specimen: fromSpecimen,
				adapter: fromAdapter,
				agree: fromBot.includes(rule) && fromSpecimen.includes(rule) && fromAdapter.includes(rule),
				severity: report.findings.find((item) => item.code === rule)?.severity ?? null,
				expectedSeverity: severity ?? 'error',
				casesFailed: report.cases.failed,
			};
			result.broken.push(entry);
			console.log(
				`${entry.agree ? 'ok  ' : 'FAIL'} ${rule}: Fastbot [${fromBot.join(', ')}], Specimen [${fromSpecimen.join(', ')}], ${entry.casesFailed.length} cases failed`
			);
		} finally {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, original);
		}
	}
	const stronger = after.findings.filter((item) => item.severity === 'error' && !isKnown(item));
	result.known = after.findings.filter(isKnown);
	result.agree =
		result.adapter.shapeMatches &&
		result.adapter.statsMatch &&
		result.broken.every((entry) => entry.agree) &&
		codes(before.errors).join() === codes(stronger).join();
} finally {
	await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
	await rm(work, { recursive: true, force: true });
}
console.log(`agree: ${result.agree}`);
process.exitCode = result.agree ? 0 : 1;
