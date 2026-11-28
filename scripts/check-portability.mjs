#!/usr/bin/env node
/**
 * Portability check: machine-specific paths, and package managers started in a way that fails on
 * Windows. One source for AFD and Lushly (#2834): canonical here, mirrored into Botcore's seeded
 * `gate-discipline` skill, with each repository's own scope in a config file.
 *
 * Errors:
 * - Windows drive-letter absolute paths (D:\..., C:\...)
 * - User-home absolute paths (C:\Users\name, /home/name, /Users/name)
 * - A package manager started by bare name without a shell (`execFileSync('pnpm', ...)`):
 *   Windows installs it as a `.cmd` shim, so the call fails there with ENOENT.
 *
 * Warnings:
 * - Hardcoded localhost URLs (allowed in the files `localhostAllowed` names)
 *
 * Escape hatch: `// portability-ok: reason` on the same line or the line before. Comment lines are
 * not scanned for paths unless the config says `comments: "scan"`.
 *
 * Usage:
 *   node check-portability.mjs [--root <dir>] [--config <file>] [<file>...]
 * The root defaults to the current directory. Without files it scans every file git lists (tracked,
 * and untracked but not ignored), or every file under the root outside git, and refuses a scan
 * that finds none. The config, JSON, defaults to `scripts/policy/portability.json` under the root
 * when that exists:
 *   include          path prefixes (or files) to scan; every path when absent
 *   exclude          path prefixes (or files) never scanned
 *   skipSegments     directory names skipped wherever they appear (node_modules, dist, ...)
 *   extensions       file extensions scanned
 *   markdown         "skip" (the default) or "scan": whether Markdown is checked for paths
 *   comments         "skip" (the default) or "scan": whether `//` and block-comment lines are
 *                    checked for paths
 *   localhostAllowed file names whose localhost URLs are allowed
 *   spawnSuggestion  what the package-manager finding tells the author to use instead
 * Explicit files take the same filters, so a hook can pass its staged files.
 *
 * Needs only Node, and git for the default scan. Exit 0 clean (warnings allowed), 1 an error
 * found or nothing to scan, 2 a bad argument or config.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CONFIG = Object.freeze({
	include: [],
	exclude: [],
	skipSegments: ['node_modules', 'dist', 'coverage', 'target', '.git'],
	extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.yaml', '.yml', '.toml'],
	markdown: 'skip',
	comments: 'skip',
	localhostAllowed: ['vite.config.ts', 'vitest.config.ts'],
	spawnSuggestion:
		"Pass a shell on Windows (`shell: process.platform === 'win32'`) with fixed arguments, or use the repository's spawn helper; a call that already does takes a portability-ok comment.",
});
const CONFIG_PATH = 'scripts/policy/portability.json';
const SELF = 'check-portability.mjs';

const ESCAPE_HATCH = /portability-ok\s*:/i;
const SCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|\*\/)/;
// Matched over the whole file, so a call whose command is on the next line is caught too.
const BARE_SHIM_SPAWN =
	/\b(?:execFileSync|execFile|spawnSync|spawn)\(\s*['"`](?:pnpm|npm|npx|pnpx|corepack|yarn)['"`]/g;
const PATTERNS = [
	{
		id: 'windows-drive-path',
		severity: 'error',
		regex: /(?:^|[\s"'`(=])([A-Za-z]:\\[^'"`\s)]+)/g,
		message: 'Windows absolute path detected',
		suggestion: 'Use repo-relative paths or aliases instead of machine-specific drive paths.',
	},
	{
		id: 'windows-user-home',
		severity: 'error',
		regex: /C:\\Users\\[^\\'"`\s)]+/gi,
		message: 'Windows user-home absolute path detected',
		suggestion: 'Use environment variables or relative paths instead of user profile paths.',
	},
	{
		id: 'unix-user-home',
		severity: 'error',
		regex: /(?:^|[\s"'`(=])(\/home\/[A-Za-z0-9._-]+(?:\/|\b))/g,
		message: 'Unix home-directory absolute path detected',
		suggestion: 'Use relative paths or environment variables instead of home-directory paths.',
	},
	{
		id: 'mac-user-home',
		severity: 'error',
		regex: /(?:^|[\s"'`(=])(\/Users\/[A-Za-z0-9._-]+(?:\/|\b))/g,
		message: 'macOS user-directory absolute path detected',
		suggestion: 'Use relative paths or environment variables instead of user-directory paths.',
	},
	{
		id: 'localhost-url',
		severity: 'warn',
		regex: /http:\/\/localhost:\d{4,5}/g,
		message: 'Hardcoded localhost URL detected',
		suggestion:
			'Prefer configurable base URLs or documented setup defaults to avoid environment coupling.',
	},
];

const posix = (path) => path.replace(/\\/g, '/');

/** The config with defaults filled in; throws on a key or value it does not know. */
export function resolveConfig(raw = {}) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw))
		throw new Error('the config must be a JSON object');
	for (const key of Object.keys(raw))
		if (!(key in DEFAULT_CONFIG) && key !== '$comment')
			throw new Error(`unknown config key ${key}`);
	const config = { ...DEFAULT_CONFIG, ...raw };
	for (const key of ['include', 'exclude', 'skipSegments', 'extensions', 'localhostAllowed'])
		if (!Array.isArray(config[key]) || config[key].some((item) => typeof item !== 'string'))
			throw new Error(`${key} must be a list of strings`);
	for (const key of ['markdown', 'comments'])
		if (!['skip', 'scan'].includes(config[key])) throw new Error(`${key} must be "skip" or "scan"`);
	if (typeof config.spawnSuggestion !== 'string' || !config.spawnSuggestion)
		throw new Error('spawnSuggestion must be a string');
	return config;
}

