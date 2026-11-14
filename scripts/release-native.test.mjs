import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const guard = resolve('scripts/release-native.py');
const inventory = JSON.parse(readFileSync('scripts/release/inventory.json', 'utf8'));
const archiveWriter = `
import io, json, sys, tarfile, zipfile
spec = json.load(sys.stdin)
if spec['file'].endswith('.whl'):
    with zipfile.ZipFile(spec['file'], 'w') as archive:
        for entry in spec['entries']:
            archive.writestr(entry['name'], entry['text'])
else:
    with tarfile.open(spec['file'], 'w:gz') as archive:
        for entry in spec['entries']:
            data = entry['text'].encode()
            member = tarfile.TarInfo(entry['name'])
            member.size = len(data)
            archive.addfile(member, io.BytesIO(data))
`;

/** Each guard track, with versions around its fixture candidate for the progression cases. */
const tracks = {
	python: {
		unit: 'afd-python',
		route: 'pypi-tag',
		prefix: 'python-v',
		format: 'python',
		manifest: 'python/pyproject.toml',
		name: 'afd',
		version: '0.10.0',
		previous: '0.9.9',
		next: '0.10.1',
	},
	rust: {
		unit: 'afd-rust',
		route: 'crates-tag',
		prefix: 'rust-v',
		format: 'rust',
		manifest: 'packages/rust/Cargo.toml',
		name: 'afd',
		version: '0.2.1',
		previous: '0.2.0',
		next: '0.2.2',
	},
	botcore: {
		unit: 'botcore',
		route: 'pypi-botcore',
		prefix: 'botcore-v',
		format: 'python',
		manifest: 'endpoints/botcore/pyproject.toml',
		name: 'lushly-botcore',
		version: '0.6.0',
		previous: '0.5.0',
		next: '0.6.1',
	},
};

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { encoding: 'utf8', ...options });
	assert.ifError(result.error);
	return result;
}

function fixture(t, track = 'python', change = () => {}, candidateVersion, manifestName) {
	const root = mkdtempSync(join(tmpdir(), 'afd-native-boundary-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const { unit: id, route, prefix, format, manifest, name } = tracks[track];
	const unit = structuredClone(inventory.units.find((item) => item.id === id));
	const selected = { units: [unit] };
	change(unit, selected);
	const version = candidateVersion ?? tracks[track].version;
	// Wheel and sdist file names and the sdist root use the normalized stem, metadata the name.
	const stem = `${name.replace(/[-_.]+/g, '_').toLowerCase()}-${version}`;
	const manifestText = `# name = "decoy"\n[${format === 'python' ? 'project' : 'package'}]\nname = '${manifestName ?? name}'\nversion = '${version}'\n`;
	function write(file, text) {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), text);
	}
	write(manifest, manifestText);
	write('scripts/release/inventory.json', JSON.stringify(selected));
	if (format === 'rust') write('packages/rust/src/lib.rs', 'pub fn example() {}\n');
	function git(...args) {
		const result = run('git', ['-C', root, '-c', 'core.hooksPath=/dev/null', ...args]);
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	}
	git('init', '-q');
	git('add', '.');
	git(
		'-c',
		'user.name=Fixture',
		'-c',
		'user.email=fixture@example.test',
		'commit',
		'-qm',
		'fixture'
	);
	const tag = `${prefix}${version}`;
	git('tag', tag);
	const source = git('rev-parse', 'HEAD');
	const artifacts = join(root, 'artifacts');
	mkdirSync(artifacts);
	const receipt = join(root, 'receipt.json');
	function check(extra = []) {
		return run('python3', [
			guard,
			'--root',
			root,
			'--unit',
			id,
			'--route',
			route,
			'--tag',
			tag,
			...extra,
		]);
	}
	function archive(file, entries) {
		const result = run('python3', ['-c', archiveWriter], {
			input: JSON.stringify({ file: join(artifacts, file), entries }),
		});
		assert.equal(result.status, 0, result.stderr);
	}
	function pythonArtifacts({
		wheelName = name,
		wheelVersion = version,
		sdistName = name,
		sdistVersion = version,
		wheelFile = `${stem}-py3-none-any.whl`,
		sdistFile = `${stem}.tar.gz`,
		sdistRoot = stem,
		wheelExtra = [],
		sdistExtra = [],
	} = {}) {
		archive(wheelFile, [
			{
				name: `${stem}.dist-info/METADATA`,
				text: `Metadata-Version: 2.1\nName: ${wheelName}\nVersion: ${wheelVersion}\n`,
			},
			{ name: 'afd/__init__.py', text: '# fixture\n' },
			...wheelExtra,
		]);
		archive(sdistFile, [
			{
				name: `${sdistRoot}/PKG-INFO`,
				text: `Metadata-Version: 2.1\nName: ${sdistName}\nVersion: ${sdistVersion}\n`,
			},
			{ name: `${sdistRoot}/pyproject.toml`, text: manifestText },
			...sdistExtra,
		]);
	}
	function rustArtifacts({
		name = 'afd',
		crateVersion = version,
		sha = source,
		payload = 'pub fn example() {}\n',
		extra = [],
	} = {}) {
		archive(`afd-${version}.crate`, [
			{
				name: `afd-${version}/Cargo.toml`,
				text: `[package]\nname='${name}'\nversion='${crateVersion}'\n`,
			},
			{ name: `afd-${version}/Cargo.toml.orig`, text: manifestText },
			{
				name: `afd-${version}/.cargo_vcs_info.json`,
				text: JSON.stringify({ git: { sha1: sha }, path_in_vcs: 'packages/rust' }),
			},
			{ name: `afd-${version}/src/lib.rs`, text: payload },
			...extra,
		]);
	}
	return {
		root,
		artifacts,
		receipt,
		write,
		git,
		check,
		pythonArtifacts,
		rustArtifacts,
		tag,
		version,
		source,
		stem,
	};
}

