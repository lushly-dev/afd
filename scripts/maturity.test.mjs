import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import {
	applyBlocks,
	checkInventory,
	checkLlmsLines,
	checkReadmeRows,
	checkRegistries,
	checkRepository,
	checkSiteText,
	LADDER,
	renderBlocks,
	resolveMap,
	visibleText,
} from './maturity.mjs';

const unit = (id, overrides = {}) => ({
	id,
	family: id,
	state: 'admitted',
	maturity: 'beta',
	routes: ['npm-main'],
	distributions: [],
	...overrides,
});

const inventory = (units, parts) => ({
	units,
	map: { groups: [{ id: 'g', label: 'Group', parts }] },
});

describe('the ladder', () => {
	it('has the five fixed words, most mature first', () => {
		assert.deepEqual(
			LADDER.map((word) => word.label),
			['Stable', 'Beta', 'Preview', 'In development', 'Internal']
		);
	});
});

describe('resolveMap', () => {
	it("gives a part the most mature of its units' words", () => {
		const { parts, errors } = resolveMap(
			inventory(
				[
					unit('a', { maturity: 'in-development', state: 'quarantined' }),
					unit('b', { maturity: 'preview' }),
				],
				[{ id: 'p', name: 'P', units: ['a', 'b'] }]
			)
		);
		assert.deepEqual(errors, []);
		assert.equal(parts[0].maturity, 'preview');
	});

	it('refuses an unknown word, a unit in two parts and a published unit off the map', () => {
		const { errors } = resolveMap(
			inventory(
				[
					unit('a', { maturity: 'alpha' }),
					unit('b'),
					unit('c'),
					unit('d', { maturity: 'internal' }),
				],
				[
					{ id: 'p', name: 'P', units: ['a', 'b'] },
					{ id: 'q', name: 'Q', families: ['b'] },
				]
			)
		);
		assert.ok(errors.some((error) => error.startsWith('a: maturity')));
		assert.ok(errors.some((error) => error.includes('b belongs to two map parts')));
		assert.ok(errors.some((error) => error.startsWith('c is in no map part')));
		assert.ok(
			!errors.some((error) => error.startsWith('d ')),
			'an internal unit may stay off the map'
		);
	});
});

