#!/usr/bin/env node
/**
 * Process check: each Factory Gateway milestone updates the files agents follow as it lands, and
 * no instruction file, skill, runbook, script, hook or MCP configuration goes around the gateway.
 *
 * Standard-tool-first: no standard tool knows which GitHub writes the gateway serves, or which
 * milestone ends each exemption, so this reads the files itself (Lushly's gate asks this line).
 *
 * Each repository keeps its own half of the process manifest (the proposal's "Keeping the process
 * current"): AFD's is docs/features/active/factory-gateway/process.json, Lushly's
 * Docs/operations/factory-gateway/process.json, and this script is the same file in both (Lushly
 * syncs it from AFD). It holds the door's patterns, so a sync carries them. Two checks:
 *
 * - The manifest. Each file a milestone lists must be tracked, landed or not, so that a rename
 *   fails until the manifest follows it. Once a milestone is `landed`, each must also name each of
 *   its `names`: ignoring case, as a word of its own, so that a path such as
 *   `scripts/issue-claim.mjs` does not name `issue-claim` and `though` does not name `gh`.
 * - The door. Every tracked file the `door.scope` globs match, less `door.exclude`, is searched
 *   for DOOR_PATTERNS (the GitHub writes the gateway serves, through the CLI, the REST API or
 *   GraphQL) and DOOR_ARGV_PATTERNS (the CLI's writes as an argument list, across lines too). A
 *   file with a write fails unless `door.allow` names it, with the milestone that removes the
 *   write (`until`), why it may write until then (`reason`) and the issue that removes it
 *   (`issue`). An allowed file fails once that milestone has landed.
 *
 * Exemptions expire: an allowed file that no longer holds a write, or is no longer tracked, fails
 * until its entry is deleted, and a scope glob that matches no tracked file fails, as does a scope
 * that reads no file, so a scan that finds nothing cannot pass by finding nothing.
 *
 * In code a write is what the code runs or tells an agent to run, so comments are left out:
 * `//` and block comments in JavaScript and TypeScript (regular expression literals are read as
 * code), `#` comments in Python, shell, YAML and TOML. Python's docstrings are read, since a
 * command's docstring is its description in the catalog agents read. Markdown and JSON are read
 * whole, and a file in UTF-16 is read by its byte-order mark. Not seen: a write built from pieces
 * (`['pr', verb]`), one through another name (an alias, a wrapper script), a `gh api` call to an
 * endpoint or with a method the patterns do not name, a GraphQL mutation named without `mutation`,
 * `gh api graphql` or its `(input:` beside it, a regular expression literal that follows a keyword
 * such as `return`, which reads as a division, and a tracked link whose target is missing, which
 * is skipped like a file deleted from the working tree.
 *
 * Usage: node scripts/check-process.mjs [--manifest <path>]
 *   (paths resolve from the cwd, which is the repository's root; the manifest defaults to AFD's)
 * Pure Node: no network, no dependency, nothing built.
 * Exit code 1 = problems found, each printed with its file and, for a write, its line.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MILESTONES = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5'];
const DEFAULT_MANIFEST = 'docs/features/active/factory-gateway/process.json';
/** An allow entry's issue: one GitHub issue, by its URL. */
const ISSUE_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/u;

/**
 * The GitHub writes the gateway serves, as text: the CLI's (`gh issue edit`, with `--repo`, any
 * spacing or backslash continuations), the REST API's writes (a write method, or fields without
 * `GET`, to the issue, pull, label, comment, check, status and variable endpoints) and GraphQL
 * mutations beside `mutation`, `gh api graphql` or `(input:`.
 */
