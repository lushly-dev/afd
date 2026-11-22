import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	encode,
	merge3,
	mergeUnit,
	RecordConflict,
	resolve,
	UNITS,
	unitOf,
} from './provenance-merge.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const BOTCORE = 'endpoints/botcore/provenance';
const MIRROR = 'endpoints/botcore/src/botcore/provenance';
const FAST_AF = 'foundations/fast-af/provenance';
const VIOLET = 'foundations/violet/provenance';
const HEALTH = 'endpoints/health/provenance';
const HEALTH_PIN = 'endpoints/health/tests/test_provenance.py';

describe('the records it writes', () => {
	it("serializes every unit's records exactly as they are committed", () => {
		for (const unit of UNITS)
			for (const name of ['adaptations.json', 'provenance.json']) {
				const path = join(ROOT, unit.dir, name);
				if (!existsSync(path)) continue;
				const text = readFileSync(path, 'utf8');
				assert.equal(encode(JSON.parse(text)), text, `${unit.dir}/${name}`);
			}
	});

	it('knows a record, its mirror, Health pin and nothing else', () => {
		assert.equal(unitOf(`${MIRROR}/provenance.json`).unit.dir, BOTCORE);
		assert.equal(unitOf(`${FAST_AF}/adaptations.json`).name, 'adaptations.json');
		assert.equal(unitOf(`${HEALTH}/provenance.json`).unit.dir, HEALTH);
		assert.equal(unitOf(HEALTH_PIN).unit.dir, HEALTH);
		assert.equal(unitOf(HEALTH_PIN).pin, true);
		assert.equal(unitOf('endpoints/botcore/src/botcore/server.py'), null);
		assert.equal(unitOf('endpoints/health/src/lushly_health/core.py'), null);
		assert.equal(unitOf('packages/core/provenance/provenance.json'), null);
	});
});

describe('whether the envelope commits the adaptations digest merges as a value (#1610)', () => {
	/** One unit's records three ways: `[rows, digest?]` per side, as base, ours, theirs. */
	const unit = (...sides) => {
		const versions = sides.map(([paths, digest]) => {
			const adaptations = encode({ files: paths.map((path) => ({ path, import_reason: '' })) });
			const record = { manifest: 'adaptations.json' };
			if (digest) record.sha256 = sha(adaptations);
			return {
				'adaptations.json': JSON.parse(adaptations),
				'provenance.json': { records: { adaptations: record } },
			};
		});
		return mergeUnit({
			names: () => new Set(['adaptations.json']),
			versions: (name) => versions.map((side) => side[name]),
			current: () => undefined,
			readFile: () => null,
		});
	};
	const envelope = (out) => JSON.parse(out['provenance.json']).records.adaptations;

	it('drops it when ours dropped it, even where theirs changed it', () => {
		// The base committed it; this branch dropped it; main recorded a file, so its digest changed.
		const out = unit([['a'], true], [['a'], false], [['a', 'b'], true]);
		assert.deepEqual(envelope(out), { manifest: 'adaptations.json' });
		assert.deepEqual(
			JSON.parse(out['adaptations.json']).files.map((row) => row.path),
			['a', 'b']
		);
	});

	it('keeps one a side added to a base without it, recomputed; the unit test then refuses it', () => {
		// Neither the base nor this branch commits it; main gained one (for Botcore or FAST-AF, a
		// regression). The merge carries it, recomputed from the merged adaptations.json, and the
		// unit's own provenance test refuses a committed digest until its recorder removes it.
		const out = unit([['a'], false], [['a', 'c'], false], [['a'], true]);
		assert.equal(envelope(out).sha256, sha(out['adaptations.json']));
	});
});

describe('merge3', () => {
	it('takes the side that changed, and a change both made alike', () => {
		assert.deepEqual(merge3({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 3 }), { a: 2, b: 3 });
		assert.deepEqual(merge3({ a: 1 }, { a: 2 }, { a: 2 }), { a: 2 });
		assert.deepEqual(merge3({ a: 1, b: 1 }, { a: 1 }, { a: 1, b: 1 }), { a: 1 });
	});

	it('refuses a value both sides changed differently, naming where', () => {
		assert.throws(() => merge3({ a: { b: 1 } }, { a: { b: 2 } }, { a: { b: 3 } }), {
			name: 'Error',
			message: 'both sides changed $.a.b',
		});
		assert.throws(() => merge3({ x: [1] }, { x: [1, 2] }, { x: [1, 3] }), RecordConflict);
	});
});

