#!/usr/bin/env node
/**
 * Orphan File Detection — Pre-push
 *
 * Finds .ts files in packages/<pkg>/src/ that are not imported by any other .ts file.
 * Warning-only (non-blocking) — orphans may be intentionally disconnected
 * during active development.
 *
 * Known entry points (excluded from orphan detection):
 *   - index.ts (barrel exports)
 *   - main.ts
 *   - server.ts (MCP entry points)
 *   - *.test.ts, *.spec.ts, *.d.ts
 *
 * Skipped directories: examples/, alfred/, python/, packages/rust/
 *
 * Run manually:   node scripts/check-orphan-files.mjs
 * Run via push:   git push (triggered by Lefthook)
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

// ─── Config ──────────────────────────────────────────────────────────────────

const PACKAGES_DIR = resolve('packages');
const SKIP_PACKAGES = new Set(['examples', 'rust']);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function warn(msg) {
	console.warn(`  ⚠ ${msg}`);
}

function info(msg) {
	console.log(`  ✓ ${msg}`);
}

/** Recursively collect all .ts files in a directory */
function collectTsFiles(dir) {
	const results = [];
	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			if (
				entry.isDirectory() &&
				!entry.name.startsWith('.') &&
				entry.name !== 'node_modules' &&
				entry.name !== 'dist'
			) {
				results.push(...collectTsFiles(fullPath));
			} else if (entry.isFile() && entry.name.endsWith('.ts')) {
				results.push(fullPath);
			}
		}
	} catch {
		// Skip unreadable directories
	}
	return results;
}

/** Get all src directories from packages/ */
function getPackageSrcDirs() {
	const dirs = [];
	if (!existsSync(PACKAGES_DIR)) return dirs;

	try {
		const entries = readdirSync(PACKAGES_DIR, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (SKIP_PACKAGES.has(entry.name)) continue;
			const srcDir = join(PACKAGES_DIR, entry.name, 'src');
			if (existsSync(srcDir)) {
				dirs.push(srcDir);
			}
		}
	} catch {
		// Skip unreadable
	}
	return dirs;
}

/** Check if a file is an entry point (excluded from orphan detection) */
function isEntryPoint(filePath) {
	const name = basename(filePath);

	// Known entry points
	if (name === 'main.ts') return true;
	if (name === 'index.ts') return true;
	if (name === 'server.ts') return true;
	if (name === 'bin.ts') return true;
	if (name.endsWith('.test.ts')) return true;
	if (name.endsWith('.spec.ts')) return true;
	if (name.endsWith('.d.ts')) return true;
	if (name.endsWith('.stories.ts')) return true;

	return false;
}

/** Extract import paths from a file's content */
function extractImports(content) {
	const imports = [];
	// Match: import ... from '...' / import '...' / export ... from '...'
	const importRegex = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
	// Match: dynamic import()
	const dynamicRegex = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

	for (const m of content.matchAll(importRegex)) {
		imports.push(m[1]);
	}
	for (const m of content.matchAll(dynamicRegex)) {
		imports.push(m[1]);
	}
	return imports;
}

/** Resolve a relative import path to an absolute file path */
function resolveImport(importPath, fromFile) {
	// Skip package imports (not starting with .)
	if (!importPath.startsWith('.')) return null;

	const resolved = resolve(join(fromFile, '..'), importPath);

	// Try with various extensions
	const extensions = ['', '.ts', '.js', '/index.ts', '/index.js'];
	for (const ext of extensions) {
		const candidate = resolved + ext;
		// Normalize for comparison (strip .js → check if .ts exists)
		const tsCandidate = candidate.replace(/\.js$/, '.ts');
		if (existsSync(tsCandidate)) return tsCandidate;
		if (existsSync(candidate)) return candidate;
	}

	return null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const srcDirs = getPackageSrcDirs();

if (srcDirs.length === 0) {
	console.error('  ✘ No packages/*/src/ directories found');
	process.exit(0);
}

// Collect all TS files across all package src dirs
const allFiles = [];
for (const srcDir of srcDirs) {
	allFiles.push(...collectTsFiles(srcDir));
}

const sourceFiles = allFiles.filter((f) => !isEntryPoint(f));

// Build import graph: which files are imported by at least one other file
const importedFiles = new Set();

for (const filePath of allFiles) {
	let content;
	try {
		content = readFileSync(filePath, 'utf-8');
	} catch {
		continue;
	}

	const imports = extractImports(content);
	for (const imp of imports) {
		const resolved = resolveImport(imp, filePath);
		if (resolved) {
			importedFiles.add(resolved.replace(/\\/g, '/'));
		}
	}
}

// Find orphans: source files not in the imported set
const orphans = sourceFiles.filter((f) => {
	const normalized = f.replace(/\\/g, '/');
	return !importedFiles.has(normalized);
});

// ─── Report ──────────────────────────────────────────────────────────────────

if (orphans.length === 0) {
	info(
		`All ${sourceFiles.length} source files are referenced (${allFiles.length} total scanned across ${srcDirs.length} package(s))`
	);
} else {
	console.warn(`\n  Orphan files — not imported by any other source file:\n`);
	for (const orphan of orphans) {
		const rel = relative(process.cwd(), orphan).replace(/\\/g, '/');
		warn(`${rel}`);
	}
	console.warn(`\n  💡 ${orphans.length} orphan(s) found. These files are not imported anywhere.`);
	console.warn(
		`     If intentional (entry points, dynamic imports), add them to isEntryPoint() in this script.`
	);
	console.warn(`     If dead code, consider removing them.\n`);
}

// Non-blocking — always exit 0 (warnings only)
process.exit(0);
