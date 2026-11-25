import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve, win32 } from 'node:path';
import test from 'node:test';
import {
	BINARY,
	binaryCandidates,
	binaryName,
	CONSUMERS,
	CONSUMERS_TOML,
	deployment,
	exportPack,
	findBinary,
	LIBRARY,
	libraryDirectories,
	overrideDirectory,
	PACK_TOML,
	prepareWorkspace,
	pruneLibraries,
	UMBEL_TOML,
	withLock,
	workspaceFor,
} from './umbel-components.mjs';

function scratch(t) {
	const root = mkdtempSync(join(tmpdir(), 'umbel-components-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

// Candidates are absolute for the platform; on Windows a rooted path gains the drive.
const at = (...parts) => join(resolve(parts[0]), ...parts.slice(1));

test('an explicit binary is the only candidate', () => {
	assert.deepEqual(binaryCandidates({ UMBEL_FIRST_PARTY: '/opt/umbel/umbel-first-party' }, '/r'), [
		at('/opt/umbel/umbel-first-party'),
	]);
});

test('release builds come before debug, the shared target before the checkout', () => {
	assert.deepEqual(binaryCandidates({ CARGO_TARGET_DIR: '/cache/target' }, '/r', 'linux'), [
		at('/cache/target', 'release', BINARY),
		at('/r', 'endpoints/umbel/target', 'release', BINARY),
		at('/cache/target', 'debug', BINARY),
		at('/r', 'endpoints/umbel/target', 'debug', BINARY),
	]);
	assert.deepEqual(binaryCandidates({ CARGO_BUILD_TARGET_DIR: '/build/target' }, '/r', 'linux'), [
		at('/build/target', 'release', BINARY),
		at('/r', 'endpoints/umbel/target', 'release', BINARY),
		at('/build/target', 'debug', BINARY),
		at('/r', 'endpoints/umbel/target', 'debug', BINARY),
	]);
	assert.deepEqual(
		binaryCandidates(
			{ UMBEL_TARGET_DIR: '/umbel/target', CARGO_TARGET_DIR: '/cache/target' },
			'/r',
			'linux'
		),
		[
			at('/umbel/target', 'release', BINARY),
			at('/cache/target', 'release', BINARY),
			at('/r', 'endpoints/umbel/target', 'release', BINARY),
			at('/umbel/target', 'debug', BINARY),
			at('/cache/target', 'debug', BINARY),
			at('/r', 'endpoints/umbel/target', 'debug', BINARY),
		]
	);
	assert.deepEqual(binaryCandidates({}, '/r', 'linux'), [
		at('/r', 'endpoints/umbel/target', 'release', BINARY),
		at('/r', 'endpoints/umbel/target', 'debug', BINARY),
	]);
});

test('binaryCandidates resolves Cargo config [build] target-dir outside the worktree (#2241)', (t) => {
	const root = scratch(t);
	const home = join(root, 'cargo-home');
	const external = join(root, 'dev', 'umbel-target');
	mkdirSync(join(root, 'endpoints', 'umbel'), { recursive: true });
	mkdirSync(home, { recursive: true });
	writeFileSync(join(home, 'config.toml'), `[build]\ntarget-dir = ${JSON.stringify(external)}\n`);
	assert.deepEqual(binaryCandidates({ CARGO_HOME: home }, root, 'linux'), [
		at(external, 'release', BINARY),
		at(root, 'endpoints/umbel/target', 'release', BINARY),
		at(external, 'debug', BINARY),
		at(root, 'endpoints/umbel/target', 'debug', BINARY),
	]);
});

test('on Windows the candidates name the .exe cargo writes', () => {
	assert.equal(binaryName('win32'), `${BINARY}.exe`);
	assert.equal(binaryName('linux'), BINARY);
	assert.deepEqual(binaryCandidates({}, '/r', 'win32'), [
		at('/r', 'endpoints/umbel/target', 'release', `${BINARY}.exe`),
		at('/r', 'endpoints/umbel/target', 'debug', `${BINARY}.exe`),
	]);
});

test('a release binary wins over a newer debug one, and the newest release wins', () => {
	const file = (mtimeMs) => ({ isFile: () => true, mtimeMs });
	const stats = {
		'/a/release/x': file(1),
		'/b/release/x': file(2),
		'/a/debug/x': file(9),
	};
	const stat = (path) => stats[path] ?? null;
	assert.equal(findBinary(['/a/release/x', '/b/release/x', '/a/debug/x'], stat), '/b/release/x');
	assert.equal(findBinary(['/c/release/x', '/a/debug/x'], stat), '/a/debug/x');
	assert.equal(findBinary(['/c/release/x'], stat), null);
	// Windows paths, joined with backslashes: release still wins.
	const win = (profile) => win32.join('C:/', 'a', profile, 'x.exe');
	const windows = { [win('release')]: file(1), [win('debug')]: file(9) };
	assert.equal(
		findBinary([win('release'), win('debug')], (path) => windows[path] ?? null),
		win('release')
	);
});

test('a checkout under a directory named release is classified by the binary’s own directory', () => {
	const file = (mtimeMs) => ({ isFile: () => true, mtimeMs });
	const stats = {
		'/work/release/afd/target/debug/x': file(9),
		'/work/release/afd/target/release/x': file(1),
	};
	const stat = (path) => stats[path] ?? null;
	// The release build is listed first and wins over the newer debug one, which a path's `release` segment would tie.
	assert.equal(
		findBinary(['/work/release/afd/target/release/x', '/work/release/afd/target/debug/x'], stat),
		'/work/release/afd/target/release/x'
	);
	// With only a debug build, it is found, and is not taken for a release one ahead of a release elsewhere.
	const both = { ...stats, '/opt/umbel/target/release/x': file(5) };
	assert.equal(
		findBinary(
			['/opt/umbel/target/release/x', '/work/release/afd/target/debug/x'],
			(path) => both[path] ?? null
		),
		'/opt/umbel/target/release/x'
	);
});

test('the workspace serves the components plugin alone, and keeps a deployer pack.toml', (t) => {
	const workspace = scratch(t);
	const override = prepareWorkspace(workspace);
	assert.equal(override, overrideDirectory(workspace));
	assert.equal(readFileSync(join(workspace, 'umbel.toml'), 'utf8'), UMBEL_TOML);
	assert.match(UMBEL_TOML, /enabled = \["components"\]/);
	assert.equal(readFileSync(join(override, 'pack.toml'), 'utf8'), PACK_TOML);
	writeFileSync(join(override, 'pack.toml'), 'pack_version = 1\nid = "mine"\n');
	writeFileSync(join(workspace, 'umbel.toml'), 'edited');
	prepareWorkspace(workspace);
	assert.equal(
		readFileSync(join(override, 'pack.toml'), 'utf8'),
		'pack_version = 1\nid = "mine"\n'
	);
	assert.equal(readFileSync(join(workspace, 'umbel.toml'), 'utf8'), UMBEL_TOML);
});

test('an export with no Specimen CLI fails with a suggestion, and starts nothing', (t) => {
	const root = scratch(t);
	const result = exportPack(join(root, 'override'), root);
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'SPECIMEN_CLI_NOT_BUILT');
	assert.match(result.error.suggestion, /pnpm build/);
});

test('an export holds a lock, waits for another and takes a stale one', (t) => {
	const lock = join(scratch(t), 'export.lock');
	assert.equal(
		withLock(lock, () => existsSync(lock)),
		true
	);
	assert.equal(existsSync(lock), false);
	mkdirSync(lock);
	const busy = withLock(lock, () => 'ran', { waitMs: 200, staleMs: 60_000 });
	assert.equal(busy.error.code, 'PACK_EXPORT_BUSY');
	assert.equal(
		withLock(lock, () => 'ran', { waitMs: 200, staleMs: -1 }),
		'ran'
	);
	assert.equal(existsSync(lock), false);
});

test('the repository deploys Loam exclusions outside the library pack', (t) => {
	const workspace = scratch(t);
	const override = prepareWorkspace(workspace);
	const consumers = join(workspace, 'spaces', 'main', 'packs', 'components', 'consumers');
	assert.equal(readFileSync(join(consumers, 'pack.toml'), 'utf8'), CONSUMERS_TOML);
	assert.deepEqual(
		JSON.parse(readFileSync(join(consumers, 'data', 'consumers.json'), 'utf8')),
		CONSUMERS
	);
	assert.deepEqual(CONSUMERS.consumers.loam.exclude_rules, [
		'violet-elements/import.root',
		'violet-elements/theme.install',
	]);
	assert.equal(existsSync(join(override, 'data', 'consumers.json')), false);
});

test('violet-elements is exported first, then each listed library once', () => {
	const root = resolve('/checkout');
	assert.deepEqual(libraryDirectories({}, root), [join(root, LIBRARY)]);
	assert.deepEqual(
		libraryDirectories(
			{ UMBEL_COMPONENTS_LIBRARIES: ['/lushly', '', ' /other ', '/lushly'].join(delimiter) },
			root
		),
		[join(root, LIBRARY), resolve('/lushly'), resolve('/other')]
	);
});

test('a listed directory that is not a library fails with a suggestion', (t) => {
	const root = scratch(t);
	const cli = join(root, 'endpoints/specimen-cli/dist/bin.js');
	mkdirSync(join(cli, '..'), { recursive: true });
	writeFileSync(cli, '');
	const result = exportPack(join(root, 'override'), root, join(root, 'not-a-library'));
	assert.equal(result.error.code, 'LIBRARY_NOT_FOUND');
	assert.match(result.error.suggestion, /UMBEL_COMPONENTS_LIBRARIES/);
});

test('a library this start did not export is removed from the override', (t) => {
	const override = scratch(t);
	for (const name of ['violet-elements', 'lushly-web']) {
		mkdirSync(join(override, 'data', name, 'components'), { recursive: true });
		mkdirSync(join(override, 'rules'), { recursive: true });
		writeFileSync(join(override, 'rules', `${name}.json`), '{}');
	}
	assert.deepEqual(pruneLibraries(override, ['violet-elements']), ['lushly-web']);
	assert.equal(existsSync(join(override, 'data', 'lushly-web')), false);
	assert.equal(existsSync(join(override, 'rules', 'lushly-web.json')), false);
	assert.equal(existsSync(join(override, 'data', 'violet-elements')), true);
	assert.equal(existsSync(join(override, 'rules', 'violet-elements.json')), true);
	assert.deepEqual(pruneLibraries(override, ['violet-elements']), []);
});

// ── The deployment's consumers and default (UMBEL_COMPONENTS_CONSUMERS, UMBEL_COMPONENTS_CONSUMER) ──

const STOREFRONT = {
	version: 2,
	consumers: {
		storefront: {
			statements: [{ id: 'forms.keep.labels-visible', text: 'Every field keeps a visible label.' }],
		},
	},
};

const reading = (files) => (path) => {
	if (!Object.hasOwn(files, path)) throw new Error(`ENOENT: ${path}`);
	return files[path];
};

test('without either variable, the files written are byte for byte the repository defaults', (t) => {
	const deployed = deployment({});
	assert.equal(deployed.success, true);
	assert.equal(deployed.data.consumers, CONSUMERS);
	assert.equal(deployed.data.umbelToml, UMBEL_TOML);
	const plain = scratch(t);
	const configured = scratch(t);
	prepareWorkspace(plain);
	prepareWorkspace(configured, deployed.data);
	const consumers = join(
		'spaces',
		'main',
		'packs',
		'components',
		'consumers',
		'data',
		'consumers.json'
	);
	for (const file of ['umbel.toml', consumers])
		assert.equal(
			readFileSync(join(configured, file), 'utf8'),
			readFileSync(join(plain, file), 'utf8')
		);
	assert.equal(
		readFileSync(join(plain, consumers), 'utf8'),
		'{"version":1,"consumers":{"loam":{"exclude_rules":["violet-elements/import.root","violet-elements/theme.install"]}}}\n'
	);
	assert.doesNotMatch(
		readFileSync(join(plain, 'umbel.toml'), 'utf8'),
		/plugins\.components\.config/
	);
});

test('a consumers file is added to the repository profiles, keeping Loam, as version 2', (t) => {
	const file = resolve('/deploy/consumers.json');
	const deployed = deployment(
		{ UMBEL_COMPONENTS_CONSUMERS: '/deploy/consumers.json' },
		reading({ [file]: JSON.stringify(STOREFRONT) })
	);
	assert.equal(deployed.success, true, JSON.stringify(deployed));
	assert.deepEqual(deployed.data.consumers, {
		version: 2,
		consumers: { ...CONSUMERS.consumers, ...STOREFRONT.consumers },
	});
	assert.equal(deployed.data.umbelToml, UMBEL_TOML);
	const workspace = scratch(t);
	prepareWorkspace(workspace, deployed.data);
	const written = JSON.parse(
		readFileSync(
			join(
				workspace,
				'spaces',
				'main',
				'packs',
				'components',
				'consumers',
				'data',
				'consumers.json'
			),
			'utf8'
		)
	);
	assert.deepEqual(written, deployed.data.consumers);
	// A version 1 file merges too.
	const v1 = deployment(
		{ UMBEL_COMPONENTS_CONSUMERS: '/deploy/consumers.json' },
		reading({ [file]: '{"version":1,"consumers":{"kiosk":{"exclude_rules":[]}}}' })
	);
	assert.deepEqual(Object.keys(v1.data.consumers.consumers), ['loam', 'kiosk']);
});

test('a consumers file that configures a repository name refuses to start', () => {
	const file = resolve('/deploy/consumers.json');
	const clash = { version: 2, consumers: { loam: { statements: [] }, storefront: {} } };
	const deployed = deployment(
		{ UMBEL_COMPONENTS_CONSUMERS: file },
		reading({ [file]: JSON.stringify(clash) })
	);
	assert.equal(deployed.success, false);
	assert.equal(deployed.error.code, 'CONSUMER_CLASH');
	assert.match(deployed.error.message, /loam/);
	assert.match(deployed.error.suggestion, /Rename/);
});

test('an unreadable or misshapen consumers file refuses to start with a suggestion', () => {
	const file = resolve('/deploy/consumers.json');
	const missing = deployment({ UMBEL_COMPONENTS_CONSUMERS: file }, reading({}));
	assert.equal(missing.error.code, 'CONSUMERS_UNREADABLE');
	for (const text of [
		'{"version":3,"consumers":{}}',
		'{"version":2,"consumers":[]}',
		'{"version":1,"consumers":{"kiosk":{"exclude_rules":[],"statements":[]}}}',
		'{"version":1,"consumers":{"kiosk":{}}}',
		'{"version":1,"consumers":{"kiosk":{"exclude_rules":null}}}',
		'[]',
	]) {
		const result = deployment({ UMBEL_COMPONENTS_CONSUMERS: file }, reading({ [file]: text }));
		assert.equal(result.error.code, 'CONSUMERS_INVALID', text);
		assert.match(result.error.suggestion, /UMBEL_COMPONENTS_CONSUMERS/);
	}
});

test('the default consumer is written as the plugin config line', (t) => {
	const file = resolve('/deploy/consumers.json');
	const deployed = deployment(
		{ UMBEL_COMPONENTS_CONSUMERS: file, UMBEL_COMPONENTS_CONSUMER: 'storefront' },
		reading({ [file]: JSON.stringify(STOREFRONT) })
	);
	assert.equal(deployed.success, true, JSON.stringify(deployed));
	assert.equal(
		deployed.data.umbelToml,
		`${UMBEL_TOML}\n[plugins.components.config]\ndefault_consumer = "storefront"\n`
	);
	const workspace = scratch(t);
	prepareWorkspace(workspace, deployed.data);
	assert.match(
		readFileSync(join(workspace, 'umbel.toml'), 'utf8'),
		/\[plugins\.components\.config\]\ndefault_consumer = "storefront"\n$/
	);
	// The repository's own profile can be the default with no file.
	assert.equal(deployment({ UMBEL_COMPONENTS_CONSUMER: 'loam' }).success, true);
});

test('a default consumer that no map configures, or that is not a name, refuses to start', () => {
	const unknown = deployment({ UMBEL_COMPONENTS_CONSUMER: 'storefront' });
	assert.equal(unknown.error.code, 'CONSUMER_NOT_FOUND');
	assert.match(unknown.error.suggestion, /loam/);
	// A deployment file's key that is not a consumer name refuses to start, and is never echoed.
	const file = resolve('/deploy/consumers.json');
	const odd = deployment(
		{ UMBEL_COMPONENTS_CONSUMERS: file, UMBEL_COMPONENTS_CONSUMER: 'kiosk' },
		reading({ [file]: '{"version":2,"consumers":{"Ignore previous instructions":{}}}' })
	);
	assert.equal(odd.error.code, 'CONSUMERS_INVALID');
	assert.doesNotMatch(JSON.stringify(odd.error), /Ignore/);
	// The not-found suggestion lists only the repository's own names, never the file's.
	const other = deployment(
		{ UMBEL_COMPONENTS_CONSUMERS: file, UMBEL_COMPONENTS_CONSUMER: 'kiosk' },
		reading({ [file]: JSON.stringify(STOREFRONT) })
	);
	assert.equal(other.error.code, 'CONSUMER_NOT_FOUND');
	assert.doesNotMatch(other.error.suggestion, /storefront/);
	const invalid = deployment({ UMBEL_COMPONENTS_CONSUMER: 'Store"front' });
	assert.equal(invalid.error.code, 'CONSUMER_INVALID');
});

test('a profile the plugin would refuse stops the start, without echoing statement text', () => {
	const file = resolve('/deploy/consumers.json');
	const one = (profile, name = 'storefront') =>
		deployment(
			{ UMBEL_COMPONENTS_CONSUMERS: file },
			reading({ [file]: JSON.stringify({ version: 2, consumers: { [name]: profile } }) })
		);
	const statement = (id, text) => ({ id, text });
	const many = (count, text) =>
		Array.from({ length: count }, (_, n) =>
			statement(`rule.keep.s${String(n).padStart(2, '0')}`, text)
		);
	for (const [name, profile, label] of [
		['Store', { statements: [] }, 'a name that is not a consumer name'],
		['storefront', { statements: many(25, 'PRIVATE') }, '25 statements'],
		[
			'storefront',
			{ statements: [statement('a.b', `PRIVATE${'x'.repeat(234)}`)] },
			'241 characters',
		],
		['storefront', { statements: [statement('a.b', 'PRIVATE\nline')] }, 'a line feed'],
		['storefront', { statements: [statement('a.b', 'PRIVATE\u202e')] }, 'a bidi override'],
		['storefront', { statements: [statement('A.b', 'PRIVATE')] }, 'a bad id'],
		[
			'storefront',
			{ statements: [statement('a.b', 'PRIVATE'), statement('a.b', 'PRIVATE')] },
			'a repeated id',
		],
		[
			'storefront',
			{ statements: many(17, `PRIVATE${'é'.repeat(233)}`) },
			'over 4096 bytes, under in characters',
		],
		[
			'storefront',
			{ statements: many(16, `PRIVATE${'x'.repeat(248)}`) },
			'over 4096 bytes with the ids',
		],
		[
			'storefront',
			{ statements: [{ id: 'a.b', text: 'PRIVATE', basis: 'verified' }] },
			'an unknown key',
		],
		['storefront', { statements: null }, 'null statements'],
		['storefront', { exclude_rules: ['import.root'] }, 'an unqualified exclusion'],
		['storefront', { extra: [] }, 'an unknown profile key'],
	]) {
		const result = one(profile, name);
		assert.equal(result.success, false, label);
		assert.equal(result.error.code, 'CONSUMERS_INVALID', label);
		assert.doesNotMatch(JSON.stringify(result), /PRIVATE/, label);
	}
	// The boundaries are admitted: 24 statements, 240 characters, exactly 4 096 bytes with the ids.
	const atBytes = [...many(16, 'x'.repeat(240)), statement('rule.keep.last', 'x'.repeat(34))];
	for (const statements of [
		many(24, 'x'.repeat(150)),
		[statement('a.b', 'é'.repeat(240))],
		atBytes,
	])
		assert.equal(one({ statements }).success, true);
});

test('a start with other consumers gets a workspace of its own', () => {
	const root = resolve('/repo');
	const own = deployment({});
	assert.equal(workspaceFor(own.data, {}, root), join(root, '.umbel', 'components'));
	const file = resolve('/deploy/consumers.json');
	const deployed = deployment(
		{ UMBEL_COMPONENTS_CONSUMERS: file, UMBEL_COMPONENTS_CONSUMER: 'storefront' },
		reading({ [file]: JSON.stringify(STOREFRONT) })
	);
	const separate = workspaceFor(deployed.data, {}, root);
	assert.match(separate, /components-[0-9a-f]{12}$/);
	assert.equal(workspaceFor(deployed.data, {}, root), separate, 'stable for the same deployment');
	const loamDefault = deployment({ UMBEL_COMPONENTS_CONSUMER: 'loam' });
	assert.notEqual(workspaceFor(loamDefault.data, {}, root), separate);
	assert.notEqual(workspaceFor(loamDefault.data, {}, root), join(root, '.umbel', 'components'));
	// An explicit workspace always wins.
	assert.equal(
		workspaceFor(deployed.data, { UMBEL_COMPONENTS_WORKSPACE: '/elsewhere' }, root),
		resolve('/elsewhere')
	);
});
