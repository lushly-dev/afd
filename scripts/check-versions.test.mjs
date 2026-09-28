import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-versions.mjs');

const parityDoc = (version, contract) =>
	[
		'| Field | Value |',
		'|---|---|',
		'| Updated | 2026-09-27 |',
		'',
		'| | TypeScript | Python | Rust | C++ |',
		'|---|---|---|---|---|',
		'| Package | 9 packages | `afd` | `afd` crate | `afd-cpp` |',
		version,
		contract,
		'',
	].join('\n');

const readme = (rustBadge, cppContract) =>
	[
		`[![Rust](https://img.shields.io/badge/Rust-${rustBadge}+-DEA584.svg)](#)`,
		'',
		'| Implementation | Package | Latest release | Status | Contract |',
		'|---|---|---|---|---|',
		'| TypeScript | core | npm badge | Beta | [1.0-rc](./spec/CHANGELOG.md) |',
		'| Python | `afd` | PyPI badge | Beta | [1.0-rc](./spec/CHANGELOG.md) |',
		'| Rust | `afd` crate | Not on crates.io yet | Preview | [1.0-rc](./spec/CHANGELOG.md) |',
		`| C++ | \`afd-cpp\` | tag badge | Preview | [${cppContract}](./spec/CHANGELOG.md) |`,
		'',
	].join('\n');

const VERSION_ROW = '| Version | 2.0.0 | 0.8.0 | 0.1.0 | 0.1.0, release candidate |';
const CONTRACT_ROW = '| Contract | 1.0-rc | 1.0-rc (`afd.CONTRACT_VERSION`) | 1.0-rc | 1.0-rc |';

/** A repository whose versions all agree, with `overrides` replacing whole files. */
function fixture(overrides = {}) {
	const files = {
		'packages/core/package.json': '{ "name": "@lushly-dev/afd-core", "version": "2.0.0" }',
		'packages/server/package.json': '{ "name": "@lushly-dev/afd-server", "version": "2.0.0" }',
		'packages/demo/package.json': '{ "name": "demo", "version": "0.0.1", "private": true }',
		'packages/core/src/contract.ts': "export const AFD_CONTRACT_VERSION = '1.0-rc';\n",
		'python/pyproject.toml':
			'[project]\nname = "afd"\nversion = "0.8.0"\n\n[tool.x]\nversion = "9.9.9"\n',
		'python/src/afd/__init__.py': '__version__ = "0.8.0"\n',
		'python/src/afd/core/contract.py': 'CONTRACT_VERSION: str = "1.0-rc"\n',
		'packages/rust/Cargo.toml':
			'[package]\nname = "afd"\nversion = "0.1.0"\nrust-version = "1.82"\n\n' +
			'[dependencies]\nserde = { version = "1.0" }\n',
		'packages/rust/src/lib.rs':
			'pub const VERSION: &str = env!("CARGO_PKG_VERSION");\n' +
			'pub const CONTRACT_VERSION: &str = "1.0-rc";\n',
		'packages/cpp/CMakeLists.txt':
			'project(\n    afd\n    VERSION 0.1.0\n    DESCRIPTION "AFD (core)"\n    LANGUAGES CXX)\n',
		'packages/cpp/cmake/version.hpp.in':
			'namespace afd {\ninline constexpr std::string_view contract_version = "1.0-rc";\n}\n',
		'spec/VERSION': '1.0-rc\n',
		'docs/language-parity.md': parityDoc(VERSION_ROW, CONTRACT_ROW),
		'README.md': readme('1.82', '1.0-rc'),
		...overrides,
	};
	const root = mkdtempSync(join(tmpdir(), 'afd-versions-'));
	for (const [file, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), text);
	}
	return root;
}

function run(root) {
	return spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
}

test('agreeing versions pass, ignoring private packages and other TOML sections', () => {
	const result = run(fixture());
	assert.equal(result.status, 0, result.stderr);
	assert.match(
		result.stdout,
		/TypeScript 2\.0\.0, Python 0\.8\.0, Rust 0\.1\.0, C\+\+ 0\.1\.0; AFD contract 1\.0-rc/
	);
});

test('a stale Version row in docs/language-parity.md fails', () => {
	const row = '| Version | 2.0.0 | 0.7.0 | 0.1.0 | 0.1.0 |';
	const result = run(fixture({ 'docs/language-parity.md': parityDoc(row, CONTRACT_ROW) }));
	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/Version row of docs\/language-parity\.md shows Python 0\.7\.0, but it is 0\.8\.0/
	);
	assert.match(result.stderr, /1 version problem/);
});

test('a missing Contract row in docs/language-parity.md fails', () => {
	const result = run(fixture({ 'docs/language-parity.md': parityDoc(VERSION_ROW, '') }));
	assert.equal(result.status, 1);
	assert.match(result.stderr, /docs\/language-parity\.md has no Contract row/);
});

test('pyproject.toml and __version__ must agree', () => {
	const result = run(fixture({ 'python/src/afd/__init__.py': "__version__ = '0.9.0'\n" }));
	assert.equal(result.status, 1);
	assert.match(result.stderr, /pyproject\.toml has version 0\.8\.0, but .* __version__ 0\.9\.0/);
});

test('every contract constant must equal spec/VERSION', () => {
	const result = run(
		fixture({
			'packages/rust/src/lib.rs': 'pub const CONTRACT_VERSION: &str = "1.0";\n',
			'packages/core/src/contract.ts': "// export const AFD_CONTRACT_VERSION = '1.0-rc';\n",
		})
	);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /lib\.rs declares contract 1\.0, but spec\/VERSION is 1\.0-rc/);
	assert.match(result.stderr, /contract\.ts declares no TypeScript contract version/);
	// The documents disagree with the changed constant too.
	assert.match(
		result.stderr,
		/Contract row of docs\/language-parity\.md shows Rust 1\.0-rc, but it is 1\.0/
	);
});

test("README's Contract column and Rust badge are checked", () => {
	const result = run(fixture({ 'README.md': readme('1.70', '0.9') }));
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Contract column shows C\+\+ 0\.9, but it is 1\.0-rc/);
	assert.match(result.stderr, /Rust badge says 1\.70\+, but .* rust-version 1\.82/);
	assert.match(result.stderr, /2 version problem/);
});

test('the @lushly-dev/* packages must share one version', () => {
	const server = '{ "name": "@lushly-dev/afd-server", "version": "2.0.1" }';
	const result = run(fixture({ 'packages/server/package.json': server }));
	assert.equal(result.status, 1);
	assert.match(result.stderr, /different versions: .*@lushly-dev\/afd-server@2\.0\.1/);
});
