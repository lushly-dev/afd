#!/usr/bin/env node
/**
 * File Size Enforcement — Pre-commit
 *
 * Checks TypeScript source files against line count thresholds.
 * Runs on staged files. Exit code 1 = violations found.
 *
 * Thresholds:
 *   WARN:  300 lines (non-blocking)
 *   ERROR: 500 lines (blocks commit)
 *
 * Escape hatch (lines 1-5 of file):
 *   // afd-override: max-lines=N
 *   Where N ≤ 1000 (hard cap). File must still be under N lines.
 *
 * Skip patterns: *.stories.ts, *.test.ts, *.spec.ts, *.d.ts, generated files
 * Skip directories: alfred/, python/, packages/rust/
 */

import { readFileSync } from 'node:fs';
import { basename, extname, normalize } from 'node:path';

// ─── Config ──────────────────────────────────────────────────────────────────

const WARN_THRESHOLD = 300;
const ERROR_THRESHOLD = 500;
const OVERRIDE_CAP = 1000;
const OVERRIDE_PATTERN = /\/\/\s*afd-override:\s*max-lines=(\d+)/;

// Skip patterns
const SKIP_SUFFIXES = ['.stories.ts', '.test.ts', '.spec.ts', '.d.ts'];
const SKIP_DIRS = ['node_modules', 'dist', 'alfred', 'python', 'packages/rust'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const files = args.length > 0 ? args : [];

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

	// Only check .ts and .js files
	if (ext !== '.ts' && ext !== '.js') return true;

	// Skip test, story, and declaration files
	for (const suffix of SKIP_SUFFIXES) {
		if (name.endsWith(suffix)) return true;
	}

	// Skip files in excluded directories
	for (const dir of SKIP_DIRS) {
		if (normalized.includes(`/${dir}/`) || normalized.includes(`\\${dir}\\`)) return true;
		if (normalized.includes(`/${dir}`) && dir.includes('/')) return true;
	}

	// Skip node_modules anywhere in path
	if (normalized.includes('/node_modules/') || normalized.includes('\\node_modules\\'))
		return true;

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

if (files.length === 0) {
	process.exit(0);
}

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
			`Split into smaller modules, or add // afd-override: max-lines=N (≤${OVERRIDE_CAP}) in the first 5 lines with justification`
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
