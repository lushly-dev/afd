import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
	assertAdmission,
	candidateDigest,
	discoverDistributions,
	loadInventory,
	parseFragments,
	planRelease,
	safePath,
} from './control.mjs';
import { simulateHandoff } from './handoff.mjs';

function write(root, file, text) {
	mkdirSync(dirname(join(root, file)), { recursive: true });
	writeFileSync(join(root, file), text);
}
function fixture({ held = false, dependency, shared = false, fixed = false } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'afd-release-'));
	const units = ['a', 'b'].map((id) => ({
		id,
		family: id,
		protocol: 'npm-changesets',
		sourceRevision: 'fixture-revision',
		authority: 'fixture-authority',
		state: id === 'b' && held ? 'held' : 'admitted',
		routes: ['npm-main'],
		gates: ['quality', 'artifact', 'isolated-install'],
		fixed: fixed && id === 'a',
		distributions: [
			{
				name: `@fixture/${id}`,
				registry: 'npm',
				format: 'npm',
				manifest: `foundations/${id}/package.json`,
				initialVersion: '1.0.0',
			},
		],
	}));
	if (fixed)
		units[0].distributions.push({
			name: '@fixture/a-helper',
			registry: 'npm',
			format: 'npm',
			manifest: 'foundations/a-helper/package.json',
			initialVersion: '1.0.0',
		});
	for (const unit of units)
		for (const entry of unit.distributions)
			write(
				root,
				entry.manifest,
				JSON.stringify({
					name: entry.name,
					version: '1.0.0',
					...(dependency && unit.id === 'a' ? { dependencies: { '@fixture/b': dependency } } : {}),
				})
			);
	write(root, 'scripts/release/inventory.json', JSON.stringify({ schemaVersion: 1, units }));
	write(
		root,
		'.changeset/a.md',
		`---\n"@fixture/a": patch\n${shared ? '"@fixture/b": minor\n' : ''}---\nA change\n`
	);
	if (!shared) write(root, '.changeset/b.md', '---\n"@fixture/b": patch\n---\nB change\n');
	return { root, inventory: loadInventory(root) };
}
const plan = (fixture, extra = {}) => planRelease({ ...fixture, selectedUnits: ['a'], ...extra });

