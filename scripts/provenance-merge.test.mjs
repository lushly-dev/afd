import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { encode, merge3, RecordConflict, resolve, UNITS, unitOf } from './provenance-merge.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const BOTCORE = 'endpoints/botcore/provenance';
const MIRROR = 'endpoints/botcore/src/botcore/provenance';
const FAST_AF = 'foundations/fast-af/provenance';

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

	it('knows a record, its mirror and nothing else', () => {
		assert.equal(unitOf(`${MIRROR}/provenance.json`).unit.dir, BOTCORE);
		assert.equal(unitOf(`${FAST_AF}/adaptations.json`).name, 'adaptations.json');
		assert.equal(unitOf('endpoints/botcore/src/botcore/server.py'), null);
		assert.equal(unitOf('packages/core/provenance/provenance.json'), null);
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
	/** A unit's records for `files`, as its recorder writes them, with the mirror for Botcore. */
	const records = (dir, files, extra = {}) => {
		const adaptations = encode({ kind: 'reviewed-import-adaptations', files });
		const upstream = encode({ files: [] });
		const envelope = encode({
			schema_version: 1,
			...extra,
			records: {
				upstream: { manifest: 'upstream-selected.json', sha256: sha(upstream) },
				adaptations: { manifest: 'adaptations.json', sha256: sha(adaptations) },
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

	it('refuses a file both sides recorded when its hash is not of its bytes', (t) => {
		const shape = { manifest_shape_sha256: 's' };
		const { root, git } = diverge(
			t,
			[
				['a.py', 'a0'],
				['c.py', 'c1', '', shape],
			],
			['c.py', 'c2', '', shape]
		);
		assert.throws(() => resolve(git, root), /\[c\.py\], which is not hashed by its bytes/);
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