const under = (path, prefix) =>
	prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`);

/** Whether the config scans this root-relative, `/`-separated path. */
export function isScanned(path, config) {
	if (basename(path) === SELF) return false;
	if (!config.extensions.includes(extname(path))) return false;
	if (config.include.length > 0 && !config.include.some((prefix) => under(path, prefix)))
		return false;
	if (config.exclude.some((prefix) => under(path, prefix))) return false;
	return !path
		.split('/')
		.slice(0, -1)
		.some((segment) => config.skipSegments.includes(segment));
}

function walk(root, dir = root, out = []) {
	let entries = [];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== '.git') walk(root, full, out);
		} else if (entry.isFile()) out.push(posix(relative(root, full)));
	}
	return out;
}

/** Every file git lists under the root, tracked or untracked but not ignored; null outside git. */
function gitFiles(root) {
	try {
		const out = execFileSync(
			'git',
			['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
			{
				cwd: root,
				encoding: 'utf8',
				maxBuffer: 256 * 1024 * 1024,
				stdio: ['ignore', 'pipe', 'ignore'],
			}
		);
		return out.split('\0').filter(Boolean);
	} catch {
		return null;
	}
}

/**
 * Scans text for findings: `{ line, severity, message, excerpt, suggestion }` each, in line order.
 * @param {string} path root-relative, `/`-separated, used for the per-file rules
 */
export function scanText(path, content, config) {
	const findings = [];
	const lines = content.split(/\r?\n/);
	const add = (index, pattern) =>
		findings.push({
			line: index + 1,
			severity: pattern.severity,
			message: pattern.message,
			excerpt: lines[index].trim().slice(0, 140),
			suggestion: pattern.suggestion,
		});
	const ext = extname(path);
	if (SCRIPT_EXTENSIONS.has(ext))
		for (const match of content.matchAll(BARE_SHIM_SPAWN)) {
			const index = content.slice(0, match.index).split('\n').length - 1;
			const prev = index > 0 ? lines[index - 1] : '';
			if (
				COMMENT_LINE.test(lines[index]) ||
				ESCAPE_HATCH.test(lines[index]) ||
				ESCAPE_HATCH.test(prev)
			)
				continue;
			// A call that sets a truthy `shell` (such as `shell: process.platform === 'win32'` or
			// `shell: true`) starts the shim; explicit `shell: false` (or falsy) fails like omitted.
			if (hasEnabledShellOption(maskCallExpression(content, content.indexOf('(', match.index))))
				continue;
			add(index, {
				severity: 'error',
				message:
					'Package manager started without a shell (ENOENT on Windows, where it is a .cmd shim)',
				suggestion: config.spawnSuggestion,
			});
		}
	if (ext === '.md' && config.markdown === 'skip') return sortFindings(findings);
	const localhostOk = config.localhostAllowed.includes(basename(path));
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const prev = i > 0 ? lines[i - 1] : '';
		if (ext !== '.md' && config.comments === 'skip' && COMMENT_LINE.test(line)) continue;
		if (ESCAPE_HATCH.test(line) || ESCAPE_HATCH.test(prev)) continue;
		for (const pattern of PATTERNS) {
			if (pattern.id === 'localhost-url' && localhostOk) continue;
			pattern.regex.lastIndex = 0;
			if (pattern.regex.test(line)) add(i, pattern);
		}
	}
	return sortFindings(findings);
}

const sortFindings = (findings) => findings.sort((a, b) => a.line - b.line);

const FALSY_SHELL = /^(?:false|undefined|null|0|!1|!true|''|""|``)$/;

/**
 * Extracts one balanced `(...)` call starting at `openParen`, masking comments to spaces and
 * replacing non-empty string literals with `'_'` (and empty ones with `''`) so `shell:` inside
 * comments or CLI argument strings cannot mask a missing shell option.
 */
function maskCallExpression(content, openParen) {
	let out = '';
	let depth = 0;
	for (let i = openParen; i < content.length; i++) {
		const ch = content[i];
		const next = content[i + 1];
		if (ch === '/' && next === '/') {
			while (i < content.length && content[i] !== '\n') i++;
			out += '\n';
			continue;
		}
		if (ch === '/' && next === '*') {
			i += 2;
			while (i < content.length && !(content[i] === '*' && content[i + 1] === '/')) {
				if (content[i] === '\n') out += '\n';
				i++;
			}
			i++;
			out += ' ';
			continue;
		}
		if (ch === "'" || ch === '"' || ch === '`') {
			const quote = ch;
			let bodyLen = 0;
			i++;
			while (i < content.length && content[i] !== quote) {
				if (content[i] === '\\' && i + 1 < content.length) {
					i += 2;
					bodyLen += 2;
					continue;
				}
				i++;
				bodyLen++;
			}
			out += bodyLen === 0 ? `${quote}${quote}` : `${quote}_${quote}`;
			continue;
		}
		out += ch;
		if (ch === '(') depth++;
		else if (ch === ')') {
			depth--;
			if (depth === 0) return out;
		}
	}
	return out;
}

