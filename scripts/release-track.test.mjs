import assert from 'node:assert/strict';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadInventory, parseFragments } from './release/control.mjs';
import { execTool } from './release/exec-tool.mjs';
import {
	ignores,
	parseEntries,
	readVersion,
	renderSection,
	setVersion,
	unreleasedBody,
} from './release/tracks.mjs';
import { selectRelease, versionSelected } from './release-control.mjs';
import {
	changelogDigest,
	checkTracks,
	lockDirectories,
	pinTrack,
	versionTrack,
} from './release-track.mjs';

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const shell = (cwd, command, args) =>
	execTool(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
/** The installed Changesets, as `pnpm version-track` runs it. */
const changesets = (cwd) =>
	shell(cwd, process.execPath, [
		join(repository, 'node_modules/@changesets/cli/bin.js'),
		'version',
	]);
const commit = (root, message = 'fixture') => {
	shell(root, 'git', ['add', '.']);
	shell(root, 'git', [
		'-c',
		'user.name=Fixture',
		'-c',
		'user.email=fixture@example.invalid',
		'commit',
		'-m',
		message,
	]);
};

const PYTHON_CHANGELOG = `# Changelog

## [Unreleased]

## [0.11.0] - 2026-11-18

### Added

- An earlier entry.

[Unreleased]: https://github.com/lushly-dev/afd/compare/python-v0.11.0...main
[0.11.0]: https://github.com/lushly-dev/afd/compare/python-v0.10.0...python-v0.11.0
`;
const BOTCORE_CHANGELOG = `# Changelog

## [Unreleased]

## [0.7.0] - 2026-11-13

### Added

- An earlier entry.
`;
const RUST_CHANGELOG = `# Changelog

## [Unreleased]

## [0.3.0] - 2026-11-24

### Added

- An earlier entry.

[Unreleased]: https://github.com/lushly-dev/afd/compare/rust-v0.3.0...HEAD
[0.3.0]: https://github.com/lushly-dev/afd/compare/rust-v0.2.1...rust-v0.3.0
`;
/** A Cargo.lock entry: built from its path when `source` is null. */
const cargoPackage = (name, version, source = null) =>
	`[[package]]\nname = "${name}"\nversion = "${version}"\n${source ? `source = "${source}"\n` : ''}`;
const REGISTRY = 'registry+https://github.com/rust-lang/crates.io-index';
const SPEC_CHANGELOG = `# AFD contract changelog

## Changing the version

Steps.

## 1.0-rc

An earlier paragraph.
`;

function stubUnit(id, name, manifest, version) {
	return {
		id,
		family: 'fixture',
		protocol: 'npm-changesets',
		sourceRevision: 'fixture',
		authority: 'none: private stub',
		state: 'quarantined',
		routes: [],
		gates: ['fixture'],
		fixed: false,
		distributions: [
			{ name, registry: 'npm', manifest, format: 'npm', initialVersion: version, private: true },
		],
	};
}

function fixture(t, { fragments = {} } = {}) {
	const base = mkdtempSync(join(tmpdir(), 'afd-track-test-'));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const root = join(base, 'repo');
	const write = (file, contents) => {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(
			join(root, file),
			typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, '\t')}\n`
		);
	};
	const read = (file) => readFileSync(join(root, file), 'utf8');
	write('package.json', { name: 'fixture', private: true, packageManager: 'pnpm@10.30.1' });
	write(
		'pnpm-workspace.yaml',
		'packages:\n  - "packages/*"\n  - "endpoints/*"\n  - "python"\n  - "spec"\n'
	);
	write('.changeset/config.json', {
		changelog: false,
		commit: false,
		fixed: [],
		linked: [],
		access: 'public',
		baseBranch: 'main',
		updateInternalDependencies: 'patch',
		ignore: ['@fixture/private-*'],
		privatePackages: { version: true, tag: false },
	});
	write('.changeset/npm.md', '---\n"@fixture/a": patch\n---\n\nAn npm release\n');
	for (const [name, text] of Object.entries(fragments)) write(`.changeset/${name}.md`, text);
	write('packages/a/package.json', { name: '@fixture/a', version: '1.0.0' });
	write('packages/a/CHANGELOG.md', '# @fixture/a\n');
	write('packages/app/package.json', {
		name: '@fixture/private-app',
		version: '0.1.0',
		private: true,
		dependencies: { '@fixture/a': 'workspace:^' },
	});
	write('python/package.json', { name: 'afd-python', version: '0.11.0', private: true });
	write(
		'python/pyproject.toml',
		'[build-system]\nrequires = []\n\n[project]\nname = "afd"\nversion = "0.11.0"\n\n[tool.other]\nversion = "9.9.9"\n'
	);
	write('python/src/afd/__init__.py', '"""afd."""\n\n__version__ = "0.11.0"\n');
	write('python/CHANGELOG.md', PYTHON_CHANGELOG);
	write('python/uv.lock', '[[package]]\nname = "afd"\nsource = { editable = "." }\n');
	write('endpoints/botcore/package.json', {
		name: 'lushly-botcore',
		version: '0.7.0',
		private: true,
	});
	write(
		'endpoints/botcore/pyproject.toml',
		'[project]\nname = "lushly-botcore"\nversion = "0.7.0"\n'
	);
	write('endpoints/botcore/src/botcore/__init__.py', "__version__ = '0.7.0'\n");
	write('endpoints/botcore/CHANGELOG.md', BOTCORE_CHANGELOG);
	write(
		'endpoints/botcore/uv.lock',
		'source = { editable = "." }\nsource = { editable = "../../python" }\n'
	);
	write('endpoints/botcore/provenance/adaptations.json', {
		files: [
			'CHANGELOG.md',
			'package.json',
			'pyproject.toml',
			'src/botcore/__init__.py',
			'uv.lock',
		].map((path) => ({ path })),
	});
	// A lockfile inside the unit that its provenance does not record.
	write(
		'endpoints/botcore/plugins/factory/uv.lock',
		'source = { editable = "." }\nsource = { editable = "../../" }\nsource = { editable = "../../../../python" }\n'
	);
	write(
		'alfred/uv.lock',
		'source = { editable = "." }\nsource = { editable = "../python" }\nsource = { editable = "../endpoints/botcore" }\n'
	);
	write('packages/rust/package.json', { name: 'afd-rust', version: '0.3.0', private: true });
	write(
		'packages/rust/Cargo.toml',
		'[package]\nname = "afd"\nversion = "0.3.0"\n\n[package.metadata.docs.rs]\nversion = "9.9.9"\n'
	);
	write('packages/rust/CHANGELOG.md', RUST_CHANGELOG);
	write(
		'packages/rust/Cargo.lock',
		`version = 4\n\n${cargoPackage('afd', '0.3.0')}\n${cargoPackage('serde', '1.0.0', REGISTRY)}`
	);
	// A consumer that builds the crate from its path, and one that downloads it: only the first
	// states this checkout's version.
	write(
		'endpoints/host/Cargo.lock',
		`version = 4\n\n${cargoPackage('host', '0.1.0')}\n${cargoPackage('afd', '0.3.0')}`
	);
	write(
		'endpoints/elsewhere/Cargo.lock',
		`version = 4\n\n${cargoPackage('afd', '0.1.0', REGISTRY)}\n${cargoPackage('elsewhere', '0.1.0')}`
	);
	write('spec/VERSION', '1.0-rc\n');
	write('spec/CHANGELOG.md', SPEC_CHANGELOG);
	write('spec/package.json', {
		name: 'afd-spec',
		version: '0.0.0',
		private: true,
		afd: { changelogSha256: changelogDigest(SPEC_CHANGELOG) },
	});
	write('scripts/release/inventory.json', {
		schemaVersion: 1,
		units: [
			{
				id: 'a',
				family: 'fixture',
				protocol: 'npm-changesets',
				sourceRevision: 'fixture',
				authority: 'fixture',
				state: 'admitted',
				routes: ['npm-main'],
				gates: ['fixture'],
				fixed: false,
				distributions: [
					{
						name: '@fixture/a',
						registry: 'npm',
						manifest: 'packages/a/package.json',
						format: 'npm',
						initialVersion: '1.0.0',
					},
				],
			},
			stubUnit('afd-python-changes', 'afd-python', 'python/package.json', '0.11.0'),
			stubUnit('botcore-changes', 'lushly-botcore', 'endpoints/botcore/package.json', '0.7.0'),
			stubUnit('afd-rust-changes', 'afd-rust', 'packages/rust/package.json', '0.3.0'),
			stubUnit('afd-spec-changes', 'afd-spec', 'spec/package.json', '0.0.0'),
		],
	});
	shell(base, 'git', ['init', '-b', 'main', 'repo']);
	commit(root);
	return { root, write, read };
}

/** The fixture holds no package the repository's pending list names, so it lists none. */
const check = (root, options = {}) => checkTracks({ root, pendingUnreleased: {}, ...options });
const messages = (root, options) => check(root, options).map((problem) => problem.message);
const fragment = (name, type, body) => `---\n"${name}": ${type}\n---\n\n${body}\n`;

test('the fixture passes the check, and so does this repository', (t) => {
	assert.deepEqual(messages(fixture(t).root), []);
	assert.deepEqual(checkTracks({ root: repository }), []);
});

test('a hand edit under Unreleased is named with its file and line', (t) => {
	const f = fixture(t);
	f.write(
		'python/CHANGELOG.md',
		PYTHON_CHANGELOG.replace('## [Unreleased]\n', '## [Unreleased]\n\n### Fixed\n\n- By hand.\n')
	);
	f.write(
		'endpoints/botcore/CHANGELOG.md',
		BOTCORE_CHANGELOG.replace('## [Unreleased]\n', '## [Unreleased]\n- By hand.\n')
	);
	const problems = check(f.root);
	assert.deepEqual(
		problems.map((problem) => problem.message),
		[
			'python/CHANGELOG.md:5 has an entry under "## [Unreleased]"',
			'endpoints/botcore/CHANGELOG.md:4 has an entry under "## [Unreleased]"',
		]
	);
	assert.match(problems[0].suggestion, /\.changeset\/.*"afd-python"/);
});

test('a published package whose changelog Changesets writes holds no hand-written Unreleased', (t) => {
	const f = fixture(t);
	f.write('packages/a/CHANGELOG.md', '# @fixture/a\n\n## Unreleased\n\n- By hand.\n\n## 1.0.0\n');
	// A private package's changelog is not Changesets': it may keep its own shape.
	f.write('packages/app/CHANGELOG.md', '# app\n\n## [Unreleased]\n\n- Kept.\n');
	const problems = check(f.root);
	assert.deepEqual(
		problems.map((problem) => problem.message),
		['packages/a/CHANGELOG.md:3 has a hand-written "Unreleased" section']
	);
	assert.match(problems[0].suggestion, /@fixture\/a's changelog from its fragments/);
	for (const heading of [
		'## [Unreleased]',
		'## unreleased  ',
		'## Unreleased\r',
		'### Unreleased changes',
		'##Unreleased:',
		'# [Unreleased] - 2026-11-27',
	]) {
		f.write('packages/a/CHANGELOG.md', `# @fixture/a\n\n${heading}\n`);
		assert.deepEqual(messages(f.root), [
			'packages/a/CHANGELOG.md:3 has a hand-written "Unreleased" section',
		]);
	}
});

