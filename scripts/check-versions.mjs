#!/usr/bin/env node
/**
 * Version Drift Check — Pre-push and quality gate
 *
 * Reads each implementation's version from its manifest, and the AFD contract version from
 * spec/VERSION and the constant each language exports. Fails (exit 1) when:
 *
 *   - the published @lushly-dev/* packages (packages/<name>/package.json) differ in version;
 *   - python/pyproject.toml and __version__ in python/src/afd/__init__.py differ;
 *   - a language's contract version constant differs from spec/VERSION;
 *   - the Version or Contract row of docs/language-parity.md disagrees with them;
 *   - the Contract column of the README's implementations table disagrees with them;
 *   - the README's Rust badge differs from rust-version in packages/rust/Cargo.toml.
 *
 * With --write, it rewrites the version cells of those documents (the Version and Contract rows,
 * the Contract column and the Rust badge) from the manifests and constants instead of failing on
 * them, and fails only on problems a document edit cannot fix. `pnpm version-packages` runs it
 * after `changeset version`, so the release commit carries the updated docs.
 *
 * Run from the repository root:   node scripts/check-versions.mjs [--write]
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const WRITE = process.argv.includes('--write');
const LANGUAGES = ['TypeScript', 'Python', 'Rust', 'C++'];
const SEMVER = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?/;
const CONTRACT = /\d+\.\d+(?:-[0-9A-Za-z.]+)?/;

// Where each language declares the contract version it implements.
const CONTRACT_SOURCES = {
	TypeScript: {
		file: 'packages/core/src/contract.ts',
		pattern: /^export const AFD_CONTRACT_VERSION\b[^=\n]*=\s*(['"])([^'"\n]*)\1/m,
	},
	Python: {
		file: 'python/src/afd/core/contract.py',
		pattern: /^CONTRACT_VERSION\b[^=\n]*=\s*(['"])([^'"\n]*)\1/m,
	},
	Rust: {
		file: 'packages/rust/src/lib.rs',
		pattern: /^pub const CONTRACT_VERSION\s*:[^=\n]*=\s*(")([^"\n]*)"/m,
	},
	'C++': {
		file: 'packages/cpp/cmake/version.hpp.in',
		pattern: /^[ \t]*(?:inline[ \t]+)?constexpr\b[^;=\n]*\bcontract_version\s*=\s*(")([^"\n]*)"/m,
	},
};

const problems = [];

function problem(message, suggestion) {
	problems.push({ message, suggestion });
}

function read(file) {
	const path = join(root, file);
	return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** The `key = "value"` of a TOML `[section]`, read line by line. */