describe('resolve, against a real merge', () => {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))
	);
	const rows = (...paths) =>
		paths.map(([path, current, reason = '', extra = {}]) => ({
			path,
			current_import_sha256: current,
			import_reason: reason,
			...extra,
		}));
	const write = (root, files) => {
		for (const [path, text] of Object.entries(files)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), text);
		}
	};
	/**
	 * A unit's records for `files`, as its recorder writes them, with the mirror for Botcore.
	 * `digest: false` is every unit's shape since #1610: no committed adaptations digest.
	 */
	const records = (dir, files, extra = {}, { digest = true } = {}) => {
		const adaptations = encode({ kind: 'reviewed-import-adaptations', files });
		const upstream = encode({ files: [] });
		const envelope = encode({
			schema_version: 1,
			...extra,
			records: {
				upstream: { manifest: 'upstream-selected.json', sha256: sha(upstream) },
				adaptations: {
					manifest: 'adaptations.json',
					...(digest ? { sha256: sha(adaptations) } : {}),
				},
			},
		});
		const out = {};
		for (const where of dir === BOTCORE ? [BOTCORE, MIRROR] : [dir]) {
			out[`${where}/adaptations.json`] = adaptations;
			out[`${where}/upstream-selected.json`] = upstream;
			out[`${where}/provenance.json`] = envelope;
		}
		return out;
	};
	const repo = (t) => {
		const root = mkdtempSync(join(tmpdir(), 'afd-provenance-merge-'));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const git = (args) =>
			execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], {
				cwd: root,
				encoding: 'utf8',
				env,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
		git(['init', '-q', '-b', 'main']);
		const commit = (files, message) => {
			write(root, files);
			git(['add', '-A']);
			git(['commit', '-q', '-m', message]);
		};
		return { root, git, commit };
	};
	/** main and the branch each record a different file of Botcore and FAST-AF, then merge. */
	const diverge = (t, branchRows, mainC = ['c.py', 'c2']) => {
		const { root, git, commit } = repo(t);
		const base = [
			['a.py', 'a0'],
			['c.py', 'c0'],
		];
		commit(
			{ ...records(BOTCORE, rows(...base)), ...records(FAST_AF, rows(['z.ts', 'z0'])) },
			'base'
		);
		git(['checkout', '-q', '-b', 'feat']);
		commit(
			{
				...records(BOTCORE, rows(...branchRows)),
				...records(FAST_AF, rows(['z.ts', 'z0'], ['y.ts', 'y1'])),
			},
			'branch'
		);
		git(['checkout', '-q', 'main']);
		commit(
			{
				...records(BOTCORE, rows(['a.py', 'a0'], ['b.py', 'b1'], mainC), {
					reconciled: 'on main',
				}),
				...records(FAST_AF, rows(['z.ts', 'z0'], ['x.ts', 'x1'])),
			},
			'main'
		);
		git(['checkout', '-q', 'feat']);
		try {
			git(['merge', '-q', '--no-edit', 'main']);
		} catch {}
		return { root, git };
	};
	const read = (root, path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

	it("merges both sides' rows, recomputes the hashes and stages the mirror", (t) => {
		const { root, git } = diverge(t, [
			['a.py', 'a1'],
			['c.py', 'c0'],
			['d.py', 'd1'],
		]);
		assert.notEqual(git(['diff', '--name-only', '--diff-filter=U']).trim(), '');
		const written = resolve(git, root);
		assert.ok(written.includes(`${MIRROR}/provenance.json`));
		assert.equal(git(['diff', '--name-only', '--diff-filter=U']).trim(), '');
		const adaptations = read(root, `${BOTCORE}/adaptations.json`);
		assert.deepEqual(
			adaptations.files.map((row) => [row.path, row.current_import_sha256]),
			[
				['a.py', 'a1'],
				['b.py', 'b1'],
				['c.py', 'c2'],
				['d.py', 'd1'],
			],
			'sorted rows stay sorted'
		);
		const envelope = read(root, `${BOTCORE}/provenance.json`);
		assert.equal(envelope.reconciled, 'on main');
		const text = (path) => readFileSync(join(root, path), 'utf8');
		assert.equal(envelope.records.adaptations.sha256, sha(text(`${BOTCORE}/adaptations.json`)));
		assert.equal(envelope.records.upstream.sha256, sha(text(`${BOTCORE}/upstream-selected.json`)));
		for (const name of ['adaptations.json', 'provenance.json'])
			assert.equal(text(`${MIRROR}/${name}`), text(`${BOTCORE}/${name}`));
		const fast = read(root, `${FAST_AF}/adaptations.json`).files.map((row) => row.path);
		assert.deepEqual(fast, ['z.ts', 'y.ts', 'x.ts'], 'unsorted rows keep their places');
		git(['commit', '-q', '--no-edit']);
	});

	it("takes the merged file's hash and both reasons for a file both sides recorded", (t) => {
		const { root, git } = diverge(
			t,
			[
				['a.py', 'a0'],
				['c.py', 'c1', 'the branch'],
			],
			['c.py', 'c2', 'main']
		);
		write(root, { 'endpoints/botcore/c.py': 'both edits\n' }); // As git merged it.
		resolve(git, root);
		const row = read(root, `${BOTCORE}/adaptations.json`).files.find((r) => r.path === 'c.py');
		assert.equal(row.current_import_sha256, sha('both edits\n'));
		assert.equal(row.import_reason, 'main; the branch');
	});

	it('refuses another field of a row both sides changed, and writes nothing', (t) => {
		const { root, git } = diverge(
			t,
			[
				['a.py', 'a0'],
				['c.py', 'c1', '', { import_classification: 'modified-after-staging' }],
			],
			['c.py', 'c2', '', { import_classification: 'unchanged-staged' }]
		);
		const before = readFileSync(join(root, `${FAST_AF}/provenance.json`), 'utf8');
		assert.throws(
			() => resolve(git, root),
			/both sides changed \$\.files\[c\.py\]\.import_classification/
		);
		assert.equal(readFileSync(join(root, `${FAST_AF}/provenance.json`), 'utf8'), before);
		assert.notEqual(git(['diff', '--name-only', '--diff-filter=U']).trim(), '');
	});

	it('recomputes both current_import_sha256 and manifest_shape_sha256 for a manifest both sides recorded', (t) => {
		const shape = { manifest_shape_sha256: 's0' };
		const { root, git } = diverge(
			t,
			[
				['a.py', 'a0'],
				['package.json', 'p1', 'branch', shape],
			],
			['package.json', 'p2', 'main', shape]
		);
		const manifest = `${JSON.stringify({ name: '@fixture/pkg', version: '1.0.0', dependencies: { a: '^2.0.0' } }, null, 2)}\n`;
		write(root, { 'endpoints/botcore/package.json': manifest });
		resolve(git, root);
		const row = read(root, `${BOTCORE}/adaptations.json`).files.find(
			(r) => r.path === 'package.json'
		);
		assert.equal(row.current_import_sha256, sha(manifest));
		assert.equal(
			row.manifest_shape_sha256,
			sha(JSON.stringify({ name: '@fixture/pkg', version: '1.0.0', dependencies: { a: '' } }))
		);
		assert.equal(row.import_reason, 'main; branch');
	});

	it('refuses a file both sides recorded when the merged file is missing on disk', (t) => {
		const { root, git } = diverge(
			t,
			[
				['a.py', 'a0'],
				['c.py', 'c1', 'branch'],
			],
			['c.py', 'c2', 'main']
		);
		assert.throws(() => resolve(git, root), /\[c\.py\], whose merged file cannot be read/);
	});

	describe('Violet records hashed before release (#1472)', () => {
		const violetInventory = encode({
			units: [
				{
					id: 'violet-npm',
					distributions: [
						{
							name: '@lushly-dev/violet-cli',
							manifest: 'endpoints/violet-cli/package.json',
							initialVersion: '0.3.0-preview',
						},
					],
				},
			],
		});
		const violetRecords = (files) => ({
			[`${VIOLET}/adaptations.json`]: encode({
				kind: 'reviewed-import-adaptations',
				files,
			}),
			[`${VIOLET}/provenance.json`]: encode({
				schema_version: 1,
				records: { adaptations: { manifest: 'adaptations.json' } },
			}),
		});

		it('merges a Violet manifest, changelog and source file both sides edited using pre-release bytes', (t) => {
			const { root, git, commit } = repo(t);
			const basePkg =
				'{\n  "name": "@lushly-dev/violet-cli",\n  "version": "0.3.0-preview.2",\n  "dependencies": { "@lushly-dev/violet-core": "workspace:^0.3.0-preview.2" },\n  "description": "base"\n}\n';
			const baseLog =
				'# @lushly-dev/violet-cli\n\n## 0.3.0-preview.2\n\n- Released\n\n## 0.2.0\n\n- Base\n';
			const baseDoc = 'line 1\nline 2\nline 3\nline 4\nline 5\n';
			const row = (path, hash, reason, extra = {}) => ({
				path,
				current_import_sha256: hash,
				classification: 'adapted',
				reason,
				...extra,
			});
			commit(
				{
					'scripts/release/inventory.json': violetInventory,
					'endpoints/violet-cli/package.json': basePkg,
					'endpoints/violet-cli/CHANGELOG.md': baseLog,
					'endpoints/violet-cli/README.md': baseDoc,
					...violetRecords([
						row('endpoints/violet-cli/CHANGELOG.md', 'l0', 'base'),
						row('endpoints/violet-cli/README.md', 'r0', 'base'),
						row('endpoints/violet-cli/package.json', 'p0', 'base', {
							manifest_shape_sha256: 's0',
						}),
					]),
				},
				'base'
			);
			git(['checkout', '-q', '-b', 'feat']);
			const branchPkg = basePkg.replace('"description": "base"', '"description": "branch"');
			const branchLog = `${baseLog}- Branch note\n`;
			const branchDoc = baseDoc.replace('line 1', 'line 1 branch');
			commit(
				{
					'endpoints/violet-cli/package.json': branchPkg,
					'endpoints/violet-cli/CHANGELOG.md': branchLog,
					'endpoints/violet-cli/README.md': branchDoc,
					...violetRecords([
						row('endpoints/violet-cli/CHANGELOG.md', 'l1', 'branch log'),
						row('endpoints/violet-cli/README.md', 'r1', 'branch doc'),
						row('endpoints/violet-cli/package.json', 'p1', 'branch pkg', {
							manifest_shape_sha256: 's1',
						}),
					]),
				},
				'branch'
			);
			git(['checkout', '-q', 'main']);
			const mainPkg = basePkg.replace(
				'"name": "@lushly-dev/violet-cli",',
				'"name": "@lushly-dev/violet-cli",\n  "keywords": ["violet"],'
			);
			const mainLog = baseLog.replace('## 0.2.0', '## 0.2.0\n\n- Main note');
			const mainDoc = baseDoc.replace('line 5', 'line 5 main');
			commit(
				{
					'endpoints/violet-cli/package.json': mainPkg,
					'endpoints/violet-cli/CHANGELOG.md': mainLog,
					'endpoints/violet-cli/README.md': mainDoc,
					...violetRecords([
						row('endpoints/violet-cli/CHANGELOG.md', 'l2', 'main log'),
						row('endpoints/violet-cli/README.md', 'r2', 'main doc'),
						row('endpoints/violet-cli/package.json', 'p2', 'main pkg', {
							manifest_shape_sha256: 's2',
						}),
					]),
				},
				'main'
			);
			git(['checkout', '-q', 'feat']);
			assert.throws(() => git(['merge', '-q', '--no-edit', 'main']));
			assert.deepEqual(git(['diff', '--name-only', '--diff-filter=U']).trim().split('\n'), [
				`${VIOLET}/adaptations.json`,
			]);
			resolve(git, root);
			const files = read(root, `${VIOLET}/adaptations.json`).files;
			const byPath = new Map(files.map((f) => [f.path, f]));

			// package.json hash and shape use pre-release 0.3.0-preview version, not 0.3.0-preview.2.
			const mergedPkg = readFileSync(join(root, 'endpoints/violet-cli/package.json'), 'utf8');
			const prePkg = mergedPkg
				.replace('"version": "0.3.0-preview.2"', '"version": "0.3.0-preview"')
				.replaceAll('"workspace:^0.3.0-preview.2"', '"workspace:^0.3.0-preview"');
			assert.equal(
				byPath.get('endpoints/violet-cli/package.json').current_import_sha256,
				sha(prePkg)
			);
			assert.equal(
				byPath.get('endpoints/violet-cli/package.json').manifest_shape_sha256,
				sha(
					JSON.stringify({ ...JSON.parse(prePkg), dependencies: { '@lushly-dev/violet-core': '' } })
				)
			);
			assert.equal(byPath.get('endpoints/violet-cli/package.json').reason, 'main pkg; branch pkg');

			// CHANGELOG.md hash strips the released 0.3.0-preview.2 section.
			const mergedLog = readFileSync(join(root, 'endpoints/violet-cli/CHANGELOG.md'), 'utf8');
			const preLog = mergedLog.replace(/## 0\.3\.0-preview\.2\r?\n\r?\n- Released\r?\n\r?\n/, '');
			assert.equal(
				byPath.get('endpoints/violet-cli/CHANGELOG.md').current_import_sha256,
				sha(preLog)
			);
			assert.equal(byPath.get('endpoints/violet-cli/CHANGELOG.md').reason, 'main log; branch log');

			// README.md uses raw bytes.
			const mergedDoc = readFileSync(join(root, 'endpoints/violet-cli/README.md'), 'utf8');
			assert.equal(
				byPath.get('endpoints/violet-cli/README.md').current_import_sha256,
				sha(mergedDoc)
			);
			assert.equal(byPath.get('endpoints/violet-cli/README.md').reason, 'main doc; branch doc');
		});
	});

	describe('Health provenance.json and test_provenance.py pin (#1472)', () => {
		const pinFile = (hash, extra = '') =>
			`${[
				'from pathlib import Path',
				'ROOT = Path(__file__).resolve().parents[1]',
				'RECORD = ROOT / "provenance" / "provenance.json"',
				`RECORD_SHA256 = "${hash}"`,
				'SOURCE_REVISION = "abc"',
				extra,
			].join('\n')}\n`;
		const healthCommit = (record, { pinHash, pinExtra = '' } = {}) => {
			const text = encode(record);
			return {
				[`${HEALTH}/provenance.json`]: text,
				[HEALTH_PIN]: pinFile(pinHash ?? sha(text), pinExtra),
			};
		};
		const baseHealth = () => ({
			schema_version: 1,
			source: { revision: 'abc' },
			adapted_functions: [{ name: 'fn_a', imported_as: 'core.a', change: 'wrapped' }],
			files: [
				{ path: 'LICENSE', origin: 'license', sha256: 'lic0' },
				{ path: 'src/lushly_health/checks.py', origin: 'derived', sha256: 'chk0' },
				{ path: 'src/lushly_health/core.py', origin: 'authored' },
				{ path: 'tests/test_audit.py', origin: 'authored', adaptation: 'Base note' },
				{ path: 'tests/test_provenance.py', origin: 'authored' },
			],
		});

		it('merges Health files, adapted_functions and updates RECORD_SHA256 in test_provenance.py', (t) => {
			const { root, git, commit } = repo(t);
			const base = baseHealth();
			commit(healthCommit(base), 'base');

			git(['checkout', '-q', '-b', 'feat']);
			const ours = structuredClone(base);
			ours.files.push({ path: 'src/lushly_health/branch_only.py', origin: 'authored' });
			ours.files.sort((a, b) => a.path.localeCompare(b.path));
			ours.adapted_functions.push({ name: 'fn_b', imported_as: 'core.b', change: 'branch' });
			commit(healthCommit(ours, { pinExtra: 'def test_branch():\n    assert True' }), 'branch');

			git(['checkout', '-q', 'main']);
			const theirs = structuredClone(base);
			theirs.files.push({ path: 'src/lushly_health/main_only.py', origin: 'authored' });
			theirs.files.sort((a, b) => a.path.localeCompare(b.path));
			theirs.adapted_functions.push({ name: 'fn_c', imported_as: 'core.c', change: 'main' });
			commit(healthCommit(theirs), 'main');

			git(['checkout', '-q', 'feat']);
			assert.throws(() => git(['merge', '-q', '--no-edit', 'main']));
			const written = resolve(git, root);
			assert.deepEqual(written.sort(), [`${HEALTH}/provenance.json`, HEALTH_PIN].sort());
			assert.equal(git(['diff', '--name-only', '--diff-filter=U']).trim(), '');

			const mergedText = readFileSync(join(root, `${HEALTH}/provenance.json`), 'utf8');
			const merged = JSON.parse(mergedText);
			assert.deepEqual(
				merged.files.map((f) => f.path),
				[
					'LICENSE',
					'src/lushly_health/branch_only.py',
					'src/lushly_health/checks.py',
					'src/lushly_health/core.py',
					'src/lushly_health/main_only.py',
					'tests/test_audit.py',
					'tests/test_provenance.py',
				]
			);
			assert.deepEqual(
				merged.adapted_functions.map((f) => f.name),
				['fn_a', 'fn_b', 'fn_c']
			);
			const pinText = readFileSync(join(root, HEALTH_PIN), 'utf8');
			assert.ok(pinText.includes(`RECORD_SHA256 = "${sha(mergedText)}"`));
			assert.ok(pinText.includes('def test_branch():'));
			git(['commit', '-q', '--no-edit']);
		});

		it('joins adaptation notes when both sides annotate the same authored Health file', (t) => {
			const { root, git, commit } = repo(t);
			const base = baseHealth();
			commit(healthCommit(base), 'base');

			git(['checkout', '-q', '-b', 'feat']);
			const ours = structuredClone(base);
			ours.files.find((f) => f.path === 'tests/test_audit.py').adaptation =
				'Base note; Branch note';
			commit(healthCommit(ours), 'branch');

			git(['checkout', '-q', 'main']);
			const theirs = structuredClone(base);
			theirs.files.find((f) => f.path === 'tests/test_audit.py').adaptation =
				'Base note; Main note';
			commit(healthCommit(theirs), 'main');

			git(['checkout', '-q', 'feat']);
			assert.throws(() => git(['merge', '-q', '--no-edit', 'main']));
			resolve(git, root);
			const merged = read(root, `${HEALTH}/provenance.json`);
			assert.equal(
				merged.files.find((f) => f.path === 'tests/test_audit.py').adaptation,
				'Base note; Main note; Branch note'
			);
		});

		it('resolves when provenance.json auto-merged and only test_provenance.py RECORD_SHA256 conflicted', (t) => {
			const { root, git, commit } = repo(t);
			const base = baseHealth();
			commit(healthCommit(base), 'base');

			git(['checkout', '-q', '-b', 'feat']);
			const ours = structuredClone(base);
			ours.files.unshift({ path: 'AAA_branch.py', origin: 'authored' });
			commit(healthCommit(ours), 'branch');

			git(['checkout', '-q', 'main']);
			const theirs = structuredClone(base);
			theirs.files.push({ path: 'zzz_main.py', origin: 'authored' });
			commit(healthCommit(theirs), 'main');

			git(['checkout', '-q', 'feat']);
			assert.throws(() => git(['merge', '-q', '--no-edit', 'main']));
			assert.deepEqual(git(['diff', '--name-only', '--diff-filter=U']).trim().split('\n'), [
				HEALTH_PIN,
			]);
			resolve(git, root);
			const mergedText = readFileSync(join(root, `${HEALTH}/provenance.json`), 'utf8');
			assert.ok(
				readFileSync(join(root, HEALTH_PIN), 'utf8').includes(
					`RECORD_SHA256 = "${sha(mergedText)}"`
				)
			);
		});

		it('refuses when HEAD RECORD_SHA256 does not match HEAD provenance.json', (t) => {
			const { root, git, commit } = repo(t);
			const base = baseHealth();
			commit(healthCommit(base), 'base');

			git(['checkout', '-q', '-b', 'feat']);
			const ours = structuredClone(base);
			ours.files.push({ path: 'src/lushly_health/b.py', origin: 'authored' });
			commit(healthCommit(ours, { pinHash: '0'.repeat(64) }), 'branch tampered');

			git(['checkout', '-q', 'main']);
			const theirs = structuredClone(base);
			theirs.files.push({ path: 'src/lushly_health/m.py', origin: 'authored' });
			commit(healthCommit(theirs), 'main');

			git(['checkout', '-q', 'feat']);
			assert.throws(() => git(['merge', '-q', '--no-edit', 'main']));
			assert.throws(() => resolve(git, root), /HEAD's RECORD_SHA256 does not match/);
		});

		it('refuses a real conflict in test_provenance.py outside RECORD_SHA256', (t) => {
			const { root, git, commit } = repo(t);
			const base = baseHealth();
			commit(healthCommit(base, { pinExtra: 'X = 1' }), 'base');

			git(['checkout', '-q', '-b', 'feat']);
			const ours = structuredClone(base);
			ours.files.push({ path: 'src/lushly_health/b.py', origin: 'authored' });
			commit(healthCommit(ours, { pinExtra: 'X = 2' }), 'branch');

			git(['checkout', '-q', 'main']);
			const theirs = structuredClone(base);
			theirs.files.push({ path: 'src/lushly_health/m.py', origin: 'authored' });
			commit(healthCommit(theirs, { pinExtra: 'X = 3' }), 'main');

			git(['checkout', '-q', 'feat']);
			assert.throws(() => git(['merge', '-q', '--no-edit', 'main']));
			assert.throws(() => resolve(git, root), /conflicts outside RECORD_SHA256/);
		});

		it('refuses when both sides edit a derived Health file row', (t) => {
			const { root, git, commit } = repo(t);
			const base = baseHealth();
			commit(healthCommit(base), 'base');

			git(['checkout', '-q', '-b', 'feat']);
			const ours = structuredClone(base);
			ours.files.find((f) => f.path === 'src/lushly_health/checks.py').sha256 = 'chk1';
			commit(healthCommit(ours), 'branch');

			git(['checkout', '-q', 'main']);
			const theirs = structuredClone(base);
			theirs.files.find((f) => f.path === 'src/lushly_health/checks.py').sha256 = 'chk2';
			commit(healthCommit(theirs), 'main');

			git(['checkout', '-q', 'feat']);
			assert.throws(() => git(['merge', '-q', '--no-edit', 'main']));
			assert.throws(() => resolve(git, root), /bound by a frozen hash/);
		});

		it('merges non-conflicting edits to both sides of test_provenance.py while updating RECORD_SHA256', (t) => {
			const { root, git, commit } = repo(t);
			const base = baseHealth();
			const baseExtra = [
				'def test_one():',
				'    assert 1 == 1',
				'',
				'',
				'',
				'def test_two():',
				'    assert 2 == 2',
			].join('\n');
			commit(healthCommit(base, { pinExtra: baseExtra }), 'base');

			git(['checkout', '-q', '-b', 'feat']);
			const ours = structuredClone(base);
			ours.files.push({ path: 'src/lushly_health/b.py', origin: 'authored' });
			commit(
				healthCommit(ours, { pinExtra: baseExtra.replace('assert 1 == 1', 'assert 1 + 0 == 1') }),
				'branch'
			);

			git(['checkout', '-q', 'main']);
			const theirs = structuredClone(base);
			theirs.files.push({ path: 'src/lushly_health/m.py', origin: 'authored' });
			commit(
				healthCommit(theirs, { pinExtra: baseExtra.replace('assert 2 == 2', 'assert 2 + 0 == 2') }),
				'main'
			);

			git(['checkout', '-q', 'feat']);
			assert.throws(() => git(['merge', '-q', '--no-edit', 'main']));
			resolve(git, root);
			const mergedText = readFileSync(join(root, `${HEALTH}/provenance.json`), 'utf8');
			const pinText = readFileSync(join(root, HEALTH_PIN), 'utf8');
			assert.ok(pinText.includes(`RECORD_SHA256 = "${sha(mergedText)}"`));
			assert.ok(pinText.includes('assert 1 + 0 == 1'));
			assert.ok(pinText.includes('assert 2 + 0 == 2'));
		});

		it('refuses conflicting edits to the same Health adapted_functions entry', (t) => {
			const { root, git, commit } = repo(t);
			const base = baseHealth();
			commit(healthCommit(base), 'base');

			git(['checkout', '-q', '-b', 'feat']);
			const ours = structuredClone(base);
			ours.adapted_functions[0].change = 'branch change';
			commit(healthCommit(ours), 'branch');

			git(['checkout', '-q', 'main']);
			const theirs = structuredClone(base);
			theirs.adapted_functions[0].change = 'main change';
			commit(healthCommit(theirs), 'main');

			git(['checkout', '-q', 'feat']);
			assert.throws(() => git(['merge', '-q', '--no-edit', 'main']));
			assert.throws(() => resolve(git, root), /both sides changed \$\.adapted_functions\[fn_a\]/);
		});
	});

	describe('a unit that does not commit the adaptations digest (#1610)', () => {
		/** Rows of several fields apart, as real rows are: a file each side records is not adjacent. */
		const spaced = (...paths) =>
			rows(...paths).map((row) => ({ ...row, stage_reason: 'staged', origin: 'imported' }));
		const base = [
			['a.py', 'a0'],
			['b.py', 'b0'],
			['c.py', 'c0'],
		];
		const branchRows = [['a.py', 'a1'], ...base.slice(1)];
		const mainRows = [...base.slice(0, 2), ['c.py', 'c1']];
		/** Branch and main each record a different file, then git merges main into the branch. */
		const twoBranches = (t, digest) => {
			const { root, git, commit } = repo(t);
			const both = (paths) => ({
				...records(BOTCORE, spaced(...paths), {}, { digest }),
				...records(FAST_AF, spaced(...paths), {}, { digest }),
			});
			commit(both(base), 'base');
			git(['checkout', '-q', '-b', 'feat']);
			commit(both(branchRows), 'branch');
			git(['checkout', '-q', 'main']);
			commit(both(mainRows), 'main');
			git(['checkout', '-q', 'feat']);
			let conflicted = false;
			try {
				git(['merge', '-q', '--no-edit', 'main']);
			} catch {
				conflicted = true;
			}
			return { root, git, conflicted };
		};

		it('merges two branches that recorded different files with no conflict at all', (t) => {
			const committed = twoBranches(t, true);
			assert.ok(committed.conflicted, 'with the digest committed, the envelope conflicts');
			assert.deepEqual(
				committed.git(['diff', '--name-only', '--diff-filter=U']).trim().split('\n').sort(),
				[BOTCORE, MIRROR, FAST_AF].map((dir) => `${dir}/provenance.json`).sort()
			);
			const stamped = twoBranches(t, false);
			assert.equal(stamped.conflicted, false, 'without it, git merges the records itself');
			for (const dir of [BOTCORE, FAST_AF]) {
				const adaptations = read(stamped.root, `${dir}/adaptations.json`).files;
				assert.deepEqual(
					adaptations.map((row) => row.current_import_sha256),
					['a1', 'b0', 'c1']
				);
				assert.ok(!('sha256' in read(stamped.root, `${dir}/provenance.json`).records.adaptations));
			}
		});

		it('merges rows that do conflict, and commits no adaptations digest', (t) => {
			const { root, git } = diverge(t, [
				['a.py', 'a1'],
				['c.py', 'c0'],
			]);
			// diverge() commits the digest shape; take main and the branch to the new one.
			git(['merge', '--abort']);
			const strip = (message) => {
				for (const dir of [BOTCORE, MIRROR, FAST_AF]) {
					const path = join(root, dir, 'provenance.json');
					const envelope = JSON.parse(readFileSync(path, 'utf8'));
					delete envelope.records.adaptations.sha256;
					writeFileSync(path, encode(envelope));
				}
				git(['commit', '-q', '-am', message]);
			};
			strip('branch drops the digest');
			git(['checkout', '-q', 'main']);
			strip('main drops the digest');
			git(['checkout', '-q', 'feat']);
			assert.throws(() => git(['merge', '-q', '--no-edit', 'main']));
			const unmerged = git(['diff', '--name-only', '--diff-filter=U']);
			assert.doesNotMatch(unmerged, /provenance\.json/, 'only the rows conflict');
			resolve(git, root);
			const envelope = read(root, `${BOTCORE}/provenance.json`);
			assert.ok(!('sha256' in envelope.records.adaptations));
			const text = (path) => readFileSync(join(root, path), 'utf8');
			assert.equal(
				envelope.records.upstream.sha256,
				sha(text(`${BOTCORE}/upstream-selected.json`))
			);
			assert.equal(text(`${MIRROR}/provenance.json`), text(`${BOTCORE}/provenance.json`));
			assert.deepEqual(
				read(root, `${BOTCORE}/adaptations.json`).files.map((row) => row.current_import_sha256),
				['a1', 'b1', 'c2']
			);
		});

		it('drops the digest from a branch that still commits it once the base does not', (t) => {
			const { root, git } = diverge(t, [
				['a.py', 'a1'],
				['c.py', 'c0'],
			]);
			git(['merge', '--abort']);
			git(['checkout', '-q', 'main']);
			const path = join(root, BOTCORE, 'provenance.json');
			const envelope = JSON.parse(readFileSync(path, 'utf8'));
			delete envelope.records.adaptations.sha256;
			for (const dir of [BOTCORE, MIRROR])
				writeFileSync(join(root, dir, 'provenance.json'), encode(envelope));
			git(['commit', '-q', '-am', 'main drops the digest']);
			git(['checkout', '-q', 'feat']);
			assert.throws(() => git(['merge', '-q', '--no-edit', 'main']));
			resolve(git, root);
			assert.ok(!('sha256' in read(root, `${BOTCORE}/provenance.json`).records.adaptations));
			// FAST-AF still commits it on both sides here, so it is recomputed as before.
			const fast = read(root, `${FAST_AF}/provenance.json`).records.adaptations.sha256;
			assert.equal(fast, sha(readFileSync(join(root, FAST_AF, 'adaptations.json'))));
		});
	});

	it('refuses a conflict outside the records', (t) => {
		const { root, git, commit } = repo(t);
		commit({ 'src/a.ts': 'a\n' }, 'base');
		git(['checkout', '-q', '-b', 'feat']);
		commit({ 'src/a.ts': 'b\n' }, 'branch');
		git(['checkout', '-q', 'main']);
		commit({ 'src/a.ts': 'c\n' }, 'main');
		git(['checkout', '-q', 'feat']);
		try {
			git(['merge', '-q', '--no-edit', 'main']);
		} catch {}
		assert.throws(() => resolve(git, root), /src\/a\.ts is not a provenance record/);
	});
});