function rejected(result, pattern) {
	assert.equal(result.status, 1, result.stdout);
	assert.match(result.stderr, pattern);
}

for (const format of Object.keys(tracks)) {
	const track = tracks[format];
	test(`${format}: admitted route binds exact source TOML version and tag`, (t) => {
		const candidate = fixture(t, format);
		const result = candidate.check();
		assert.equal(result.status, 0, result.stderr);
		const receipt = JSON.parse(result.stdout);
		assert.equal(receipt.source, candidate.source);
		assert.equal(receipt.version, candidate.version);
		assert.equal(receipt.unit, track.unit);
		assert.equal(receipt.route, track.route);
		assert.equal(receipt.name, track.name);
	});
	for (const state of ['held', 'quarantined', 'unknown']) {
		test(`${format}: ${state} units reject before authentication`, (t) => {
			const candidate = fixture(t, format, (unit) => {
				unit.state = state;
			});
			rejected(candidate.check(), /not admitted/);
		});
	}
	for (const [label, mutate, pattern] of [
		[
			'missing unit',
			(_, selected) => {
				selected.units = [];
			},
			/Unknown or duplicate/,
		],
		[
			'wrong authority',
			(unit) => {
				unit.authority = 'github: other/repo';
			},
			/authority mismatch/,
		],
		[
			'wrong protocol',
			(unit) => {
				unit.protocol = 'category-json-v1';
			},
			/protocol mismatch/,
		],
		[
			'unavailable route',
			(unit) => {
				unit.routes = [];
			},
			/route is not admitted/,
		],
		[
			'foreign identity',
			(unit) => {
				unit.distributions[0].name = 'upstream';
			},
			/identity mismatch/,
		],
		[
			'wrong manifest',
			(unit) => {
				unit.distributions[0].manifest = 'other.toml';
			},
			/identity mismatch/,
		],
		[
			'duplicate owner',
			(unit, selected) => {
				selected.units.push({ ...unit, id: 'other' });
			},
			/ambiguous/,
		],
	]) {
		test(`${format}: ${label} fails closed`, (t) => {
			const candidate = fixture(t, format, mutate);
			rejected(candidate.check(), pattern);
		});
	}
	test(`${format}: an admitted unit cannot publish its exact held candidate`, (t) => {
		const candidate = fixture(t, format, (unit) => {
			unit.heldVersions = [track.version];
		});
		// Admission must fail even before inspecting this missing artifact directory.
		rejected(
			candidate.check(['--artifacts', join(candidate.root, 'missing')]),
			/candidate is held/
		);
	});
	test(`${format}: a hold on another exact version preserves release eligibility`, (t) => {
		const candidate = fixture(t, format, (unit) => {
			unit.heldVersions = [track.previous];
		});
		const result = candidate.check();
		assert.equal(result.status, 0, result.stderr);
	});
	test(`${format}: versions below initialVersion reject before artifact inspection`, (t) => {
		const candidate = fixture(t, format, (unit) => {
			unit.distributions[0].initialVersion = track.next;
		});
		rejected(
			candidate.check(['--artifacts', join(candidate.root, 'missing')]),
			/Version progression reset/
		);
	});
	test(`${format}: versions above initialVersion remain admitted`, (t) => {
		const candidate = fixture(t, format, (unit) => {
			unit.distributions[0].initialVersion = track.previous;
		});
		const result = candidate.check();
		assert.equal(result.status, 0, result.stderr);
	});
	test(`${format}: build metadata does not change baseline precedence`, (t) => {
		const candidate = fixture(t, format, (unit) => {
			unit.distributions[0].initialVersion = `${track.version}+trace.1`;
		});
		const result = candidate.check();
		assert.equal(result.status, 0, result.stderr);
	});
	test(`${format}: stable versions follow prerelease baselines`, (t) => {
		const candidate = fixture(t, format, (unit) => {
			unit.distributions[0].initialVersion = `${track.version}-rc.1`;
		});
		const result = candidate.check();
		assert.equal(result.status, 0, result.stderr);
	});
	test(`${format}: malformed baselines fail closed`, (t) => {
		const candidate = fixture(t, format, (unit) => {
			unit.distributions[0].initialVersion = '0.2.1-01';
		});
		rejected(candidate.check(), /Unsupported release SemVer/);
	});
	test(`${format}: declared held internal prerequisites require registry evidence support`, (t) => {
		const candidate = fixture(t, format, (unit, selected) => {
			unit.prerequisites = [{ registry: 'pypi', name: 'held-foundation', range: '^1.0.0' }];
			selected.units.push({
				...unit,
				id: 'held-foundation',
				state: 'held',
				routes: [],
				distributions: [
					{
						name: 'held-foundation',
						registry: 'pypi',
						format: 'python',
						manifest: 'foundations/held/pyproject.toml',
					},
				],
			});
		});
		rejected(
			candidate.check(['--artifacts', join(candidate.root, 'missing')]),
			/prerequisites require a configured read-only registry evidence adapter/
		);
	});
	test(`${format}: declared registry prerequisites require registry evidence support`, (t) => {
		const candidate = fixture(t, format, (unit) => {
			unit.prerequisites = [{ registry: 'npm', name: '@external/foundation', range: '^1.0.0' }];
		});
		rejected(
			candidate.check(['--artifacts', join(candidate.root, 'missing')]),
			/prerequisites require a configured read-only registry evidence adapter/
		);
	});
	test(`${format}: another source commit cannot substitute for tag`, (t) => {
		const candidate = fixture(t, format);
		candidate.write('other.txt', 'changed source');
		candidate.git('add', 'other.txt');
		candidate.git(
			'-c',
			'user.name=Fixture',
			'-c',
			'user.email=fixture@example.test',
			'commit',
			'-qm',
			'other'
		);
		rejected(candidate.check(), /not the exact release tag source/);
	});
	test(`${format}: changed inventory cannot silently reopen publication`, (t) => {
		const candidate = fixture(t, format);
		candidate.write('scripts/release/inventory.json', '{}');
		rejected(candidate.check(), /Inventory differs/);
	});
	test(`${format}: manifest version really comes from TOML and must match tag`, (t) => {
		const candidate = fixture(t, format);
		candidate.git('tag', '-d', candidate.tag);
		candidate.git('tag', `${track.prefix}9.9.9`);
		rejected(candidate.check(['--tag', `${track.prefix}9.9.9`]), /version does not match tag/);
	});
}