test('a pending changelog passes while its section remains, and its entry fails once it is gone', (t) => {
	const f = fixture(t);
	const pendingUnreleased = { 'packages/a/CHANGELOG.md': '#1' };
	f.write('packages/a/CHANGELOG.md', '# @fixture/a\n\n## Unreleased\n\n- By hand.\n');
	assert.deepEqual(messages(f.root, { pendingUnreleased }), []);

	f.write('packages/a/CHANGELOG.md', '# @fixture/a\n');
	assert.deepEqual(messages(f.root, { pendingUnreleased }), [
		'packages/a/CHANGELOG.md has no "Unreleased" section, but PENDING_UNRELEASED still lists it (#1)',
	]);

	const elsewhere = { 'packages/app/CHANGELOG.md': '#2', 'packages/gone/CHANGELOG.md': '#3' };
	assert.deepEqual(messages(f.root, { pendingUnreleased: elsewhere }), [
		"PENDING_UNRELEASED lists packages/app/CHANGELOG.md (#2), which is not a published package's changelog",
		"PENDING_UNRELEASED lists packages/gone/CHANGELOG.md (#3), which is not a published package's changelog",
	]);
});

test('an Unreleased heading inside a fenced example in a release note is not a section', (t) => {
	const f = fixture(t);
	f.write(
		'packages/a/CHANGELOG.md',
		'# @fixture/a\n\n## 1.0.0\n\n- Documents the format:\n\n  ```markdown\n  ## Unreleased\n  ```\n'
	);
	assert.deepEqual(messages(f.root), []);
});

