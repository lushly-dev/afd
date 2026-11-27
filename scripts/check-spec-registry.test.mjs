import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import {
	checkSpecRegistry,
	globMatches,
	ownerStatus,
	resolveEntries,
} from './check-spec-registry.mjs';

const tempDirs = [];

function write(root, rel, content) {
	const abs = join(root, rel);
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(
		abs,
		typeof content === 'string' ? content : `${JSON.stringify(content, null, '\t')}\n`
	);
}

const markers = (id) =>
	`<!-- generated:spec-registry:${id}:start -->\n<!-- generated:spec-registry:${id}:end -->\n`;

function registry(overrides = {}) {
	return {
		core: {
			pages: ['spec/core.md'],
			vectors: ['spec/vectors/error-codes.json'],
			fixtures: [],
			conformance: [],
			errorCodes: ['NOT_FOUND'],
			capabilities: ['core.one'],
		},
		profiles: [
			{
				id: 'gates',
				title: 'Gates',
				version: '1.0',
				optIn: 'A server with gates',
				pages: ['spec/gates.md'],
				vectors: ['spec/vectors/gates.json'],
				fixtures: [],
				conformance: [],
				errorCodes: ['GATE_CLOSED'],
				capabilities: ['gates.one', 'gates.two'],
			},
		],
		parts: [{ file: 'spec/vectors/gates.json', sections: { shared: 'core' } }],
		outsideContract: {
			files: ['spec/VERSION', 'spec/registry.json', 'spec/registry.md', 'spec/capabilities/*'],
			capabilities: ['tooling.cli'],
		},
		...overrides,
	};
}

/** A minimal repository that passes, before rendering; `mutate` changes it first. */
function fixture(mutate = () => {}) {
	const root = mkdtempSync(join(tmpdir(), 'afd-spec-registry-'));
	tempDirs.push(root);
	const files = {
		'spec/VERSION': '1.0\n',
		'spec/core.md': '# Core\n\nEvery implementation carries this.\n',
		'spec/gates.md': '# Gates\n\nProfile: `gates`. Optional.\n',
		'spec/registry.md': `# Registry\n\n${markers('profiles')}`,
		'docs/language-parity.md': `# Parity\n\n${markers('languages')}`,
		'spec/vectors/error-codes.json': {
			codes: [
				{ code: 'NOT_FOUND', retryable: false, profile: 'core' },
				{ code: 'GATE_CLOSED', retryable: false, profile: 'gates' },
			],
		},
		'spec/vectors/gates.json': { description: 'x', cases: [], shared: [] },
		'spec/capabilities/catalog.json': {
			languages: [
				{ id: 'typescript', displayName: 'TypeScript' },
				{ id: 'cpp', displayName: 'C++' },
			],
			capabilities: ['core.one', 'gates.one', 'gates.two', 'tooling.cli'].map((id) => ({
				id,
				label: id,
			})),
			tables: [],
		},
		'spec/capabilities/typescript.json': {
			capabilities: {
				'core.one': { status: 'yes' },
				'gates.one': { status: 'yes' },
				'gates.two': { status: 'yes' },
				'tooling.cli': { status: 'yes' },
			},
		},
		'spec/capabilities/cpp.json': {
			capabilities: {
				'core.one': { status: 'yes' },
				'gates.one': { status: 'partial' },
				'gates.two': { status: 'no' },
				'tooling.cli': { status: 'na' },
			},
		},
		'spec/registry.json': registry(),
	};
	mutate(files);
	for (const [rel, content] of Object.entries(files)) write(root, rel, content);
	return root;
}

function problemsOf(root) {
	checkSpecRegistry(root, { write: true });
	return checkSpecRegistry(root).problems;
}

