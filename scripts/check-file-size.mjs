#!/usr/bin/env node
/**
 * File Size Guard — Pre-commit
 *
 * A runaway guard, not a factoring rule: only a source file over 1,500 lines blocks a commit.
 * The 500-line review threshold belongs to the sweep-bloat skill's periodic pass, which ranks
 * oversized files by size and churn and splits them on purpose, a few at a time, so a feature
 * never stops to split a file mid-change. The pair matches botcore.toml (file_size_warn /
 * file_size_error), which Botcore's dev_check_size reads.
 * Runs on staged files. Exit code 1 = violations found.
 *
 * Thresholds:
 *   WARN:  500 lines (non-blocking; the sweep's input)
 *   ERROR: 1500 lines (blocks commit). There is no override: split a file that reaches it.
 *
 * Scope: .ts under packages/ and .js/.mjs under scripts/. Markdown, Python, Rust and C++
 *   are never size-checked by this script.
 * Skip patterns: *.stories.ts, *.test.ts, *.spec.ts, *.d.ts, and anything under a `_generated/`
 *   or `generated/` directory
 * Skip directories: alfred/, python/, packages/rust/, and the imported upstream source in
 *   foundations/fast-af/, foundations/violet/, integrations/violet-afd/, endpoints/violet-cli/
 *   and endpoints/violet-server/
 */

import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join, normalize, relative, resolve } from 'node:path';

// ─── Config ──────────────────────────────────────────────────────────────────

const WARN_THRESHOLD = 500;
const ERROR_THRESHOLD = 1500;

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

	// Generated output is sized by its generator, not by hand.
	if (/(^|\/)_?generated\//.test(normalized)) return true;

	return false;
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

	if (lineCount > ERROR_THRESHOLD) {
		report(
			filePath,
			lineCount,
			`File exceeds ${ERROR_THRESHOLD} lines`,
			`Split it by responsibility: past this size it grew unchecked. Name the seam: what moves, and what stays`
		);
	} else if (lineCount > WARN_THRESHOLD) {
		warn(
			filePath,
			lineCount,
			`Over the ${WARN_THRESHOLD}-line review threshold`,
			`No action needed in this change: the sweep-bloat skill ranks it. Blocks only past ${ERROR_THRESHOLD} lines.`
		);
	}
}

// ─── Summary ─────────────────────────────────────────────────────────────────

if (checkedFiles > 0) {
	if (warnings > 0) {
		console.warn(`\n  ⚠ ${warnings} file size warning(s) (non-blocking)`);
	}
}

if (violations > 0) {
	console.error(
		`\n  ✘ ${violations} file size violation(s) across ${checkedFiles} file(s) checked`
	);
	process.exit(1);
}