function tomlValue(text, section, key) {
	let inSection = false;
	for (const line of text.split('\n')) {
		const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
		if (header) inSection = header[1].trim() === section;
		else if (inSection) {
			const value = line.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`));
			if (value) return value[1];
		}
	}
	return null;
}

/** Read `file`, or record a problem and return null. */
function required(file) {
	const text = read(file);
	if (text === null) problem(`${file} is missing`, 'Run from the repository root');
	return text;
}

// ─── Implementation versions ─────────────────────────────────────────────────

function typescriptVersion() {
	const versions = new Map();
	const packagesDir = join(root, 'packages');
	if (!existsSync(packagesDir)) return null;
	for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
		const file = `packages/${entry.name}/package.json`;
		const text = entry.isDirectory() ? read(file) : null;
		if (text === null) continue;
		let manifest;
		try {
			manifest = JSON.parse(text);
		} catch (error) {
			problem(`${file} is not valid JSON: ${error.message}`, 'Fix the manifest');
			continue;
		}
		if (manifest.private === true || !manifest.name?.startsWith('@lushly-dev/')) continue;
		versions.set(manifest.name, manifest.version);
	}
	const distinct = [...new Set(versions.values())];
	if (distinct.length > 1) {
		const list = [...versions].map(([name, version]) => `${name}@${version}`).join(', ');
		problem(
			`The @lushly-dev/* packages have different versions: ${list}`,
			'They are one fixed Changesets group; version them with pnpm version-packages'
		);
	}
	return distinct[0] ?? null;
}

function pythonVersion() {
	const pyproject = required('python/pyproject.toml');
	const init = required('python/src/afd/__init__.py');
	if (pyproject === null || init === null) return null;
	const version = tomlValue(pyproject, 'project', 'version');
	const dunder = init.match(/^__version__\b[^=\n]*=\s*(['"])([^'"\n]*)\1/m)?.[2] ?? null;
	if (version !== dunder) {
		problem(
			`python/pyproject.toml has version ${version}, but python/src/afd/__init__.py has __version__ ${dunder}`,
			'Bump both together'
		);
	}
	return version;
}

function cppVersion() {
	const cmake = required('packages/cpp/CMakeLists.txt');
	const project = cmake?.match(/\bproject\s*\(\s*afd\b[^)]*?\bVERSION\s+(\d+\.\d+\.\d+)/);
	return project?.[1] ?? null;
}

const cargo = required('packages/rust/Cargo.toml');
const versions = {
	TypeScript: typescriptVersion(),
	Python: pythonVersion(),
	Rust: cargo === null ? null : tomlValue(cargo, 'package', 'version'),
	'C++': cppVersion(),
};
for (const [language, version] of Object.entries(versions)) {
	if (version === null) problem(`Could not read the ${language} version`, 'Check its manifest');
}

// ─── Contract version ────────────────────────────────────────────────────────

const specText = required('spec/VERSION');
const expected = specText?.trim() || null;
if (specText !== null && !new RegExp(`^${CONTRACT.source}$`).test(expected ?? '')) {
	problem(`spec/VERSION holds "${expected ?? ''}", not MAJOR.MINOR`, 'See spec/CHANGELOG.md');
}

const contracts = {};
for (const [language, { file, pattern }] of Object.entries(CONTRACT_SOURCES)) {
	const constant = read(file)?.match(pattern)?.[2] ?? null;
	contracts[language] = constant;
	if (constant === null) {
		problem(`${file} declares no ${language} contract version`, 'See spec/CHANGELOG.md');
	} else if (expected !== null && constant !== expected) {
		problem(
			`${file} declares contract ${constant}, but spec/VERSION is ${expected}`,
			'Update every constant with spec/VERSION (spec/CHANGELOG.md lists them)'
		);
	}
}

// ─── Documents ───────────────────────────────────────────────────────────────

/** Split a Markdown table row into its raw cells, without the outer pipes. */
function rawCells(line) {
	return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
}

/** Split a Markdown table row into trimmed cells. */
function cells(line) {
	return rawCells(line).map((cell) => cell.trim());
}

/**
 * The first table whose header matches `isHeader`, as { header, rows }, where each row is
 * { cells, line } and `line` is its index in `lines`.
 */
function table(lines, isHeader) {
	const start = lines.findIndex((line) => line.trim().startsWith('|') && isHeader(cells(line)));
	if (start < 0) return null;
	const rows = [];
	for (let index = start + 2; index < lines.length; index++) {
		if (!lines[index].trim().startsWith('|')) break;
		rows.push({ cells: cells(lines[index]), line: index });
	}
	return { header: cells(lines[start]), rows };
}

const written = [];

/**
 * Check that the version in cell `column` of `lines[row.line]` equals `actual`. With --write,
 * replace it in place instead, keeping the rest of the cell.
 */
function compare(where, language, lines, row, column, pattern, actual) {
	const shown = row.cells[column]?.match(pattern)?.[0] ?? null;
	if (actual === null || shown === actual) return;
	if (WRITE && shown !== null) {
		const raw = rawCells(lines[row.line]);
		raw[column] = raw[column].replace(pattern, actual);
		const [, lead, trail] = lines[row.line].match(/^(\s*).*?(\s*)$/);
		lines[row.line] = `${lead}|${raw.join('|')}|${trail}`;
		written.push(`${where}: ${language} ${shown} → ${actual}`);
		return;
	}
	problem(
		`${where} shows ${language} ${shown ?? '(nothing)'}, but it is ${actual}`,
		`Update ${where}`
	);
}

/** Save `lines` to `file` when --write changed them. */
function save(file, text, lines) {
	const updated = lines.join('\n');
	if (WRITE && updated !== text) writeFileSync(join(root, file), updated);
}

const parity = required('docs/language-parity.md');
if (parity !== null) {
	const lines = parity.split('\n');
	const glance = table(lines, (header) => LANGUAGES.every((language) => header.includes(language)));
	for (const [name, pattern, actual] of [
		['Version', SEMVER, versions],
		['Contract', CONTRACT, contracts],
	]) {
		const found = glance?.rows.find((row) => row.cells[0] === name);
		if (!found) {
			problem(
				`docs/language-parity.md has no ${name} row`,
				'Add it to "Implementations at a glance"'
			);
			continue;
		}
		for (const language of LANGUAGES) {
			compare(
				`the ${name} row of docs/language-parity.md`,
				language,
				lines,
				found,
				glance.header.indexOf(language),
				pattern,
				actual[language]
			);
		}
	}
	save('docs/language-parity.md', parity, lines);
}

const readme = required('README.md');
if (readme !== null) {
	const lines = readme.split('\n');
	const implementations = table(lines, (header) => header[0] === 'Implementation');
	const column = implementations?.header.indexOf('Contract') ?? -1;
	if (column < 0) {
		problem('README.md has no implementations table with a Contract column', 'Restore it');
	} else {
		for (const language of LANGUAGES) {
			const found = implementations.rows.find((row) => row.cells[0] === language);
			if (!found) problem(`README.md's implementations table has no ${language} row`, 'Add it');
			else
				compare(
					"README.md's Contract column",
					language,
					lines,
					found,
					column,
					CONTRACT,
					contracts[language]
				);
		}
	}

	const BADGE = /(img\.shields\.io\/badge\/Rust-)(\d+\.\d+(?:\.\d+)?)\+/;
	const msrv = cargo === null ? null : tomlValue(cargo, 'package', 'rust-version');
	const index = lines.findIndex((line) => BADGE.test(line));
	const badge = index < 0 ? null : lines[index].match(BADGE)[2];
	if (badge && badge !== msrv) {
		if (WRITE && msrv) {
			lines[index] = lines[index].replace(BADGE, `$1${msrv}+`);
			written.push(`README.md's Rust badge: ${badge} → ${msrv}`);
		} else {
			problem(
				`README.md's Rust badge says ${badge}+, but packages/rust/Cargo.toml has rust-version ${msrv}`,
				'Keep the badge equal to rust-version'
			);
		}
	}
	save('README.md', readme, lines);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

for (const change of written) console.log(`  ✎ Updated ${change}`);

if (problems.length > 0) {
	for (const { message, suggestion } of problems) {
		console.error(`  ✘ ${message}`);
		console.error(`    💡 ${suggestion}\n`);
	}
	if (WRITE) console.error('  --write updates only the documents; fix the sources above by hand');
	console.error(`  ✘ ${problems.length} version problem(s)`);
	process.exit(1);
}

const summary = LANGUAGES.map((language) => `${language} ${versions[language]}`).join(', ');
console.log(`  ✓ Versions agree: ${summary}; AFD contract ${expected}`);