for (const [version, baseline, admitted] of [
	['1.0.0-rc.2', '1.0.0', false],
	['1.0.0-rc.2', '1.0.0-rc.10', false],
	['1.0.0-rc.10', '1.0.0-rc.2', true],
	['1.0.0-1', '1.0.0-alpha', false],
	['1.0.0-alpha', '1.0.0-1', true],
	['1.0.0-alpha', '1.0.0-alpha.1', false],
	['1.0.0-alpha.1', '1.0.0-alpha', true],
	['1.0.0-rc.1+build.2', '1.0.0-rc.1+build.1', true],
]) {
	test(`Rust: SemVer ${version} against baseline ${baseline}`, (t) => {
		const candidate = fixture(
			t,
			'rust',
			(unit) => {
				unit.distributions[0].initialVersion = baseline;
			},
			version
		);
		const result = candidate.check();
		if (admitted) assert.equal(result.status, 0, result.stderr);
		else rejected(result, /Version progression reset/);
	});
}

for (const track of ['python', 'botcore']) {
	const label = track === 'python' ? 'Python' : 'Botcore';
	test(`${label}: exact wheel and sdist produce a hash receipt and unchanged readback`, (t) => {
		const candidate = fixture(t, track);
		candidate.pythonArtifacts();
		const result = candidate.check([
			'--artifacts',
			candidate.artifacts,
			'--receipt',
			candidate.receipt,
		]);
		assert.equal(result.status, 0, result.stderr);
		const receipt = JSON.parse(result.stdout);
		assert.equal(receipt.name, tracks[track].name);
		assert.deepEqual(
			receipt.artifacts.map((artifact) => artifact.file),
			[`${candidate.stem}-py3-none-any.whl`, `${candidate.stem}.tar.gz`]
		);
		assert.ok(receipt.artifacts.every((artifact) => /^[a-f0-9]{64}$/.test(artifact.sha256)));
		assert.equal(
			candidate.check(['--artifacts', candidate.artifacts, '--verify-receipt', candidate.receipt])
				.status,
			0
		);
		candidate.pythonArtifacts({
			wheelExtra: [{ name: 'afd/changed.py', text: '# changed payload\n' }],
		});
		rejected(
			candidate.check(['--artifacts', candidate.artifacts, '--verify-receipt', candidate.receipt]),
			/receipt no longer matches/
		);
	});

	for (const [name, options, pattern] of [
		['wrong wheel identity', () => ({ wheelName: 'foreign' }), /metadata name mismatch/],
		['wrong wheel version', () => ({ wheelVersion: '9.9.9' }), /metadata version mismatch/],
		['wrong sdist version', () => ({ sdistVersion: '9.9.9' }), /metadata version mismatch/],
		[
			'unsafe sdist member',
			() => ({ sdistExtra: [{ name: '../outside', text: 'bad' }] }),
			/Unsafe archive member/,
		],
		[
			'duplicate wheel metadata',
			(candidate) => ({
				wheelExtra: [
					{
						name: `${candidate.stem}.dist-info/METADATA`,
						text: `Name: ${tracks[track].name}\nVersion: ${candidate.version}\n`,
					},
				],
			}),
			/Duplicate archive member/,
		],
	]) {
		test(`${label}: ${name} rejects the entire artifact set`, (t) => {
			const candidate = fixture(t, track);
			candidate.pythonArtifacts(options(candidate));
			rejected(candidate.check(['--artifacts', candidate.artifacts]), pattern);
		});
	}

	test(`${label}: unexpected files and missing sdists are never silently skipped`, (t) => {
		const candidate = fixture(t, track);
		candidate.pythonArtifacts();
		writeFileSync(join(candidate.artifacts, 'foreign.whl'), 'foreign');
		rejected(
			candidate.check(['--artifacts', candidate.artifacts]),
			/exactly one wheel and one sdist/
		);
		rmSync(join(candidate.artifacts, 'foreign.whl'));
		rmSync(join(candidate.artifacts, `${candidate.stem}.tar.gz`));
		rejected(
			candidate.check(['--artifacts', candidate.artifacts]),
			/exactly one wheel and one sdist/
		);
	});
}

