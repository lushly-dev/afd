#!/usr/bin/env node
/**
 * Process check: each Factory Gateway milestone updates the files agents follow as it lands, and
 * no instruction file, skill, runbook, script, hook or MCP configuration goes around the gateway.
 *
 * The manifest, docs/features/active/factory-gateway/process.json, is shared by AFD and Lushly
 * (the proposal's "Keeping the process current"). This runs both of its checks for one of them:
 *
 * - The manifest. Once a milestone is `landed`, each file it lists for this repository must exist
 *   and name each of its `names`: ignoring case, as a word of its own, so that a path such as
 *   `scripts/issue-claim.mjs` does not name `issue-claim` and `though` does not name `gh`.
 * - The door. Every tracked file the repository's `door.scope` globs match, less `door.exclude`,
 *   is searched for the `door.patterns` (the GitHub writes the gateway serves, through the CLI,
 *   the REST API or GraphQL) and the `door.argvPatterns` (the CLI's writes as an argument list,
 *   across lines too). A file with a
 *   write fails unless `door.allow` names it, and an allowed file fails once the milestone in its
 *   `until` has landed.
 *
 * Exemptions expire: an allowed file that no longer holds a write, or is no longer tracked, fails
 * until its entry is deleted, and a scope glob that matches no tracked file fails, so a scan that
 * finds nothing cannot pass by finding nothing.
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
 * Usage: node scripts/check-process.mjs [--manifest <path>] [--repo afd|lushly]
 *   (paths resolve from the cwd, which is the repository's root)
 * Exit code 1 = problems found, each printed with its file and, for a write, its line.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MILESTONES = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5'];
const REPOS = ['afd', 'lushly'];
const DEFAULT_MANIFEST = 'docs/features/active/factory-gateway/process.json';

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

/** The manifest's own shape. Problems here stop the run: nothing below can be trusted. */
export function validateManifest(manifest, repo) {
	const problems = [];
	const bad = (message) => problems.push(`manifest: ${message}`);
	if (manifest?.version !== 1) bad('version must be 1');
	const milestones = manifest?.milestones ?? {};
	for (const [name, milestone] of Object.entries(milestones)) {
		if (!MILESTONES.includes(name)) bad(`unknown milestone ${name}`);
		if (typeof milestone?.landed !== 'boolean') bad(`${name}.landed must be true or false`);
		for (const r of REPOS) {
			for (const [i, entry] of (milestone?.[r] ?? []).entries()) {
				const ok =
					typeof entry?.path === 'string' &&
					Array.isArray(entry.names) &&
					entry.names.length > 0 &&
					entry.names.every((n) => typeof n === 'string' && n.trim() !== '');
				if (!ok) bad(`${name}.${r}[${i}] needs a path and at least one name`);
			}
		}
	}
	const door = manifest?.door ?? {};
	for (const key of ['patterns', 'argvPatterns', 'exclude']) {
		if (!Array.isArray(door[key]) || door[key].some((p) => typeof p !== 'string'))
			bad(`door.${key} must be a list of strings`);
	}
	for (const pattern of [...(door.patterns ?? []), ...(door.argvPatterns ?? [])]) {
		try {
			new RegExp(pattern, 'u');
		} catch (error) {
			bad(`door pattern ${JSON.stringify(pattern)} does not compile: ${error.message}`);
		}
	}
	if (!(door.patterns?.length > 0)) bad('door.patterns is empty, so nothing would be refused');
	const scope = door.scope?.[repo];
	if (!Array.isArray(scope) || scope.length === 0 || scope.some((g) => typeof g !== 'string'))
		bad(`door.scope.${repo} must list the globs this repository's door check reads`);
	const seen = new Set();
	for (const [i, entry] of (door.allow ?? []).entries()) {
		if (!REPOS.includes(entry?.repo)) bad(`door.allow[${i}].repo must be one of ${REPOS}`);
		if (typeof entry?.path !== 'string') bad(`door.allow[${i}] needs a path`);
		// A milestone the manifest holds, so that it has a `landed` to flip and the entry can expire.
		if (!Object.hasOwn(milestones, entry?.until) || !MILESTONES.includes(entry?.until))
			bad(`door.allow[${i}].until must name a milestone in the manifest`);
		const key = `${entry?.repo}:${entry?.path}`;
		if (seen.has(key)) bad(`door.allow names ${key} twice`);
		seen.add(key);
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
export function checkProcess({ manifest, repo, files, read }) {
	const problems = validateManifest(manifest, repo);
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
		if (!milestone.landed) continue;
		for (const { path, names: required } of milestone[repo] ?? []) {
			if (!tracked.has(path)) {
				problems.push(`${path}: ${name} has landed and lists this file, which is not tracked`);
				continue;
			}
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
	const scope = door.scope[repo].map((glob) => ({ glob, test: globToRegExp(glob) }));
	const exclude = door.exclude.map(globToRegExp);
	for (const { glob, test } of scope) {
		if (!files.some((f) => test.test(f)))
			problems.push(`manifest: door.scope.${repo} glob ${glob} matches no tracked file`);
	}
	const expressions = [...door.patterns, ...door.argvPatterns].map((p) => new RegExp(p, 'gu'));
	const allow = new Map(
		(door.allow ?? []).filter((a) => a.repo === repo).map((a) => [a.path, a.until])
	);
	const writers = new Set();
	let scanned = 0;
	let allowed = 0;
	for (const path of files) {
		if (!scope.some(({ test }) => test.test(path)) || exclude.some((e) => e.test(path))) continue;
		const text = textOf(path);
		if (text === null) continue;
		scanned++;
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
	if (scanned === 0) problems.push(`door: no file in door.scope.${repo} was read`);
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
	const repo = option('--repo', 'afd');
	if (!REPOS.includes(repo)) {
		console.error(`process: --repo must be one of ${REPOS.join(', ')}`);
		process.exit(2);
	}
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
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
	const { problems, scanned, allowed } = checkProcess({ manifest, repo, files, read });
	if (problems.length > 0) {
		for (const problem of problems) console.error(problem);
		console.error(`process: ${problems.length} problem(s); the rules are in ${manifestPath}`);
		process.exit(1);
	}
	console.log(
		`process: ${scanned} files read; ${allowed} hold GitHub writes allowed until their milestone`
	);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
