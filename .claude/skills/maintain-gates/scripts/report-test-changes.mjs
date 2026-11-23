#!/usr/bin/env node
/**
 * Lists what a branch did to its tests, for the reviewer: a suite made green by checking less.
 *
 * Compares each changed test file at the merge base with the branch and reports:
 *
 * - a test or scenario file deleted (a rename is compared, not reported as a deletion);
 * - fewer tests, or fewer assertions, in a file;
 * - a skip, focus or todo added, a whole file's or suite's included, a conditional one made
 *   unconditional, or a new test file born with an unconditional one (unconditional
 *   JavaScript ones are also the quarantine check's business);
 * - an assertion line removed and not put back word for word (a changed expected value, a
 *   swapped matcher), when the count did not fall;
 * - JavaScript matchers loosened: exact matchers (`toBe`, `toEqual`...) fewer while loose
 *   ones (`toBeDefined`, `toBeTruthy`...) more;
 * - a snapshot that lost lines, a test runner config (Vitest, Vite, Playwright, Jest, pytest,
 *   a tests CMakeLists.txt) or the quarantine or discovery policy register changed or added.
 *
 * It is a report, not a gate: it exits 0 whatever it finds, because a deleted test is often
 * right (the code it tested went too). What it removes is the chance that nobody noticed.
 * Counting is lexical, per file: a test moved to another file shows as one fewer here, and
 * the totals, which include new test files, show the net. In the working tree an unstaged
 * `mv` reads as a deletion, since git does not see the untracked new file; stage it.
 *
 * Languages: JavaScript and TypeScript test files (comments and strings masked), Python
 * `test_*.py` and `*_test.py`, Rust files with `#[test]`, C++ files under `test/` or
 * `tests/` or named `*_test.*` (doctest, Catch2, GoogleTest), and `*.scenario.yaml` (steps
 * are `command:` keys, assertions `expect:` keys, so a narrowed `expect:` block is not seen).
 * Outside JavaScript only line comments are stripped, so an assertion named in a string
 * still counts.
 *
 * Needs only Node and git. Usage:
 *   node report-test-changes.mjs [--root <dir>] [--base <ref>] [--head <ref>] [--register <path>] [--discovery-register <path>] [--target <id>] [--measures-out <file>] [--json]
 * The base defaults to origin/main and is compared from its merge base with the head. With
 * no head, the working tree is compared, so uncommitted edits are included.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from './check-test-configs.mjs';
import { DEFAULT_REGISTER as DEFAULT_DISCOVERY_REGISTER } from './check-test-discovery.mjs';
import {
	DEFAULT_REGISTER,
	findSuppressions,
	maskSource,
	TEST_FILE,
} from './check-test-quarantine.mjs';

export const DEFAULT_BASE = 'origin/main';
export const MEASURES_SCHEMA_VERSION = '1.0';
const MEASURE_IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const stripLineComments = (marker) => (text) =>
	text
		.split('\n')
		.map((line) => {
			const at = line.indexOf(marker);
			return at === -1 ? line : line.slice(0, at);
		})
		.join('\n');

/** Members that keep a call a test declaration: `it.each(...)`, `test.skip(...)`. */
const TEST_MEMBERS = new Set([
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
const SKIP_MEMBERS = new Set(['only', 'skip', 'todo', 'fixme', 'skipIf', 'runIf']);
const EXACT =
	/\.\s*(?:toBe|toEqual|toStrictEqual|toMatchObject|toMatchInlineSnapshot|toHaveBeenCalledWith|toHaveBeenNthCalledWith|toHaveBeenLastCalledWith|toHaveLength|toContainEqual|toThrowError)\s*\(/g;
const LOOSE =
	/\.\s*(?:toBeDefined|toBeTruthy|toBeFalsy|toBeTypeOf|toBeInstanceOf|toHaveBeenCalled|toBeGreaterThanOrEqual|toBeLessThanOrEqual)\s*\(|\bexpect\s*\.\s*(?:anything|any)\s*\(/g;

/** The index of the `)` that closes the `(` at `open`, in masked code. */
function closingParen(code, open) {
	let depth = 0;
	for (let i = open; i < code.length; i++) {
		if (code[i] === '(') depth += 1;
		else if (code[i] === ')' && --depth === 0) return i;
	}
	return code.length;
}

function countJsTests(code) {
	let tests = 0;
	let skips = 0;
	// Jasmine-style `xit`, `xdescribe` (skip) and `fit`, `fdescribe` (focus) never depend on a
	// condition, and the quarantine scan does not read them.
	let prefixed = 0;
	const chain =
		/(?<![\w$.])([xf]?(?:it|test)|bench)((?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*(?:<[^()]*?>\s*)?\(/g;
	for (const match of code.matchAll(chain)) {
		const members = [...match[2].matchAll(/[A-Za-z_$][\w$]*/g)].map((member) => member[0]);
		if (!members.every((member) => TEST_MEMBERS.has(member))) continue;
		if (/^[xf]/.test(match[1])) prefixed += 1;
		if (/^[xf]/.test(match[1]) || members.some((member) => SKIP_MEMBERS.has(member))) skips += 1;
		// `it.skipIf(cond)` only makes a test function: a test when called on the spot,
		// `it.skipIf(cond)('title', fn)`, and an alias otherwise.
		const last = members.at(-1);
		if (
			(last === 'skipIf' || last === 'runIf') &&
			code[closingParen(code, match.index + match[0].length - 1) + 1] !== '('
		)
			continue;
		tests += 1;
	}
	// A suite-level skip or focus: `describe.skip(...)`, Playwright's `test.describe.only(...)`.
	const suites =
		/(?<![\w$.])(?:(?:test|it)\s*\.\s*)?([xf]?)(?:describe|suite)((?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(/g;
	for (const match of code.matchAll(suites)) {
		if (match[1]) prefixed += 1;
		if (
			match[1] ||
			[...match[2].matchAll(/[A-Za-z_$][\w$]*/g)].some((member) => SKIP_MEMBERS.has(member[0]))
		)
			skips += 1;
	}
	return { tests, skips, prefixed };
}

const count = (text, pattern) => [...text.matchAll(pattern)].length;

/**
 * Per language: which files it owns, how to strip comments, and what counts as a test, an
 * assertion and a skip. `line` patterns pick the diff lines quoted as evidence.
 */
export const LANGUAGES = [
	{
		name: 'JavaScript',
		owns: (file) => TEST_FILE.test(file),
		measure(text) {
			const code = maskSource(text);
			const { tests, skips, prefixed } = countJsTests(code);
			return {
				tests,
				// Not `expect.any(...)` and its kin, which are values inside an assertion.
				assertions: count(
					code,
					/(?<![\w$.])(?:expect(?:\s*\.\s*(?:soft|poll))?|assert(?:\s*\.\s*[A-Za-z_$][\w$]*)?)\s*\(/g
				),
				skips,
				unconditional: findSuppressions(text).length + prefixed,
				exact: count(code, EXACT),
				loose: count(code, LOOSE),
			};
		},
		line: {
			tests: /(?<![\w$.])(?:it|test|bench)\b\s*[.(]/,
			assertions: /(?<![\w$.])(?:expect|assert)\b\s*[.(]/,
			skips:
				/\.\s*(?:only|skip|todo|fixme|skipIf|runIf)\b|(?<![\w$.])[xf](?:describe|it|test)\s*\(/,
		},
	},
	{
		name: 'Python',
		owns: (file) => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(file),
		strip: stripLineComments('#'),
		tests: /^\s*(?:async\s+)?def\s+test\w*\s*\(/gm,
		assertions:
			/^\s*assert\b|\bself\.assert\w+\s*\(|\bpytest\.(?:raises|warns|approx)\s*\(|\bself\.fail\s*\(/gm,
		// Decorators, a module-wide `pytestmark`, and skips raised at run time.
		skips:
			/\bpytest\.mark\.(?:skip|skipif|xfail)\b|@(?:unittest\.)?(?:skip(?:If|Unless)?|expectedFailure)\b|\bpytest\.(?:skip|xfail|importorskip)\s*\(|\bself\.skipTest\s*\(|\braise\s+(?:unittest\.)?SkipTest\b/g,
		// The markers that hold whatever the environment: `skipif` turned into `skip` shows.
		unconditional: /\bpytest\.mark\.skip\b|@(?:unittest\.)?skip\s*\(/g,
	},
	{
		name: 'Rust',
		owns: (file) => file.endsWith('.rs'),
		// Rust tests sit in ordinary source files: only one that has a test, before or after.
		holds: (texts) => texts.some((text) => /#\[(?:[\w:]+::)?test\b/.test(text)),
		strip: stripLineComments('//'),
		tests: /#\[(?:[\w:]+::)?test\b/g,
		assertions: /\b(?:debug_)?assert(?:_eq|_ne|_matches)?!|#\[should_panic\b/g,
		skips: /#\[ignore\b|#\[cfg_attr\([^\]]*\bignore\b/g,
		unconditional: /#\[ignore\b/g,
	},
	{
		name: 'C++',
		owns: (file) =>
			/\.(?:cpp|cc|cxx)$/.test(file) && /(^|\/)tests?\/|_test\.(?:cpp|cc|cxx)$/.test(file),
		strip: stripLineComments('//'),
		tests: /\b(?:TEST_CASE(?:_FIXTURE|_TEMPLATE)?|SCENARIO|TEST|TEST_F|TEST_P)\s*\(/g,
		assertions: /\b(?:CHECK|REQUIRE)(?:_[A-Z_]+)?\s*\(|\b(?:EXPECT|ASSERT)_[A-Z_]+\s*\(/g,
		// Catch2 hides a test with a `[.]`-style tag or marks it `[!mayfail]`.
		skips:
			/doctest::skip\s*\(|\bDISABLED_\w|\bGTEST_SKIP\b|\bSKIP\s*\(|\[\.[^\]"\n]*\]|\[!(?:mayfail|shouldfail)\]/g,
	},
	{
		name: 'Scenario',
		owns: (file) => /\.scenario\.ya?ml$/.test(file),
		strip: stripLineComments('#'),
		tests: /^\s*-?\s*command\s*:/gm,
		assertions: /^\s*-?\s*expect\s*:/gm,
		skips: /^\s*-?\s*skip\s*:\s*true\b/gm,
		units: 'steps',
	},
];

for (const language of LANGUAGES) {
	if (language.measure) continue;
	const nonGlobal = (pattern) => new RegExp(pattern.source, pattern.flags.replace('g', ''));
	language.measure = (text) => {
		const code = language.strip(text);
		return {
			tests: count(code, language.tests),
			assertions: count(code, language.assertions),
			skips: count(code, language.skips),
			...(language.unconditional && { unconditional: count(code, language.unconditional) }),
		};
	};
	language.line = {
		tests: nonGlobal(language.tests),
		assertions: nonGlobal(language.assertions),
		skips: nonGlobal(language.skips),
	};
}

function gitRunner(root) {
	const env = { ...process.env };
	for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
	// Literal pathspecs: `app/[id]/page.test.ts` names one file, not a glob.
	return (args) =>
		execFileSync('git', ['--literal-pathspecs', ...args], {
			cwd: root,
			encoding: 'utf8',
			env,
			// A failed read is handled, so git's own complaint would only look like a failure.
			stdio: ['ignore', 'pipe', 'pipe'],
			maxBuffer: 256 * 1024 * 1024,
		});
}

/** Test runner configuration besides Vitest's and Vite's: Playwright, Jest, pytest, CTest. */
const RUNNER_CONFIG =
	/(^|\/)(?:playwright|jest)(?:\.[\w-]+)?\.config\.[cm]?[jt]s$|(^|\/)(?:conftest\.py|pytest\.ini|tox\.ini|\.coveragerc)$|(^|\/)tests?\/CMakeLists\.txt$/;

/** `[{status, from, to}]` for every file changed between `base` and `head` (or the worktree). */
function changedFiles(git, base, head) {
	const fields = git(['diff', '-z', '--name-status', '-M', base, ...(head ? [head] : [])])
		.split('\0')
		.filter(Boolean);
	const changes = [];
	for (let i = 0; i < fields.length; ) {
		const status = fields[i++];
		if (status.startsWith('R') || status.startsWith('C')) {
			changes.push({ status: status[0], from: fields[i++], to: fields[i++] });
		} else {
			const path = fields[i++];
			changes.push({ status: status[0], from: path, to: path });
		}
	}
	return changes;
}

/** Removed (`-`, old line numbers) and added (`+`, new line numbers) lines of one file's diff. */
function diffLines(git, base, head, change) {
	const paths = change.from === change.to ? [change.to] : [change.from, change.to];
	const text = git(['diff', '-U0', '-M', base, ...(head ? [head] : []), '--', ...paths]);
	const removed = [];
	const added = [];
	let oldLine = 0;
	let newLine = 0;
	// Inside a hunk, `---` and `+++` are content (a YAML separator removed), not headers.
	let inHunk = false;
	for (const line of text.split('\n')) {
		const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
		if (hunk) {
			inHunk = true;
			oldLine = Number(hunk[1]);
			newLine = Number(hunk[2]);
		} else if (line.startsWith('diff --git ')) {
			inHunk = false;
		} else if (inHunk && line.startsWith('-')) {
			removed.push({ line: oldLine++, text: line.slice(1).trim() });
		} else if (inHunk && line.startsWith('+')) {
			added.push({ line: newLine++, text: line.slice(1).trim() });
		}
	}
	return { removed, added };
}

const MAX_QUOTED = 5;
const quote = (lines, pattern) =>
	lines.filter((entry) => pattern.test(entry.text)).slice(0, MAX_QUOTED);

/** The findings for one changed file: what it lost, given its text before and after. */
export function compareTestFile(file, language, before, after, diff = { removed: [], added: [] }) {
	const old = language.measure(before);
	const now = after === undefined ? undefined : language.measure(after);
	const units = language.units ?? 'tests';
	if (now === undefined)
		return {
			measures: { before: old, after: undefined },
			findings: [
				{
					file,
					kind: 'deleted-file',
					detail: `deleted with ${old.tests} ${units} and ${old.assertions} assertions`,
				},
			],
		};
	const findings = [];
	if (now.tests < old.tests)
		findings.push({
			file,
			kind: 'fewer-tests',
			detail: `${units} ${old.tests} → ${now.tests}`,
			lines: quote(diff.removed, language.line.tests),
		});
	if (now.assertions < old.assertions)
		findings.push({
			file,
			kind: 'fewer-assertions',
			detail: `assertions ${old.assertions} → ${now.assertions}`,
			lines: quote(diff.removed, language.line.assertions),
		});
	if (now.skips > old.skips || now.unconditional > old.unconditional)
		findings.push({
			file,
			kind: 'skip-added',
			detail:
				`skips ${old.skips} → ${now.skips}` +
				(now.unconditional > old.unconditional
					? `, ${now.unconditional - old.unconditional} more unconditional`
					: ''),
			lines: quote(diff.added, language.line.skips),
		});
	// An assertion line removed and not put back word for word: a changed expected value,
	// a matcher swapped, a check reduced to `expect(true).toBe(true)`. Counts cannot see it.
	// Compared from the assertion on, so `it('a', () => expect(x).toBe(1))` turned into
	// `it.skip('a', ...)` is a skip, not also a changed assertion.
	if (now.assertions >= old.assertions) {
		// Trailing closers dropped, so splitting `it('a', () => { expect(x).toBe(1); });` over
		// three lines reads as the same assertion.
		const assertion = (text) => {
			const match = language.line.assertions.exec(text);
			return match ? text.slice(match.index).replace(/[\s;,)}\]]+$/, '') : undefined;
		};
		const kept = new Set(diff.added.map((entry) => assertion(entry.text)));
		const rewritten = diff.removed.filter((entry) => {
			const part = assertion(entry.text);
			return part !== undefined && !kept.has(part);
		});
		if (rewritten.length > 0)
			findings.push({
				file,
				kind: 'assertions-rewritten',
				detail: `${rewritten.length} assertion ${rewritten.length === 1 ? 'line' : 'lines'} changed`,
				lines: rewritten.slice(0, MAX_QUOTED),
			});
	}
	if (now.exact !== undefined && now.exact < old.exact && now.loose > old.loose)
		findings.push({
			file,
			kind: 'matchers-loosened',
			detail: `exact matchers ${old.exact} → ${now.exact}, loose ${old.loose} → ${now.loose}`,
		});
	return { measures: { before: old, after: now }, findings };
}

/** The report for a branch: findings, per-language totals before and after, and the refs. */
export function reportTestChanges({
	root = process.cwd(),
	base = DEFAULT_BASE,
	head,
	register = DEFAULT_REGISTER,
	discoveryRegister = DEFAULT_DISCOVERY_REGISTER,
} = {}) {
	const git = gitRunner(root);
	let mergeBase;
	try {
		mergeBase = git(['merge-base', base, head ?? 'HEAD']).trim();
	} catch {
		throw new Error(
			`Cannot find a merge base between ${base} and ${head ?? 'HEAD'}. Fetch the base (git fetch origin main) or pass --base.`
		);
	}
	// A blob git cannot show (a submodule pointer) reads as absent rather than ending the report.
	const attempt = (load) => {
		try {
			return load();
		} catch {
			return undefined;
		}
	};
	const read = {
		before: (path) => attempt(() => git(['show', `${mergeBase}:${path}`])),
		after: (path) =>
			attempt(() =>
				head ? git(['show', `${head}:${path}`]) : readFileSync(resolve(root, path), 'utf8')
			),
	};
	const findings = [];
	const totals = {};
	let testFiles = 0;
	const tally = (name, measures) => {
		totals[name] ??= { files: 0, before: {}, after: {} };
		const total = totals[name];
		total.files += 1;
		for (const side of ['before', 'after'])
			for (const key of ['tests', 'assertions', 'skips'])
				total[side][key] = (total[side][key] ?? 0) + (measures[side]?.[key] ?? 0);
	};
	for (const change of changedFiles(git, mergeBase, head)) {
		const { status, from, to } = change;
		const added = status === 'A' || status === 'C'; // a new file or a copy only adds
		// Decide by path first, so a change to no test file reads nothing.
		const candidates = LANGUAGES.filter(
			(language) => language.owns(to) || (!added && language.owns(from))
		);
		const kind = /(^|\/)__snapshots__\/|\.snap$/.test(to)
			? 'snapshot-changed'
			: CONFIG.test(to) || RUNNER_CONFIG.test(to) || to === register || to === discoveryRegister
				? 'config-changed'
				: undefined;
		if (candidates.length === 0 && !kind) continue;
		const before = added ? undefined : read.before(from);
		const after = status === 'D' ? undefined : read.after(to);
		const texts = [before, after].filter((text) => text !== undefined);
		const language = candidates.find((candidate) => !candidate.holds || candidate.holds(texts));
		if (language) {
			testFiles += 1;
			if (added || before === undefined) {
				// New files enter the totals, so a test moved into one nets out. Only an
				// unconditional skip in one is a finding, since that test has never run; a
				// conditional one (`importorskip`, `skipIf`) runs where its condition holds.
				if (after === undefined) continue;
				const measures = { after: language.measure(after) };
				tally(language.name, measures);
				const born = measures.after.unconditional ?? measures.after.skips;
				if (born > 0)
					findings.push({
						file: to,
						kind: 'skip-added',
						detail: `new file with ${born} ${measures.after.unconditional === undefined ? '' : 'unconditional '}${born === 1 ? 'skip' : 'skips'}`,
						lines: after
							.split('\n')
							.map((text, index) => ({ line: index + 1, text: text.trim() }))
							.filter((entry) => language.line.skips.test(entry.text))
							.slice(0, MAX_QUOTED),
					});
				continue;
			}
			const diff = after === undefined ? undefined : diffLines(git, mergeBase, head, change);
			const result = compareTestFile(to, language, before, after, diff);
			if (status === 'R' && from !== to)
				for (const finding of result.findings) finding.file = `${from} → ${to}`;
			findings.push(...result.findings);
			tally(language.name, result.measures);
			continue;
		}
		// A new runner config is reported too: a new `conftest.py` can drop every test beside it.
		if (!kind) continue;
		const diff = after === undefined ? undefined : diffLines(git, mergeBase, head, change);
		// A snapshot that only gained entries lost nothing.
		if (kind === 'snapshot-changed' && diff && diff.removed.length === 0) continue;
		findings.push({
			file: to,
			kind: after === undefined ? 'deleted-file' : kind,
			detail:
				after === undefined
					? 'deleted'
					: added
						? `new, ${diff.added.length} lines`
						: `${diff.removed.length} lines removed, ${diff.added.length} added`,
			// What went, or else what came: an added `exclude` loosens as much as a removed include.
			lines:
				kind === 'config-changed' && diff
					? (diff.removed.length > 0 ? diff.removed : diff.added).slice(0, MAX_QUOTED)
					: undefined,
		});
	}
	return { base, mergeBase, head: head ?? 'working tree', testFiles, totals, findings };
}

const KIND_LABELS = {
	'deleted-file': 'Deleted',
	'fewer-tests': 'Fewer tests',
	'fewer-assertions': 'Fewer assertions',
	'skip-added': 'Skip added',
	'assertions-rewritten': 'Assertions changed',
	'matchers-loosened': 'Matchers loosened',
	'snapshot-changed': 'Snapshot changed',
	'config-changed': 'Test config changed',
};

/** The report as Markdown, for a pull request body or a reviewer's brief. */
export function formatReport(report) {
	const out = ['## Test changes', ''];
	const short = report.mergeBase.slice(0, 12);
	out.push(`Against ${report.base} (merge base ${short}), ${report.head}.`, '');
	if (report.findings.length === 0) {
		out.push(
			`Nothing found: no test file deleted, no test, assertion or skip count worse and no assertion line changed (${report.testFiles} test ${report.testFiles === 1 ? 'file' : 'files'} compared). The counts are lexical; read the test diffs too.`
		);
		return out.join('\n');
	}
	for (const finding of report.findings) {
		out.push(`- **${KIND_LABELS[finding.kind]}** \`${finding.file}\`: ${finding.detail}`);
		for (const { line, text } of finding.lines ?? [])
			out.push(`  - ${line}: \`${text.slice(0, 120)}\``);
	}
	const rows = Object.entries(report.totals);
	if (rows.length > 0) {
		out.push('', 'Totals over the changed and new test files (before → after):', '');
		for (const [name, { files, before, after }] of rows)
			out.push(
				`- ${name}, ${files} ${files === 1 ? 'file' : 'files'}: tests ${before.tests} → ${after.tests}, assertions ${before.assertions} → ${after.assertions}, skips ${before.skips} → ${after.skips}`
			);
	}
	out.push('', 'Each item needs a stated reason in the pull request; the reviewer checks it.');
	return out.join('\n');
}

/** Build a Health `schema_version = "1.0"` measures document from a test-change report. */
export function toMeasuresDocument(report, { source = 'test-change-report', target } = {}) {
	if (target !== undefined && !MEASURE_IDENTIFIER.test(target)) {
		throw new Error(`Invalid measure target identifier: ${target}`);
	}
	if (!MEASURE_IDENTIFIER.test(source)) {
		throw new Error(`Invalid measure source identifier: ${source}`);
	}
	const countKind = (...kinds) =>
		report.findings.filter((finding) => kinds.includes(finding.kind)).length;
	let testsNetDelta = 0;
	for (const [name, row] of Object.entries(report.totals ?? {})) {
		if (name === 'Scenario') continue;
		testsNetDelta += (row.after?.tests ?? 0) - (row.before?.tests ?? 0);
	}
	return {
		schema_version: MEASURES_SCHEMA_VERSION,
		source,
		...(target !== undefined ? { target } : {}),
		measures: [
			{
				key: 'test_change_findings',
				label: 'Test-change findings',
				value: report.findings.length,
				unit: 'findings',
				direction: 'lower_is_better',
			},
			{
				key: 'test_files_deleted',
				label: 'Deleted test files',
				value: countKind('deleted-file'),
				unit: 'files',
				direction: 'lower_is_better',
			},
			{
				key: 'test_fewer_tests_findings',
				label: 'Files with fewer tests',
				value: countKind('fewer-tests'),
				unit: 'files',
				direction: 'lower_is_better',
			},
			{
				key: 'test_skips_added',
				label: 'Skip-added findings',
				value: countKind('skip-added'),
				unit: 'findings',
				direction: 'lower_is_better',
			},
			{
				key: 'test_assertions_weakened',
				label: 'Weakened or rewritten assertion findings',
				value: countKind('fewer-assertions', 'assertions-rewritten', 'matchers-loosened'),
				unit: 'findings',
				direction: 'lower_is_better',
			},
			{
				key: 'test_configs_changed',
				label: 'Changed test configs or shrinking snapshots',
				value: countKind('config-changed', 'snapshot-changed'),
				unit: 'findings',
				direction: 'lower_is_better',
			},
			{
				key: 'test_files_changed',
				label: 'Changed test files compared',
				value: report.testFiles,
				unit: 'files',
				direction: 'neutral',
			},
			{
				key: 'tests_net_delta',
				label: 'Net test count change on branch',
				value: testsNetDelta,
				unit: 'tests',
				direction: 'higher_is_better',
			},
		],
	};
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
		else if (arg === '--base') options.base = requireValue(argv, i++, arg);
		else if (arg === '--head') options.head = requireValue(argv, i++, arg);
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

// Compare real paths: run through a symlinked skills folder, argv names the link while
// import.meta.url names the target, and a plain comparison would skip the report.
if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
	try {
		const options = parseArguments(process.argv.slice(2));
		const report = reportTestChanges(options);
		if (options.measuresOut) {
			const doc = toMeasuresDocument(report, { target: options.target });
			mkdirSync(dirname(options.measuresOut), { recursive: true });
			writeFileSync(options.measuresOut, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
		}
		console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
	} catch (cause) {
		console.error(cause instanceof Error ? cause.message : String(cause));
		process.exitCode = 2;
	}
}