test('Botcore: the inventory admits lushly-botcore alone, on the AFD publisher', () => {
	const family = inventory.units.filter((unit) => unit.family === 'botcore');
	const botcore = family.find((unit) => unit.id === 'botcore');
	assert.equal(botcore.state, 'admitted');
	assert.equal(botcore.authority, 'github: lushly-dev/afd');
	assert.deepEqual(botcore.routes, ['pypi-botcore']);
	assert.deepEqual(
		botcore.distributions.map(({ name, registry, manifest, format }) => ({
			name,
			registry,
			manifest,
			format,
		})),
		[
			{
				name: tracks.botcore.name,
				registry: 'pypi',
				manifest: tracks.botcore.manifest,
				format: 'python',
			},
		]
	);
	const others = family.filter((unit) => unit !== botcore);
	// The five imported distributions keep their upstream authority; a plugin authored in AFD
	// since (botcore-factory) claims none. Every one of them is quarantined.
	const imported = others.filter((unit) => unit.authority === 'github: lushly-dev/botcore');
	assert.equal(imported.length, 5);
	for (const unit of others) {
		assert.equal(unit.state, 'quarantined', unit.id);
		if (!imported.includes(unit)) assert.match(unit.authority, /^none: /, unit.id);
	}
});

test('Botcore: the guard has no track for the quarantined distributions', (t) => {
	const candidate = fixture(t, 'botcore');
	for (const unit of inventory.units.filter(
		(item) => item.family === 'botcore' && item.id !== 'botcore'
	)) {
		const result = run('python3', [
			guard,
			'--root',
			candidate.root,
			'--unit',
			unit.id,
			'--route',
			unit.routes[0] ?? 'pypi-botcore',
			'--tag',
			candidate.tag,
		]);
		rejected(result, /Unknown native release unit/);
	}
});