test('an entry under its own heading, or a section written by hand, is not hidden by an empty Unreleased', (t) => {
	const f = fixture(t);
	f.write(
		'python/CHANGELOG.md',
		PYTHON_CHANGELOG.replace('## [Unreleased]\n', '## [Unreleased]\n\n## Fixed\n\n- By hand.\n')
	);
	assert.deepEqual(messages(f.root), [
		'python/CHANGELOG.md:5 has the heading "## Fixed" below "## [Unreleased]"',
	]);
	f.write(
		'python/CHANGELOG.md',
		PYTHON_CHANGELOG.replace(
			'## [Unreleased]\n',
			'## [Unreleased]\n\n## [0.12.0] - 2026-12-01\n\n### Fixed\n\n- By hand.\n'
		)
	);
	assert.deepEqual(messages(f.root), [
		'python/CHANGELOG.md:5 has 0.12.0 as its newest section, but python/package.json has 0.11.0',
	]);
	// A second Unreleased heading hides nothing either.
	f.write(
		'python/CHANGELOG.md',
		PYTHON_CHANGELOG.replace(
			'## [Unreleased]\n',
			'## [Unreleased]\n\n## [Unreleased]\n\n- By hand.\n'
		)
	);
	assert.deepEqual(messages(f.root), [
		'python/CHANGELOG.md:5 has the heading "## [Unreleased]" below "## [Unreleased]"',
	]);
	// A heading inside a code block is not a section.
	f.write(
		'python/CHANGELOG.md',
		PYTHON_CHANGELOG.replace(
			'- An earlier entry.\n',
			'- An earlier entry.\n\n```md\n## Notes\n```\n'
		)
	);
	assert.deepEqual(messages(f.root), []);
});

test('a hand edit to the contract changelog fails until it is a fragment or a pinned correction', (t) => {
	const f = fixture(t);
	f.write('spec/CHANGELOG.md', SPEC_CHANGELOG.replace('## 1.0-rc\n', '## 1.0-rc\n\nBy hand.\n'));
	const [problem, ...rest] = check(f.root);
	assert.deepEqual(rest, []);
	assert.equal(problem.message, 'spec/CHANGELOG.md differs from the digest spec/package.json pins');
	assert.match(problem.suggestion, /"afd-spec": patch/);
	pinTrack({ root: f.root, name: 'spec' });
	assert.deepEqual(messages(f.root), []);
	// A CRLF checkout of the same text has the same digest.
	assert.equal(changelogDigest('a\r\nb\r\n'), changelogDigest('a\nb\n'));
});

test('a stub that disagrees with its project, could publish, or lost its ignore list fails', (t) => {
	const f = fixture(t);
	f.write('python/src/afd/__init__.py', '__version__ = "0.11.1"\n');
	assert.deepEqual(messages(f.root), [
		'python/src/afd/__init__.py has version 0.11.1, but python/package.json has 0.11.0',
	]);

	const g = fixture(t);
	g.write('endpoints/botcore/package.json', { name: 'lushly-botcore', version: '0.7.0' });
	assert.deepEqual(messages(g.root), [
		'endpoints/botcore/package.json must be the private package lushly-botcore with a semver version',
	]);

	const h = fixture(t);
	const config = JSON.parse(h.read('.changeset/config.json'));
	h.write('.changeset/config.json', { ...config, ignore: [] });
	assert.deepEqual(messages(h.root), [
		'The private package @fixture/private-app is not in the ignore list of .changeset/config.json',
	]);
	h.write('.changeset/config.json', { ...config, privatePackages: { version: false, tag: false } });
	assert.deepEqual(messages(h.root), ['.changeset/config.json does not version private packages']);
	h.write('.changeset/config.json', { ...config, ignore: [...config.ignore, 'afd-*'] });
	assert.deepEqual(messages(h.root), ['.changeset/config.json ignores a track stub with "afd-*"']);

	h.write('.changeset/config.json', {
		...config,
		ignore: [...config.ignore, '!@fixture/private-app'],
	});
	assert.deepEqual(messages(h.root), [
		'.changeset/config.json has the ignore pattern "!@fixture/private-app"',
	]);
	h.write('.changeset/config.json', { ...config, ignore: ['@fixture/*'] });
	assert.deepEqual(messages(h.root), [
		'.changeset/config.json ignores the published package @fixture/a with "@fixture/*"',
	]);

	// An inventory that reads no fragments would let every fragment rule pass unseen.
	const j = fixture(t, { fragments: { bad: fragment('afd-python', 'patch', '- No heading.') } });
	const unread = JSON.parse(j.read('scripts/release/inventory.json'));
	j.write('scripts/release/inventory.json', { ...unread, storages: [] });
	assert.deepEqual(messages(j.root), [
		'scripts/release/inventory.json does not read .changeset as npm-changesets storage',
	]);

	const i = fixture(t);
	const inventory = JSON.parse(i.read('scripts/release/inventory.json'));
	inventory.units[1].state = 'admitted';
	i.write('scripts/release/inventory.json', inventory);
	assert.deepEqual(messages(i.root), [
		'scripts/release/inventory.json must own python/package.json as the private unit afd-python-changes, not admitted and with no route',
	]);
});