test('batch 1: unrelated held unit leaves its manifests and fragments untouched', () => {
	const f = fixture({ held: true });
	const before = readFileSync(join(f.root, '.changeset/b.md'), 'utf8');
	const result = plan(f);
	assert.deepEqual(result.selectedUnits, ['a']);
	assert.equal(result.fragments.length, 1);
	assert.equal(readFileSync(join(f.root, '.changeset/b.md'), 'utf8'), before);
	assert.throws(() => plan(f, { selectedUnits: ['b'] }), /not admitted/);
});
test('batch 2: a required new held prerequisite blocks the dependent', () => {
	const f = fixture({ held: true, dependency: '^1.0.0' });
	assert.throws(() => plan(f), /Unsatisfied prerequisite/);
	assert.throws(() => plan(f, { selectedUnits: ['a', 'b'] }), /not admitted/);
});
test('batch 3: explicit compatible published evidence satisfies held prerequisite', () => {
	const f = fixture({ held: true, dependency: '^1.0.0' });
	assert.equal(
		plan(f, { registryEvidence: [{ registry: 'npm', name: '@fixture/b', versions: ['1.2.3'] }] })
			.distributions.length,
		1
	);
	assert.throws(
		() =>
			plan(f, { registryEvidence: [{ registry: 'npm', name: '@fixture/b', versions: ['2.0.0'] }] }),
		/Unsatisfied prerequisite/
	);
});
test('batch 4: deliberately coordinated fragment cannot be partially selected', () => {
	const f = fixture({ held: true, shared: true });
	assert.throws(() => plan(f), /Incomplete coordinated/);
});
test('selected approved prerequisite and dependent form a valid batch', () => {
	const f = fixture({ dependency: 'workspace:^' });
	assert.equal(plan(f, { selectedUnits: ['a', 'b'] }).distributions.length, 2);
});
test('unknown public distributions are quarantined even absent from registry', () => {
	const f = fixture();
	write(
		f.root,
		'endpoints/new/package.json',
		JSON.stringify({ name: '@fixture/new', version: '8.0.0' })
	);
	const unknown = discoverDistributions(f.root, f.inventory).find(
		(entry) => entry.name === '@fixture/new'
	);
	assert.equal(unknown.state, 'quarantined');
	assert.equal(unknown.unit, null);
	assert.equal(plan(f).distributions.length, 1);
	assert.throws(() => plan(f, { selectedUnits: ['@fixture/new'] }), /not admitted/);
});
test('manifest identity changes reject and exact contents are bound by digest', () => {
	const f = fixture();
	const first = plan(f);
	write(
		f.root,
		'foundations/a/package.json',
		'{"name":"@fixture/a","version":"1.0.0","description":"changed"}'
	);
	assert.notEqual(first.digest, plan(f).digest);
	write(f.root, 'foundations/a/package.json', '{"name":"@fixture/renamed","version":"1.0.0"}');
	assert.throws(() => plan(f), /identity changed/);
});
test('partial fixed versions and selecting a distribution instead of its unit reject', () => {
	const f = fixture({ fixed: true });
	write(
		f.root,
		'foundations/a-helper/package.json',
		'{"name":"@fixture/a-helper","version":"1.0.1"}'
	);
	assert.throws(() => plan(f), /Partial fixed group/);
	assert.throws(() => plan(f, { selectedUnits: ['@fixture/a'] }), /not admitted/);
});
test('unknown and mixed formats fail before release operations can write', () => {
	const f = fixture();
	write(f.root, '.changeset/category.json', '{"category":"fixed","summary":"wrong storage"}');
	assert.throws(() => plan(f), /Unknown release fragment/);
	assert.equal(
		readFileSync(join(f.root, 'foundations/a/package.json'), 'utf8').includes('1.0.0'),
		true
	);
});
test('same-protocol unknown ownership rejects; separate category storage is validated', () => {
	const f = fixture();
	f.inventory.storages = [
		{ path: '.changeset', protocol: 'npm-changesets' },
		{ path: 'release-intent/tools', protocol: 'category-json-v1' },
	];
	f.inventory.units.push({
		id: 'tool',
		family: 'tool',
		protocol: 'category-json-v1',
		state: 'quarantined',
		authority: 'fixture',
		sourceRevision: 'fixture',
		routes: ['tool'],
		gates: ['fixture'],
		distributions: [
			{ name: 'tool', registry: 'pypi', format: 'python', manifest: 'tools/tool/pyproject.toml' },
		],
	});
	write(f.root, 'tools/tool/pyproject.toml', '[project]\nname="tool"\nversion="1.0.0"\n');
	write(
		f.root,
		'release-intent/tools/change.json',
		JSON.stringify({
			protocol: 'category-json-v1',
			category: 'fixed',
			summary: 'correct separate storage',
			units: ['tool'],
		})
	);
	assert.equal(parseFragments(f.root, f.inventory).length, 3);
	assert.equal(plan(f).fragments.length, 1);
	write(f.root, '.changeset/unknown.md', '---\n"unknown": patch\n---\nChange\n');
	assert.throws(() => parseFragments(f.root, f.inventory), /ownership/);
});
test('traversal, manifest symlinks and symlinked source roots reject', () => {
	const f = fixture();
	assert.throws(() => safePath(f.root, '../escape'), /Unsafe/);
	symlinkSync(join(f.root, 'foundations/a/package.json'), join(f.root, 'foundations/symlink.json'));
	assert.throws(() => discoverDistributions(f.root, f.inventory), /Symlink/);
});
test('route and held candidate admission fail closed', () => {
	const f = fixture();
	assert.throws(
		() => assertAdmission({ ...f, unit: 'a', route: 'rogue-route' }),
		/Unapproved release route/
	);
	f.inventory.units[0].heldVersions = ['1.0.0'];
	assert.throws(() => plan(f), /candidate is held/);
});
test('candidate digest binds unrelated manifests and fragments as well as selection', () => {
	const f = fixture();
	const before = candidateDigest(f.root, f.inventory, ['a']);
	write(f.root, '.changeset/b.md', '---\n"@fixture/b": minor\n---\nChanged\n');
	assert.notEqual(before, candidateDigest(f.root, f.inventory, ['a']));
});

