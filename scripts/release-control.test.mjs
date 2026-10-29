import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadInventory } from './release/control.mjs';
import {
	createPublishPlan,
	intentStatus,
	main,
	publishPlan as productionPublishPlan,
	readIntent,
	saveIntent,
	selectRelease,
	versionSelected,
} from './release-control.mjs';
import { dependencyOrder, verifyPublished } from './release-operations/prerequisites.mjs';
import { notes, packedManifest, validatePacked } from './release-operations/publish.mjs';
import { reconcilePublication } from './release-operations/recovery.mjs';
import {
	entryHash,
	registryNames,
	repositoryEntry,
	sourceDigest,
	tree,
} from './release-operations/shared.mjs';
import { inWorktree } from './release-operations/version.mjs';

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const shell = (cwd, command, args) =>
	execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (root, file, contents) => {
	mkdirSync(dirname(join(root, file)), { recursive: true });
	writeFileSync(
		join(root, file),
		typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`
	);
};
function fixture(
	t,
	{
		dependencies = {},
		peerDependencies = {},
		coordinated = false,
		bState = 'held',
		bVersion = '1.0.0',
	} = {}
) {
	const base = mkdtempSync(join(tmpdir(), 'afd-release-test-'));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const root = join(base, 'repo');
	mkdirSync(root);
	for (const [id, version] of [
		['a', '1.0.0'],
		['b', bVersion],
	]) {
		write(root, `packages/${id}/package.json`, {
			name: `@fixture/${id}`,
			version,
			files: ['index.js'],
			...(id === 'a' ? { dependencies, peerDependencies } : {}),
		});
		write(root, `packages/${id}/index.js`, 'export const fixture = true;\n');
		write(
			root,
			`packages/${id}/CHANGELOG.md`,
			`# @fixture/${id}\n\n## ${version}\n\nfixture release\n`
		);
	}
	const inventory = {
		schemaVersion: 1,
		roots: ['packages'],
		storages: [{ path: '.changeset', protocol: 'npm-changesets' }],
		units: ['a', 'b'].map((id) => ({
			id,
			family: id,
			protocol: 'npm-changesets',
			sourceRevision: 'fixture',
			authority: 'fixture',
			state: id === 'b' ? bState : 'admitted',
			routes: ['npm-main'],
			gates: ['fixture'],
			fixed: true,
			distributions: [
				{
					name: `@fixture/${id}`,
					registry: 'npm',
					manifest: `packages/${id}/package.json`,
					format: 'npm',
					initialVersion: '1.0.0',
				},
			],
		})),
	};
	write(root, 'scripts/release/inventory.json', inventory);
	write(root, '.changeset/config.json', {
		changelog: false,
		commit: false,
		fixed: [['@fixture/a'], ['@fixture/b']],
		linked: [],
		access: 'public',
		baseBranch: 'main',
		updateInternalDependencies: 'patch',
		ignore: [],
	});
	write(
		root,
		'.changeset/a.md',
		`---\n"@fixture/a": patch\n${coordinated ? '"@fixture/b": patch\n' : ''}---\n\nA release\n`
	);
	if (!coordinated)
		write(root, '.changeset/b.md', '---\n"@fixture/b": patch\n---\n\nHeld B release\n');
	write(root, 'package.json', { name: 'fixture', private: true, packageManager: 'pnpm@10.30.1' });
	write(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
	shell(root, 'git', ['init', '-b', 'main']);
	shell(root, 'git', ['add', '.']);
	shell(root, 'git', [
		'-c',
		'user.name=Fixture',
		'-c',
		'user.email=fixture@example.invalid',
		'commit',
		'-m',
		'fixture',
	]);
	return {
		root,
		base,
		inventory,
		artifacts: join(base, 'artifacts'),
		receipt: join(base, 'receipt.json'),
		evidence: [
			{ registry: 'npm', name: '@fixture/a', versions: [] },
			{ registry: 'npm', name: '@fixture/b', versions: ['1.0.0'] },
		],
	};
}
function commit(root) {
	shell(root, 'git', ['add', '.']);
	shell(root, 'git', [
		'-c',
		'user.name=Fixture',
		'-c',
		'user.email=fixture@example.invalid',
		'commit',
		'--allow-empty',
		'-m',
		'reviewed intent',
	]);
}
function approve(f, units = ['a']) {
	saveIntent(f.root, units);
	commit(f.root);
}
function successfulReadback(artifact) {
	return {
		name: artifact.name,
		version: artifact.version,
		dist: {
			integrity: `sha512-${createHash('sha512').update(readFileSync(artifact.file)).digest('base64')}`,
		},
	};
}
function publishPlan(args) {
	return productionPublishPlan({ ...args, readback: args.readback ?? successfulReadback });
}
function build(f) {
	approve(f);
	return createPublishPlan({
		root: f.root,
		selectedUnits: ['a'],
		registryEvidence: f.evidence,
		artifactsDirectory: f.artifacts,
	});
}
function registry(f) {
	return (name) => f.evidence.find((entry) => entry.name === name);
}

