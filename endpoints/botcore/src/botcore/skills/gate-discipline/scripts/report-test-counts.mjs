#!/usr/bin/env node
/**
 * Repository-wide test inventory and exemption counts, for Health trend measures.
 *
 * Counts tracked test files, tests, assertions, skips, unconditional skips, scenario
 * files and scenario steps across JavaScript/TypeScript, Python, Rust, C++ and
 * `*.scenario.yaml`, plus registered quarantine and test-discovery exemptions.
 *
 * Always exits 0 on a valid run (reporting, not a gate). Use `--measures-out <file>` to
 * write a Health `schema_version = "1.0"` measures JSON file.
 *
 * Needs only Node and git. Usage:
 *   node report-test-counts.mjs [--root <dir>] [--register <path>]
 *                               [--discovery-register <path>] [--target <id>]
 *                               [--json] [--measures-out <file>]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_REGISTER as DEFAULT_DISCOVERY_REGISTER } from './check-test-discovery.mjs';
import {
	DEFAULT_REGISTER as DEFAULT_QUARANTINE_REGISTER,
	findSuppressions,
	loadRegister,
	maskSource,
} from './check-test-quarantine.mjs';
import { LANGUAGES } from './report-test-changes.mjs';

export const MEASURES_SCHEMA_VERSION = '1.0';
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const JS_SKIP_MEMBERS = new Set(['skip', 'todo', 'fixme', 'skipIf', 'runIf']);
const JS_TEST_MEMBERS = new Set([
	'only',
	'skip',
	'todo',
	'fixme',
	'each',
	'concurrent',
	'sequential',
	'fails',
	'failing',
	'skipIf',
	'runIf',
	'for',
]);

/** Count JS/TS skip markers separately from focus (`.only`, `fit`, `fdescribe`). */
function countJsSkips(text) {
	const code = maskSource(text);
	let skips = 0;
	let xPrefixed = 0;
	const chain =
		/(?<![\w$.])([xf]?(?:it|test)|bench)((?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*(?:<[^()]*?>\s*)?\(/g;
	for (const match of code.matchAll(chain)) {
		const members = [...match[2].matchAll(/[A-Za-z_$][\w$]*/g)].map((member) => member[0]);
		if (!members.every((member) => JS_TEST_MEMBERS.has(member))) continue;
		const isX = match[1].startsWith('x');
		if (isX) xPrefixed += 1;
		if (isX || members.some((member) => JS_SKIP_MEMBERS.has(member))) skips += 1;
	}
	const suites =
		/(?<![\w$.])(?:(?:test|it)\s*\.\s*)?([xf]?)(?:describe|suite)((?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(/g;
	for (const match of code.matchAll(suites)) {
		const isX = match[1] === 'x';
		if (isX) xPrefixed += 1;
		if (
			isX ||
			[...match[2].matchAll(/[A-Za-z_$][\w$]*/g)].some((member) => JS_SKIP_MEMBERS.has(member[0]))
		) {
			skips += 1;
		}
	}
	const unconditional =
		findSuppressions(text).filter((entry) => entry.kind !== 'only').length + xPrefixed;
	return { skips, unconditional };
}

function gitRunner(root) {
	const env = { ...process.env };
	for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
	return (args) =>
		execFileSync('git', ['--literal-pathspecs', ...args], {
			cwd: root,
			encoding: 'utf8',
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
			maxBuffer: 256 * 1024 * 1024,
		});
}

function countDiscoveryExemptions(root, registerPath) {
	const full = resolve(root, registerPath);
	if (!existsSync(full)) return 0;
	const parsed = JSON.parse(readFileSync(full, 'utf8'));
	return Array.isArray(parsed.unrun) ? parsed.unrun.length : 0;
}

function countQuarantined(root, registerPath) {
	const full = resolve(root, registerPath);
	if (!existsSync(full)) return 0;
	const loaded = loadRegister(root, registerPath);
	return loaded.entries.size;
}

/** Count tests, assertions, skips, scenarios and exemptions across the tracked tree. */
export function reportTestCounts({
	root = process.cwd(),
	register = DEFAULT_QUARANTINE_REGISTER,
	discoveryRegister = DEFAULT_DISCOVERY_REGISTER,
} = {}) {
	const git = gitRunner(root);
	const files = git(['ls-files', '-z']).split('\0').filter(Boolean);

	const byLanguage = {};
	for (const lang of LANGUAGES) {
		byLanguage[lang.name] = {
			files: 0,
			tests: 0,
			assertions: 0,
			skips: 0,
			unconditional: 0,
		};
	}

	for (const file of files) {
		const candidates = LANGUAGES.filter((lang) => lang.owns(file));
		if (candidates.length === 0) continue;
		const full = resolve(root, file);
		if (!existsSync(full)) continue;
		let text;
		try {
			text = readFileSync(full, 'utf8');
		} catch {
			continue;
		}
		const language = candidates.find((candidate) => !candidate.holds || candidate.holds([text]));
		if (!language) continue;
		const measured = language.measure(text);
		const jsSkips = language.name === 'JavaScript' ? countJsSkips(text) : undefined;
		const bucket = byLanguage[language.name];
		bucket.files += 1;
		bucket.tests += measured.tests ?? 0;
		bucket.assertions += measured.assertions ?? 0;
		bucket.skips += jsSkips ? jsSkips.skips : (measured.skips ?? 0);
		bucket.unconditional += jsSkips ? jsSkips.unconditional : (measured.unconditional ?? 0);
	}

	const codeLangs = ['JavaScript', 'Python', 'Rust', 'C++'];
	const totals = {
		testFiles: 0,
		tests: 0,
		assertions: 0,
		skips: 0,
		unconditionalSkips: 0,
		scenarioFiles: byLanguage.Scenario.files,
		scenarioSteps: byLanguage.Scenario.tests,
		scenarioAssertions: byLanguage.Scenario.assertions,
		quarantined: countQuarantined(root, register),
		discoveryExemptions: countDiscoveryExemptions(root, discoveryRegister),
	};
	for (const name of codeLangs) {
		const bucket = byLanguage[name];
		totals.testFiles += bucket.files;
		totals.tests += bucket.tests;
		totals.assertions += bucket.assertions;
		totals.skips += bucket.skips;
		totals.unconditionalSkips += bucket.unconditional;
	}

	return { totals, byLanguage };
}

/** Build a Health 1.0 measures document from a repository test-counts report. */
export function toMeasuresDocument(report, { source = 'test-counts', target } = {}) {
	if (target !== undefined && !IDENTIFIER.test(target)) {
		throw new Error(`Invalid measure target identifier: ${target}`);
	}
	if (!IDENTIFIER.test(source)) {
		throw new Error(`Invalid measure source identifier: ${source}`);
	}
	const { totals, byLanguage } = report;
	return {
		schema_version: MEASURES_SCHEMA_VERSION,
		source,
		...(target !== undefined ? { target } : {}),
		measures: [
			{
				key: 'test_files_total',
				label: 'Tracked test files',
				value: totals.testFiles,
				unit: 'files',
				direction: 'higher_is_better',
			},
			{
				key: 'tests_total',
				label: 'Tests across suites',
				value: totals.tests,
				unit: 'tests',
				direction: 'higher_is_better',
			},
			{
				key: 'test_assertions_total',
				label: 'Test assertions across suites',
				value: totals.assertions,
				unit: 'assertions',
				direction: 'higher_is_better',
			},
			{
				key: 'tests_skipped',
				label: 'Skipped tests (lexical)',
				value: totals.skips,
				unit: 'skips',
				direction: 'lower_is_better',
			},
			{
				key: 'tests_unconditional_skips',
				label: 'Unconditional test skips',
				value: totals.unconditionalSkips,
				unit: 'skips',
				direction: 'lower_is_better',
			},
			{
				key: 'tests_quarantined',
				label: 'Quarantined test files',
				value: totals.quarantined,
				unit: 'files',
				direction: 'lower_is_better',
			},
			{
				key: 'test_discovery_exemptions',
				label: 'Unrun test-discovery exemptions',
				value: totals.discoveryExemptions,
				unit: 'entries',
				direction: 'lower_is_better',
			},
			{
				key: 'scenario_files_total',
				label: 'Scenario files',
				value: totals.scenarioFiles,
				unit: 'files',
				direction: 'higher_is_better',
			},
			{
				key: 'scenario_steps_total',
				label: 'Scenario steps',
				value: totals.scenarioSteps,
				unit: 'steps',
				direction: 'higher_is_better',
			},
			{
				key: 'tests_javascript',
				label: 'JavaScript/TypeScript tests',
				value: byLanguage.JavaScript.tests,
				unit: 'tests',
				direction: 'higher_is_better',
			},
			{
				key: 'tests_python',
				label: 'Python tests',
				value: byLanguage.Python.tests,
				unit: 'tests',
				direction: 'higher_is_better',
			},
			{
				key: 'tests_rust',
				label: 'Rust tests',
				value: byLanguage.Rust.tests,
				unit: 'tests',
				direction: 'higher_is_better',
			},
			{
				key: 'tests_cpp',
				label: 'C++ tests',
				value: byLanguage['C++'].tests,
				unit: 'tests',
				direction: 'higher_is_better',
			},
		],
	};
}

export function formatReport(report) {
	const { totals, byLanguage } = report;
	const lines = [
		'Test inventory (lexical):',
		`  test files: ${totals.testFiles} (${totals.tests} tests, ${totals.assertions} assertions)`,
		`  skips: ${totals.skips} (${totals.unconditionalSkips} unconditional), ${totals.quarantined} quarantined, ${totals.discoveryExemptions} discovery exemptions`,
		`  scenarios: ${totals.scenarioFiles} files, ${totals.scenarioSteps} steps (${totals.scenarioAssertions} assertions)`,
		'',
		'By language:',
	];
	for (const name of ['JavaScript', 'Python', 'Rust', 'C++']) {
		const b = byLanguage[name];
		lines.push(
			`  ${name.padEnd(11)} ${String(b.files).padStart(4)} files  ${String(b.tests).padStart(5)} tests  ${String(b.assertions).padStart(6)} assertions  ${String(b.skips).padStart(3)} skips`
		);
	}
	return lines.join('\n');
}

function requireValue(argv, index, flag) {
	const value = argv[index + 1];
	if (value === undefined || value.trim() === '') {
		throw new Error(`${flag} requires a non-empty value.`);
	}
	return value;
}

function parseArguments(argv) {
	const options = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--root') options.root = resolve(requireValue(argv, i++, arg));
		else if (arg === '--register') options.register = requireValue(argv, i++, arg);
		else if (arg === '--discovery-register')
			options.discoveryRegister = requireValue(argv, i++, arg);
		else if (arg === '--target') options.target = requireValue(argv, i++, arg);
		else if (arg === '--measures-out') options.measuresOut = resolve(requireValue(argv, i++, arg));
		else if (arg === '--json') options.json = true;
		else throw new Error(`Unknown argument ${arg}.`);
	}
	return options;
}

if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
	try {
		const options = parseArguments(process.argv.slice(2));
		const report = reportTestCounts(options);
		if (options.measuresOut) {
			const doc = toMeasuresDocument(report, { target: options.target });
			mkdirSync(dirname(options.measuresOut), { recursive: true });
			writeFileSync(options.measuresOut, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
		}
		console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
	} catch (cause) {
		console.error(cause instanceof Error ? cause.message : String(cause));
		process.exitCode = 1;
	}
}