const handoff = () => ({
	unit: 'tool',
	registryIdentity: 'pypi:tool',
	oldAuthority: 'old',
	newAuthority: 'new',
	oldRoute: 'old-route',
	newRoute: 'new-route',
	frozenRevision: 'abc123',
	artifactHashes: ['sha256:123'],
	restorationSteps: ['disable candidate and reconcile', 'restore old only with no publication'],
	verificationEvidence: ['fixture'],
	queued: [],
	inFlight: [],
	registryOutcome: 'none',
	oldEnabled: true,
	newEnabled: false,
	approved: true,
	state: 'quarantined',
});
test('handoff freezes, disables sole old authority then enables new authority', () => {
	let record = simulateHandoff(handoff(), 'freeze');
	record = simulateHandoff(record, 'disable-old');
	record = simulateHandoff(record, 'enable-new');
	assert.equal(record.authority, 'new');
	assert.equal(record.oldEnabled, false);
	assert.throws(
		() => simulateHandoff({ ...record, oldEnabled: true }, 'failure'),
		/Dual publisher/
	);
});
test('failed handoff stays held until outcomes and queued/in-flight work are reconciled', () => {
	let record = simulateHandoff(handoff(), 'freeze');
	record = simulateHandoff(record, 'disable-old');
	record = simulateHandoff(record, 'enable-new');
	record = simulateHandoff(record, 'failure');
	for (const overrides of [
		{ queued: ['job'] },
		{ inFlight: ['job'] },
		{ registryOutcome: 'unknown' },
		{ registryOutcome: 'published' },
	])
		assert.throws(
			() => simulateHandoff({ ...record, oldContractVerified: true, ...overrides }, 'restore-old'),
			/Unsafe restoration/
		);
	const restored = simulateHandoff({ ...record, oldContractVerified: true }, 'restore-old');
	assert.equal(restored.state, 'quarantined');
	assert.equal(restored.oldEnabled, true);
	assert.equal(restored.newEnabled, false);
});

test('callers cannot omit coordinated on-disk intent or supply ambiguous registry snapshots', () => {
	const f = fixture({ shared: true });
	assert.throws(() => plan(f, { fragments: [] }), /fragments changed or were omitted/);
	assert.throws(
		() =>
			plan(f, {
				selectedUnits: ['a', 'b'],
				registryEvidence: [
					{ registry: 'npm', name: 'b', versions: [] },
					{ registry: 'npm', name: 'b', versions: ['1.0.0'] },
				],
			}),
		/ambiguous registry/
	);
});
test('all dependency fields constrain a known prerequisite independently', () => {
	const f = fixture({ held: true });
	write(
		f.root,
		'foundations/a/package.json',
		JSON.stringify({
			name: '@fixture/a',
			version: '1.0.0',
			dependencies: { '@fixture/b': '^2.0.0' },
			peerDependencies: { '@fixture/b': '^1.0.0' },
		})
	);
	assert.throws(
		() =>
			plan(f, { registryEvidence: [{ registry: 'npm', name: '@fixture/b', versions: ['1.5.0'] }] }),
		/Unsatisfied prerequisite.*\^2\.0\.0/
	);
});
test('duplicate identities and version progression resets are rejected', () => {
	const f = fixture();
	write(
		f.root,
		'tools/copy/package.json',
		JSON.stringify({ name: '@fixture/a', version: '1.0.0' })
	);
	assert.throws(() => plan(f), /Duplicate public distribution/);
	write(
		f.root,
		'tools/copy/package.json',
		JSON.stringify({ name: 'other', version: '1.0.0', private: true })
	);
	write(
		f.root,
		'foundations/a/package.json',
		JSON.stringify({ name: '@fixture/a', version: '0.9.0' })
	);
	assert.throws(() => plan(f), /Version progression reset/);
});