test('A approved and unrelated B held: real Changesets versions only A; B bytes unchanged', (t) => {
	const f = fixture(t);
	const before = ['package.json', 'CHANGELOG.md'].map((name) =>
		readFileSync(join(f.root, 'packages/b', name), 'utf8')
	);
	const fragment = readFileSync(join(f.root, '.changeset/b.md'), 'utf8');
	const plan = selectRelease({ root: f.root, registryEvidence: f.evidence });
	assert.deepEqual(plan.selectedUnits, ['a']);
	const result = versionSelected({
		root: f.root,
		plan,
		inventory: loadInventory(f.root),
		invoke: (cwd) =>
			shell(cwd, process.execPath, [
				join(repository, 'node_modules/@changesets/cli/bin.js'),
				'version',
			]),
	});
	assert.ok(result.changed.includes('packages/a/package.json'));
	assert.equal(JSON.parse(readFileSync(join(f.root, 'packages/a/package.json'))).version, '1.0.1');
	assert.equal(existsSync(join(f.root, '.changeset/a.md')), false);
	assert.equal(readFileSync(join(f.root, '.changeset/b.md'), 'utf8'), fragment);
	assert.deepEqual(
		['package.json', 'CHANGELOG.md'].map((name) =>
			readFileSync(join(f.root, 'packages/b', name), 'utf8')
		),
		before
	);
});
test('A requires new held B: selection fails without writes', (t) => {
	const f = fixture(t, { dependencies: { '@fixture/b': '^2.0.0' }, bVersion: '2.0.0' });
	assert.throws(
		() => selectRelease({ root: f.root, selectedUnits: ['a'], registryEvidence: f.evidence }),
		/Unsatisfied prerequisite/
	);
	assert.equal(shell(f.root, 'git', ['status', '--porcelain']), '');
});
test('A uses published compatible held B; packed metadata is registry portable and only A uploads', (t) => {
	const f = fixture(t, { dependencies: { '@fixture/b': 'workspace:^' } });
	const plan = build(f);
	assert.equal(packedManifest(plan.artifacts[0].file).dependencies['@fixture/b'], '^1.0.0');
	const uploads = [],
		tags = [];
	const receipt = publishPlan({
		root: f.root,
		plan,
		receiptFile: f.receipt,
		registry: registry(f),
		publisher: (artifact) => uploads.push(artifact.name),
		tagger: (tag) => tags.push(tag),
	});
	assert.deepEqual(uploads, ['@fixture/a']);
	assert.deepEqual(tags, ['@fixture/a@1.0.0']);
	assert.equal(receipt.state, 'complete');
	assert.match(receipt.publishedPackages[0].notes, /fixture release/);
});
test('one npm fragment spans A and held B: reject partial and full selections', (t) => {
	const f = fixture(t, { coordinated: true });
	assert.throws(
		() => selectRelease({ root: f.root, selectedUnits: ['a'], registryEvidence: f.evidence }),
		/Incomplete coordinated/
	);
	assert.throws(
		() => selectRelease({ root: f.root, selectedUnits: ['a', 'b'], registryEvidence: f.evidence }),
		/not admitted/
	);
	assert.equal(shell(f.root, 'git', ['status', '--porcelain']), '');
});
test('unknown imported npm package absent in registry cannot be selected or uploaded', (t) => {
	const f = fixture(t);
	write(f.root, 'foundations/import/package.json', { name: '@fixture/import', version: '8.0.0' });
	assert.throws(
		() => selectRelease({ root: f.root, selectedUnits: ['import'], registryEvidence: [] }),
		/not admitted/
	);
	const plan = build(f),
		uploads = [];
	f.evidence.push({ registry: 'npm', name: '@fixture/import', versions: [] });
	publishPlan({
		root: f.root,
		plan,
		receiptFile: f.receipt,
		registry: registry(f),
		publisher: (artifact) => uploads.push(artifact.name),
		tagger: () => {},
	});
	assert.deepEqual(uploads, ['@fixture/a']);
});
test('malicious packed package identity or dependencies reject before uploads', (t) => {
	const f = fixture(t);
	const distribution = selectRelease({
		root: f.root,
		selectedUnits: ['a'],
		registryEvidence: f.evidence,
	}).distributions[0];
	assert.throws(
		() =>
			validatePacked({
				root: f.root,
				distribution,
				metadata: { name: '@evil/a', version: '1.0.0' },
			}),
		/identity changed/
	);
	assert.throws(
		() =>
			validatePacked({
				root: f.root,
				distribution,
				metadata: { name: '@fixture/a', version: '1.0.0', dependencies: { evil: '*' } },
			}),
		/dependencies changed/
	);
});
test('stale source plan and mutated archive fail with no publish or receipt side effects', (t) => {
	const f = fixture(t),
		plan = build(f);
	let uploads = 0;
	write(f.root, 'packages/a/index.js', 'changed');
	assert.throws(
		() =>
			publishPlan({
				root: f.root,
				plan,
				receiptFile: f.receipt,
				registry: registry(f),
				publisher: () => uploads++,
				tagger: () => {},
			}),
		/Stale release source|Release intent source changed/
	);
	assert.equal(uploads, 0);
	assert.equal(existsSync(f.receipt), false);
});
test('missing or unknown registry result is blocked before upload', (t) => {
	const f = fixture(t),
		plan = build(f);
	let uploads = 0;
	assert.throws(
		() =>
			publishPlan({
				root: f.root,
				plan,
				receiptFile: f.receipt,
				registry: () => undefined,
				publisher: () => uploads++,
				tagger: () => {},
			}),
		/Unknown registry outcome/
	);
	assert.equal(uploads, 0);
	assert.equal(existsSync(f.receipt), false);
});
test('a failure leaves durable held receipt and prevents automatic retry', (t) => {
	const f = fixture(t),
		plan = build(f);
	let attempts = 0;
	assert.throws(
		() =>
			publishPlan({
				root: f.root,
				plan,
				receiptFile: f.receipt,
				registry: registry(f),
				publisher: () => {
					attempts++;
					throw new Error('authentication failed');
				},
				tagger: () => {},
			}),
		/Publication held/
	);
	assert.equal(JSON.parse(readFileSync(f.receipt)).state, 'held');
	assert.throws(
		() =>
			publishPlan({
				root: f.root,
				plan,
				receiptFile: f.receipt,
				registry: registry(f),
				publisher: () => attempts++,
				tagger: () => {},
			}),
		/reconciliation/
	);
	assert.equal(attempts, 1);
});
test('Changesets writes outside selected unit are rejected with source unchanged', (t) => {
	const f = fixture(t),
		plan = selectRelease({ root: f.root, selectedUnits: ['a'], registryEvidence: f.evidence });
	assert.throws(
		() =>
			versionSelected({
				root: f.root,
				plan,
				inventory: f.inventory,
				invoke: (cwd) => write(cwd, 'packages/b/CHANGELOG.md', 'bad write'),
			}),
		/outside selected/
	);
	assert.equal(shell(f.root, 'git', ['status', '--porcelain']), '');
});
test('committed explicit release intent binds complete units and candidate identities', (t) => {
	const f = fixture(t);
	saveIntent(f.root, ['a']);
	commit(f.root);
	assert.deepEqual(readIntent(f.root).selectedUnits, ['a']);
	const manifest = JSON.parse(readFileSync(join(f.root, 'packages/a/package.json')));
	manifest.name = '@evil/a';
	write(f.root, 'packages/a/package.json', manifest);
	assert.throws(() => readIntent(f.root), /identity changed/);
});

