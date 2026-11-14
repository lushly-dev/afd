import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadInventory } from './release/control.mjs';
import { execTool, tarCommand } from './release/exec-tool.mjs';
import {
	createPublishPlan,
	main,
	readIntent,
	saveIntent,
	selectRelease,
	versionSelected,
} from './release-control.mjs';

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const changesets = join(repository, 'node_modules/@changesets/cli/bin.js');
const shell = (cwd, command, args) =>
	execTool(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (root, file, contents) => {
	mkdirSync(dirname(join(root, file)), { recursive: true });
	writeFileSync(
		join(root, file),
		typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`
	);
};
const read = (root, file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
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
		'fixture',
	]);
}

/**
 * Core `p` (fixed with its host `h`) and dependent `d` preview under `preview`; `m` is an
 * unrelated unit on the main route. Each preview manifest starts at its seed, `x.y.z-preview`.
 */
function fixture(t) {
	const base = mkdtempSync(join(tmpdir(), 'afd-prerelease-test-'));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const root = join(base, 'repo');
	const manifests = {
		p: { version: '2.2.0-preview', optionalDependencies: { '@fixture/h': 'workspace:*' } },
		h: { version: '2.2.0-preview' },
		d: {
			version: '2.2.0-preview',
			dependencies: { '@fixture/p': 'workspace:^' },
			peerDependencies: { '@fixture/p': '^2.2.0-preview' },
		},
		m: { version: '1.0.0' },
	};
	for (const [id, manifest] of Object.entries(manifests)) {
		write(root, `packages/${id}/package.json`, {
			name: `@fixture/${id}`,
			files: ['index.js'],
			...manifest,
		});
		write(root, `packages/${id}/index.js`, 'export const fixture = true;\n');
	}
	const unit = (id, ids, route, version) => ({
		id,
		family: 'fixture',
		protocol: 'npm-changesets',
		sourceRevision: 'fixture',
		authority: 'fixture',
		state: 'admitted',
		routes: [route],
		...(route === 'npm-prerelease' ? { distTag: 'preview' } : {}),
		gates: ['fixture'],
		fixed: ids.length > 1,
		distributions: ids.map((name) => ({
			name: `@fixture/${name}`,
			registry: 'npm',
			manifest: `packages/${name}/package.json`,
			format: 'npm',
			initialVersion: version,
		})),
	});
	write(root, 'scripts/release/inventory.json', {
		schemaVersion: 1,
		roots: ['packages'],
		storages: [{ path: '.changeset', protocol: 'npm-changesets' }],
		units: [
			unit('p', ['p', 'h'], 'npm-prerelease', '2.2.0-preview'),
			unit('d', ['d'], 'npm-prerelease', '2.2.0-preview'),
			unit('m', ['m'], 'npm-main', '1.0.0'),
		],
	});
	write(root, '.changeset/config.json', {
		changelog: false,
		commit: false,
		fixed: [],
		linked: [],
		access: 'public',
		baseBranch: 'main',
		updateInternalDependencies: 'patch',
		ignore: [],
		___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH: {
			onlyUpdatePeerDependentsWhenOutOfRange: true,
		},
	});
	write(root, '.changeset/preview.md', '---\n"@fixture/p": patch\n"@fixture/d": patch\n---\n\nP\n');
	write(root, '.changeset/main.md', '---\n"@fixture/m": patch\n---\n\nM\n');
	write(root, 'package.json', { name: 'fixture', private: true, packageManager: 'pnpm@10.30.1' });
	write(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
	shell(root, 'git', ['init', '-b', 'main']);
	commit(root);
	return {
		root,
		artifacts: join(base, 'artifacts'),
		evidence: ['p', 'h', 'd', 'm'].map((id) => ({
			registry: 'npm',
			name: `@fixture/${id}`,
			versions: [],
		})),
	};
}
function version(f, route) {
	const plan = selectRelease({ root: f.root, registryEvidence: f.evidence, route });
	const result = versionSelected({
		root: f.root,
		plan,
		inventory: loadInventory(f.root),
		invoke: (cwd) => shell(cwd, process.execPath, [changesets, 'version']),
	});
	saveIntent(f.root, result.selectedUnits);
	commit(f.root);
	return { plan, result };
}
const versions = (f) =>
	Object.fromEntries(
		['p', 'h', 'd', 'm'].map((id) => [id, read(f.root, `packages/${id}/package.json`).version])
	);

test('a prerelease releases first; the main route waits for the next run', (t) => {
	const f = fixture(t);
	const { plan } = version(f);
	assert.equal(plan.route, 'npm-prerelease');
	assert.deepEqual(plan.selectedUnits, ['d', 'p']);
	assert.equal(versions(f).m, '1.0.0');
	assert.equal(existsSync(join(f.root, '.changeset/main.md')), true);
	const next = selectRelease({ root: f.root, registryEvidence: f.evidence });
	assert.equal(next.route, 'npm-main');
	assert.deepEqual(next.selectedUnits, ['m']);
	version(f);
	assert.deepEqual(versions(f), {
		p: '2.2.0-preview.0',
		h: '2.2.0-preview.0',
		d: '2.2.0-preview.0',
		m: '1.0.1',
	});
});

test('a preview versions from its seed, counts on, and keeps its ranges without a major bump', (t) => {
	const f = fixture(t);
	const { plan, result } = version(f);
	assert.equal(plan.route, 'npm-prerelease');
	assert.deepEqual(result.selectedUnits, ['d', 'p']);
	assert.deepEqual(versions(f), {
		p: '2.2.0-preview.0',
		h: '2.2.0-preview.0',
		d: '2.2.0-preview.0',
		m: '1.0.0',
	});
	// Prerelease mode is entered for the run only, and the fragments it applied are consumed.
	// Changesets 3 moves applied prerelease fragments to .changeset/pre; none of it is kept.
	assert.equal(existsSync(join(f.root, '.changeset/pre.json')), false);
	assert.equal(existsSync(join(f.root, '.changeset/pre')), false);
	assert.equal(existsSync(join(f.root, '.changeset/preview.md')), false);
	assert.equal(existsSync(join(f.root, '.changeset/main.md')), true);
	assert.deepEqual(readIntent(f.root).selectedUnits, ['d', 'p']);

	write(f.root, '.changeset/again.md', '---\n"@fixture/p": minor\n---\n\nAgain\n');
	commit(f.root);
	version(f, 'npm-prerelease');
	const after = versions(f);
	assert.equal(after.p, '2.2.0-preview.1');
	assert.equal(after.h, '2.2.0-preview.1');
	// A minor core preview stays within its dependent's peer range, so the dependent is not made major.
	assert.equal(after.d, '2.2.0-preview.0');
	assert.equal(
		read(f.root, 'packages/d/package.json').peerDependencies['@fixture/p'],
		'^2.2.0-preview'
	);
});

test('a prerelease refuses Changesets prerelease state it did not create', (t) => {
	const f = fixture(t);
	write(f.root, '.changeset/pre/stale.md', '---\n"@fixture/p": major\n---\n\nStale\n');
	commit(f.root);
	const before = versions(f);
	assert.throws(
		() => version(f, 'npm-prerelease'),
		/Unexpected directory in release fragment storage: \.changeset\/pre/
	);
	assert.deepEqual(versions(f), before);
});

// Changesets 3 bumps a dependent that leaves its peer range by patch and narrows the range.
test('a release that narrows a peer range without a major of the dependent is refused', (t) => {
	const f = fixture(t);
	write(
		f.root,
		'.changeset/preview.md',
		'---\n"@fixture/p": major\n"@fixture/d": patch\n---\n\nP\n'
	);
	commit(f.root);
	const before = versions(f);
	assert.throws(
		() => version(f, 'npm-prerelease'),
		/@fixture\/d .* changes its peer range on @fixture\/p without a major bump/
	);
	assert.deepEqual(versions(f), before);
	assert.equal(existsSync(join(f.root, '.changeset/preview.md')), true);
});

test('a release that narrows a peer range ships with a major of the dependent', (t) => {
	const f = fixture(t);
	write(
		f.root,
		'.changeset/preview.md',
		'---\n"@fixture/p": major\n"@fixture/d": major\n---\n\nP\n'
	);
	commit(f.root);
	version(f, 'npm-prerelease');
	assert.equal(versions(f).p, '3.0.0-preview.0');
	assert.equal(versions(f).d, '3.0.0-preview.0');
	assert.equal(
		read(f.root, 'packages/d/package.json').peerDependencies['@fixture/p'],
		'^3.0.0-preview.0'
	);
});

test('a prerelease plan publishes under its own tag and refuses another', (t) => {
	const f = fixture(t);
	version(f, 'npm-prerelease');
	const args = {
		root: f.root,
		registryEvidence: f.evidence,
		artifactsDirectory: f.artifacts,
		pack: (directory, destination) =>
			shell(directory, 'pnpm', ['pack', '--pack-destination', destination]),
	};
	assert.throws(
		() => createPublishPlan({ ...args, distTag: 'latest' }),
		/publishes under the preview npm tag/
	);
	assert.throws(
		() => createPublishPlan({ ...args, route: 'npm-main' }),
		/Unapproved release route npm-main/
	);
	const plan = createPublishPlan(args);
	assert.equal(plan.route, 'npm-prerelease');
	assert.equal(plan.distTag, 'preview');
	assert.deepEqual(plan.artifacts.map(({ name, version }) => `${name}@${version}`).sort(), [
		'@fixture/d@2.2.0-preview.0',
		'@fixture/h@2.2.0-preview.0',
		'@fixture/p@2.2.0-preview.0',
	]);
	const packed = plan.artifacts.find((artifact) => artifact.name === '@fixture/d');
	const manifest = JSON.parse(
		shell(f.root, tarCommand(), ['-xOzf', packed.file, 'package/package.json'])
	);
	assert.equal(manifest.dependencies['@fixture/p'], '^2.2.0-preview.0');
});

test('a preview seed cannot be planned for publication', (t) => {
	const f = fixture(t);
	saveIntent(f.root, ['d', 'p']);
	commit(f.root);
	assert.throws(
		() =>
			createPublishPlan({
				root: f.root,
				registryEvidence: f.evidence,
				artifactsDirectory: f.artifacts,
			}),
		/publishes only x\.y\.z-preview\.N versions: @fixture\/d@2\.2\.0-preview/
	);
	assert.equal(existsSync(f.artifacts), false);
});

test('a plan refuses a package npm does not have, so the run stops before it claims the release', (t) => {
	const f = fixture(t);
	version(f, 'npm-prerelease');
	const evidence = join(f.root, '..', 'evidence.json');
	const plan = join(f.root, '..', 'plan.json');
	const run = () =>
		main(['plan', '--root', f.root, '--registry-evidence', evidence, '--plan', plan]);
	write(f.root, '../evidence.json', f.evidence);
	assert.throws(
		run,
		/npm has no package @fixture\/d, @fixture\/h, @fixture\/p; trusted publishing/
	);
	assert.equal(existsSync(plan), false);
	// A placeholder makes the name exist; its version satisfies no range, so it changes nothing else.
	write(f.root, '../evidence.json', placeheld(f.evidence));
	run();
	assert.equal(JSON.parse(readFileSync(plan, 'utf8')).distTag, 'preview');
});

/** Each name as the maintainer creates it: placeholder versions, `latest` on `0.0.0-bootstrap.0`. */
const placeheld = (evidence, latest = {}) =>
	evidence.map((entry) => ({
		...entry,
		versions: ['0.0.0-stage', '0.0.0-bootstrap.0'],
		distTags: {
			bootstrap: '0.0.0-bootstrap.0',
			...(entry.name in latest
				? latest[entry.name] && { latest: latest[entry.name] }
				: { latest: '0.0.0-bootstrap.0' }),
		},
	}));

// npm moves `latest` by itself only for a name without one, and a preview on `latest` is what a plain
// install resolves; so a prerelease plan stops, before any claim, unless every `latest` is stable or a
// placeholder.
test('a prerelease plan refuses a name whose latest is missing or another prerelease', (t) => {
	const f = fixture(t);
	version(f, 'npm-prerelease');
	const evidence = join(f.root, '..', 'evidence.json');
	const plan = join(f.root, '..', 'plan.json');
	const run = () =>
		main(['plan', '--root', f.root, '--registry-evidence', evidence, '--plan', plan]);
	write(
		f.root,
		'../evidence.json',
		placeheld(f.evidence, { '@fixture/d': '2.2.0-preview.0', '@fixture/h': null })
	);
	assert.throws(
		run,
		/needs npm's latest tag on a stable version or the 0\.0\.0 placeholder: @fixture\/d@2\.2\.0-preview\.0, @fixture\/h has none\. The maintainer moves it/
	);
	assert.equal(existsSync(plan), false);
	// A stable `latest` stays where it is: the upload names only `preview`.
	write(f.root, '../evidence.json', placeheld(f.evidence, { '@fixture/d': '2.1.0' }));
	run();
	assert.equal(JSON.parse(readFileSync(plan, 'utf8')).distTag, 'preview');
});

// A published package's peer on a workspace package still in preview takes `workspace:^` (or `~`; never
// `*`, which packs an exact pin), so its
// floor is the version it was built against when it packs: a bare `^x.y.z-preview` admits earlier
// previews whose API its new code calls (#1066). A preview line may raise a floor without a major.
test("an admitted package's peer on a workspace package in preview is a workspace range", () => {
	const inventory = loadInventory(repository);
	const npm = inventory.units.flatMap((unit) =>
		unit.distributions
			.filter((entry) => entry.registry === 'npm')
			.map((entry) => ({ ...entry, admitted: unit.state === 'admitted' }))
	);
	const versions = new Map(
		npm.map((entry) => [entry.name, read(repository, entry.manifest).version])
	);
	const loose = npm
		.filter((entry) => entry.admitted)
		.flatMap((entry) =>
			Object.entries(read(repository, entry.manifest).peerDependencies ?? {})
				.filter(([name]) => versions.get(name)?.includes('-'))
				.filter(([, range]) => !/^workspace:[~^]$/.test(range))
				.map(([name, range]) => `${entry.name} -> ${name}@${range}`)
		);
	assert.deepEqual(loose, []);
});