test('declared private distributions record ownership but never enter selection', () => {
	const f = fixture();
	const unit = {
		...structuredClone(f.inventory.units[1]),
		id: 'c',
		family: 'c',
		state: 'quarantined',
		distributions: [
			{
				name: '@fixture/c',
				registry: 'npm',
				format: 'npm',
				manifest: 'foundations/c/package.json',
				initialVersion: '0.1.0',
				private: true,
			},
		],
	};
	const inventory = { schemaVersion: 1, units: [...f.inventory.units, unit] };
	write(f.root, 'scripts/release/inventory.json', JSON.stringify(inventory));
	const manifest = { name: '@fixture/c', version: '0.1.0', private: true };
	write(f.root, 'foundations/c/package.json', JSON.stringify(manifest));
	const loaded = { root: f.root, inventory: loadInventory(f.root) };
	const found = discoverDistributions(f.root, loaded.inventory).map((entry) => entry.name);
	assert.deepEqual(found.sort(), ['@fixture/a', '@fixture/b']);
	assert.deepEqual(plan(loaded).selectedUnits, ['a']);
	assert.throws(() => assertAdmission({ ...loaded, unit: 'c', route: 'npm-main' }), /not admitted/);
	write(f.root, 'foundations/c/package.json', JSON.stringify({ ...manifest, name: '@fixture/d' }));
	assert.throws(() => discoverDistributions(f.root, loaded.inventory), /identity changed/);
	write(f.root, 'foundations/c/package.json', JSON.stringify({ ...manifest, private: false }));
	assert.throws(() => discoverDistributions(f.root, loaded.inventory), /became public/);
	rmSync(join(f.root, 'foundations/c/package.json'));
	assert.throws(() => discoverDistributions(f.root, loaded.inventory), /missing or renamed/);
});

test('only units of declared private distributions may declare no route', () => {
	const f = fixture();
	const unit = {
		...structuredClone(f.inventory.units[1]),
		id: 'c',
		family: 'c',
		state: 'quarantined',
		routes: [],
		distributions: [
			{
				name: '@fixture/c',
				registry: 'npm',
				format: 'npm',
				manifest: 'foundations/c/package.json',
				initialVersion: '0.1.0',
				private: true,
			},
		],
	};
	const writeInventory = (units) =>
		write(f.root, 'scripts/release/inventory.json', JSON.stringify({ schemaVersion: 1, units }));
	write(
		f.root,
		'foundations/c/package.json',
		JSON.stringify({ name: '@fixture/c', version: '0.1.0', private: true })
	);
	writeInventory([...f.inventory.units, unit]);
	const inventory = loadInventory(f.root);
	assert.deepEqual(
		discoverDistributions(f.root, inventory)
			.map((entry) => entry.name)
			.sort(),
		['@fixture/a', '@fixture/b']
	);
	assert.throws(
		() => assertAdmission({ root: f.root, inventory, unit: 'c', route: 'npm-main' }),
		/not admitted/
	);
	writeInventory([...f.inventory.units, { ...unit, routes: undefined }]);
	assert.throws(() => loadInventory(f.root), /Incomplete release contract: c/);
	const publicUnit = { ...unit, distributions: [{ ...unit.distributions[0], private: false }] };
	writeInventory([...f.inventory.units, publicUnit]);
	assert.throws(() => loadInventory(f.root), /Only one enabled publication route/);
});

test('admission requires an explicit exact route rather than accepting an omitted route', () => {
	const f = fixture();
	assert.throws(() => assertAdmission({ ...f, unit: 'a' }), /Unapproved release route/);
	assert.equal(assertAdmission({ ...f, unit: 'a', route: 'npm-main' }).length, 1);
});

test('declared prerequisites outside workspace still require published evidence', () => {
	const f = fixture();
	f.inventory.units[0].prerequisites = [
		{ registry: 'pypi', name: 'external-tool', range: '^1.0.0' },
	];
	assert.throws(() => plan(f), /Unsatisfied prerequisite external-tool/);
	assert.equal(
		plan(f, {
			registryEvidence: [{ registry: 'pypi', name: 'External_Tool', versions: ['1.2.0'] }],
		}).distributions.length,
		1
	);
});

test('an npm alias to a quarantined import cannot hide its prerequisite identity', () => {
	const f = fixture();
	write(
		f.root,
		'tools/import/package.json',
		JSON.stringify({ name: '@fixture/import', version: '1.0.0' })
	);
	write(
		f.root,
		'foundations/a/package.json',
		JSON.stringify({
			name: '@fixture/a',
			version: '1.0.0',
			dependencies: { alias: 'npm:@fixture/import@^1.0.0' },
		})
	);
	assert.throws(() => plan(f), /Unsatisfied prerequisite @fixture\/import/);
	assert.equal(
		plan(f, {
			registryEvidence: [{ registry: 'npm', name: '@fixture/import', versions: ['1.1.0'] }],
		}).distributions.length,
		1
	);
});