test('archive mutation is rejected before publisher or receipt effects', (t) => {
	const f = fixture(t),
		plan = build(f);
	writeFileSync(plan.artifacts[0].file, 'corrupt archive');
	let uploads = 0;
	assert.throws(
		() =>
			publishPlan({
				root: f.root,
				plan,
				receiptFile: f.receipt,
				registry: registry(f),
				publisher: () => uploads++,
				tagger: () => {},
			}),
		/Artifact changed/
	);
	assert.equal(uploads, 0);
	assert.equal(existsSync(f.receipt), false);
});
test('revalidates source before every upload and holds later artifacts after source drift', (t) => {
	const f = fixture(t, { bState: 'admitted' });
	approve(f, ['a', 'b']);
	const plan = createPublishPlan({
		root: f.root,
		selectedUnits: ['a', 'b'],
		registryEvidence: f.evidence,
		artifactsDirectory: f.artifacts,
	});
	f.evidence.find((entry) => entry.name === '@fixture/b').versions = [];
	const uploads = [];
	assert.throws(
		() =>
			publishPlan({
				root: f.root,
				plan,
				receiptFile: f.receipt,
				registry: registry(f),
				publisher: (artifact) => {
					uploads.push(artifact.name);
					write(f.root, 'packages/a/index.js', 'drift');
				},
				tagger: () => {},
			}),
		/Stale release source|Release intent source changed/
	);
	assert.equal(uploads.length, 1);
});
test('stale version fragment and malicious selected manifest fail before copyback', (t) => {
	const f = fixture(t),
		plan = selectRelease({ root: f.root, selectedUnits: ['a'], registryEvidence: f.evidence });
	write(f.root, '.changeset/a.md', '---\n"@fixture/a": minor\n---\n\nChanged release intent\n');
	assert.throws(
		() =>
			versionSelected({
				root: f.root,
				plan,
				inventory: f.inventory,
				invoke: () => assert.fail('must not invoke'),
			}),
		/Stale version plan/
	);
	const current = selectRelease({
		root: f.root,
		selectedUnits: ['a'],
		registryEvidence: f.evidence,
	});
	const before = readFileSync(join(f.root, 'packages/a/package.json'), 'utf8');
	assert.throws(
		() =>
			versionSelected({
				root: f.root,
				plan: current,
				inventory: f.inventory,
				invoke: (cwd) =>
					write(cwd, 'packages/a/package.json', { name: '@evil/a', version: '2.0.0' }),
			}),
		/identity changed/
	);
	assert.equal(readFileSync(join(f.root, 'packages/a/package.json'), 'utf8'), before);
});
test('reviewed release intent rejects changed selected source', (t) => {
	const f = fixture(t);
	saveIntent(f.root, ['a']);
	commit(f.root);
	write(f.root, 'packages/a/index.js', 'new candidate');
	assert.throws(() => readIntent(f.root), /source changed/);
});