test('a track fragment names one track, under a known heading; a contract entry is a patch of prose', (t) => {
	const refused = (text, read = false) => {
		const f = fixture(t, { fragments: { bad: text } });
		if (read) return assert.throws(() => parseFragments(f.root, loadInventory(f.root)), read);
		// The npm release reads every fragment, so a track's entry must never stop it.
		parseFragments(f.root, loadInventory(f.root));
		return messages(f.root)[0] ?? null;
	};
	const entry = '### Fixed\n\n- A fix.';
	assert.equal(refused(fragment('afd-python', 'patch', entry)), null);
	assert.equal(refused(fragment('afd-spec', 'patch', 'A paragraph.')), null);
	// Sharing a fragment is refused wherever fragments are read, the npm release included.
	refused(
		`---\n"afd-python": patch\n"@fixture/a": patch\n---\n\n${entry}\n`,
		/names afd-python, @fixture\/a; a fragment for afd-python names only it/
	);
	refused(
		`---\n"afd-python": patch\n"lushly-botcore": patch\n---\n\n${entry}\n`,
		/a fragment for afd-python names only it/
	);
	// A ~~~ line inside a backtick fence does not close it, so the heading after it is seen.
	assert.match(
		refused(fragment('afd-python', 'patch', `${entry}\n\n\`\`\`\n~~~\n\`\`\`\n\n## Mine`)),
		/has a "## Mine" heading/
	);
	assert.match(
		refused(fragment('afd-python', 'patch', '- A fix.')),
		/needs its entries under a heading/
	);
	assert.match(
		refused(fragment('lushly-botcore', 'minor', '### Improved\n\n- Faster.')),
		/has the heading "### Improved"; use Breaking changes, Added/
	);
	assert.match(
		refused(fragment('afd-python', 'patch', `## [0.12.0]\n\n${entry}`)),
		/has a "## \[0\.12\.0\]" heading/
	);
	assert.match(
		refused(fragment('afd-python', 'patch', '### Fixed\n')),
		/nothing under "### Fixed"/
	);
	assert.match(
		refused(fragment('afd-spec', 'minor', 'A paragraph.')),
		/bumps afd-spec by minor; use patch/
	);
	assert.match(
		refused(fragment('afd-spec', 'patch', '### Added\n\nText.')),
		/a contract entry is prose/
	);
	assert.match(refused('---\n"afd-python": patch\n---\n'), /has no entry/);
	assert.match(
		refused(fragment('afd-python', 'major', entry)),
		/bumps afd-python by major, which would release 1\.0\.0; before 1\.0 a breaking change is minor/
	);
});

test('entries merge by category in Keep a Changelog order; a # in a code block is not a heading', () => {
	const entries = parseEntries(
		'An intro.\n\n### fixed\n\n```sh\n# a comment\n```\n\n### Added\n\n- New.'
	);
	assert.equal(entries.intro, 'An intro.');
	assert.deepEqual([...entries.sections.keys()], ['Fixed', 'Added']);
	assert.equal(
		renderSection({
			version: '1.2.0',
			date: '2026-01-02',
			contract: '1.0-rc',
			bodies: [
				'### Fixed\n\n- One.',
				'Intro.\n\n### Breaking changes\n\n- Two.\n\n### Fixed\n\n- Three.',
			],
		}),
		'## [1.2.0] - 2026-01-02\n\nImplements AFD contract `1.0-rc`.\n\nIntro.\n\n### Breaking changes\n\n- Two.\n\n### Fixed\n\n- One.\n\n- Three.'
	);
	assert.equal(
		unreleasedBody('# C\n\n## [Unreleased]\n\n[Unreleased]: https://x/compare/a...b\n').body,
		''
	);
	assert.equal(unreleasedBody('# C\n'), null);
	assert.equal(ignores('@lushly-dev/loam-*', '@lushly-dev/loam-app-hello'), true);
	assert.equal(ignores('@lushly-dev/loam-*', '@lushly-dev/loamy'), false);
	assert.equal(ignores('afd.spec', 'afd-spec'), false);
});