export const DOOR_PATTERNS = [
	'\\bgh(?:[\\s\\\\]+(?:-R|--repo)(?:[\\s\\\\]+|=)\\S+)?[\\s\\\\]+issue[\\s\\\\]+(?:edit|comment|create)\\b',
	'\\bgh(?:[\\s\\\\]+(?:-R|--repo)(?:[\\s\\\\]+|=)\\S+)?[\\s\\\\]+pr[\\s\\\\]+(?:create|merge|edit|ready|comment)\\b',
	'\\bgh(?:[\\s\\\\]+(?:-R|--repo)(?:[\\s\\\\]+|=)\\S+)?[\\s\\\\]+variable[\\s\\\\]+set\\b',
	'\\bgh[\\s\\\\]+api\\b(?!(?:\\\\\\n|[^\\n;&|`])*\\s(?:-X\\s*|--method[\\s=])[Gg][Ee][Tt]\\b)(?=(?:\\\\\\n|[^\\n;&|`])*/(?:issues|pulls|labels|comments|assignees|check-runs|statuses|variables|merges)\\b)(?=(?:\\\\\\n|[^\\n;&|`])*\\s(?:-X\\s*|--method[\\s=])(?:[Pp][Oo][Ss][Tt]|[Pp][Aa][Tt][Cc][Hh]|[Pp][Uu][Tt]|[Dd][Ee][Ll][Ee][Tt][Ee])\\b|(?:\\\\\\n|[^\\n;&|`])*\\s(?:-[fF]|--field|--raw-field|--input)[\\s=])(?:\\\\\\n|[^\\n;&|`])*',
	'(?:\\bmutation\\b|\\bgh[\\s\\\\]+api[\\s\\\\]+graphql\\b)(?:\\\\\\n|[^\\n])*\\b(?:enqueuePullRequest|mergePullRequest|createPullRequest|updatePullRequest|markPullRequestReadyForReview|revertPullRequest|addLabelsToLabelable|removeLabelsFromLabelable|addAssigneesToAssignable|removeAssigneesFromAssignable|addComment|createIssue|updateIssue)\\b|\\b(?:enqueuePullRequest|mergePullRequest|createPullRequest|updatePullRequest|markPullRequestReadyForReview|revertPullRequest|addLabelsToLabelable|removeLabelsFromLabelable|addAssigneesToAssignable|removeAssigneesFromAssignable|addComment|createIssue|updateIssue)\\s*\\(\\s*input\\s*:',
];

/** The CLI's writes as an argument list (`['gh', 'pr', 'merge']`), across lines too. */
export const DOOR_ARGV_PATTERNS = [
	'["\'`]issue["\'`]\\s*,\\s*["\'`](?:edit|comment|create)["\'`]',
	'["\'`]pr["\'`]\\s*,\\s*["\'`](?:create|merge|edit|ready|comment)["\'`]',
	'["\'`]variable["\'`]\\s*,\\s*["\'`]set["\'`]',
];

const JS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.jsx']);
const HASH = new Set(['.sh', '.bash', '.zsh', '.yml', '.yaml', '.toml']);

/** A glob as a regular expression: `**` spans directories, `*` stays within one. */
export function globToRegExp(glob) {
	let source = '';
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === '*' && glob[i + 1] === '*') {
			i++;
			if (glob[i + 1] === '/') {
				i++;
				source += '(?:.*/)?';
			} else source += '.*';
		} else if (c === '*') source += '[^/]*';
		else if (c === '?') source += '[^/]';
		else source += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	}
	return new RegExp(`^${source}$`, 'u');
}

/** Blanks a range of the text, keeping its newlines so that line numbers still hold. */
const blank = (text) => text.replace(/[^\n]/g, ' ');