test('automatic selection retains unrelated C when A shares a coordinated fragment with held B', (t) => {
	const f = fixture(t, { coordinated: true });
	const c = structuredClone(f.inventory.units[0]);
	c.id = 'c';
	c.family = 'c';
	c.distributions[0].name = '@fixture/c';
	c.distributions[0].manifest = 'packages/c/package.json';
	f.inventory.units.push(c);
	write(f.root, 'scripts/release/inventory.json', f.inventory);
	write(f.root, 'packages/c/package.json', {
		name: '@fixture/c',
		version: '1.0.0',
		dependencies: { '@fixture/a': '^1.0.0' },
	});
	write(f.root, '.changeset/c.md', '---\n"@fixture/c": patch\n---\n\nC release\n');
	f.evidence[0].versions = ['1.0.0'];
	f.evidence.push({ registry: 'npm', name: '@fixture/c', versions: [] });
	const plan = selectRelease({ root: f.root, registryEvidence: f.evidence });
	assert.deepEqual(plan.selectedUnits, ['c']);
	assert.equal(plan.selectable, true);
	assert.equal(plan.blocked.length, 1);
});

test('holding an unrelated unit after A approval preserves A intent admission', (t) => {
	const f = fixture(t, { bState: 'admitted' });
	saveIntent(f.root, ['a']);
	commit(f.root);
	f.inventory.units[1].state = 'held';
	write(f.root, 'scripts/release/inventory.json', f.inventory);
	assert.deepEqual(readIntent(f.root).selectedUnits, ['a']);
});

test('default uploader invokes explicit bound tarball with approved registry/tag and no scripts', (t) => {
	const f = fixture(t),
		plan = build(f);
	assert.equal(plan.distTag, 'latest');
	const bin = join(f.base, 'bin'),
		capture = join(f.base, 'npm-args.json');
	mkdirSync(bin);
	writeFileSync(
		join(bin, 'npm'),
		`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(capture)},JSON.stringify(process.argv.slice(2)));\n`
	);
	chmodSync(join(bin, 'npm'), 0o755);
	const prior = process.env.PATH;
	process.env.PATH = `${bin}:${prior}`;
	try {
		publishPlan({
			root: f.root,
			plan,
			receiptFile: f.receipt,
			registry: registry(f),
			tagger: () => {},
		});
	} finally {
		process.env.PATH = prior;
	}
	assert.deepEqual(JSON.parse(readFileSync(capture)), [
		'publish',
		plan.artifacts[0].file,
		'--@fixture:registry=https://registry.npmjs.org',
		'--registry',
		'https://registry.npmjs.org',
		'--access',
		'public',
		'--tag',
		'latest',
		'--ignore-scripts',
	]);
});

test('actual packed malicious identity is rejected before a publish plan can be created', (t) => {
	const f = fixture(t);
	approve(f);
	const staging = join(f.base, 'malicious');
	write(staging, 'package/package.json', { name: '@evil/substitute', version: '1.0.0' });
	assert.throws(
		() =>
			createPublishPlan({
				root: f.root,
				selectedUnits: ['a'],
				registryEvidence: f.evidence,
				artifactsDirectory: f.artifacts,
				pack: (_directory, destination) =>
					shell(f.root, 'tar', ['-czf', join(destination, 'evil.tgz'), '-C', staging, 'package']),
			}),
		/Packed identity changed/
	);
	assert.equal(shell(f.root, 'git', ['status', '--porcelain']), '');
	assert.equal(existsSync(f.receipt), false);
});

test('intent status skips missing approval even when current registry version is absent', (t) => {
	const f = fixture(t);
	assert.deepEqual(
		intentStatus({
			root: f.root,
			registry: () => assert.fail('missing intent never queries or approves registry candidates'),
		}),
		{ publishable: false, state: 'missing', selectedUnits: [] }
	);
	assert.equal(shell(f.root, 'git', ['status', '--porcelain']), '');
});
test('fulfilled intent is inert after later selected source development', (t) => {
	const f = fixture(t);
	saveIntent(f.root, ['a']);
	commit(f.root);
	f.evidence[0].versions = ['1.0.0'];
	write(f.root, 'packages/a/index.js', 'later development');
	const before = shell(f.root, 'git', ['status', '--porcelain']);
	assert.deepEqual(intentStatus({ root: f.root, registry: registry(f) }), {
		publishable: false,
		state: 'fulfilled',
		selectedUnits: ['a'],
	});
	assert.equal(shell(f.root, 'git', ['status', '--porcelain']), before);
});
test('partially fulfilled intent requires unchanged source and holds after drift', (t) => {
	const f = fixture(t, { bState: 'admitted' });
	saveIntent(f.root, ['a', 'b']);
	commit(f.root);
	assert.deepEqual(intentStatus({ root: f.root, registry: registry(f) }), {
		publishable: true,
		state: 'pending',
		selectedUnits: ['a', 'b'],
		missing: [{ name: '@fixture/a', version: '1.0.0' }],
	});
	write(f.root, 'packages/a/index.js', 'later development');
	assert.throws(
		() => intentStatus({ root: f.root, registry: registry(f) }),
		/Publication held: Release intent source changed/
	);
});
test('intent status holds unknown registry outcomes and never treats them as fulfillment', (t) => {
	const f = fixture(t);
	saveIntent(f.root, ['a']);
	commit(f.root);
	assert.throws(
		() => intentStatus({ root: f.root, registry: () => undefined }),
		/Publication held: unknown registry outcome/
	);
});