test('Botcore: restoring the old authority closes the AFD route', (t) => {
	const candidate = fixture(t, 'botcore', (unit) => {
		unit.state = 'quarantined';
		unit.authority = 'github: lushly-dev/botcore';
	});
	rejected(candidate.check(), /not admitted/);
});

for (const [name, options, pattern] of [
	[
		'an unnormalized sdist file name',
		{ sdistFile: 'lushly-botcore-0.6.0.tar.gz' },
		/Sdist filename identity/,
	],
	[
		'an unnormalized wheel file name',
		{ wheelFile: 'lushly-botcore-0.6.0-py3-none-any.whl' },
		/Wheel filename identity/,
	],
	['an unnormalized sdist root', { sdistRoot: 'lushly-botcore-0.6.0' }, /expected PKG-INFO/],
	['normalized wheel metadata', { wheelName: 'lushly_botcore' }, /metadata name mismatch/],
	['normalized sdist metadata', { sdistName: 'lushly_botcore' }, /metadata name mismatch/],
]) {
	test(`Botcore: ${name} rejects the artifact set`, (t) => {
		const candidate = fixture(t, 'botcore');
		candidate.pythonArtifacts(options);
		rejected(candidate.check(['--artifacts', candidate.artifacts]), pattern);
	});
}

for (const manifestName of ['botcore', 'lushly_botcore', 'afd']) {
	test(`Botcore: source manifest name ${manifestName} is rejected`, (t) => {
		const candidate = fixture(t, 'botcore', () => {}, undefined, manifestName);
		rejected(candidate.check(), /Source manifest name mismatch/);
	});
}

test('Rust: actual packaged manifest, source payload and candidate revision produce a receipt', (t) => {
	const candidate = fixture(t, 'rust');
	candidate.rustArtifacts();
	const result = candidate.check([
		'--artifacts',
		candidate.artifacts,
		'--receipt',
		candidate.receipt,
	]);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(JSON.parse(result.stdout).artifacts.length, 1);
	assert.equal(
		candidate.check(['--artifacts', candidate.artifacts, '--verify-receipt', candidate.receipt])
			.status,
		0
	);
	candidate.rustArtifacts({
		extra: [{ name: 'afd-0.2.1/Cargo.lock', text: '# generated lock changed\n' }],
	});
	rejected(
		candidate.check(['--artifacts', candidate.artifacts, '--verify-receipt', candidate.receipt]),
		/receipt no longer matches/
	);
});

for (const [label, options, pattern] of [
	['wrong crate identity', { name: 'foreign' }, /identity\/version mismatch/],
	['wrong crate version', { crateVersion: '9.9.9' }, /identity\/version mismatch/],
	['wrong candidate revision', { sha: '0'.repeat(40) }, /source revision/],
	['changed source payload', { payload: '// injected\n' }, /payload differs/],
	['unsafe member', { extra: [{ name: '/outside', text: 'bad' }] }, /Unsafe archive member/],
]) {
	test(`Rust: ${label} rejects before token acquisition`, (t) => {
		const candidate = fixture(t, 'rust');
		candidate.rustArtifacts(options);
		rejected(candidate.check(['--artifacts', candidate.artifacts]), pattern);
	});
}

test('Rust: source edits after packaging invalidate the pre-upload check', (t) => {
	const candidate = fixture(t, 'rust');
	candidate.rustArtifacts();
	candidate.write('packages/rust/src/lib.rs', '// changed after archive inspection\n');
	rejected(candidate.check(['--artifacts', candidate.artifacts]), /uncommitted changes/);
});