afterEach(() => {
	while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

describe('check-spec-registry', () => {
	test('the repository registry passes', () => {
		assert.deepEqual(checkSpecRegistry().problems, []);
	});

	test('a minimal registry passes once rendered', () => {
		assert.deepEqual(problemsOf(fixture()), []);
	});

	test('an unrendered table fails until --write', () => {
		const root = fixture();
		const { problems } = checkSpecRegistry(root);
		assert.ok(problems.some((p) => p.includes('profiles table is out of date')));
		assert.ok(problems.some((p) => p.includes('languages table is out of date')));
		const { written } = checkSpecRegistry(root, { write: true });
		assert.deepEqual(written.sort(), ['docs/language-parity.md', 'spec/registry.md']);
		assert.deepEqual(checkSpecRegistry(root).problems, []);
	});

	test('renders what each language implements', () => {
		const root = fixture();
		checkSpecRegistry(root, { write: true });
		const parity = readFileSync(join(root, 'docs/language-parity.md'), 'utf8');
		assert.match(parity, /\| Core 1\.0 \| Yes \| Yes \|/);
		assert.match(parity, /\| `gates` 1\.0 \| Yes \| Partial \(0 of 2\) \|/);
		const page = readFileSync(join(root, 'spec/registry.md'), 'utf8');
		assert.match(
			page,
			/\| `gates` \| 1\.0 \| A server with gates \| \[`gates\.md`\]\(\.\/gates\.md\) \| `GATE_CLOSED` \|/
		);
	});

	test('a spec file with no owner fails', () => {
		const root = fixture((files) => {
			files['spec/stray.md'] = '# Stray\n';
		});
		assert.ok(problemsOf(root).includes('spec/stray.md: has no owner in spec/registry.json'));
	});

	test('a file with two owners fails', () => {
		const root = fixture((files) => {
			files['spec/registry.json'].profiles[0].pages.push('spec/core.md');
		});
		assert.ok(
			problemsOf(root).some((p) => p.includes('spec/core.md: owned by both core and gates'))
		);
	});

	test('a listed file that does not exist fails', () => {
		const root = fixture((files) => {
			files['spec/registry.json'].core.fixtures.push('spec/wire/missing.json');
		});
		assert.ok(problemsOf(root).includes('core fixtures: spec/wire/missing.json does not exist'));
	});

	test('an error code whose vector profile disagrees with the registry fails', () => {
		const root = fixture((files) => {
			files['spec/vectors/error-codes.json'].codes[1].profile = 'core';
		});
		assert.ok(
			problemsOf(root).some((p) =>
				p.startsWith('error code GATE_CLOSED: spec/vectors/error-codes.json says profile "core"')
			)
		);
	});

	test('an error code with no owner, or only in the registry, fails', () => {
		const root = fixture((files) => {
			files['spec/vectors/error-codes.json'].codes.push({
				code: 'NEW_CODE',
				retryable: false,
				profile: 'core',
			});
			files['spec/registry.json'].core.errorCodes.push('GONE_CODE');
		});
		const problems = problemsOf(root);
		assert.ok(problems.includes('error code NEW_CODE: has no owner in spec/registry.json'));
		assert.ok(
			problems.includes(
				'error code GONE_CODE: in the registry but not in spec/vectors/error-codes.json'
			)
		);
	});

	test('a capability with no owner, two owners or no catalog entry fails', () => {
		const root = fixture((files) => {
			files['spec/capabilities/catalog.json'].capabilities.push({ id: 'new.one', label: 'x' });
			files['spec/registry.json'].core.capabilities.push('gates.one', 'unknown.one');
		});
		const problems = problemsOf(root);
		assert.ok(problems.includes('capability new.one: has no owner in spec/registry.json'));
		assert.ok(problems.includes('capability gates.one: owned by both core and gates'));
		assert.ok(problems.includes('capability unknown.one: not in spec/capabilities/catalog.json'));
	});

	test("a profile's legacy reference-generated vectors fail", () => {
		const root = fixture((files) => {
			files['spec/vectors/validation.json'] = { cases: [] };
			files['spec/registry.json'].profiles[0].vectors.push('spec/vectors/validation.json');
		});
		assert.ok(
			problemsOf(root).some((p) => p.includes('validation.json is legacy reference-generated'))
		);
	});

	test("a profile's page that claims every implementation, or does not name its profile, fails", () => {
		const root = fixture((files) => {
			files['spec/gates.md'] = '# Gates\n\nEvery implementation MUST gate.\n';
		});
		const problems = problemsOf(root);
		assert.ok(problems.some((p) => p.startsWith('spec/gates.md:3: says "every implementation"')));
		assert.ok(
			problems.some((p) => p.startsWith("spec/gates.md: a profile's page names its profile"))
		);
	});

	test('a claim of every implementation wrapped across lines, or a profile line too far down, fails', () => {
		const root = fixture((files) => {
			files['spec/gates.md'] =
				`# Gates\n${'\n'.repeat(12)}Profile: \`gates\`.\n\nA rule every\nimplementation keeps.\n`;
		});
		const problems = problemsOf(root);
		assert.ok(problems.some((p) => p.startsWith('spec/gates.md:16: says "every implementation"')));
		assert.ok(
			problems.some((p) =>
				p.startsWith("spec/gates.md: a profile's page names its profile in its first 10 lines")
			)
		);
	});

	test("a profile's legacy reference-generated file fails in any of its lists", () => {
		const root = fixture((files) => {
			files['spec/vectors/validation.json'] = { cases: [] };
			files['spec/registry.json'].profiles[0].fixtures.push('spec/vectors/validation.json');
		});
		assert.ok(
			problemsOf(root).some((p) => p.includes('validation.json is legacy reference-generated'))
		);
	});

	test('parts must name a real section and a real owner other than the file owner', () => {
		const root = fixture((files) => {
			files['spec/registry.json'].parts = [
				{
					file: 'spec/vectors/gates.json',
					sections: { missing: 'core', cases: 'gates', shared: 'nobody' },
				},
				{
					file: 'spec/vectors/gates.json',
					entries: [{ path: 'cases', key: 'name', owners: { core: ['absent'] } }],
				},
			];
		});
		const problems = problemsOf(root);
		assert.ok(problems.includes('parts: spec/vectors/gates.json has no section "missing"'));
		assert.ok(
			problems.includes('parts: spec/vectors/gates.json "cases" repeats the file\'s owner')
		);
		assert.ok(
			problems.includes('parts: spec/vectors/gates.json "shared" names unknown owner "nobody"')
		);
		assert.ok(problems.includes('parts: spec/vectors/gates.json "cases" has no entry "absent"'));
	});

	test('a part assigned to two owners across records fails', () => {
		const root = fixture((files) => {
			files['spec/registry.json'].profiles.push({
				...files['spec/registry.json'].profiles[0],
				id: 'locks',
				title: 'Locks',
				pages: ['spec/locks.md'],
				vectors: [],
				errorCodes: [],
				capabilities: [],
			});
			files['spec/locks.md'] = '# Locks\n\nProfile: `locks`.\n';
			files['spec/vectors/gates.json'].cases = [{ name: 'one' }];
			files['spec/registry.json'].parts = [
				{ file: 'spec/vectors/gates.json', sections: { shared: 'core' } },
				{ file: 'spec/vectors/gates.json', sections: { shared: 'locks' } },
				{
					file: 'spec/vectors/gates.json',
					entries: [{ path: 'cases', key: 'name', owners: { core: ['one'] } }],
				},
				{
					file: 'spec/vectors/gates.json',
					entries: [{ path: 'cases', key: 'name', owners: { locks: ['one'] } }],
				},
			];
		});
		const problems = problemsOf(root);
		assert.ok(
			problems.includes('parts: spec/vectors/gates.json "shared" has two owners, core and locks')
		);
		assert.ok(
			problems.includes(
				'parts: spec/vectors/gates.json "cases" entry "one" has two owners, core and locks'
			)
		);
	});

	test('a profile with no shared cases fails unless it names the issue that adds them', () => {
		const add = (files, extra) => {
			files['spec/registry.json'].profiles.push({
				id: 'bare',
				title: 'Bare',
				version: '1.0',
				optIn: 'A server that is bare',
				pages: ['spec/bare.md'],
				vectors: [],
				fixtures: [],
				conformance: [],
				errorCodes: [],
				capabilities: [],
				...extra,
			});
			files['spec/bare.md'] = '# Bare\n\nProfile: `bare`.\n';
		};
		const missing = problemsOf(fixture((files) => add(files, {})));
		assert.ok(
			missing.some((p) =>
				p.startsWith('profile "bare": has no vectors, fixtures, conformance cases or parts')
			)
		);
		const pending = problemsOf(
			fixture((files) =>
				add(files, { pendingVectors: 'https://github.com/lushly-dev/afd/issues/1' })
			)
		);
		assert.deepEqual(pending, []);
		const viaPart = problemsOf(
			fixture((files) => {
				add(files, {});
				files['spec/registry.json'].parts.push({
					file: 'spec/vectors/error-codes.json',
					sections: { codes: 'bare' },
				});
			})
		);
		assert.deepEqual(viaPart, []);
		const stale = problemsOf(
			fixture((files) => {
				files['spec/registry.json'].profiles[0].pendingVectors =
					'https://github.com/lushly-dev/afd/issues/1';
			})
		);
		assert.ok(stale.includes('profile "gates": has shared cases, so drop "pendingVectors"'));
	});

	test('a profile without a version, an opt-in or a page fails', () => {
		const root = fixture((files) => {
			const p = files['spec/registry.json'].profiles[0];
			p.version = '1';
			p.optIn = '';
			p.pages = [];
		});
		const { problems } = checkSpecRegistry(root);
		assert.ok(problems.includes('profile "gates": "version" must be MAJOR.MINOR'));
		assert.ok(
			problems.includes(
				'profile "gates": needs an "optIn", the condition under which a server has it'
			)
		);
		assert.ok(problems.includes('profile "gates": needs at least one page'));
	});
});

describe('ownerStatus', () => {
	const owner = { capabilities: ['a', 'b'] };
	const manifest = (a, b) => ({ capabilities: { a: { status: a }, b: { status: b } } });
	test('all yes is Yes, all na is N/A, none is No', () => {
		assert.equal(ownerStatus(owner, manifest('yes', 'yes')), 'Yes');
		assert.equal(ownerStatus(owner, manifest('na', 'na')), 'N/A');
		assert.equal(ownerStatus(owner, manifest('planned', 'no')), 'No');
	});
	test('N/A beside Yes does not hold a language back', () => {
		assert.equal(ownerStatus(owner, manifest('yes', 'na')), 'Yes');
		assert.equal(ownerStatus(owner, manifest('partial', 'na')), 'Partial');
	});
	test('some is Partial with the count of yes', () => {
		assert.equal(ownerStatus(owner, manifest('yes', 'planned')), 'Partial (1 of 2)');
		assert.equal(ownerStatus(owner, manifest('partial', 'no')), 'Partial (0 of 2)');
		assert.equal(ownerStatus({ capabilities: ['a'] }, manifest('partial')), 'Partial');
	});
	test('an owner without capabilities is not tracked', () => {
		assert.equal(ownerStatus({ capabilities: [] }, manifest()), 'Not tracked');
	});
});

describe('resolveEntries', () => {
	const json = {
		servers: [
			{ id: 'a', calls: [{ tool: 'x' }] },
			{ id: 'b', calls: [] },
		],
		tests: [],
	};
	test('walks sections and picks array elements by key', () => {
		assert.deepEqual(resolveEntries(json, 'tests'), []);
		assert.deepEqual(resolveEntries(json, 'servers[id=a]/calls'), [{ tool: 'x' }]);
		assert.equal(resolveEntries(json, 'servers[id=c]/calls'), undefined);
		assert.equal(resolveEntries(json, 'missing/calls'), undefined);
	});
});

describe('globMatches', () => {
	test('a star matches within one segment', () => {
		assert.ok(globMatches('spec/capabilities/*', 'spec/capabilities/rust.json'));
		assert.ok(globMatches('spec/vectors/generate-*.mjs', 'spec/vectors/generate-validation.mjs'));
		assert.ok(!globMatches('spec/capabilities/*', 'spec/capabilities/deep/rust.json'));
		assert.ok(!globMatches('spec/vectors/generate-*.mjs', 'spec/vectors/validation.json'));
	});
});