test('production planning requires exact committed intent and rejects explicit unit bypass', (t) => {
	const f = fixture(t, { bState: 'admitted' });
	const args = {
		root: f.root,
		selectedUnits: ['a'],
		registryEvidence: f.evidence,
		artifactsDirectory: f.artifacts,
	};
	assert.throws(() => createPublishPlan(args), /Missing reviewed release intent/);
	saveIntent(f.root, ['a']);
	assert.throws(() => createPublishPlan(args), /must be committed/);
	commit(f.root);
	assert.throws(
		() => createPublishPlan({ ...args, selectedUnits: ['b'] }),
		/differ from reviewed release intent/
	);
	const supplied = join(f.base, 'evidence.json');
	writeFileSync(supplied, JSON.stringify(f.evidence));
	assert.throws(
		() =>
			main([
				'plan',
				'--root',
				f.root,
				'--units',
				'b',
				'--registry-evidence',
				supplied,
				'--plan',
				join(f.base, 'plan.json'),
			]),
		/differ from reviewed release intent/
	);
	assert.equal(existsSync(f.artifacts), false);
});
test('plan binds exact intent bytes and API publication rejects missing or edited approval before queries', (t) => {
	const f = fixture(t),
		plan = build(f);
	const path = join(f.root, '.release/npm-intent.json'),
		bytes = readFileSync(path);
	assert.equal(plan.sourceRevision, shell(f.root, 'git', ['rev-parse', 'HEAD']).trim());
	assert.equal(plan.artifacts[0].filename, plan.artifacts[0].file.split('/').at(-1));
	assert.equal(plan.intentDigest, createHash('sha256').update(bytes).digest('hex'));
	rmSync(path);
	assert.throws(
		() =>
			productionPublishPlan({
				root: f.root,
				plan,
				receiptFile: f.receipt,
				registry: () => assert.fail('no query'),
				publisher: () => assert.fail('no upload'),
			}),
		/Missing reviewed release intent/
	);
	writeFileSync(path, `${bytes.toString()}\n`);
	assert.throws(
		() =>
			productionPublishPlan({
				root: f.root,
				plan,
				receiptFile: f.receipt,
				registry: () => assert.fail('no query'),
				publisher: () => assert.fail('no upload'),
			}),
		/uncommitted changes/
	);
	assert.equal(existsSync(f.receipt), false);
});
test('normalized alias and explicit prerequisite closure are discovered through query spies', (t) => {
	const f = fixture(t, { dependencies: { renamed: 'npm:@fixture/b@^1.0.0' } });
	f.inventory.units[0].prerequisites = [
		{ registry: 'npm', name: '@external/needed', range: '^1.0.0' },
	];
	f.inventory.units[1].prerequisites = [
		{ registry: 'npm', name: '@external/nested', range: '^1.0.0' },
	];
	write(f.root, 'scripts/release/inventory.json', f.inventory);
	const queried = [];
	const evidence = registryNames(f.root, ['a']).map((name) => {
		queried.push(name);
		return { registry: 'npm', name, versions: ['1.0.0'] };
	});
	assert.deepEqual(queried, ['@external/needed', '@fixture/a', '@fixture/b']);
	assert.deepEqual(
		selectRelease({ root: f.root, selectedUnits: ['a'], registryEvidence: evidence }).selectedUnits,
		['a']
	);
	assert.equal(queried.includes('renamed'), false);
});
test('non-npm explicit prerequisites fail before npm evidence queries', (t) => {
	const f = fixture(t);
	f.inventory.units[0].prerequisites = [{ registry: 'pypi', name: 'external', range: '^1.0.0' }];
	write(f.root, 'scripts/release/inventory.json', f.inventory);
	let queries = 0;
	assert.throws(
		() => registryNames(f.root, ['a']).map(() => queries++),
		/Unsupported registry evidence adapter: pypi/
	);
	assert.equal(queries, 0);
});
test('current AFD required core peer publishes before adapters in dependency order', () => {
	const inventory = loadInventory(repository);
	const artifacts = inventory.units
		.find((unit) => unit.id === 'afd-npm')
		.distributions.map((entry) => ({ ...entry, unit: 'afd-npm', file: entry.manifest }));
	const ordered = dependencyOrder(repository, artifacts, (file) =>
		JSON.parse(readFileSync(join(repository, file)))
	);
	assert.ok(
		ordered.findIndex((entry) => entry.name === '@lushly-dev/afd-core') <
			ordered.findIndex((entry) => entry.name === '@lushly-dev/afd-adapters')
	);
});
test('required peers upload and verify before dependents; uncertain successful upload holds the batch', (t) => {
	const f = fixture(t, { bState: 'admitted', peerDependencies: { '@fixture/b': 'workspace:^' } });
	f.evidence[1].versions = [];
	approve(f, ['a', 'b']);
	const plan = createPublishPlan({
		root: f.root,
		selectedUnits: ['a', 'b'],
		registryEvidence: f.evidence,
		artifactsDirectory: f.artifacts,
	});
	const events = [];
	publishPlan({
		root: f.root,
		plan,
		receiptFile: f.receipt,
		registry: registry(f),
		publisher: (artifact) => events.push(`upload:${artifact.name}`),
		readback: (artifact) => {
			events.push(`verify:${artifact.name}`);
			return successfulReadback(artifact);
		},
		tagger: () => {},
	});
	assert.deepEqual(events, [
		'upload:@fixture/b',
		'verify:@fixture/b',
		'upload:@fixture/a',
		'verify:@fixture/a',
	]);
});
test('successful uploader with absent registry readback cannot advance required dependents', (t) => {
	const f = fixture(t, { bState: 'admitted' });
	f.evidence[1].versions = [];
	f.inventory.units[0].prerequisites = [{ registry: 'npm', name: '@fixture/b', range: '^1.0.0' }];
	write(f.root, 'scripts/release/inventory.json', f.inventory);
	approve(f, ['a', 'b']);
	const plan = createPublishPlan({
		root: f.root,
		selectedUnits: ['a', 'b'],
		registryEvidence: f.evidence,
		artifactsDirectory: f.artifacts,
	});
	const uploads = [],
		tags = [];
	assert.throws(
		() =>
			publishPlan({
				root: f.root,
				plan,
				receiptFile: f.receipt,
				registry: registry(f),
				publisher: (artifact) => uploads.push(artifact.name),
				readback: () => ({}),
				tagger: (tag) => tags.push(tag),
			}),
		/Publication held.*readback is missing or uncertain/
	);
	assert.deepEqual(uploads, ['@fixture/b']);
	assert.deepEqual(tags, []);
	assert.equal(JSON.parse(readFileSync(f.receipt)).state, 'held');
});