/** Strips redundant balanced outer parentheses around a masked JS expression. */
function unwrapOuterParens(expr) {
	let text = expr.trim();
	while (text.startsWith('(') && text.endsWith(')')) {
		let depth = 0;
		let wrapsAll = true;
		for (let i = 0; i < text.length; i++) {
			if (text[i] === '(') depth++;
			else if (text[i] === ')') {
				depth--;
				if (depth === 0 && i < text.length - 1) {
					wrapsAll = false;
					break;
				}
			}
		}
		if (!wrapsAll || depth !== 0) break;
		text = text.slice(1, -1).trim();
	}
	return text;
}

/**
 * Checks only top-level `shell:` properties of an options object literal passed to the spawn call
 * (parenDepth === 1, braceDepth === 1, bracketDepth === 0), ignoring nested objects like `env`.
 */
function hasEnabledShellOption(maskedCall) {
	let matched = false;
	let parenDepth = 0;
	let braceDepth = 0;
	let bracketDepth = 0;
	for (let i = 0; i < maskedCall.length; i++) {
		const ch = maskedCall[i];
		if (ch === '(') {
			parenDepth++;
			continue;
		}
		if (ch === ')') {
			parenDepth--;
			continue;
		}
		if (ch === '[') {
			bracketDepth++;
			continue;
		}
		if (ch === ']') {
			bracketDepth--;
			continue;
		}
		if (ch === '{') {
			braceDepth++;
			continue;
		}
		if (ch === '}') {
			braceDepth--;
			continue;
		}
		if (parenDepth !== 1 || braceDepth !== 1 || bracketDepth !== 0) continue;
		if (ch !== 's') continue;
		const rest = maskedCall.slice(i);
		const propMatch = rest.match(/^shell\s*:/);
		if (!propMatch) continue;
		// Ensure `shell:` is a property key (preceded by `{` or `,`, not part of an identifier or value).
		const before = maskedCall.slice(0, i).trimEnd();
		const prevChar = before[before.length - 1];
		if (prevChar !== '{' && prevChar !== ',') continue;
		let j = i + propMatch[0].length;
		let valParen = 0;
		let valBrace = 0;
		let valBracket = 0;
		for (; j < maskedCall.length; j++) {
			const c = maskedCall[j];
			if (c === '(') valParen++;
			else if (c === ')') {
				if (valParen === 0) break;
				valParen--;
			} else if (c === '{') valBrace++;
			else if (c === '}') {
				if (valBrace === 0) break;
				valBrace--;
			} else if (c === '[') valBracket++;
			else if (c === ']') {
				if (valBracket === 0) break;
				valBracket--;
			} else if (c === ',' && valParen === 0 && valBrace === 0 && valBracket === 0) {
				break;
			}
		}
		const value = unwrapOuterParens(maskedCall.slice(i + propMatch[0].length, j));
		matched = !FALSY_SHELL.test(value);
		i = j - 1;
	}
	return matched;
}