/** What can come before a regular expression literal, where a `/` cannot be a division. */
const REGEX_BEFORE = /^$|[(,=:[!&|?{};+\-*%<>~^]/u;

/** Whether a `/` after `before` opens a regular expression: not after `++` or `--`, a division. */
function regexCanStart(before) {
	const code = before.trimEnd();
	if (code.endsWith('++') || code.endsWith('--')) return false;
	return REGEX_BEFORE.test(code.at(-1) ?? '');
}

/** JavaScript and TypeScript without their comments. Strings, templates and regular expressions are kept. */
function maskJs(text) {
	let out = '';
	let i = 0;
	while (i < text.length) {
		const c = text[i];
		if (c === '/' && text[i + 1] === '/') {
			const end = text.indexOf('\n', i);
			const stop = end < 0 ? text.length : end;
			out += blank(text.slice(i, stop));
			i = stop;
		} else if (c === '/' && text[i + 1] === '*') {
			const end = text.indexOf('*/', i + 2);
			const stop = end < 0 ? text.length : end + 2;
			out += blank(text.slice(i, stop));
			i = stop;
		} else if (c === "'" || c === '"' || c === '`') {
			let j = i + 1;
			while (j < text.length && text[j] !== c) {
				if (text[j] === '\\') j++;
				else if (c !== '`' && text[j] === '\n') break;
				j++;
			}
			out += text.slice(i, j + 1);
			i = j + 1;
		} else if (c === '/' && regexCanStart(out)) {
			// A regular expression literal, kept whole, so that a `/*` or quote inside it opens
			// nothing. It ends at its first `/` outside a character class, on the same line.
			let j = i + 1;
			let inClass = false;
			while (j < text.length && text[j] !== '\n') {
				if (text[j] === '\\') j++;
				else if (text[j] === '[') inClass = true;
				else if (text[j] === ']') inClass = false;
				else if (text[j] === '/' && !inClass) break;
				j++;
			}
			if (text[j] === '/') {
				out += text.slice(i, j + 1);
				i = j + 1;
			} else {
				out += c;
				i++;
			}
		} else {
			out += c;
			i++;
		}
	}
	return out;
}

/** Python without its `#` comments. Strings, docstrings among them, are kept. */
function maskPython(text) {
	let out = '';
	let i = 0;
	while (i < text.length) {
		const c = text[i];
		if (c === '#') {
			const end = text.indexOf('\n', i);
			const stop = end < 0 ? text.length : end;
			out += blank(text.slice(i, stop));
			i = stop;
		} else if (c === "'" || c === '"') {
			const triple = text.startsWith(c.repeat(3), i);
			const quote = triple ? c.repeat(3) : c;
			let j = i + quote.length;
			while (j < text.length && !text.startsWith(quote, j)) {
				if (text[j] === '\\') j++;
				else if (!triple && text[j] === '\n') break;
				j++;
			}
			const stop = Math.min(text.length, j + quote.length);
			out += text.slice(i, stop);
			i = stop;
		} else {
			out += c;
			i++;
		}
	}
	return out;
}

/** Shell, YAML and TOML without their `#` comments (one that opens the line or follows a space). */
function maskHash(text) {
	return text
		.split('\n')
		.map((line) => {
			let quote = null;
			for (let i = 0; i < line.length; i++) {
				const c = line[i];
				if (quote) {
					if (c === '\\' && quote === '"') i++;
					else if (c === quote) quote = null;
				} else if (c === "'" || c === '"') quote = c;
				else if (c === '#' && (i === 0 || /\s/.test(line[i - 1])))
					return line.slice(0, i) + blank(line.slice(i));
			}
			return line;
		})
		.join('\n');
}

/** The text a file's writes are looked for in. */
export function searchable(path, text) {
	const ext = extname(path).toLowerCase();
	if (JS.has(ext)) return maskJs(text);
	if (ext === '.py') return maskPython(text);
	if (HASH.has(ext)) return maskHash(text);
	return text;
}

/** Each write in the text: `{ line, text }`, in order. */
export function writesIn(text, expressions) {
	const hits = [];
	for (const expression of expressions) {
		for (const match of text.matchAll(expression)) {
			const line = text.slice(0, match.index).split('\n').length;
			hits.push({ line, text: match[0].replace(/\s+/g, ' ') });
		}
	}
	return hits.sort((a, b) => a.line - b.line);
}

/** Keys a manifest may hold at each level; any other is a mistake, a version 1 leftover among them. */
const KEYS = {
	manifest: ['$comment', 'version', 'repo', 'milestones', 'door'],
	milestone: ['$comment', 'landed', 'files'],
	file: ['path', 'names'],
	door: ['$comment', 'scope', 'exclude', 'allow'],
	exclude: ['glob', 'reason'],
	allow: ['path', 'until', 'reason', 'issue'],
};

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim() !== '';

/** The manifest's own shape. Problems here stop the run: nothing below can be trusted. */
export function validateManifest(manifest) {
	const problems = [];
	const bad = (message) => problems.push(`manifest: ${message}`);
	const keys = (value, kind, where) => {
		for (const key of Object.keys(isObject(value) ? value : {})) {
			if (kind === 'door' && (key === 'patterns' || key === 'argvPatterns')) continue;
			if (!KEYS[kind].includes(key)) bad(`${where} has an unknown key ${JSON.stringify(key)}`);
		}
	};
	if (!isObject(manifest)) {
		bad('must be a JSON object');
		return problems;
	}
	keys(manifest, 'manifest', 'the manifest');
	if (manifest.version !== 2)
		bad("version must be 2: one repository's half, with the patterns in the checker");
	if (typeof manifest.repo !== 'string' || !/^[a-z][\w-]*$/u.test(manifest.repo))
		bad('repo must name the repository this half is for');
	const milestones = isObject(manifest.milestones) ? manifest.milestones : {};
	if (!isObject(manifest.milestones)) bad('milestones must be an object');
	// Every milestone, so that none drops out of the check unseen.
	for (const name of MILESTONES) {
		if (!Object.hasOwn(milestones, name)) bad(`milestones must hold ${name}`);
	}
	for (const [name, milestone] of Object.entries(milestones)) {
		if (!MILESTONES.includes(name)) bad(`unknown milestone ${name}`);
		keys(milestone, 'milestone', name);
		if (typeof milestone?.landed !== 'boolean') bad(`${name}.landed must be true or false`);
		if (!Array.isArray(milestone?.files)) bad(`${name}.files must be a list`);
		for (const [i, entry] of (Array.isArray(milestone?.files) ? milestone.files : []).entries()) {
			keys(entry, 'file', `${name}.files[${i}]`);
			const ok =
				text(entry?.path) &&
				Array.isArray(entry.names) &&
				entry.names.length > 0 &&
				entry.names.every(text);
			if (!ok) bad(`${name}.files[${i}] needs a path and at least one name`);
		}
	}
	const door = isObject(manifest.door) ? manifest.door : {};
	if (!isObject(manifest.door)) bad('door must be an object');
	keys(door, 'door', 'door');
	for (const key of ['patterns', 'argvPatterns']) {
		if (Object.hasOwn(door, key))
			bad(`door.${key} is not read: the patterns are DOOR_PATTERNS in scripts/check-process.mjs`);
	}
	const scope = door.scope;
	if (!Array.isArray(scope) || scope.length === 0 || !scope.every(text))
		bad("door.scope must list the globs this repository's door check reads");
	// An exclusion is an exemption that never names a milestone, so it says why, and fails once
	// it removes nothing (checkProcess).
	if (!Array.isArray(door.exclude)) bad('door.exclude must be a list');
	for (const [i, entry] of (Array.isArray(door.exclude) ? door.exclude : []).entries()) {
		keys(entry, 'exclude', `door.exclude[${i}]`);
		if (!text(entry?.glob)) bad(`door.exclude[${i}] needs a glob`);
		if (!text(entry?.reason)) bad(`door.exclude[${i}].reason must say why its files are not read`);
	}
	if (!Array.isArray(door.allow)) bad('door.allow must be a list');
	const seen = new Set();
	for (const [i, entry] of (Array.isArray(door.allow) ? door.allow : []).entries()) {
		keys(entry, 'allow', `door.allow[${i}]`);
		if (!text(entry?.path)) bad(`door.allow[${i}] needs a path`);
		// A milestone the manifest holds, so that it has a `landed` to flip and the entry can expire.
		if (!Object.hasOwn(milestones, entry?.until) || !MILESTONES.includes(entry?.until))
			bad(`door.allow[${i}].until must name a milestone in the manifest`);
		if (!text(entry?.reason))
			bad(`door.allow[${i}].reason must say why the file may write until then`);
		if (typeof entry?.issue !== 'string' || !ISSUE_URL.test(entry.issue))
			bad(`door.allow[${i}].issue must link the GitHub issue that removes the write`);
		if (seen.has(entry?.path)) bad(`door.allow names ${entry?.path} twice`);
		seen.add(entry?.path);
	}
	return problems;
}

/**
 * Whether the text names `name`: ignoring case, as a word of its own. A name inside a path or a
 * longer word (`scripts/issue-claim.mjs`, `issue-claims`, `though` for `gh`) does not count; one
 * joined by `-` or `_` (`factory-gateway`, `mcp__gateway__issue-claim`) does.
 */
export function names(text, name) {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(?<![\\p{L}\\p{N}/.])${escaped}(?![\\p{L}\\p{N}]|\\.\\w)`, 'iu').test(text);
}

/**
 * Both checks over `files`, the tracked paths, read through `read(path)`, which gives the text,
 * or null for a path that is a directory (a link to one) or missing from the working tree, and
 * throws when the file cannot be read. Returns the problems and what was read.
 */
export function checkProcess({ manifest, files, read }) {
	const problems = validateManifest(manifest);
	if (problems.length > 0) return { problems, scanned: 0, allowed: 0 };
	const tracked = new Set(files);
	const landed = (name) => manifest.milestones[name]?.landed === true;
	const textOf = (path) => {
		try {
			return read(path);
		} catch (error) {
			problems.push(`${path}: cannot be read (${error.code ?? error.message})`);
			return null;
		}
	};

	for (const [name, milestone] of Object.entries(manifest.milestones)) {
		for (const { path, names: required } of milestone.files) {
			if (!tracked.has(path)) {
				problems.push(
					`${path}: ${name} lists this file, which is not tracked: if it moved, list it by its new path`
				);
				continue;
			}
			if (!milestone.landed) continue;
			const text = textOf(path);
			if (text === null) {
				problems.push(`${path}: ${name} has landed and lists this file, which is not a file`);
				continue;
			}
			for (const n of required) {
				if (!names(text, n))
					problems.push(`${path}: ${name} has landed, so this file must name \`${n}\``);
			}
		}
	}

	const { door } = manifest;
	const scope = door.scope.map((glob) => ({ glob, test: globToRegExp(glob), read: 0 }));
	const exclude = door.exclude.map(({ glob }) => ({ glob, test: globToRegExp(glob), removed: 0 }));
	const inScope = (path) => scope.some(({ test }) => test.test(path));
	const expressions = [...DOOR_PATTERNS, ...DOOR_ARGV_PATTERNS].map((p) => new RegExp(p, 'gu'));
	const allow = new Map((door.allow ?? []).map((a) => [a.path, a.until]));
	const writers = new Set();
	let scanned = 0;
	let allowed = 0;
	for (const path of files) {
		if (!inScope(path)) continue;
		const excluding = exclude.filter((e) => e.test.test(path));
		for (const e of excluding) e.removed++;
		if (excluding.length > 0) continue;
		const text = textOf(path);
		if (text === null) continue;
		scanned++;
		for (const glob of scope) if (glob.test.test(path)) glob.read++;
		const hits = writesIn(searchable(path, text), expressions);
		if (hits.length === 0) continue;
		writers.add(path);
		const until = allow.get(path);
		if (until && !landed(until)) {
			allowed++;
			continue;
		}
		for (const hit of hits) {
			problems.push(
				until
					? `${path}:${hit.line}: \`${hit.text}\` was allowed until ${until}, which has landed: call the gateway's command instead`
					: `${path}:${hit.line}: \`${hit.text}\` is a GitHub write the factory gateway serves: call its command instead, or list the file in door.allow with the milestone that removes it`
			);
		}
	}
	for (const [path, until] of allow) {
		if (!tracked.has(path))
			problems.push(`${path}: door.allow lets it write until ${until}, but it is not tracked`);
		else if (!writers.has(path))
			problems.push(
				`${path}: door.allow lets it write until ${until}, but it holds no write the door refuses: delete its entry`
			);
	}
	// Each glob reads something and each exclusion removes something, so neither the scope nor
	// an exclusion can silence a directory unseen.
	for (const { glob, test, read } of scope) {
		if (!files.some((f) => test.test(f)))
			problems.push(`manifest: door.scope glob ${glob} matches no tracked file`);
		else if (read === 0)
			problems.push(
				`manifest: door.scope glob ${glob} reads no file: door.exclude removes each it matches, or none is a file`
			);
	}
	for (const { glob, removed } of exclude) {
		if (removed === 0)
			problems.push(`manifest: door.exclude glob ${glob} removes no file in door.scope: delete it`);
	}
	if (scanned === 0) problems.push('door: no file in door.scope was read');
	return { problems, scanned, allowed };
}