test('published compatible held dependency uses no prerequisites from its unreleased candidate', (t) => {
	const f = fixture(t, { dependencies: { '@fixture/b': '^1.0.0' }, bVersion: '2.0.0' });
	f.inventory.units[1].prerequisites = [
		{ registry: 'pypi', name: 'unreleased-native', range: '^9.0.0' },
		{ registry: 'npm', name: '@fixture/unreleased-c', range: '^9.0.0' },
	];
	write(f.root, 'scripts/release/inventory.json', f.inventory);
	const queried = [];
	const reader = (name) => {
		queried.push(name);
		return registry(f)(name);
	};
	const names = registryNames(f.root, ['a']);
	assert.deepEqual(names, ['@fixture/a', '@fixture/b']);
	const evidence = names.map(reader);
	assert.equal(
		selectRelease({ root: f.root, selectedUnits: ['a'], registryEvidence: evidence }).selectable,
		true
	);
	const plan = build(f),
		uploads = [];
	const receipt = publishPlan({
		root: f.root,
		plan,
		receiptFile: f.receipt,
		registry: reader,
		publisher: (artifact) => uploads.push(artifact.name),
		tagger: () => {},
	});
	assert.equal(receipt.state, 'complete');
	assert.deepEqual(uploads, ['@fixture/a']);
	assert.ok(queried.every((name) => name === '@fixture/a' || name === '@fixture/b'));
});

