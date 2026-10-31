#!/usr/bin/env node
/**
 * File Size Enforcement — Pre-commit
 *
 * Checks TypeScript source files against line count thresholds. The pair matches
 * botcore.toml (file_size_warn / file_size_error), which Botcore's dev_check_size reads.
 * Runs on staged files. Exit code 1 = violations found.
 *
 * Thresholds:
 *   WARN:  500 lines (non-blocking)
 *   ERROR: 1000 lines (blocks commit)
 *
 * Escape hatch (lines 1-5 of file):
 *   // afd-override: max-lines=N
 *   Where N ≤ 1500 (hard cap). File must still be under N lines. Give an override headroom
 *   (round the current count up by a hundred or two) rather than pinning it one line above
 *   the file's size, or the next edit trips it.
 *
 * Scope: .ts under packages/ and .js/.mjs under scripts/. Markdown, Python, Rust and C++
 *   are never size-checked by this script.
 * Skip patterns: *.stories.ts, *.test.ts, *.spec.ts, *.d.ts, generated files
 * Skip directories: alfred/, python/, packages/rust/, and the imported upstream source in
 *   foundations/fast-af/, foundations/violet/, integrations/violet-afd/, endpoints/violet-cli/
 *   and endpoints/violet-server/
 */

import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join, normalize, relative, resolve } from 'node:path';

// ─── Config ──────────────────────────────────────────────────────────────────

const WARN_THRESHOLD = 500;
const ERROR_THRESHOLD = 1000;
const OVERRIDE_CAP = 1500;
const OVERRIDE_PATTERN = /\/\/\s*afd-override:\s*max-lines=(\d+)/;

// Skip patterns
const SKIP_SUFFIXES = [
	'.stories.ts',
	'.test.ts',
	'.spec.ts',
	'.d.ts',
	'.test.js',
	'.spec.js',
	'.test.mjs',
	'.spec.mjs',
];
// FAST-AF and Violet are upstream source bound to file-level provenance hashes; splitting it is not an import.
const SKIP_DIRS = [
	'node_modules',
	'dist',
	'alfred',
	'python',
	'packages/rust',
	'foundations/fast-af',
	'foundations/violet',
	'integrations/violet-afd',
	'endpoints/violet-cli',
	'endpoints/violet-server',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function isSkippedDirectory(filePath) {
	const normalized = normalize(filePath).replace(/\\/g, '/');
	return SKIP_DIRS.some(
		(dir) =>
			normalized === dir || normalized.startsWith(`${dir}/`) || normalized.includes(`/${dir}/`)
	);
}

/** Discover source files for full-repository checks. */
export function discoverFiles(root = process.cwd()) {
	const files = [];
	const sourceRoots = ['packages', 'scripts'];

	function visit(directory) {
		let entries;
		try {
			entries = readdirSync(directory, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const absolute = join(directory, entry.name);
			const workspacePath = relative(root, absolute);
			if (entry.isDirectory()) {
				if (!isSkippedDirectory(workspacePath)) visit(absolute);
			} else if (entry.isFile() && !shouldSkip(workspacePath)) {
				files.push(workspacePath);
			}
		}
	}

	for (const sourceRoot of sourceRoots) visit(resolve(root, sourceRoot));
	return files.sort();
}

const files = args.length > 0 ? args : discoverFiles();

let violations = 0;
let warnings = 0;
let overrides = 0;
let checkedFiles = 0;

function report(file, lineCount, rule, suggestion) {
	violations++;
	const name = basename(file);
	console.error(`  ✘ ${name}  ${rule}`);
	console.error(`    ${lineCount} lines`);
	console.error(`    💡 ${suggestion}\n`);
}

function warn(file, lineCount, rule, suggestion) {
	warnings++;
	const name = basename(file);
	console.warn(`  ⚠ ${name}  ${rule}`);
	console.warn(`    ${lineCount} lines`);
	console.warn(`    💡 ${suggestion}\n`);
}

function shouldSkip(filePath) {
	const name = basename(filePath);
	const ext = extname(filePath);
	const normalized = normalize(filePath).replace(/\\/g, '/');

	// Package source is TypeScript. JavaScript is checked only for repository scripts.
	if (ext !== '.ts' && !(['.js', '.mjs'].includes(ext) && normalized.startsWith('scripts/'))) {
		return true;
	}

	// Skip test, story, and declaration files
	for (const suffix of SKIP_SUFFIXES) {
		if (name.endsWith(suffix)) return true;
	}

	// Skip files in excluded directories, including repository-relative staged paths
	if (isSkippedDirectory(filePath)) return true;
	for (const dir of SKIP_DIRS) {
		if (normalized.includes(`/${dir}/`) || normalized.includes(`\\${dir}\\`)) return true;
		if (normalized.includes(`/${dir}`) && dir.includes('/')) return true;
	}

	// Skip node_modules anywhere in path
	if (normalized.includes('/node_modules/') || normalized.includes('\\node_modules\\')) return true;

	return false;
}

function parseOverride(lines) {
	// Check first 5 lines for override comment
	const head = lines.slice(0, 5);
	for (const line of head) {
		const match = line.match(OVERRIDE_PATTERN);
		if (match) {
			return parseInt(match[1], 10);
		}
	}
	return null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

for (const filePath of files) {
	if (shouldSkip(filePath)) continue;

	let content;
	try {
		content = readFileSync(filePath, 'utf-8');
	} catch {
		continue;
	}

	const lines = content.split('\n');
	const lineCount = lines.length;
	checkedFiles++;

	const override = parseOverride(lines);

	if (override !== null) {
		overrides++;

		// Validate override cap
		if (override > OVERRIDE_CAP) {
			report(
				filePath,
				lineCount,
				`Override max-lines=${override} exceeds hard cap of ${OVERRIDE_CAP}`,
				`Reduce the override to ≤${OVERRIDE_CAP} or refactor the file into smaller modules`
			);
			continue;
		}

		// Check against override threshold
		if (lineCount > override) {
			report(
				filePath,
				lineCount,
				`File exceeds its own override limit of ${override} lines`,
				`Refactor to stay under ${override} lines, or increase the override (max ${OVERRIDE_CAP})`
			);
		}
		// Override file within limit — no warning even if above default thresholds
		continue;
	}

	// No override — check against default thresholds
	if (lineCount > ERROR_THRESHOLD) {
		report(
			filePath,
			lineCount,
			`File exceeds ${ERROR_THRESHOLD} lines (no override)`,
			`Split by responsibility, or add // afd-override: max-lines=N (≤${OVERRIDE_CAP}, with headroom) in the first 5 lines with justification`
		);
	} else if (lineCount > WARN_THRESHOLD) {
		warn(
			filePath,
			lineCount,
			`File approaching size limit (>${WARN_THRESHOLD} lines)`,
			`Consider splitting. Will block at ${ERROR_THRESHOLD} lines.`
		);
	}
}

// ─── Summary ─────────────────────────────────────────────────────────────────

if (checkedFiles > 0) {
	if (warnings > 0) {
		console.warn(`\n  ⚠ ${warnings} file size warning(s) (non-blocking)`);
	}
	if (overrides > 0) {
		console.log(`  ℹ ${overrides} file(s) with afd-override`);
	}
}

if (violations > 0) {
	console.error(
		`\n  ✘ ${violations} file size violation(s) across ${checkedFiles} file(s) checked`
	);
	console.error(`    Add // afd-override: max-lines=N for legitimate exceptions\n`);
	process.exit(1);
}
