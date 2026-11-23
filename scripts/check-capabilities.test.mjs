import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkCapabilities, loadAndValidate, renderCell } from './check-capabilities.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempDirs = [];

function makeTempDir() {
	const dir = mkdtempSync(join(tmpdir(), 'afd-capabilities-'));
	tempDirs.push(dir);
	return dir;
}

function writeFile(root, rel, content) {
	const abs = join(root, rel);
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, content, 'utf8');
}

function createFixture(overrides = {}) {
	const root = makeTempDir();
	writeFile(root, 'packages/core/src/result.ts', 'export const ok = true;\n');
	writeFile(root, 'python/src/result.py', 'ok = True\n');

	const catalog = overrides.catalog ?? {
		languages: [
			{ id: 'typescript', displayName: 'TypeScript' },
			{ id: 'python', displayName: 'Python' },
		],
		capabilities: [
			{ id: 'wire.result', label: 'CommandResult' },
			{ id: 'mcp.tasks', label: 'MCP Tasks' },
		],
		tables: [
			{
				id: 'parity.wire',
				file: 'docs/language-parity.md',
				firstColumn: 'Capability',
				rows: [{ capability: 'wire.result' }, { capability: 'mcp.tasks', view: 'compact' }],
			},
			{
				id: 'spec.status',
				file: 'spec/example.md',
				layout: 'by-language',
				firstColumn: 'Language',
				columns: [
					{ header: 'Evidence', capability: 'wire.result', field: 'evidence' },
					{ header: 'Tasks', capability: 'mcp.tasks', field: 'status', view: 'compact' },
				],
			},
		],
	};

	const ts = overrides.ts ?? {
		language: 'typescript',
		displayName: 'TypeScript',
		capabilities: {
			'wire.result': {
				status: 'yes',
				evidence: ['packages/core/src/result.ts'],
			},
			'mcp.tasks': {
				status: 'yes',
				note: 'full support',
				views: { compact: '(#1971)' },
				evidence: ['packages/core/src/result.ts'],
			},
		},
	};

	const py = overrides.py ?? {
		language: 'python',
		displayName: 'Python',
		capabilities: {
			'wire.result': {
				status: 'yes',
				evidence: ['python/src/result.py'],
			},
			'mcp.tasks': {
				status: 'planned',
				note: '(#1972)',
				views: { compact: '(#1972)' },
				issue: '#1972',
				evidence: ['spec/example.md'],
			},
		},
	};

	writeFile(root, 'spec/capabilities/catalog.json', `${JSON.stringify(catalog, null, '\t')}\n`);
	writeFile(root, 'spec/capabilities/typescript.json', `${JSON.stringify(ts, null, '\t')}\n`);
	writeFile(root, 'spec/capabilities/python.json', `${JSON.stringify(py, null, '\t')}\n`);

	writeFile(
		root,
		'docs/language-parity.md',
		overrides.parityDoc ??
			[
				'# Parity',
				'',
				'<!-- generated:capabilities:parity.wire:start -->',
				'<!-- generated:capabilities:parity.wire:end -->',
				'',
			].join('\n')
	);
	writeFile(
		root,
		'spec/example.md',
		overrides.specDoc ??
			[
				'# Example',
				'',
				'<!-- generated:capabilities:spec.status:start -->',
				'<!-- generated:capabilities:spec.status:end -->',
				'',
			].join('\n')
	);

	if (overrides.sync !== false) {
		const synced = checkCapabilities({ root, write: true });
		assert.deepEqual(synced.problems, []);
	}

	return root;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		rmSync(tempDirs.pop(), { recursive: true, force: true });
	}
});