function trackedMirror(f) {
	write(f.root, '.claude/skills/fixture/SKILL.md', '# Canonical fixture skill\n');
	mkdirSync(join(f.root, '.codex'));
	symlinkSync('../.claude/skills', join(f.root, '.codex/skills'), 'dir');
	commit(f.root);
}
test('tracked skills mirror survives real Changesets versioning and actual pnpm packing', (t) => {
	const f = fixture(t);
	trackedMirror(f);
	const mirror = join(f.root, '.codex/skills'),
		canonical = join(f.root, '.claude/skills/fixture/SKILL.md');
	const canonicalBytes = readFileSync(canonical, 'utf8');
	const mirrorHash = entryHash(repositoryEntry(f.root, '.codex/skills'));
	assert.equal(
		mirrorHash,
		createHash('sha256')
			.update(JSON.stringify({ type: 'symlink', target: '../.claude/skills' }))
			.digest('hex')
	);
	const before = sourceDigest(f.root);
	writeFileSync(canonical, `${canonicalBytes}changed\n`);
	assert.notEqual(sourceDigest(f.root), before);
	assert.equal(entryHash(repositoryEntry(f.root, '.codex/skills')), mirrorHash);
	writeFileSync(canonical, canonicalBytes);
	assert.throws(() => tree(f.root), /Symlink is not release input/);
	assert.equal(
		new Map(tree(f.root, '', { allowRepositoryMirror: true })).get('.codex/skills'),
		mirrorHash
	);
	const selected = selectRelease({
		root: f.root,
		selectedUnits: ['a'],
		registryEvidence: f.evidence,
	});
	versionSelected({
		root: f.root,
		plan: selected,
		inventory: loadInventory(f.root),
		invoke: (candidate) => {
			assert.equal(lstatSync(join(candidate, '.codex/skills')).isSymbolicLink(), true);
			assert.equal(readlinkSync(join(candidate, '.codex/skills')), '../.claude/skills');
			shell(candidate, process.execPath, [
				join(repository, 'node_modules/@changesets/cli/bin.js'),
				'version',
			]);
		},
	});
	assert.equal(readlinkSync(mirror), '../.claude/skills');
	assert.equal(readFileSync(canonical, 'utf8'), canonicalBytes);
	approve(f);
	const plan = createPublishPlan({
		root: f.root,
		selectedUnits: ['a'],
		registryEvidence: f.evidence,
		artifactsDirectory: f.artifacts,
		pack: (directory, destination) => {
			const candidate = dirname(dirname(directory));
			assert.equal(readlinkSync(join(candidate, '.codex/skills')), '../.claude/skills');
			assert.equal(
				readFileSync(join(candidate, '.claude/skills/fixture/SKILL.md'), 'utf8'),
				canonicalBytes
			);
			shell(directory, 'pnpm', ['pack', '--pack-destination', destination]);
		},
	});
	assert.equal(plan.artifacts[0].name, '@fixture/a');
	assert.equal(readlinkSync(mirror), '../.claude/skills');
	assert.equal(readFileSync(canonical, 'utf8'), canonicalBytes);
	assert.equal(typeof sourceDigest(f.root), 'string');
});
test('unknown, escaping and symlinked-parent repository inputs fail before worktree or artifact effects', async (t) => {
	for (const kind of ['unknown', 'escaping-mirror', 'symlinked-parent', 'untracked-mirror'])
		await t.test(kind, (t) => {
			const f = fixture(t),
				outside = join(f.base, 'outside');
			mkdirSync(outside);
			writeFileSync(join(outside, 'protected.txt'), 'protected\n');
			if (kind === 'symlinked-parent') {
				trackedMirror(f);
				rmSync(join(f.root, '.codex'), { recursive: true });
				symlinkSync(outside, join(f.root, '.codex'), 'dir');
			} else {
				write(f.root, '.claude/skills/fixture/SKILL.md', '# canonical\n');
				mkdirSync(join(f.root, '.codex'));
				const path = kind === 'unknown' ? '.codex/other' : '.codex/skills';
				symlinkSync(
					kind === 'escaping-mirror' ? outside : '../.claude/skills',
					join(f.root, path),
					'dir'
				);
				if (kind !== 'untracked-mirror') commit(f.root);
			}
			if (kind !== 'untracked-mirror') approve(f);
			const worktrees = shell(f.root, 'git', ['worktree', 'list', '--porcelain']);
			const reject =
				kind === 'untracked-mirror' ? /must be a tracked symlink/ : /Symlink is not release input/;
			assert.throws(() => sourceDigest(f.root), reject);
			assert.throws(
				() => inWorktree(f.root, () => assert.fail('must not invoke worktree callback')),
				reject
			);
			if (kind !== 'untracked-mirror') {
				const selected = selectRelease({
					root: f.root,
					selectedUnits: ['a'],
					registryEvidence: f.evidence,
				});
				assert.throws(
					() =>
						versionSelected({
							root: f.root,
							plan: selected,
							inventory: loadInventory(f.root),
							invoke: () => assert.fail('must not invoke Changesets'),
						}),
					reject
				);
				assert.throws(
					() =>
						createPublishPlan({
							root: f.root,
							selectedUnits: ['a'],
							registryEvidence: f.evidence,
							artifactsDirectory: f.artifacts,
							pack: () => assert.fail('must not pack'),
						}),
					reject
				);
			}
			assert.equal(shell(f.root, 'git', ['worktree', 'list', '--porcelain']), worktrees);
			assert.equal(existsSync(f.artifacts), false);
			assert.equal(readFileSync(join(outside, 'protected.txt'), 'utf8'), 'protected\n');
		});
});

test('verified existing candidate is adopted and tagged without a second upload', (t) => {
	const f = fixture(t);
	const plan = build(f);
	f.evidence.find((entry) => entry.name === '@fixture/a').versions.push('1.0.0');
	const uploads = [],
		tags = [];
	const receipt = publishPlan({
		root: f.root,
		plan,
		receiptFile: f.receipt,
		registry: registry(f),
		publisher: (artifact) => uploads.push(artifact.name),
		tagger: (tag) => tags.push(tag),
	});
	assert.deepEqual(uploads, []);
	assert.deepEqual(tags, ['@fixture/a@1.0.0']);
	assert.equal(receipt.publishedPackages.length, plan.artifacts.length);
	assert.equal(receipt.publishedPackages[0].publication, 'previously-published');
	assert.equal(receipt.verifiedArtifacts.length, 1);
});