/** A file's text: UTF-16 by its byte-order mark, else UTF-8. A NUL reads as a space. */
export function decode(bytes) {
	let text;
	if (bytes[0] === 0xff && bytes[1] === 0xfe) text = bytes.subarray(2).toString('utf16le');
	else if (bytes[0] === 0xfe && bytes[1] === 0xff)
		text = Buffer.from(bytes.subarray(2)).swap16().toString('utf16le');
	else text = bytes.toString('utf8');
	return text.replaceAll('\0', ' ');
}

function main() {
	const args = process.argv.slice(2);
	const option = (name, fallback) => {
		const at = args.indexOf(name);
		return at >= 0 ? args[at + 1] : fallback;
	};
	const manifestPath = option('--manifest', DEFAULT_MANIFEST);
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	} catch (error) {
		console.error(
			`process: cannot read the manifest ${manifestPath} (${error.code ?? error.message}); pass this repository's with --manifest`
		);
		process.exit(2);
	}
	// The half must be this repository's: its `repo` names the origin remote's repository.
	const remote = spawnSync('git', ['config', '--get', 'remote.origin.url'], { encoding: 'utf8' });
	const origin = remote.stdout
		?.trim()
		.replace(/\/+$/u, '')
		.replace(/\.git$/u, '');
	const repo = typeof manifest?.repo === 'string' ? manifest.repo.toLowerCase() : null;
	if (origin && repo && !origin.toLowerCase().endsWith(`/${repo}`)) {
		console.error(
			`process: ${manifestPath} is ${manifest.repo}'s half, but this repository is ${origin}`
		);
		process.exit(1);
	}
	const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 })
		.split('\0')
		.filter(Boolean);
	const read = (path) => {
		let bytes;
		try {
			bytes = readFileSync(join(process.cwd(), path));
		} catch (error) {
			if (error.code === 'EISDIR' || error.code === 'ENOENT') return null;
			throw error;
		}
		return decode(bytes);
	};
	const { problems, scanned, allowed } = checkProcess({ manifest, files, read });
	if (problems.length > 0) {
		for (const problem of problems) console.error(problem);
		console.error(`process: ${problems.length} problem(s); the rules are in ${manifestPath}`);
		process.exit(1);
	}
	console.log(
		`process: ${manifest.repo}'s half: ${scanned} files read; ${allowed} hold GitHub writes allowed until their milestone`
	);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