test('version python: Changesets bumps the stub, and the version, section and links follow', (t) => {
	const f = fixture(t, {
		fragments: {
			'py-one': fragment('afd-python', 'minor', '### Added\n\n- A capability.'),
			'py-two': fragment(
				'afd-python',
				'patch',
				'### Breaking changes\n\n- A break.\n\n### Fixed\n\n- A fix.'
			),
			'bot-one': fragment('lushly-botcore', 'patch', '### Fixed\n\n- A Botcore fix.'),
		},
	});
	const ran = [];
	const result = versionTrack({
		pendingUnreleased: {},
		root: f.root,
		name: 'python',
		date: '2026-12-01',
		invoke: changesets,
		execute: (command, args, cwd) =>
			ran.push([command === process.execPath ? 'node' : command, ...args, cwd]),
	});
	assert.equal(result.version, '0.12.0');
	assert.equal(result.tag, 'python-v0.12.0');
	assert.deepEqual(result.consumed, ['.changeset/py-one.md', '.changeset/py-two.md']);
	assert.equal(JSON.parse(f.read('python/package.json')).version, '0.12.0');
	assert.match(f.read('python/pyproject.toml'), /\[project\]\nname = "afd"\nversion = "0\.12\.0"/);
	// Only the project's version: another table's is not it.
	assert.match(f.read('python/pyproject.toml'), /\[tool\.other\]\nversion = "9\.9\.9"/);
	assert.match(f.read('python/src/afd/__init__.py'), /^__version__ = "0\.12\.0"$/m);
	assert.equal(
		f.read('python/CHANGELOG.md'),
		PYTHON_CHANGELOG.replace(
			'## [Unreleased]\n',
			'## [Unreleased]\n\n## [0.12.0] - 2026-12-01\n\nImplements AFD contract `1.0-rc`.\n\n### Breaking changes\n\n- A break.\n\n### Added\n\n- A capability.\n\n### Fixed\n\n- A fix.\n'
		).replace(
			'[Unreleased]: https://github.com/lushly-dev/afd/compare/python-v0.11.0...main\n',
			'[Unreleased]: https://github.com/lushly-dev/afd/compare/python-v0.12.0...main\n[0.12.0]: https://github.com/lushly-dev/afd/compare/python-v0.11.0...python-v0.12.0\n'
		)
	);
	// Its own fragments are consumed; the npm one and the other track's stay, with their packages.
	assert.equal(existsSync(join(f.root, '.changeset/py-one.md')), false);
	assert.equal(existsSync(join(f.root, '.changeset/py-two.md')), false);
	assert.equal(existsSync(join(f.root, '.changeset/npm.md')), true);
	assert.equal(existsSync(join(f.root, '.changeset/bot-one.md')), true);
	assert.equal(JSON.parse(f.read('packages/a/package.json')).version, '1.0.0');
	assert.equal(JSON.parse(f.read('packages/app/package.json')).version, '0.1.0');
	assert.equal(JSON.parse(f.read('endpoints/botcore/package.json')).version, '0.7.0');
	// Every uv project that locks python, then the parity documents. Nothing in Botcore changed
	// here (the fake lock rewrites nothing), so no provenance is recorded.
	// Every step runs from the repository root.
	assert.deepEqual(ran, [
		['uv', 'lock', '--directory', 'alfred', f.root],
		['uv', 'lock', '--directory', 'endpoints/botcore', f.root],
		['uv', 'lock', '--directory', 'endpoints/botcore/plugins/factory', f.root],
		['uv', 'lock', '--directory', 'python', f.root],
		['node', 'scripts/check-versions.mjs', '--write', f.root],
	]);
	assert.deepEqual(messages(f.root), []);
});

test('version rust: Cargo.toml and every lockfile that builds the crate from its path follow', (t) => {
	const f = fixture(t, {
		fragments: {
			'rust-one': fragment('afd-rust', 'minor', '### Added\n\n- A capability.'),
			'rust-two': fragment('afd-rust', 'patch', '### Fixed\n\n- A fix.'),
			'py-one': fragment('afd-python', 'minor', '### Added\n\n- A Python capability.'),
		},
	});
	const elsewhere = f.read('endpoints/elsewhere/Cargo.lock');
	const ran = [];
	const result = versionTrack({
		pendingUnreleased: {},
		root: f.root,
		name: 'rust',
		date: '2026-12-01',
		invoke: changesets,
		execute: (command, args, cwd) =>
			ran.push([command === process.execPath ? 'node' : command, ...args, cwd]),
	});
	assert.equal(result.version, '0.4.0');
	assert.equal(result.tag, 'rust-v0.4.0');
	assert.deepEqual(result.consumed, ['.changeset/rust-one.md', '.changeset/rust-two.md']);
	assert.deepEqual(result.changed, [
		'endpoints/host/Cargo.lock',
		'packages/rust/CHANGELOG.md',
		'packages/rust/Cargo.lock',
		'packages/rust/Cargo.toml',
		'packages/rust/package.json',
	]);
	assert.equal(JSON.parse(f.read('packages/rust/package.json')).version, '0.4.0');
	assert.match(
		f.read('packages/rust/Cargo.toml'),
		/\[package\]\nname = "afd"\nversion = "0\.4\.0"/
	);
	// Only the package's version: a table under it is another.
	assert.match(
		f.read('packages/rust/Cargo.toml'),
		/\[package\.metadata\.docs\.rs\]\nversion = "9\.9\.9"/
	);
	assert.equal(
		f.read('packages/rust/Cargo.lock'),
		`version = 4\n\n${cargoPackage('afd', '0.4.0')}\n${cargoPackage('serde', '1.0.0', REGISTRY)}`
	);
	assert.equal(
		f.read('endpoints/host/Cargo.lock'),
		`version = 4\n\n${cargoPackage('host', '0.1.0')}\n${cargoPackage('afd', '0.4.0')}`
	);
	// A lockfile that downloads the crate from a registry is not this checkout's version.
	assert.equal(f.read('endpoints/elsewhere/Cargo.lock'), elsewhere);
	assert.equal(
		f.read('packages/rust/CHANGELOG.md'),
		RUST_CHANGELOG.replace(
			'## [Unreleased]\n',
			'## [Unreleased]\n\n## [0.4.0] - 2026-12-01\n\nImplements AFD contract `1.0-rc`.\n\n### Added\n\n- A capability.\n\n### Fixed\n\n- A fix.\n'
		).replace(
			'[Unreleased]: https://github.com/lushly-dev/afd/compare/rust-v0.3.0...HEAD\n',
			'[Unreleased]: https://github.com/lushly-dev/afd/compare/rust-v0.4.0...HEAD\n[0.4.0]: https://github.com/lushly-dev/afd/compare/rust-v0.3.0...rust-v0.4.0\n'
		)
	);
	assert.equal(existsSync(join(f.root, '.changeset/py-one.md')), true);
	assert.equal(JSON.parse(f.read('python/package.json')).version, '0.11.0');
	// No uv project locks the crate; the parity documents follow its version.
	assert.deepEqual(ran, [['node', 'scripts/check-versions.mjs', '--write', f.root]]);
	assert.deepEqual(messages(f.root), []);
});

