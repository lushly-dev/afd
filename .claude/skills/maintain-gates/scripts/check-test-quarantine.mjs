#!/usr/bin/env node
/**
 * No silent test suppression, in any JavaScript or TypeScript test file git tracks.
 *
 * Without a quarantine, the answers to a red test are "block everyone" or "skip it and
 * forget", and agents pick the second. This makes suppression loud and self-retiring:
 *
 * - `.only` always fails: a focus left behind shrinks the suite to one case.
 * - An unconditional `.skip` or `.todo` on `describe`, `it`, `test`, `suite` or `bench`
 *   needs an entry in the register (default `scripts/policy/test-quarantine.json`) naming
 *   the file, an owner, a reason of at least 20 characters and a tracking issue.
 * - Reconciliation runs both ways: an entry whose file has no unconditional skip left
 *   fails as recovered, so a spent entry is deleted rather than left to cover the next one.
 * - A scan that finds no test file fails: the scanner stopped seeing the suite it guards.
 *
 * Conditional skips are allowed, because they run again whenever their condition stops
 * holding: `it.skipIf(cond)`, `it.runIf(cond)` and Playwright's `test.skip(cond, reason)`,
 * whose first argument is an expression rather than a title. `test.skip('title', fn)`,
 * `test.skip()` and `it.todo(...)` are unconditional. A condition covers only itself: in
 * `it.runIf(key).only(...)` or `it.skipIf(cond).concurrent.skip(...)` the later modifier counts.
 *
 * Not covered, by design: aliases (`const s = it.skip`), element access (`it['skip']`),
 * option objects (`{ skip: true }`) and a test's own context (`t.skip()`, `ctx.skip()`).
 * Python, Rust and other languages' skips are outside this scan.
 *
 * Needs only Node and git. Usage:
 *   node check-test-quarantine.mjs [--root <dir>] [--register <path>] [<path>...]
 * Paths limit the scan to those directories; the register path is relative to the root.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_REGISTER = 'scripts/policy/test-quarantine.json';
export const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const ROOTS = new Set(['describe', 'it', 'test', 'suite', 'bench']);
const SUPPRESSIONS = new Set(['only', 'skip', 'todo', 'fixme']);
/** A path as git prints it: forward slashes, no leading `./`, no trailing slash. */
const gitPath = (path) =>
	path
		.replaceAll('\\', '/')
		.replace(/^(\.\/)+/, '')
		.replace(/\/+$/, '');

/** Test files git tracks or would track under `root`, limited to `paths` when given. */
export function listTestFiles(root, paths = []) {
	const env = { ...process.env };
	for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
	const output = execFileSync(
		'git',
		['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...paths],
		{ cwd: root, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 }
	);
	return output.split('\0').filter((file) => file && TEST_FILE.test(file));
}

/**
 * The source with every comment blanked and every string, template and regular expression
 * literal's contents blanked (delimiters kept), so offsets and lines are unchanged and only
 * code can match.
 */
export function maskSource(text) {
	const out = text.split('');
	const blank = (from, to) => {
		for (let i = from; i < to; i++) if (out[i] !== '\n') out[i] = ' ';
	};
	let i = 0;
	// The last significant code token, to tell a regular expression from a division: a word,
	// `)`, `]` or a closing literal ends an operand (`x`), unless the word is a keyword after
	// which an expression starts; postfix `++` and `--` end one too.
	let previous = '';
	const regexMayFollow = () => previous !== 'x' && previous !== '++' && previous !== '--';
	const EXPRESSION_KEYWORDS = new Set([
		'return',
		'typeof',
		'instanceof',
		'in',
		'of',
		'new',
		'delete',
		'void',
		'throw',
		'case',
		'do',
		'else',
		'yield',
		'await',
	]);

	function skipString(quote) {
		const start = i;
		i++;
		while (i < text.length && text[i] !== quote && text[i] !== '\n') {
			if (text[i] === '\\') i++;
			i++;
		}
		blank(start + 1, i);
		i++;
	}

	function skipTemplate() {
		const start = i;
		i++;
		while (i < text.length && text[i] !== '`') {
			if (text[i] === '\\') {
				i += 2;
				continue;
			}
			if (text[i] === '$' && text[i + 1] === '{') {
				i += 2;
				scanCode('}');
				continue;
			}
			i++;
		}
		blank(start + 1, i);
		i++;
	}

	function skipRegex() {
		const start = i;
		i++;
		let inClass = false;
		while (i < text.length && text[i] !== '\n') {
			const c = text[i];
			if (c === '\\') {
				i += 2;
				continue;
			}
			if (c === '[') inClass = true;
			else if (c === ']') inClass = false;
			else if (c === '/' && !inClass) break;
			i++;
		}
		blank(start + 1, i);
		i++;
	}

	/** Scans code until the unmatched `close` (or the end), consuming it. */
	function scanCode(close) {
		let depth = 0;
		while (i < text.length) {
			const c = text[i];
			const next = text[i + 1];
			if (c === '/' && next === '/') {
				const end = text.indexOf('\n', i);
				const stop = end === -1 ? text.length : end;
				blank(i, stop);
				i = stop;
			} else if (c === '/' && next === '*') {
				const end = text.indexOf('*/', i + 2);
				const stop = end === -1 ? text.length : end + 2;
				blank(i, stop);
				i = stop;
			} else if (c === '"' || c === "'") {
				skipString(c);
				previous = 'x';
			} else if (c === '`') {
				skipTemplate();
				previous = 'x';
			} else if (c === '/' && regexMayFollow()) {
				skipRegex();
				previous = 'x';
			} else {
				if (c === '{') depth++;
				if (c === '}') {
					if (depth === 0 && close === '}') {
						i++;
						return;
					}
					depth--;
				}
				if (/[\p{L}_$]/u.test(c)) {
					const word = /^[\p{L}\p{N}_$]+/u.exec(text.slice(i, i + 64))[0];
					// A property named like a keyword (`x.in`, `obj.return`) is an operand.
					let before = i - 1;
					while (before >= 0 && /\s/.test(out[before])) before--;
					const property = before >= 0 && out[before] === '.';
					previous = EXPRESSION_KEYWORDS.has(word) && !property ? word : 'x';
					i += word.length;
					continue;
				}
				if ((c === '+' || c === '-') && next === c) {
					previous = previous === 'x' ? `${c}${c}` : c; // postfix ends an operand
					i += 2;
					continue;
				}
				if (!/\s/.test(c)) previous = /[\w$)\]]/.test(c) ? 'x' : c;
				i++;
			}
		}
	}

	scanCode(null);
	return out.join('');
}