describe('checkInventory', () => {
	/** A fixture repository with the given files; returns its root. */
	function fixture(files) {
		const root = mkdtempSync(join(tmpdir(), 'maturity-'));
		for (const [file, text] of Object.entries(files)) {
			mkdirSync(join(root, dirname(file)), { recursive: true });
			writeFileSync(join(root, file), text);
		}
		return root;
	}
	const npm = (dir) => [
		{ name: dir, registry: 'npm', format: 'npm', manifest: `${dir}/package.json` },
	];
	const pkg = (version) => JSON.stringify({ name: 'x', version });

	it('ties each word to the state, the npm tag and the version shape', () => {
		const root = fixture({
			'release/package.json': pkg('1.0.0'),
			'pre/package.json': pkg('1.0.0-preview.1'),
		});
		try {
			const errors = checkInventory(root, {
				units: [
					unit('quarantined-beta', { state: 'quarantined' }),
					unit('admitted-dev', { maturity: 'in-development' }),
					unit('held-beta', { state: 'held' }),
					unit('preview-on-latest', { maturity: 'preview', distributions: npm('release') }),
					unit('beta-on-a-tag', { distTag: 'next', distributions: npm('release') }),
					unit('beta-prerelease', { distributions: npm('pre') }),
					unit('beta-release', { distributions: npm('release') }),
					unit('missing', { distributions: npm('gone') }),
				],
			});
			const about = (id) => errors.filter((error) => error.startsWith(id));
			assert.match(about('quarantined-beta')[0], /"Beta" says published/);
			assert.match(about('admitted-dev')[0], /"In development" says not published/);
			assert.deepEqual(about('held-beta'), [], 'a held unit may be published or not yet');
			assert.match(about('preview-on-latest')[0], /publishes under the preview tag/);
			assert.ok(
				errors.some((error) => /release\/.*a Preview version is x\.y\.z-preview\.N/.test(error))
			);
			assert.match(about('beta-on-a-tag')[0], /a Beta npm unit publishes on the default tag/);
			assert.ok(errors.some((error) => /pre\/.*a Beta version has no prerelease/.test(error)));
			assert.deepEqual(about('beta-release'), []);
			assert.ok(
				errors.some((error) => error.startsWith('gone/package.json: the manifest is missing'))
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('gives Stable only to a 1.0 or later release in every format, on a final contract', () => {
		const files = {
			'n/package.json': pkg('0.9.0'),
			'p/pyproject.toml':
				'[project]\nname = "p"\nversion = "0.13.0"\nclassifiers = ["Development Status :: 5 - Production/Stable"]\n',
			'r/Cargo.toml': '[package]\nname = "r"\nversion = "0.3.0"\n',
			'c/CMakeLists.txt': 'project(afd-cpp VERSION 0.3.0 LANGUAGES CXX)\n',
			'q/pyproject.toml':
				'[project]\nname = "q"\nversion = "1.0.0rc1"\nclassifiers = ["Development Status :: 5 - Production/Stable"]\n',
			'ok/package.json': pkg('2.0.0'),
		};
		const units = [
			unit('n', { maturity: 'stable', distributions: npm('n') }),
			unit('p', {
				maturity: 'stable',
				distributions: [
					{ name: 'p', registry: 'pypi', format: 'python', manifest: 'p/pyproject.toml' },
				],
			}),
			unit('r', {
				maturity: 'stable',
				distributions: [
					{ name: 'r', registry: 'crates', format: 'rust', manifest: 'r/Cargo.toml' },
				],
			}),
			unit('c', {
				maturity: 'stable',
				distributions: [
					{ name: 'c', registry: 'source', format: 'cpp', manifest: 'c/CMakeLists.txt' },
				],
			}),
			unit('q', {
				maturity: 'stable',
				distributions: [
					{ name: 'q', registry: 'pypi', format: 'python', manifest: 'q/pyproject.toml' },
				],
			}),
			unit('ok', { maturity: 'stable', distributions: npm('ok') }),
		];
		const final = fixture({ ...files, 'spec/VERSION': '1.0\n' });
		const candidate = fixture({ ...files, 'spec/VERSION': '1.0-rc\n' });
		try {
			const errors = checkInventory(final, { units });
			for (const dir of ['n', 'p', 'r', 'c', 'q'])
				assert.ok(
					errors.some((error) => error.startsWith(`${dir}/`) && /Stable needs a 1\.0/.test(error)),
					`${dir} is below 1.0`
				);
			assert.ok(
				!errors.some((error) => error.startsWith('ok')),
				'2.0.0 on a final contract is Stable'
			);
			assert.ok(
				checkInventory(candidate, { units }).some((error) =>
					error.startsWith('ok: Stable needs a final AFD contract')
				)
			);
		} finally {
			rmSync(final, { recursive: true, force: true });
			rmSync(candidate, { recursive: true, force: true });
		}
	});

	it('maps each word to one PyPI Development Status classifier', () => {
		const pyproject = (status) =>
			`[project]\nname = "x"\nversion = "0.1.0"\nclassifiers = [${status ? `"${status}"` : ''}]\n`;
		const root = fixture({
			'alpha/pyproject.toml': pyproject('Development Status :: 3 - Alpha'),
			'none/pyproject.toml': pyproject(''),
			'none-dev/pyproject.toml': pyproject(''),
		});
		try {
			const py = (dir) => [
				{ name: dir, registry: 'pypi', format: 'python', manifest: `${dir}/pyproject.toml` },
			];
			const errors = checkInventory(root, {
				units: [
					unit('beta-says-alpha', { routes: ['pypi'], distributions: py('alpha') }),
					unit('beta-says-nothing', { routes: ['pypi'], distributions: py('none') }),
					unit('dev-says-nothing', {
						state: 'quarantined',
						maturity: 'in-development',
						distributions: py('none-dev'),
					}),
				],
			});
			assert.equal(errors.filter((error) => error.startsWith('alpha/')).length, 1);
			assert.equal(errors.filter((error) => error.startsWith('none/')).length, 1);
			assert.ok(!errors.some((error) => error.startsWith('none-dev/')), 'unpublished may omit it');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('generated blocks', () => {
	const map = resolveMap(
		inventory(
			[unit('a', { maturity: 'preview' })],
			[{ id: 'fast-af', name: 'FAST-AF', units: ['a'], standalone: true }]
		)
	);

	it('render every part with its word and mark the standalone ones', () => {
		const blocks = renderBlocks(map);
		assert.match(blocks['README.md'].map, /fastaf\["FAST-AF<br\/><em>Preview<\/em>"\]/);
		assert.match(blocks['README.md'].map, /class fastaf standalone/);
		assert.match(blocks['README.md'].ladder, /\| \*\*Preview\*\* \| .* Now: FAST-AF\. \|/);
		assert.match(
			blocks['site/llms.txt'].map,
			/- Group: FAST-AF \(Preview\); each one's foundation packages depend on nothing in AFD/
		);
	});

	it('replace stale content and report missing, unknown or unmatched markers', () => {
		const marker = (name, edge) => `<!-- generated:maturity:${name}:${edge} -->`;
		const start = marker('map', 'start');
		const end = marker('map', 'end');
		const fresh = applyBlocks(`a\n${start}\nold\n${end}\nb`, { map: 'new' }, 'f');
		assert.deepEqual(fresh.errors, []);
		assert.equal(fresh.output, `a\n${start}\nnew\n${end}\nb`);
		assert.match(applyBlocks('a', { map: 'x' }, 'f').errors[0], /block is missing/);
		assert.match(
			applyBlocks(`${start}\nold`, { map: 'x' }, 'f').errors[0],
			/no matching end marker/
		);
		assert.match(applyBlocks(`${end}\n`, {}, 'f').errors[0], /an end marker without a start/);
		const unknown = `${marker('other', 'start')}\n${marker('other', 'end')}`;
		assert.match(applyBlocks(unknown, {}, 'f').errors[0], /unknown generated block: other/);
	});
});

describe('surfaces', () => {
	const parts = [{ id: 'violet', name: 'Violet', group: 'design', maturity: 'preview' }];
	const build = [{ id: 'rust', name: 'Rust', group: 'build', maturity: 'preview' }];

	it('README rows state exactly their part word', () => {
		assert.deepEqual(
			checkReadmeRows('| [**Violet**](x) | A token engine | Preview, on npm |', parts),
			[]
		);
		assert.equal(checkReadmeRows('| Violet | In the repository only |', parts).length, 1);
		assert.equal(checkReadmeRows('| Violet | Preview | Beta |', parts).length, 1);
		assert.match(checkReadmeRows('no table', parts)[0], /no table row names Violet/);
	});

	it('llms.txt states every part outside the build group, with its word', () => {
		assert.deepEqual(checkLlmsLines('- [Violet](u): tokens. Status: Preview.', parts), []);
		assert.equal(checkLlmsLines('- [Violet](u): tokens. In the repository.', parts).length, 1);
		assert.match(
			checkLlmsLines('- **Violet**: tokens. Status: Beta.', parts)[0],
			/no "- \[Violet\]\(" line/
		);
		assert.deepEqual(checkLlmsLines('', build), [], 'the build group is listed by package name');
	});

	it("reads a label's words with no markup left, even from split tags", () => {
		assert.equal(visibleText('<b>Preview</b>,\n  on <code>npm</code>'), 'Preview, on npm');
		assert.equal(visibleText('<<b>script>x'), 'x');
		assert.ok(!visibleText('<scr<b>ipt>alert(1)</scr</b>ipt>').includes('<'));
	});

	it('site labels open with their word, however nested, and every status label carries one', () => {
		const site = (html) => checkSiteText('f', html, parts);
		const good = site(
			'<span data-maturity="violet" class="mono family-status">Preview, on npm</span>'
		);
		assert.deepEqual(good, { errors: [], checked: 1 });
		assert.equal(
			site('<span data-maturity="violet" class="family-status">In preview, on npm</span>').errors
				.length,
			1
		);
		const nested = site(
			'<div class="area-status"><p><strong data-maturity="violet">Beta.</strong> On npm.</p></div>'
		);
		assert.equal(nested.checked, 1);
		assert.match(nested.errors[0], /expected it to open with "Preview"/);
		assert.match(
			site('<span class="mono family-status">Preview</span>').errors[0],
			/no data-maturity/
		);
		assert.match(
			site('<span class="edition">In preview</span>').errors[0],
			/\.edition label has no data-maturity/
		);
		assert.deepEqual(site('<span data-maturity="none" class="edition">Open source, MIT</span>'), {
			errors: [],
			checked: 0,
		});
		assert.deepEqual(site('<span class="footer-edition">AFD / VIOLET</span>').errors, []);
		assert.match(site('<strong data-maturity="nope">Beta</strong>').errors[0], /unknown part/);
	});
});

describe('checkRegistries', () => {
	/** The versions a real registry body holds: the placeholder is published deprecated. */
	const versions = {
		'0.0.0-bootstrap.0': { deprecated: 'Placeholder; install @preview.' },
		'1.0.0-preview.1': {},
		'1.0.0': {},
	};

	/** Runs the registry check for one Preview npm package whose registry answers with `tags`. */
	async function previewWith(tags, answer) {
		const realFetch = globalThis.fetch;
		globalThis.fetch =
			answer ??
			(async () => new Response(JSON.stringify({ 'dist-tags': tags, versions }), { status: 200 }));
		try {
			return await checkRegistries(
				{
					units: [
						unit('p', {
							maturity: 'preview',
							distributions: [
								{ name: '@x/p', registry: 'npm', format: 'npm', manifest: 'p/package.json' },
							],
						}),
					],
				},
				{ releaseLag: {} }
			);
		} finally {
			globalThis.fetch = realFetch;
		}
	}

	it('excuses a release published before the ladder only while it is the served version', async () => {
		const realFetch = globalThis.fetch;
		const pypi = async (version, status, releaseLag) => {
			globalThis.fetch = async () =>
				new Response(JSON.stringify({ info: { version, classifiers: [status] } }), { status: 200 });
			try {
				return await checkRegistries(
					{
						units: [
							unit('py', {
								distributions: [
									{ name: 'py', registry: 'pypi', format: 'python', manifest: 'py/pyproject.toml' },
								],
							}),
						],
					},
					{ releaseLag }
				);
			} finally {
				globalThis.fetch = realFetch;
			}
		};
		const alpha = 'Development Status :: 3 - Alpha';
		const beta = 'Development Status :: 4 - Beta';
		const lag = { 'pypi:py': { version: '0.13.0', issue: '#1' } };
		const excused = await pypi('0.13.0', alpha, lag);
		assert.deepEqual(excused.errors, []);
		assert.match(excused.warnings[0], /0\.13\.0 was released before the ladder \(#1\)/);
		assert.match(
			(await pypi('0.13.0', alpha, {})).errors[0],
			/says "Development Status :: 3 - Alpha"/
		);
		assert.match(
			(await pypi('0.14.0', alpha, lag)).errors[0],
			/exemption for 0\.13\.0 has expired/
		);
		assert.match((await pypi('0.13.0', beta, lag)).errors[0], /now agrees with the ladder; remove/);
		assert.deepEqual((await pypi('0.14.0', beta, {})).errors, []);
		const stale = await pypi('0.14.0', beta, { 'pypi:renamed': { version: '1.0.0', issue: '#1' } });
		assert.match(
			stale.errors[0],
			/^pypi:renamed: the release-lag exemption names no published unit/
		);
	});

	it('reports an unreachable registry as unchecked, never as a mismatch', async () => {
		// The scheduled workflow fails only on a mismatch, so an outage must not read as one.
		for (const answer of [
			async () => {
				throw new TypeError('fetch failed');
			},
			async () => new Response('busy', { status: 503 }),
		]) {
			const result = await previewWith({}, answer);
			assert.deepEqual(result.errors, []);
			assert.match(result.unchecked[0], /^@x\/p: /);
		}
	});

	it("keeps a Preview package's latest on the 0.0.0 placeholder, as the release plan requires", async () => {
		const placeholder = await previewWith({
			latest: '0.0.0-bootstrap.0',
			preview: '1.0.0-preview.1',
		});
		assert.deepEqual([placeholder.errors, placeholder.warnings], [[], []]);
		const onPreview = await previewWith({ latest: '1.0.0-preview.1', preview: '1.0.0-preview.1' });
		assert.match(
			onPreview.errors[0],
			/latest is 1\.0\.0-preview\.1; it stays on the 0\.0\.0 placeholder/
		);
		const onRelease = await previewWith({ latest: '1.0.0', preview: '1.0.0-preview.1' });
		assert.match(onRelease.errors[0], /latest is 1\.0\.0;/);
		const noPreview = await previewWith({ latest: '0.0.0-bootstrap.0' });
		assert.match(noPreview.errors[0], /npm has no preview tag/);
		const noLatest = await previewWith({ preview: '1.0.0-preview.1' });
		assert.match(noLatest.errors[0], /latest is missing/);
		const notAVersion = await previewWith({
			latest: '0.0.0-not a version',
			preview: '1.0.0-preview.1',
		});
		assert.match(notAVersion.errors[0], /latest is 0\.0\.0-not a version;/);
	});
});

describe('this repository', () => {
	it('states one status per part on every surface', () => {
		assert.deepEqual(checkRepository().errors, []);
	});
});