test('Native publisher workflow contracts preserve events, pins, gates and guard ordering', () => {
	const python = readFileSync('.github/workflows/publish-python.yml', 'utf8');
	const botcore = readFileSync('.github/workflows/publish-botcore.yml', 'utf8');
	const rust = readFileSync('.github/workflows/publish-rust.yml', 'utf8');
	for (const workflow of [python, botcore, rust]) {
		for (const line of workflow
			.split('\n')
			.filter((line) => line.includes('uses:') && !line.includes('uses: ./'))) {
			assert.match(line, /@[a-f0-9]{40} # v\d/);
		}
		assert.doesNotMatch(workflow, /ref: (main|master)\b/);
		assert.match(workflow, /python-version: '3\.12'/);
	}
	assert.match(python, /release:\n\s+types: \[published\]/);
	assert.match(
		python,
		/if: github.event_name == 'push' \|\| startsWith\(github.event.release.tag_name, 'python-v'\)/
	);
	assert.match(python, /needs: \[version, test\]/);
	assert.match(python, /uses: \.\/\.github\/workflows\/python.yml/);
	assert.match(
		python,
		/--verify-receipt "\$RUNNER_TEMP\/native-python-receipt\/native-python-receipt.json"/
	);
	assert.ok(
		python.lastIndexOf('--unit afd-python --route pypi-tag') <
			python.indexOf('uses: pypa/gh-action-pypi-publish')
	);
	assert.match(python, /skip-existing: true/);
	// The Botcore publisher mirrors the Python one on its own tag, route, gate and environment.
	assert.match(botcore, /release:\n\s+types: \[published\]/);
	assert.match(botcore, /push:\n\s+tags:\n\s+- 'botcore-v\*'/);
	assert.match(
		botcore,
		/if: github.event_name == 'push' \|\| startsWith\(github.event.release.tag_name, 'botcore-v'\)/
	);
	assert.match(botcore, /^permissions:\n {2}contents: read\n/m);
	assert.equal(botcore.match(/id-token: write/g)?.length, 1);
	assert.ok(botcore.indexOf('id-token: write') > botcore.indexOf('\n  publish:'));
	assert.match(botcore, /needs: \[version, test\]/);
	assert.match(botcore, /uses: \.\/\.github\/workflows\/botcore.yml/);
	assert.match(readFileSync('.github/workflows/botcore.yml', 'utf8'), /^ {2}workflow_call:/m);
	assert.match(
		botcore,
		/environment:\n\s+name: pypi-botcore\n\s+url: https:\/\/pypi.org\/project\/lushly-botcore\//
	);
	assert.ok(
		botcore.indexOf('--receipt "$RUNNER_TEMP/native-botcore-receipt.json"') <
			botcore.indexOf('--verify-receipt')
	);
	assert.match(
		botcore,
		/--verify-receipt "\$RUNNER_TEMP\/native-botcore-receipt\/native-botcore-receipt.json"/
	);
	assert.equal(
		botcore.match(/--unit botcore --route pypi-botcore --tag "\$RELEASE_TAG"/g)?.length,
		4
	);
	assert.doesNotMatch(botcore, /--unit afd-|--route pypi-tag|secrets\./);
	assert.ok(
		botcore.lastIndexOf('--unit botcore --route pypi-botcore') <
			botcore.indexOf('uses: pypa/gh-action-pypi-publish')
	);
	assert.match(botcore, /skip-existing: true/);
	// The same action pins as the Python publisher.
	const pins = (workflow) => new Set(workflow.match(/uses: [\w./-]+@[a-f0-9]{40} # v[\d.]+/g));
	assert.deepEqual(pins(botcore), pins(python));
	assert.match(rust, /needs: \[version, check\]/);
	assert.match(rust, /uses: \.\/\.github\/workflows\/rust.yml/);
	assert.ok(
		rust.indexOf('--receipt "$RUNNER_TEMP/native-rust-receipt.json"') <
			rust.indexOf('uses: rust-lang/crates-io-auth-action')
	);
	assert.ok(
		rust.indexOf('--verify-receipt "$RUNNER_TEMP/native-rust-receipt.json"') <
			rust.lastIndexOf('          cargo publish')
	);
	assert.match(rust, /if: steps.registry.outputs.published == 'false'/);
});