/** The trimmed top-level arguments of the call whose `(` is at `open` in masked code. */
function callArguments(code, open) {
	const args = [];
	let depth = 0;
	let start = open + 1;
	for (let i = open + 1; i < code.length; i++) {
		const c = code[i];
		if (c === '(' || c === '[' || c === '{') depth++;
		else if (c === ',' && depth === 0) {
			args.push(code.slice(start, i).trim());
			start = i + 1;
		} else if (c === ')' || c === ']' || c === '}') {
			if (depth > 0) {
				depth--;
				continue;
			}
			const last = code.slice(start, i).trim();
			if (last || args.length > 0) args.push(last);
			break;
		}
	}
	return args;
}

/** The index of the bracket closing the one at `open` in masked code, or -1. */
function closingBracket(code, open) {
	let depth = 0;
	for (let i = open; i < code.length; i++) {
		const c = code[i];
		if (c === '(' || c === '[' || c === '{') depth++;
		else if ((c === ')' || c === ']' || c === '}') && --depth === 0) return i;
	}
	return -1;
}

// After a condition's call, `?.` reads as `.` does: `it.runIf(key)?.only(...)`.
const MEMBER = /\??\.\s*([A-Za-z_$][\w$]*)/g;
const MEMBERS = /^(?:\s*\??\.\s*[A-Za-z_$][\w$]*)+/;
const CONDITIONS = new Set(['skipIf', 'runIf']);

/**
 * The members of a chain and where it ends. A condition's call does not end it: in
 * `it.runIf(key).only(...)` the chain reads on past `runIf(key)`, so a later `.only`, `.skip`
 * or `.todo` counts as it would without the condition.
 */