test('a Cargo version is read and set where Cargo states it, and nowhere else', () => {
	// A crate whose name starts with this one's, and a registry copy before the path one.
	const lock = [
		'version = 4',
		'',
		cargoPackage('afd-macros', '0.1.0'),
		cargoPackage('afd', '0.2.0', REGISTRY),
		cargoPackage('afd', '0.3.0'),
	].join('\n');
	assert.equal(readVersion(lock, 'cargo-lock', 'afd'), '0.3.0');
	const set = setVersion(lock, 'cargo-lock', '0.4.0', 'Cargo.lock', 'afd');
	assert.equal(set, lock.replace(cargoPackage('afd', '0.3.0'), cargoPackage('afd', '0.4.0')));
	assert.equal(readVersion(cargoPackage('afd', '0.3.0', REGISTRY), 'cargo-lock', 'afd'), null);
	// CRLF is read and kept.
	const crlf = lock.replaceAll('\n', '\r\n');
	assert.equal(
		setVersion(crlf, 'cargo-lock', '0.4.0', 'Cargo.lock', 'afd'),
		set.replaceAll('\n', '\r\n')
	);
	// A manifest's own table, after a comment on its header; a table or an array of tables after it
	// ends it, so a manifest whose version is inherited states none.
	const manifest =
		'[package] # the crate\r\nname = "afd"\r\nversion = "0.3.0"\r\n\r\n[[bin]]\r\nversion = "9"\r\n';
	assert.equal(readVersion(manifest, 'cargo'), '0.3.0');
	assert.equal(
		setVersion(manifest, 'cargo', '0.4.0', 'Cargo.toml'),
		manifest.replace('version = "0.3.0"', 'version = "0.4.0"')
	);
	assert.equal(readVersion('[package]\nname = "afd"\n\n[[bin]]\nversion = "9"\n', 'cargo'), null);
	assert.equal(readVersion('[package.metadata]\nversion = "9"\n', 'cargo'), null);
	assert.throws(() => readVersion('', 'cmake'), /Unknown version file kind: cmake/);
});

test('the Rust track refuses a hand entry and a path lockfile that disagrees with its stub', (t) => {
	const f = fixture(t);
	f.write(
		'packages/rust/CHANGELOG.md',
		RUST_CHANGELOG.replace('## [Unreleased]\n', '## [Unreleased]\n\n### Fixed\n\n- By hand.\n')
	);
	f.write(
		'endpoints/host/Cargo.lock',
		`version = 4\n\n${cargoPackage('host', '0.1.0')}\n${cargoPackage('afd', '0.2.0')}`
	);
	// A registry copy of the crate at another version is a dependency, not this checkout.
	f.write(
		'endpoints/elsewhere/Cargo.lock',
		`version = 4\n\n${cargoPackage('afd', '0.9.0', REGISTRY)}\n${cargoPackage('elsewhere', '0.1.0')}`
	);
	const problems = check(f.root);
	assert.deepEqual(
		problems.map((problem) => problem.message),
		[
			'endpoints/host/Cargo.lock has version 0.2.0, but packages/rust/package.json has 0.3.0',
			'packages/rust/CHANGELOG.md:5 has an entry under "## [Unreleased]"',
		]
	);
	assert.match(problems[1].suggestion, /\.changeset\/.*"afd-rust"/);
});

test('a pending changelog whose file was deleted is named, though its package remains', (t) => {
	const f = fixture(t);
	rmSync(join(f.root, 'packages/a/CHANGELOG.md'));
	assert.deepEqual(messages(f.root, { pendingUnreleased: { 'packages/a/CHANGELOG.md': '#1' } }), [
		'PENDING_UNRELEASED lists packages/a/CHANGELOG.md (#1), which does not exist',
	]);
});

test('version python records the Botcore lockfile it rewrites', (t) => {
	const f = fixture(t, {
		fragments: { 'py-one': fragment('afd-python', 'patch', '### Fixed\n\n- A fix.') },
	});
	const ran = [];
	versionTrack({
		pendingUnreleased: {},
		root: f.root,
		name: 'python',
		invoke: changesets,
		execute: (command, args, cwd) => {
			// Both Botcore lockfiles are rewritten; its provenance records only the first.
			if (command === 'uv' && args[0] === 'lock' && args[2].includes('botcore'))
				writeFileSync(join(cwd, args[2], 'uv.lock'), 'relocked\n');
			ran.push([command, ...args]);
		},
	});
	assert.deepEqual(ran.at(-1), [
		'uv',
		'run',
		'--directory',
		'endpoints/botcore',
		'--no-project',
		'python',
		'scripts/record_provenance.py',
		'--refresh',
		'--reason',
		'Versioned by pnpm version-track python (afd-python 0.11.1)',
		'uv.lock',
	]);
});

test('version botcore: every rewritten imported file is recorded, after the locks', (t) => {
	const f = fixture(t, {
		fragments: {
			'bot-one': fragment(
				'lushly-botcore',
				'minor',
				'What the release is for.\n\n### Added\n\n- A command.'
			),
		},
	});
	const ran = [];
	const result = versionTrack({
		pendingUnreleased: {},
		root: f.root,
		name: 'botcore',
		date: '2026-12-01',
		invoke: changesets,
		execute: (command, args, cwd) => ran.push([command, ...args, cwd]),
	});
	assert.equal(result.version, '0.8.0');
	assert.match(f.read('endpoints/botcore/src/botcore/__init__.py'), /^__version__ = '0\.8\.0'$/m);
	assert.equal(
		f.read('endpoints/botcore/CHANGELOG.md'),
		BOTCORE_CHANGELOG.replace(
			'## [Unreleased]\n',
			'## [Unreleased]\n\n## [0.8.0] - 2026-12-01\n\nWhat the release is for.\n\n### Added\n\n- A command.\n'
		)
	);
	assert.deepEqual(
		ran.map((step) => step.slice(0, 2).join(' ')),
		['uv lock', 'uv lock', 'uv lock', `${process.execPath} scripts/check-versions.mjs`, 'uv run']
	);
	assert.deepEqual(ran.at(-1).slice(10), [
		'CHANGELOG.md',
		'package.json',
		'pyproject.toml',
		'src/botcore/__init__.py',
		f.root,
	]);
	assert.deepEqual(messages(f.root), []);
});

