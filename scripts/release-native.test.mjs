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

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { encoding: 'utf8', ...options });
	assert.ifError(result.error);
	return result;
}

function fixture(t, format = 'python', change = () => {}, candidateVersion) {
	const root = mkdtempSync(join(tmpdir(), 'afd-native-boundary-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const unit = structuredClone(inventory.units.find((item) => item.id === `afd-${format}`));
	const selected = { units: [unit] };
	change(unit, selected);
	const manifest = format === 'python' ? 'python/pyproject.toml' : 'packages/rust/Cargo.toml';
	const version = candidateVersion ?? (format === 'python' ? '0.10.0' : '0.2.1');
	const manifestText = `# name = "decoy"\n[${format === 'python' ? 'project' : 'package'}]\nname = 'afd'\nversion = '${version}'\n`;
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
	const tag = `${format}-v${version}`;
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
			`afd-${format}`,
			'--route',
			format === 'python' ? 'pypi-tag' : 'crates-tag',
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
		wheelName = 'afd',
		wheelVersion = version,
		sdistVersion = version,
		wheelExtra = [],
		sdistExtra = [],
	} = {}) {
		archive(`afd-${version}-py3-none-any.whl`, [
			{
				name: `afd-${version}.dist-info/METADATA`,
				text: `Metadata-Version: 2.1\nName: ${wheelName}\nVersion: ${wheelVersion}\n`,
			},
			{ name: 'afd/__init__.py', text: '# fixture\n' },
			...wheelExtra,
		]);
		archive(`afd-${version}.tar.gz`, [
			{
				name: `afd-${version}/PKG-INFO`,
				text: `Metadata-Version: 2.1\nName: afd\nVersion: ${sdistVersion}\n`,
			},
			{ name: `afd-${version}/pyproject.toml`, text: manifestText },
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
	};
}

function rejected(result, pattern) {
	assert.equal(result.status, 1, result.stdout);
	assert.match(result.stderr, pattern);
}

for (const format of ['python', 'rust']) {
	test(`${format}: admitted route binds exact source TOML version and tag`, (t) => {
		const candidate = fixture(t, format);
		const result = candidate.check();
		assert.equal(result.status, 0, result.stderr);
		const receipt = JSON.parse(result.stdout);
		assert.equal(receipt.source, candidate.source);
		assert.equal(receipt.version, candidate.version);
		assert.equal(receipt.name, 'afd');
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
			unit.heldVersions = [format === 'python' ? '0.10.0' : '0.2.1'];
		});
		// Admission must fail even before inspecting this missing artifact directory.
		rejected(
			candidate.check(['--artifacts', join(candidate.root, 'missing')]),
			/candidate is held/
		);
	});
	test(`${format}: a hold on another exact version preserves release eligibility`, (t) => {
		const candidate = fixture(t, format, (unit) => {
			unit.heldVersions = [format === 'python' ? '0.9.0' : '0.2.0'];
		});
		const result = candidate.check();
		assert.equal(result.status, 0, result.stderr);
	});
	test(`${format}: versions below initialVersion reject before artifact inspection`, (t) => {
		const candidate = fixture(t, format, (unit) => {
			unit.distributions[0].initialVersion = format === 'python' ? '0.10.1' : '0.2.2';
		});
		rejected(
			candidate.check(['--artifacts', join(candidate.root, 'missing')]),
			/Version progression reset/
		);
	});
	test(`${format}: versions above initialVersion remain admitted`, (t) => {
		const candidate = fixture(t, format, (unit) => {
			unit.distributions[0].initialVersion = format === 'python' ? '0.9.9' : '0.2.0';
		});
		const result = candidate.check();
		assert.equal(result.status, 0, result.stderr);
	});
	test(`${format}: build metadata does not change baseline precedence`, (t) => {
		const candidate = fixture(t, format, (unit) => {
			unit.distributions[0].initialVersion = `${format === 'python' ? '0.10.0' : '0.2.1'}+trace.1`;
		});
		const result = candidate.check();
		assert.equal(result.status, 0, result.stderr);
	});
	test(`${format}: stable versions follow prerelease baselines`, (t) => {
		const candidate = fixture(t, format, (unit) => {
			unit.distributions[0].initialVersion = `${format === 'python' ? '0.10.0' : '0.2.1'}-rc.1`;
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
		candidate.git('tag', `${format}-v9.9.9`);
		rejected(candidate.check(['--tag', `${format}-v9.9.9`]), /version does not match tag/);
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

test('Python: exact wheel and sdist produce a hash receipt and unchanged readback', (t) => {
	const candidate = fixture(t);
	candidate.pythonArtifacts();
	const result = candidate.check([
		'--artifacts',
		candidate.artifacts,
		'--receipt',
		candidate.receipt,
	]);
	assert.equal(result.status, 0, result.stderr);
	const receipt = JSON.parse(result.stdout);
	assert.equal(receipt.artifacts.length, 2);
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

for (const [label, options, pattern] of [
	['wrong wheel identity', { wheelName: 'foreign' }, /metadata name mismatch/],
	['wrong wheel version', { wheelVersion: '9.9.9' }, /metadata version mismatch/],
	['wrong sdist version', { sdistVersion: '9.9.9' }, /metadata version mismatch/],
	[
		'unsafe sdist member',
		{ sdistExtra: [{ name: '../outside', text: 'bad' }] },
		/Unsafe archive member/,
	],
	[
		'duplicate wheel metadata',
		{
			wheelExtra: [{ name: 'afd-0.10.0.dist-info/METADATA', text: 'Name: afd\nVersion: 0.10.0\n' }],
		},
		/Duplicate archive member/,
	],
]) {
	test(`Python: ${label} rejects the entire artifact set`, (t) => {
		const candidate = fixture(t);
		candidate.pythonArtifacts(options);
		rejected(candidate.check(['--artifacts', candidate.artifacts]), pattern);
	});
}

test('Python: unexpected files and missing sdists are never silently skipped', (t) => {
	const candidate = fixture(t);
	candidate.pythonArtifacts();
	writeFileSync(join(candidate.artifacts, 'foreign.whl'), 'foreign');
	rejected(
		candidate.check(['--artifacts', candidate.artifacts]),
		/exactly one wheel and one sdist/
	);
	rmSync(join(candidate.artifacts, 'foreign.whl'));
	rmSync(join(candidate.artifacts, 'afd-0.10.0.tar.gz'));
	rejected(
		candidate.check(['--artifacts', candidate.artifacts]),
		/exactly one wheel and one sdist/
	);
});

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
	const rust = readFileSync('.github/workflows/publish-rust.yml', 'utf8');
	for (const workflow of [python, rust]) {
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