function parseArgs(argv) {
	const options = { root: process.cwd(), config: undefined, files: [] };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--root' || arg === '--config') {
			const value = argv[++i];
			if (!value) throw new Error(`${arg} needs a value`);
			options[arg.slice(2)] = value;
		} else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
		else options.files.push(arg);
	}
	return options;
}

function loadConfig(root, path) {
	const file = path ? resolve(root, path) : join(root, CONFIG_PATH);
	if (!path && !existsSync(file)) return resolveConfig();
	return resolveConfig(JSON.parse(readFileSync(file, 'utf8')));
}

/** Runs the check and returns its exit code; `log` and `warn` take one line each. */
export function main(argv, { log = console.log, warn = console.warn, error = console.error } = {}) {
	let options;
	let config;
	try {
		options = parseArgs(argv);
		options.root = resolve(options.root);
		config = loadConfig(options.root, options.config);
	} catch (problem) {
		error(`check-portability: ${problem.message}`);
		return 2;
	}
	const { root, files: given } = options;
	const listed =
		given.length > 0
			? given
					.map((file) => resolve(root, file))
					.filter((file) => existsSync(file) && statSync(file).isFile())
					.map((file) => posix(relative(root, file)))
			: (gitFiles(root) ?? walk(root));
	const paths = listed.filter((path) => !isAbsolute(path) && !path.startsWith('../'));
	const scanned = paths.filter((path) => isScanned(path, config));
	if (given.length === 0 && scanned.length === 0) {
		error(`check-portability: found no file to scan under ${root}; refusing a vacuous pass`);
		return 1;
	}
	let errors = 0;
	let warnings = 0;
	for (const path of scanned) {
		let content;
		try {
			content = readFileSync(join(root, path), 'utf8');
		} catch {
			continue;
		}
		for (const finding of scanText(path, content, config)) {
			const out = finding.severity === 'error' ? error : warn;
			if (finding.severity === 'error') errors++;
			else warnings++;
			out(
				`  ${finding.severity === 'error' ? '✘' : '⚠'} ${path}:${finding.line}  ${finding.message}`
			);
			out(`    ${finding.excerpt}`);
			out(`    💡 ${finding.suggestion}\n`);
		}
	}
	if (warnings > 0) warn(`\n⚠  ${warnings} portability warning(s)`);
	if (errors > 0) {
		error(`❌ ${errors} portability error(s) across ${scanned.length} file(s) checked`);
		return 1;
	}
	if (given.length === 0) log(`Portability check passed across ${scanned.length} file(s).`);
	return 0;
}

// Imported with no script path (`node -e`, stdin), argv[1] names no file.
const entry = process.argv[1] && resolve(process.argv[1]);
const invoked = entry && existsSync(entry) && realpathSync(entry);
if (invoked && invoked === realpathSync(fileURLToPath(import.meta.url)))
	process.exitCode = main(process.argv.slice(2));