function chainMembers(code, offset, segment) {
	const members = [];
	for (;;) {
		for (const member of segment.matchAll(MEMBER))
			members.push({
				kind: member[1],
				at: offset + member.index + member[0].length - member[1].length,
			});
		const end = offset + segment.length;
		if (!CONDITIONS.has(members.at(-1).kind)) return { members, end };
		const call = code.slice(end).match(/^\s*\(/);
		const close = call ? closingBracket(code, end + call[0].length - 1) : -1;
		const rest = close === -1 ? null : code.slice(close + 1).match(MEMBERS);
		if (!rest) return { members, end };
		offset = close + 1;
		segment = rest[0];
	}
}

/** Whether a `.skip(...)` call skips unconditionally (a declaration or a bare runtime skip). */
const ALWAYS = /^\(*\s*(true|1|!0|!false)\s*\)*$/;
const NEVER = /^\(*\s*(false|0|!1|!true|null|undefined)\s*\)*$/;

function unconditionalSkip(args) {
	if (args.length === 0) return true;
	if (/^['"`]/.test(args[0])) return true; // a title: `it.skip('title', fn)`
	if (ALWAYS.test(args[0])) return true; // a condition that always holds
	// A variable title still declares a test when a function follows.
	return args.slice(1).some((arg) => /=>|^(async\s+)?function\b/.test(arg));
}

/** `{ line, kind }` for each `.only`, and each unconditional `.skip` or `.todo`, in a file. */
export function findSuppressions(text) {
	const code = maskSource(text);
	const found = [];
	const chain = /(?<![\w$.])([A-Za-z_$][\w$]*)((?:\s*\.\s*[A-Za-z_$][\w$]*)+)/g;
	const lineAt = (position) => code.slice(0, position).split('\n').length;
	for (const match of code.matchAll(chain)) {
		if (!ROOTS.has(match[1])) continue;
		const { members, end } = chainMembers(code, match.index + match[1].length, match[2]);
		members.forEach(({ kind, at }, index) => {
			if (CONDITIONS.has(kind)) {
				// A condition that is a literal decides once and for all: `it.skipIf(true)`.
				const after = at + kind.length;
				const call = code.slice(after).match(/^\s*\(/);
				const first = call ? callArguments(code, after + call[0].length - 1)[0] : undefined;
				if (first !== undefined && (kind === 'skipIf' ? ALWAYS : NEVER).test(first))
					found.push({ line: lineAt(at), kind: 'skip' });
				return;
			}
			if (!SUPPRESSIONS.has(kind)) return;
			const line = lineAt(at);
			const last = index === members.length - 1;
			const skipLike = kind === 'skip' || kind === 'fixme'; // Playwright's fixme skips too
			if (!skipLike || !last) {
				// `.only` and `.todo` anywhere; a skip inside a chain (`describe.skip.each`).
				found.push({ line, kind });
				return;
			}
			// A call, possibly with type arguments: `test.skip<Fixtures>(...)`.
			const call = code.slice(end).match(/^\s*(?:<[^()]*?>\s*)?\(/);
			// A skip that is not called is a reference (`cond ? describe : describe.skip`).
			if (call && unconditionalSkip(callArguments(code, end + call[0].length - 1)))
				found.push({ line, kind });
		});
	}
	return found;
}

export function loadRegister(root, registerPath) {
	const path = resolve(root, registerPath);
	if (!existsSync(path)) return { entries: new Map(), issues: [`${registerPath} is missing.`] };
	const issues = [];
	const entries = new Map();
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(path, 'utf8'));
	} catch (cause) {
		return { entries, issues: [`${registerPath} is not valid JSON: ${cause.message}`] };
	}
	for (const entry of parsed.quarantined ?? []) {
		const { file, owner, reason, issue } = entry ?? {};
		const text = (value) => typeof value === 'string' && value.trim() !== '';
		if (!text(file) || !text(owner) || !text(reason) || reason.trim().length < 20 || !text(issue)) {
			issues.push(
				`${registerPath}: malformed entry ${JSON.stringify(entry)}; it needs file, owner, a reason of at least 20 characters and a tracking issue.`
			);
			continue;
		}
		const key = gitPath(file);
		if (entries.has(key)) issues.push(`${registerPath}: ${file} is listed twice.`);
		entries.set(key, entry);
	}
	return { entries, issues };
}

export function checkTestQuarantine({
	root = process.cwd(),
	register = DEFAULT_REGISTER,
	paths: given = [],
} = {}) {
	const paths = given.map(gitPath);
	const quarantine = loadRegister(root, register);
	const issues = [...quarantine.issues];
	const suppressed = new Set();
	const files = listTestFiles(root, paths);
	for (const file of files) {
		let text;
		try {
			text = readFileSync(resolve(root, file), 'utf8');
		} catch {
			continue; // listed by git but deleted in the working tree
		}
		for (const { line, kind } of findSuppressions(text)) {
			if (kind === 'only') {
				issues.push(
					`${file}:${line} uses .only; remove the focus, which silently shrinks the suite.`
				);
				continue;
			}
			suppressed.add(file);
			if (!quarantine.entries.has(file))
				issues.push(
					`${file}:${line} uses .${kind} with no quarantine entry. Make it conditional (skipIf, runIf) if it depends on the environment, or add {file, owner, reason, issue} to ${register}.`
				);
		}
	}
	const scanned = new Set(files);
	for (const file of quarantine.entries.keys()) {
		const inScope =
			paths.length === 0 || paths.some((path) => file === path || file.startsWith(`${path}/`));
		if (inScope && !suppressed.has(file))
			issues.push(
				scanned.has(file)
					? `${register}: ${file} has no unconditional .skip or .todo left; it recovered, so delete the entry (and close its issue if it was the last).`
					: `${register}: ${file} is not a test file git lists; delete or correct the entry.`
			);
	}
	if (files.length === 0)
		issues.push('The scan found no test file: it stopped seeing the suite it guards.');
	return { files: files.length, quarantined: quarantine.entries.size, issues };
}

function parseArguments(argv) {
	const options = { paths: [] };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--root') options.root = resolve(argv[++i]);
		else if (argv[i] === '--register') options.register = argv[++i];
		else options.paths.push(argv[i]);
	}
	return options;
}

// Compare real paths: run through a symlinked skills folder, argv names the link while
// import.meta.url names the target, and a plain comparison would skip the check and exit 0.
if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
	try {
		const { files, quarantined, issues } = checkTestQuarantine(
			parseArguments(process.argv.slice(2))
		);
		if (issues.length > 0) {
			console.error(`Test quarantine check failed with ${issues.length} issue(s):`);
			for (const issue of issues) console.error(`- ${issue}`);
			process.exitCode = 1;
		} else {
			console.log(
				`Test quarantine check passed: ${files} test files, ${quarantined} quarantined, no unexplained suppression.`
			);
		}
	} catch (cause) {
		console.error(cause instanceof Error ? cause.message : String(cause));
		process.exitCode = 1;
	}
}
