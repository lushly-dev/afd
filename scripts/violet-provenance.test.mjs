import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = 'foundations/violet/provenance';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const blob = (bytes) =>
	createHash('sha1')
		.update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
		.digest('hex');
const record = (name) => JSON.parse(readFileSync(join(root, directory, name), 'utf8'));
const json = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const provenance = record('provenance.json');
const upstream = record('upstream-selected.json');
const adaptations = record('adaptations.json');
const git = (args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
const unchanged = new Set(['unchanged', 'moved-unchanged', 'fixture-copy']);

test('Violet provenance records are bound by hash and every unit stays quarantined', () => {
	for (const entry of Object.values(provenance.records))
		assert.equal(sha(readFileSync(join(root, directory, entry.manifest))), entry.sha256);
	assert.equal(upstream.revision, provenance.source_revision);
	assert.equal(adaptations.source_revision, provenance.source_revision);
	assert.equal(provenance.publication_state, 'quarantined');
	const inventory = json('scripts/release/inventory.json');
	const architecture = json('architecture.json');
	for (const unit of provenance.units) {
		const manifestPath = `${unit.path}/package.json`;
		const owner = inventory.units.find((item) =>
			item.distributions.some((distribution) => distribution.name === unit.name)
		);
		assert.equal(owner?.id, 'violet-npm', unit.name);
		assert.equal(owner.state, 'quarantined', unit.name);
		assert.equal(owner.family, 'violet', unit.name);
		assert.equal(owner.sourceRevision, provenance.source_revision, unit.name);
		assert.match(owner.authority, /^github: lushly-dev\/violet\b/);
		const declared = owner.distributions.find((distribution) => distribution.name === unit.name);
		assert.equal(declared.manifest, manifestPath);
		const manifest = json(manifestPath);
		assert.equal(manifest.name, unit.name);
		assert.equal(manifest.version, declared.initialVersion, `${unit.name} version reset`);
		assert.notEqual(manifest.private, true, unit.name);
		const classified = architecture.units.find((item) => item.manifest === manifestPath);
		assert.deepEqual([classified?.family, classified?.layer], ['violet', unit.layer], unit.name);
	}
});

test('the native core has no AFD edge and the integration uses the workspace AFD core', () => {
	const core = json('foundations/violet/packages/core/package.json');
	for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'])
		assert(
			!Object.keys(core[field] ?? {}).some((name) => name.startsWith('@lushly-dev/')),
			`core ${field} names another Lushly package`
		);
	assert.equal(core.exports['./commands'], undefined);
	const afd = json('integrations/violet-afd/package.json');
	assert.equal(afd.dependencies['@lushly-dev/afd-core'], 'workspace:^2.2.0');
	// Pre-1.0, widen the peer to the next minor before a fixed-group minor release, or
	// Changesets major-bumps the integration and with it the whole group.
	const peer = afd.peerDependencies['@lushly-dev/violet-core'];
	assert(semver.satisfies(core.version, peer));
	const pendingMinor = readdirSync(join(root, '.changeset'))
		.filter((name) => name.endsWith('.md') && name !== 'README.md')
		.some((name) =>
			/^['"]@lushly-dev\/violet-core['"]: (?:minor|major)$/m.test(
				readFileSync(join(root, '.changeset', name), 'utf8')
			)
		);
	if (pendingMinor)
		assert(
			semver.satisfies(semver.inc(core.version, 'minor'), peer),
			`a pending violet-core minor needs the integration peer (${peer}) to accept it`
		);
	for (const endpoint of ['endpoints/violet-cli', 'endpoints/violet-server'])
		assert.equal(
			json(`${endpoint}/package.json`).dependencies['@lushly-dev/violet-afd'],
			'workspace:*'
		);
});

test('upstream licenses are imported verbatim', () => {
	const core = upstream.files.find((file) => file.path === 'packages/core/LICENSE');
	for (const path of [
		'foundations/violet/packages/core/LICENSE',
		'foundations/violet/packages/runtime/LICENSE',
		'integrations/violet-afd/LICENSE',
		'endpoints/violet-cli/LICENSE',
		'endpoints/violet-server/LICENSE',
	])
		assert.equal(sha(readFileSync(join(root, path))), core.sha256, `${path} must stay verbatim`);
});

test('every imported Violet file is present, recorded and unchanged since review', () => {
	const recorded = new Map(adaptations.files.map((file) => [file.path, file]));
	// Untracked-but-unignored files count; an ignored source file would fail as missing.
	const present = git([
		'ls-files',
		'--cached',
		'--others',
		'--exclude-standard',
		'--',
		'foundations/violet',
		'integrations/violet-afd',
		'endpoints/violet-cli',
		'endpoints/violet-server',
		'tests/consumers/violet',
		'docs/features/active/platform-monorepo/violet-transition.md',
	])
		.toString()
		.split('\n')
		.filter((path) => path && !path.startsWith(`${directory}/`));
	assert.deepEqual(
		present.filter((path) => !recorded.has(path)),
		[],
		'record new Violet files in adaptations.json'
	);
	const known = new Set(Object.keys(adaptations.classifications));
	for (const file of adaptations.files) {
		assert(existsSync(join(root, file.path)), `missing or ignored: ${file.path}`);
		assert(present.includes(file.path), `not visible to Git (check .gitignore): ${file.path}`);
		assert(known.has(file.classification), `${file.path}: ${file.classification}`);
		assert.equal(
			sha(readFileSync(join(root, file.path))),
			file.current_import_sha256,
			`${file.path} changed; record the adaptation`
		);
		if (unchanged.has(file.classification))
			assert.equal(file.current_import_sha256, file.upstream_sha256, file.path);
		else assert(file.reason, `${file.path} needs a reason`);
		if (file.classification !== 'afd-authored') assert(file.upstream_path, file.path);
	}
	const accounted = new Set(adaptations.files.map((file) => file.upstream_path).filter(Boolean));
	assert.deepEqual(
		upstream.files.map((file) => file.path).filter((path) => !accounted.has(path)),
		[],
		'every selected upstream file maps to an import'
	);
});

test('upstream Git object ids match the bytes of every file imported unchanged', () => {
	// The Violet revision is not in this repository; unchanged bytes still prove the recorded ids.
	const byPath = new Map(upstream.files.map((file) => [file.path, file]));
	let checked = 0;
	for (const file of adaptations.files) {
		if (!unchanged.has(file.classification)) continue;
		assert.equal(
			blob(readFileSync(join(root, file.path))),
			byPath.get(file.upstream_path).git_blob,
			file.path
		);
		checked++;
	}
	assert(checked > 100, `only ${checked} unchanged upstream files`);
});