describe('check-capabilities', () => {
	test('renderCell keeps canonical status word across views', () => {
		const entry = { status: 'yes', note: 'verbose detail', views: { short: '(#42)', bare: '' } };
		assert.equal(renderCell(entry), 'Yes: verbose detail');
		assert.equal(renderCell(entry, 'short'), 'Yes (#42)');
		assert.equal(renderCell(entry, 'bare'), 'Yes');
		assert.equal(renderCell({ status: 'partial', note: ', with caveat' }), 'Partial, with caveat');
	});

	test('passing fixture passes check with zero problems (no-op control)', () => {
		const root = createFixture();
		const res = checkCapabilities({ root });
		assert.deepEqual(res.problems, []);
		assert.equal(res.stats.languages, 2);
		assert.equal(res.stats.capabilities, 2);
		assert.equal(res.stats.tables, 2);
	});

	test('fails when catalog.json or a language manifest is JSON null or non-object', () => {
		const root = createFixture();
		writeFile(root, 'spec/capabilities/catalog.json', 'null\n');
		const nullCatalog = checkCapabilities({ root });
		assert.ok(
			nullCatalog.problems.some((p) =>
				p.includes('catalog.json: top-level JSON value must be an object')
			)
		);

		const root2 = createFixture();
		writeFile(root2, 'spec/capabilities/python.json', 'null\n');
		const nullManifest = checkCapabilities({ root: root2 });
		assert.ok(
			nullManifest.problems.some((p) =>
				p.includes('python.json: top-level JSON value must be an object')
			)
		);
	});

	test('detects rendered table drift and --write repairs it, preserving CRLF', () => {
		const root = createFixture();
		const parityPath = join(root, 'docs/language-parity.md');
		const crlfClean = readFileSync(parityPath, 'utf8').replace(/\n/g, '\r\n');
		writeFileSync(parityPath, crlfClean, 'utf8');
		assert.deepEqual(checkCapabilities({ root }).problems, []);

		const drifted = crlfClean.replace('Yes (#1971)', 'Planned');
		writeFileSync(parityPath, drifted, 'utf8');

		const failed = checkCapabilities({ root });
		assert.equal(failed.problems.length, 1);
		assert.match(
			failed.problems[0],
			/docs\/language-parity\.md: table "parity\.wire" is out of date/
		);

		const repaired = checkCapabilities({ root, write: true });
		assert.deepEqual(repaired.problems, []);
		assert.deepEqual(repaired.updated, ['docs/language-parity.md']);
		assert.ok(readFileSync(parityPath, 'utf8').includes('\r\n'));

		assert.deepEqual(checkCapabilities({ root }).problems, []);
	});

	test('fails when a capability is missing from a language manifest', () => {
		const root = createFixture({
			py: {
				language: 'python',
				displayName: 'Python',
				capabilities: {
					'wire.result': { status: 'yes', evidence: ['python/src/result.py'] },
				},
			},
			sync: false,
		});
		const { problems } = loadAndValidate(root);
		assert.ok(problems.some((p) => p.includes('python.json: missing capability "mcp.tasks"')));
	});

	test('fails when a language manifest contains an unknown capability', () => {
		const root = createFixture({
			py: {
				language: 'python',
				displayName: 'Python',
				capabilities: {
					'wire.result': { status: 'yes', evidence: ['python/src/result.py'] },
					'mcp.tasks': { status: 'planned', issue: '#1', evidence: ['spec/example.md'] },
					'ghost.cap': { status: 'no', evidence: [] },
				},
			},
			sync: false,
		});
		const { problems } = loadAndValidate(root);
		assert.ok(problems.some((p) => p.includes('unknown capability not listed in catalog.json')));
	});

	test('fails on invalid status, empty yes/partial evidence, misspelled evidence path, and empty planned entry', () => {
		const root = createFixture({
			ts: {
				language: 'typescript',
				displayName: 'TypeScript',
				capabilities: {
					'wire.result': { status: 'yes', evidence: [] },
					'mcp.tasks': {
						status: 'yes',
						views: { compact: '(#1971)' },
						evidence: ['pakages/core/absent.ts'],
					},
				},
			},
			py: {
				language: 'python',
				displayName: 'Python',
				capabilities: {
					'wire.result': { status: 'maybe', evidence: ['python/src/result.py'] },
					'mcp.tasks': { status: 'planned', evidence: [] },
				},
			},
			sync: false,
		});
		const { problems } = loadAndValidate(root);
		assert.ok(problems.some((p) => p.includes('status "yes" requires non-empty "evidence"')));
		assert.ok(
			problems.some((p) => p.includes('evidence path "pakages/core/absent.ts" does not exist'))
		);
		assert.ok(problems.some((p) => p.includes('invalid status "maybe"')));
		assert.ok(
			problems.some((p) => p.includes('status "planned" requires a "note", "issue" or "evidence"'))
		);
	});

	test('fails on undeclared JSON manifest, unreferenced capability, invalid col.field, and pipe/newline in cell text', () => {
		const root = createFixture({
			catalog: {
				languages: [
					{ id: 'typescript', displayName: 'TypeScript' },
					{ id: 'python', displayName: 'Python' },
				],
				capabilities: [
					{ id: 'wire.result', label: 'CommandResult | broken' },
					{ id: 'mcp.tasks', label: 'MCP Tasks' },
					{ id: 'unused.cap', label: 'Unused' },
				],
				tables: [
					{
						id: 'parity.wire',
						file: 'docs/language-parity.md',
						firstColumn: 'Capability',
						rows: [{ capability: 'wire.result' }],
					},
					{
						id: 'spec.status',
						file: 'spec/example.md',
						layout: 'by-language',
						firstColumn: 'Language',
						columns: [
							{ header: 'Tasks', capability: 'mcp.tasks', field: 'bogus', view: 'compact' },
						],
					},
				],
			},
			sync: false,
		});
		writeFile(root, 'spec/capabilities/extra.json', '{}\n');
		const { problems } = loadAndValidate(root);
		assert.ok(
			problems.some((p) => p.includes('unexpected JSON file not declared in catalog.json'))
		);
		assert.ok(
			problems.some((p) => p.includes('capability "unused.cap" is not rendered in any table'))
		);
		assert.ok(problems.some((p) => p.includes('invalid field "bogus"')));
		assert.ok(problems.some((p) => p.includes("contains an unescaped '|'")));
	});

	test('fails on orphan, duplicate, misordered, or wrong-file markers and refuses to rewrite on marker error', () => {
		const root = createFixture();
		const specPath = join(root, 'spec/example.md');
		const withOrphanAndDup = [
			readFileSync(specPath, 'utf8'),
			'<!-- generated:capabilities:spec.ghost:start -->',
			'<!-- generated:capabilities:spec.ghost:end -->',
			'<!-- generated:capabilities:spec.status:start -->',
			'<!-- generated:capabilities:parity.wire:start -->',
		].join('\n');
		writeFileSync(specPath, withOrphanAndDup, 'utf8');

		const res = checkCapabilities({ root, write: true });
		assert.ok(res.problems.some((p) => p.includes('orphan capability marker "spec.ghost"')));
		assert.ok(res.problems.some((p) => p.includes('duplicate start marker for "spec.status"')));
		assert.ok(
			res.problems.some((p) =>
				p.includes('marker "parity.wire" belongs to docs/language-parity.md')
			)
		);
		assert.equal(readFileSync(specPath, 'utf8'), withOrphanAndDup);
	});

	test('enforces doc-line-limits policy on generated tables and does not write over-limit output', () => {
		const root = createFixture({
			ts: {
				language: 'typescript',
				displayName: 'TypeScript',
				capabilities: {
					'wire.result': {
						status: 'yes',
						note: 'x'.repeat(1600),
						evidence: ['packages/core/src/result.ts'],
					},
					'mcp.tasks': {
						status: 'yes',
						views: { compact: '(#1971)' },
						evidence: ['packages/core/src/result.ts'],
					},
				},
			},
			sync: false,
		});
		const before = readFileSync(join(root, 'docs/language-parity.md'), 'utf8');
		const res = checkCapabilities({ root, write: true });
		assert.ok(res.problems.some((p) => p.includes('over the 1500-character doc-line limit')));
		assert.equal(readFileSync(join(root, 'docs/language-parity.md'), 'utf8'), before);
	});

	test('fails on unused view keys in a language manifest', () => {
		const root = createFixture({
			ts: {
				language: 'typescript',
				displayName: 'TypeScript',
				capabilities: {
					'wire.result': {
						status: 'yes',
						views: { typoView: 'unused' },
						evidence: ['packages/core/src/result.ts'],
					},
					'mcp.tasks': {
						status: 'yes',
						views: { compact: '(#1971)' },
						evidence: ['packages/core/src/result.ts'],
					},
				},
			},
			sync: false,
		});
		const { problems } = loadAndValidate(root);
		assert.ok(problems.some((p) => p.includes('unused view "typoView"')));
	});

	test('passes on the real AFD repository', () => {
		const res = checkCapabilities({ root: REPO_ROOT });
		assert.deepEqual(res.problems, []);
		assert.equal(res.stats.languages, 4);
		assert.ok(res.stats.capabilities > 50);
		assert.ok(res.stats.tables >= 15);
	});
});