test('recovery keeps known uploads adopted even if later registry listings regress', (t) => {
	const f = fixture(t, { bState: 'admitted' });
	f.evidence[1].versions = [];
	f.inventory.units[0].prerequisites = [{ registry: 'npm', name: '@fixture/b', range: '^1.0.0' }];
	write(f.root, 'scripts/release/inventory.json', f.inventory);
	approve(f, ['a', 'b']);
	const plan = createPublishPlan({
		root: f.root,
		selectedUnits: ['a', 'b'],
		registryEvidence: f.evidence,
		artifactsDirectory: f.artifacts,
	});
	const prior = {
		state: 'held',
		binding: plan.binding,
		intentDigest: plan.intentDigest,
		sourceRevision: plan.sourceRevision,
		current: '@fixture/b',
	};
	// Prove the uncertain blob directly even while its version listing is stale.
	const proof = reconcilePublication({
		root: f.root,
		plan,
		receipt: prior,
		registry: registry(f),
		readback: successfulReadback,
	});
	assert.deepEqual(
		proof.verified.map((a) => a.name),
		['@fixture/b']
	);
	assert.deepEqual(proof.missing, ['@fixture/a']);
	f.evidence[1].versions = [];
	const uploads = [],
		tags = [];
	const receipt = publishPlan({
		root: f.root,
		plan,
		receiptFile: f.receipt,
		registry: registry(f),
		previouslyPublished: proof.verified,
		publisher: (a) => uploads.push(a.name),
		tagger: (t) => tags.push(t),
	});
	assert.deepEqual(uploads, ['@fixture/a']);
	assert.deepEqual(tags, ['@fixture/b@1.0.0', '@fixture/a@1.0.0']);
	assert.equal(receipt.publishedPackages.length, 2);
	assert.equal(receipt.verifiedArtifacts.length, 2);
});
test('reconciliation rejects wrong evidence and uncertain missing or mismatched uploads', (t) => {
	const f = fixture(t);
	const plan = build(f);
	const prior = {
		state: 'held',
		binding: plan.binding,
		intentDigest: plan.intentDigest,
		sourceRevision: plan.sourceRevision,
		current: '@fixture/a',
	};
	const options = {
		root: f.root,
		plan,
		receipt: prior,
		registry: registry(f),
		readback: successfulReadback,
	};
	assert.throws(
		() => reconcilePublication({ ...options, receipt: { ...prior, binding: 'wrong' } }),
		/exact held/
	);
	assert.throws(
		() => reconcilePublication({ ...options, readback: () => ({}) }),
		/missing or uncertain/
	);
	assert.throws(
		() => reconcilePublication({ ...options, registry: () => null }),
		/Unknown recovery/
	);
	f.evidence[0].versions.push('1.0.0');
	assert.throws(
		() => reconcilePublication({ ...options, readback: () => ({ name: 'wrong' }) }),
		/missing or uncertain/
	);
	const proof = verifyPublished(plan.artifacts[0], successfulReadback);
	assert.equal(reconcilePublication(options).verified[0].integrity, proof.integrity);
});

test('held finalization requires the complete source-bound set and fresh byte proofs, then adopts without uploads', (t) => {
	const f = fixture(t),
		plan = build(f),
		artifact = plan.artifacts[0];
	const prior = {
		state: 'complete',
		binding: plan.binding,
		intentDigest: plan.intentDigest,
		sourceRevision: plan.sourceRevision,
		finalization: { state: 'held', head: plan.sourceRevision, reason: 'hook failure' },
		publishedPackages: [
			{
				name: artifact.name,
				version: artifact.version,
				tag: `${artifact.name}@${artifact.version}`,
				notes: notes(f.root, artifact),
			},
		],
	};
	const proof = (a) => {
		const bytes = readFileSync(a.file);
		return {
			name: a.name,
			version: a.version,
			method: 'registry-tarball',
			sha256: a.artifactHash,
			bytes: bytes.length,
			url: 'https://registry.npmjs.org/fixture',
			integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
		};
	};
	const options = { root: f.root, plan, receipt: prior, registry: registry(f), readback: proof };
	for (const patch of [
		{ publishedPackages: [] },
		{ publishedPackages: [...prior.publishedPackages, ...prior.publishedPackages] },
		{ finalization: { state: 'held', head: 'wrong' } },
		{ publishedPackages: [{ ...prior.publishedPackages[0], notes: 'wrong' }] },
		{ publishedPackages: [{ ...prior.publishedPackages[0], tag: 'wrong' }] },
	])
		assert.throws(
			() => reconcilePublication({ ...options, receipt: { ...prior, ...patch } }),
			/complete original/
		);
	assert.throws(
		() => reconcilePublication({ ...options, readback: successfulReadback }),
		/every artifact proof/
	);
	assert.throws(
		() => reconcilePublication({ ...options, readback: () => ({}) }),
		/missing or uncertain/
	);
	const reconciled = reconcilePublication(options);
	assert.equal(reconciled.finalizationOnly, true);
	assert.deepEqual(reconciled.missing, []);
	let uploads = 0;
	const receipt = publishPlan({
		root: f.root,
		plan,
		receiptFile: f.receipt,
		registry: registry(f),
		readback: proof,
		previouslyPublished: reconciled.verified,
		publisher: () => {
			uploads++;
			throw new Error('finalization cannot upload');
		},
		tagger: () => {},
	});
	assert.equal(uploads, 0);
	assert.equal(receipt.state, 'complete');
	assert.equal(prior.finalization.state, 'held');
});
