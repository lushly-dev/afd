#!/usr/bin/env node
/**
 * Portability Check — Pre-commit
 *
 * Detects machine-specific paths and localhost URLs that reduce repo portability.
 *
 * Errors:
 * - Windows drive-letter absolute paths (D:\..., C:\...)
 * - User-home absolute paths (C:\Users\name, /home/name, /Users/name)
 * - A package manager started by bare name without a shell (`execFileSync('pnpm', ...)`):
 *   Windows installs it as a `.cmd` shim, so the call fails there with ENOENT. Use `execTool`
 *   or `spawnTool` from scripts/release/exec-tool.mjs
 *
 * Warnings:
 * - Hardcoded localhost URLs
 *
 * Escape hatch:
 * - Add `// portability-ok: reason` on the same line or previous line
 *
 * Allowlist:
 * - Markdown files (*.md)
 * - vite/vitest config localhost references
 *
 * Excluded directories: alfred/, python/, packages/rust/ (own tooling),
 * and the C++ CMake build trees packages/cpp/build/ and packages/examples/todo/backends/cpp/build/
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const CHECK_EXTENSIONS = new Set([
	'.ts',
	'.tsx',
	'.js',
	'.mjs',
	'.cjs',
	'.json',
	'.md',
	'.yaml',
	'.yml',
]);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'alfred', 'python']);
const CPP_BUILD_DIR = /\/(?:packages\/cpp|packages\/examples\/todo\/backends\/cpp)\/build\//;
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
		regex: /C:\\Users\\[^\\'"`\s)]+/g,
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

let errors = 0;
let warnings = 0;
let checkedFiles = 0;

function isSkippedPath(normalizedPath) {
	// Skip packages/rust/ specifically (contains slash so check manually)
	if (normalizedPath.includes('/packages/rust/') || normalizedPath.includes('\\packages\\rust\\'))
		return true;
	// Skip C++ CMake build trees: CMake writes machine-specific absolute paths into them
	// (CMakeConfigureLog.yaml, compile_commands.json, FetchContent _deps/).
	if (CPP_BUILD_DIR.test(normalizedPath.replace(/\\/g, '/'))) return true;
	return false;
}

function collectFiles(dir, out = []) {
	if (!existsSync(dir)) return out;
	let entries = [];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (entry.name.startsWith('.')) continue;
		if (SKIP_DIRS.has(entry.name)) continue;
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			collectFiles(fullPath, out);
			continue;
		}
		if (!entry.isFile()) continue;
		if (!CHECK_EXTENSIONS.has(extname(entry.name))) continue;
		out.push(fullPath);
	}
	return out;
}

function getInputFiles() {
	const args = process.argv.slice(2);
	if (args.length > 0) {
		return args.filter((file) => existsSync(file));
	}

	const files = [];
	const roots = ['packages', 'scripts', 'tests', 'docs', '.github'];
	for (const root of roots) {
		collectFiles(resolve(root), files);
	}
	for (const file of ['AGENTS.md', 'README.md', 'SETUP.md', 'CHANGELOG.md', 'CONTRIBUTING.md']) {
		const fullPath = resolve(file);
		if (existsSync(fullPath)) files.push(fullPath);
	}
	return files;
}

function isAllowed(filePath, _line, patternId) {
	const normalized = normalize(filePath).replace(/\\/g, '/');
	if (normalized.endsWith('.md')) return true;

	if (patternId === 'localhost-url') {
		if (normalized.endsWith('/vite.config.ts') || normalized.endsWith('/vitest.config.ts')) {
			return true;
		}
	}

	return false;
}

function report(filePath, lineNum, severity, message, excerpt, suggestion) {
	const name = normalize(filePath).replace(process.cwd().replace(/\\/g, '/'), '.');
	const label = severity === 'error' ? '✘' : '⚠';
	if (severity === 'error') {
		errors++;
		console.error(`  ${label} ${name}:${lineNum}  ${message}`);
		console.error(`    ${excerpt}`);
		console.error(`    💡 ${suggestion}\n`);
		return;
	}
	warnings++;
	console.warn(`  ${label} ${name}:${lineNum}  ${message}`);
	console.warn(`    ${excerpt}`);
	console.warn(`    💡 ${suggestion}\n`);
}

function scanShimSpawns(filePath, content, lines) {
	for (const match of content.matchAll(BARE_SHIM_SPAWN)) {
		const index = content.slice(0, match.index).split('\n').length - 1;
		const line = lines[index];
		const prev = index > 0 ? lines[index - 1] : '';
		if (COMMENT_LINE.test(line) || ESCAPE_HATCH.test(line) || ESCAPE_HATCH.test(prev)) continue;
		// A call that sets `shell` (as `shell: process.platform === 'win32'`) starts the shim.
		const call = content.slice(match.index, content.indexOf(');', match.index));
		if (/\bshell\s*:/.test(call)) continue;
		report(
			filePath,
			index + 1,
			'error',
			'Package manager started without a shell (ENOENT on Windows, where it is a .cmd shim)',
			line.trim().slice(0, 140),
			'Use execTool or spawnTool from scripts/release/exec-tool.mjs; a call that already passes a Windows shell with fixed arguments takes a portability-ok comment.'
		);
	}
}

function scanFile(filePath) {
	const normalizedPath = normalize(filePath).replace(/\\/g, '/');
	if (normalizedPath.endsWith('/scripts/check-portability.mjs')) return;
	if (isSkippedPath(normalizedPath)) return;

	let content = '';
	try {
		content = readFileSync(filePath, 'utf-8');
	} catch {
		return;
	}

	const lines = content.split('\n');
	checkedFiles++;
	if (SCRIPT_EXTENSIONS.has(extname(filePath))) scanShimSpawns(filePath, content, lines);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const prev = i > 0 ? lines[i - 1] : '';
		if (COMMENT_LINE.test(line)) continue;
		if (ESCAPE_HATCH.test(line) || ESCAPE_HATCH.test(prev)) continue;

		for (const pattern of PATTERNS) {
			pattern.regex.lastIndex = 0;
			const matches = [...line.matchAll(pattern.regex)];
			if (matches.length === 0) continue;
			if (isAllowed(filePath, line, pattern.id)) continue;
			report(
				filePath,
				i + 1,
				pattern.severity,
				pattern.message,
				line.trim().slice(0, 140),
				pattern.suggestion
			);
		}
	}
}

const files = getInputFiles();
for (const filePath of files) {
	scanFile(filePath);
}

if (warnings > 0) {
	console.warn(`\n⚠  ${warnings} portability warning(s)`);
}
if (errors > 0) {
	console.error(`❌ ${errors} portability error(s) across ${checkedFiles} file(s) checked`);
	process.exit(1);
}
process.exit(0);