test('version spec folds prose under the contract version and never writes VERSION', (t) => {
	const f = fixture(t, {
		fragments: {
			'spec-one': fragment(
				'afd-spec',
				'patch',
				'A new vector file.\n\nIt is additive, so the version stays.'
			),
		},
	});
	const ran = [];
	const result = versionTrack({
		pendingUnreleased: {},
		root: f.root,
		name: 'spec',
		invoke: changesets,
		execute: (...step) => ran.push(step),
	});
	assert.equal(result.version, '0.0.1');
	assert.equal(result.tag, null);
	assert.deepEqual(ran, []);
	assert.equal(f.read('spec/VERSION'), '1.0-rc\n');
	assert.equal(
		f.read('spec/CHANGELOG.md'),
		SPEC_CHANGELOG.replace(
			'## 1.0-rc\n',
			'## 1.0-rc\n\nA new vector file.\n\nIt is additive, so the version stays.\n'
		)
	);
	assert.deepEqual(messages(f.root), []);

	// After the specification process changes VERSION, the next fold opens that version's heading.
	f.write('spec/VERSION', '1.0\n');
	f.write(
		'.changeset/spec-two.md',
		fragment('afd-spec', 'patch', 'Every language loads every vector.')
	);
	commit(f.root, 'contract 1.0');
	versionTrack({
		pendingUnreleased: {},
		root: f.root,
		name: 'spec',
		invoke: changesets,
		execute: () => {},
	});
	assert.match(
		f.read('spec/CHANGELOG.md'),
		/Steps\.\n\n## 1\.0\n\nEvery language loads every vector\.\n\n## 1\.0-rc\n\nA new vector file\./
	);
	assert.equal(f.read('spec/VERSION'), '1.0\n');
});

test('a refused version step writes nothing', (t) => {
	const f = fixture(t);
	assert.throws(
		() =>
			versionTrack({
				pendingUnreleased: {},
				root: f.root,
				name: 'python',
				invoke: changesets,
				execute: () => {},
			}),
		/No fragment in \.changeset\/ names afd-python/
	);
	assert.throws(
		() => versionTrack({ pendingUnreleased: {}, root: f.root, name: 'cpp' }),
		/Unknown track cpp/
	);
	f.write('.changeset/py.md', fragment('afd-python', 'patch', '### Fixed\n\n- A fix.'));
	f.write(
		'python/CHANGELOG.md',
		PYTHON_CHANGELOG.replace('## [Unreleased]\n', '## [Unreleased]\n\n- By hand.\n')
	);
	commit(f.root, 'hand edit');
	assert.throws(
		() =>
			versionTrack({
				pendingUnreleased: {},
				root: f.root,
				name: 'python',
				invoke: changesets,
				execute: () => {},
			}),
		/Fix the tracks first: python\/CHANGELOG\.md:5 has an entry/
	);
	// Changesets writing anything but the stub is refused before a file changes.
	f.write('python/CHANGELOG.md', PYTHON_CHANGELOG);
	commit(f.root, 'restored');
	assert.throws(
		() =>
			versionTrack({
				pendingUnreleased: {},
				root: f.root,
				name: 'python',
				execute: () => {},
				invoke: (cwd) => {
					changesets(cwd);
					writeFileSync(
						join(cwd, 'packages/a/package.json'),
						'{"name":"@fixture/a","version":"9.0.0"}\n'
					);
				},
			}),
		/Changesets wrote outside the afd-python track: packages\/a\/package\.json/
	);
	assert.equal(JSON.parse(f.read('python/package.json')).version, '0.11.0');
	assert.equal(existsSync(join(f.root, '.changeset/py.md')), true);
	assert.equal(shell(f.root, 'git', ['status', '--porcelain']), '');
});

test('without the tools, the step lists the commands it still owes', (t) => {
	const f = fixture(t, {
		fragments: { bot: fragment('lushly-botcore', 'patch', '### Fixed\n\n- A fix.') },
	});
	const result = versionTrack({
		pendingUnreleased: {},
		root: f.root,
		name: 'botcore',
		invoke: changesets,
		tools: false,
	});
	assert.deepEqual(result.ran, []);
	// Lines to run from the repository root, in any shell. The files to record are the ones
	// written and the recorded lockfile the owed lock rewrites.
	assert.deepEqual(result.owed, [
		'uv lock --directory alfred',
		'uv lock --directory endpoints/botcore',
		'uv lock --directory endpoints/botcore/plugins/factory',
		'node scripts/check-versions.mjs --write',
		'uv run --directory endpoints/botcore --no-project python scripts/record_provenance.py --refresh --reason "Versioned by pnpm version-track botcore (lushly-botcore 0.7.1)" CHANGELOG.md package.json pyproject.toml src/botcore/__init__.py uv.lock',
	]);

	// The contract fold locks nothing and writes nothing in Botcore, so it owes nothing.
	const g = fixture(t, { fragments: { spec: fragment('afd-spec', 'patch', 'A paragraph.') } });
	assert.deepEqual(
		versionTrack({
			pendingUnreleased: {},
			root: g.root,
			name: 'spec',
			invoke: changesets,
			tools: false,
		}).owed,
		[]
	);
});

test('a compare link the step cannot move on stops it before anything is written', (t) => {
	const f = fixture(t, {
		fragments: { py: fragment('afd-python', 'patch', '### Fixed\n\n- A fix.') },
	});
	f.write(
		'python/CHANGELOG.md',
		PYTHON_CHANGELOG.replace('compare/python-v0.11.0...main', 'compare/v0.11.0...main')
	);
	commit(f.root, 'another tag scheme');
	assert.throws(
		() =>
			versionTrack({
				pendingUnreleased: {},
				root: f.root,
				name: 'python',
				invoke: changesets,
				execute: () => {},
			}),
		/\[Unreleased\] link does not compare python-vX\.Y\.Z with a branch/
	);
	assert.equal(shell(f.root, 'git', ['status', '--porcelain']), '');
});

test('a tool that fails says the version is already written', (t) => {
	const f = fixture(t, {
		fragments: { py: fragment('afd-python', 'patch', '### Fixed\n\n- A fix.') },
	});
	// The first lock works; the second fails. The fragments are consumed by then, so the error
	// names every command still to run, the provenance record of the lockfile included.
	let calls = 0;
	assert.throws(
		() =>
			versionTrack({
				pendingUnreleased: {},
				root: f.root,
				name: 'python',
				invoke: changesets,
				execute: () => {
					if (++calls === 2) throw new Error('uv: command not found');
				},
			}),
		(error) => {
			assert.equal(
				error.message,
				[
					'afd-python 0.11.1 is written, but "uv lock --directory endpoints/botcore" failed: uv: command not found',
					'Fix the cause, then run what is left by hand from the repository root, in order:',
					'  uv lock --directory endpoints/botcore',
					'  uv lock --directory endpoints/botcore/plugins/factory',
					'  uv lock --directory python',
					'  node scripts/check-versions.mjs --write',
					'  uv run --directory endpoints/botcore --no-project python scripts/record_provenance.py --refresh --reason "Versioned by pnpm version-track python (afd-python 0.11.1)" uv.lock',
				].join('\n')
			);
			return true;
		}
	);
	assert.equal(JSON.parse(f.read('python/package.json')).version, '0.11.1');
});

test('the npm release neither selects a track nor consumes its fragments', (t) => {
	const f = fixture(t, {
		fragments: {
			py: fragment('afd-python', 'minor', '### Added\n\n- A capability.'),
			spec: fragment('afd-spec', 'patch', 'A paragraph.'),
		},
	});
	const evidence = [{ registry: 'npm', name: '@fixture/a', versions: [] }];
	const plan = selectRelease({ root: f.root, registryEvidence: evidence });
	assert.deepEqual(plan.selectedUnits, ['a']);
	assert.deepEqual(plan.blocked, []);
	assert.deepEqual(
		plan.distributions.map((distribution) => distribution.name),
		['@fixture/a']
	);
	const result = versionSelected({
		root: f.root,
		plan,
		inventory: loadInventory(f.root),
		invoke: changesets,
	});
	assert.deepEqual(result.changed.sort(), ['.changeset/npm.md', 'packages/a/package.json']);
	assert.equal(JSON.parse(f.read('python/package.json')).version, '0.11.0');
	assert.equal(JSON.parse(f.read('spec/package.json')).version, '0.0.0');
	assert.equal(existsSync(join(f.root, '.changeset/py.md')), true);
	assert.equal(existsSync(join(f.root, '.changeset/spec.md')), true);
	// A track's unit can never be selected by hand either.
	assert.throws(
		() =>
			selectRelease({ root: f.root, selectedUnits: ['afd-python-changes'], registryEvidence: [] }),
		/Release unit is not admitted: afd-python-changes/
	);
});

test('lock directories are the uv projects that lock the track as an editable source', (t) => {
	const f = fixture(t);
	assert.deepEqual(lockDirectories(f.root, 'python'), [
		'alfred',
		'endpoints/botcore',
		'endpoints/botcore/plugins/factory',
		'python',
	]);
	assert.deepEqual(lockDirectories(f.root, 'endpoints/botcore'), [
		'alfred',
		'endpoints/botcore',
		'endpoints/botcore/plugins/factory',
	]);
	assert.deepEqual(lockDirectories(f.root, 'spec'), []);
});

test('default versionTrack invoke runs Changesets directly under pnpm 12 without mutating node_modules or pnpm-lock.yaml', (t) => {
	const f = fixture(t, {
		fragments: {
			py: fragment('afd-python', 'patch', '### Fixed\n\n- A fix.'),
		},
	});
	const repoPkg = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));
	const lockfile = "lockfileVersion: '9.0'\n# sentinel\n";
	writeFileSync(
		join(f.root, 'package.json'),
		`${JSON.stringify({ name: 'fixture', private: true, packageManager: repoPkg.packageManager }, null, '\t')}\n`
	);
	writeFileSync(join(f.root, '.gitignore'), 'node_modules\n');
	writeFileSync(join(f.root, 'pnpm-lock.yaml'), lockfile);
	commit(f.root, 'configure pnpm 12 and lockfile');
	// Isolated fixture-local node_modules so a regression can never mutate repository/node_modules.
	const linkType = process.platform === 'win32' ? 'junction' : 'dir';
	const nm = join(f.root, 'node_modules');
	mkdirSync(join(nm, '@changesets'), { recursive: true });
	writeFileSync(join(nm, '.sentinel'), 'intact\n');
	symlinkSync(
		realpathSync(join(repository, 'node_modules/@changesets/cli')),
		join(nm, '@changesets/cli'),
		linkType
	);
	versionTrack({
		pendingUnreleased: {},
		root: f.root,
		name: 'python',
		date: '2026-11-24',
		tools: false,
	});
	assert.equal(JSON.parse(f.read('python/package.json')).version, '0.11.1');
	assert.equal(readFileSync(join(nm, '.sentinel'), 'utf8'), 'intact\n');
});
