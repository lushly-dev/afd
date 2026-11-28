/**
 * #2808: the installers' third-party notices (`scripts/notices.mjs`). A package the app ships must not go out
 * without its notice: the generator finds what ships (crates over normal dependencies, the files a build's module
 * record names), reproduces what each ships, falls back to the standard text of what it declares, and refuses
 * otherwise. Fixtures here; `test/installers/p6-d5.test.ts` checks each real installer carries the file.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
	dedupePackages,
	isFirstPartyLicense,
	LICENSE_TEXTS,
	licenseIds,
	normalizeText,
	noticeFilesIn,
	npmPackages,
	type Package,
	packageRootOf,
	readModuleRecord,
	renderNotices,
	resolveNotices,
	rustCrates,
	SUPPLEMENTS,
} from '../scripts/notices.mjs';

const root = mkdtempSync(join(tmpdir(), 'loam-notices-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, text: string): string {
	const file = join(root, path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, text);
	return file;
}

const labels = (items: { label: string }[] | undefined) => items?.map((item) => item.label);

const LICENSES = join(root, 'licenses');
write('licenses/MIT.txt', 'MIT License\n\nThe standard MIT text.\n');
write('licenses/Apache-2.0.txt', 'Apache License\nVersion 2.0\n');

function crate(name: string, dir: string, extra: Record<string, unknown> = {}) {
	return {
		id: `${name}-id`,
		name,
		version: '1.0.0',
		license: 'MIT',
		manifest_path: join(root, dir, 'Cargo.toml'),
		targets: [{ kind: ['lib'] }],
		...extra,
	};
}

const normal = (pkg: string) => ({ pkg: `${pkg}-id`, dep_kinds: [{ kind: null, target: null }] });

function pkgOf(extra: Partial<Package> = {}): Package {
	return {
		kind: 'npm',
		name: 'pkg',
		version: '1.0.0',
		license: 'MIT',
		authors: [],
		url: null,
		files: [],
		...extra,
	};
}

describe('#2808: third-party notices', () => {
	it("#2808: reads a module record's relative paths back as absolute ones, virtual modules as they are", () => {
		const file = write(
			'record/build-record/modules.json',
			JSON.stringify({
				resolveFrom: '../web',
				modules: ['../web/node_modules/zod/index.js', '\0vite/preload-helper.js'],
			})
		);
		const at = (path: string) => join(root, path).split('\\').join('/');
		expect(readModuleRecord(file)).toEqual({
			resolveFrom: at('record/web'),
			modules: [at('record/web/node_modules/zod/index.js'), '\0vite/preload-helper.js'],
		});
		// A record with no modules reads as empty, which `build:notices` then refuses.
		expect(readModuleRecord(write('record/empty.json', '{}')).modules).toEqual([]);
	});

	it('#2808: takes the crates compiled in, over normal dependencies, without build, dev or proc-macro ones', () => {
		write('crates/a/LICENSE-MIT', 'Copyright (c) A\n');
		write('crates/a/license.rs', '// not a notice');
		write('crates/e/COPYING', 'Copyright (c) E\n');
		const metadata = {
			packages: [
				crate('root', 'crates/root'),
				crate('a', 'crates/a', { license_file: 'LICENSE-MIT' }),
				crate('b', 'crates/b'),
				crate('c', 'crates/c'),
				crate('m', 'crates/m', { targets: [{ kind: ['proc-macro'] }] }),
				crate('d', 'crates/d'),
				crate('e', 'crates/e'),
			],
			resolve: {
				root: 'root-id',
				nodes: [
					{
						id: 'root-id',
						deps: [
							normal('a'),
							{ pkg: 'b-id', dep_kinds: [{ kind: 'build', target: null }] },
							{ pkg: 'c-id', dep_kinds: [{ kind: 'dev', target: null }] },
							normal('m'),
						],
					},
					{ id: 'a-id', deps: [normal('e')] },
					{ id: 'm-id', deps: [normal('d')] },
					{ id: 'e-id', deps: [normal('a')] },
				],
			},
		};
		const crates = rustCrates(metadata);
		expect(crates.map((item) => item.name).sort()).toEqual(['a', 'e']);
		expect(labels(crates.find((item) => item.name === 'a')?.files)).toEqual(['LICENSE-MIT']);
	});

	it('#2808: finds third-party and vendored notices below the top, but none in tests, examples or docs', () => {
		write('scan/LICENSE', 'top');
		write('scan/THIRDPARTYNOTICES', 'vendored from elsewhere');
		write('scan/THIRD-PARTY-LICENSE', 'bundled helpers');
		write('scan/src/polyfill/once_cell/LICENSE-MIT', 'vendored once_cell');
		write('scan/third_party/fiat/LICENSE', 'fiat');
		write('scan/LICENSES/Apache-2.0.txt', 'reuse folder');
		write('scan/tests/fixtures/LICENSE', 'a test fixture');
		write('scan/examples/LICENSE', 'an example');
		write('scan/docs/NOTICE', 'docs');
		write('scan/src/license.rs', 'code');
		write('scan/src/notice.js', 'code');
		expect(labels(noticeFilesIn(join(root, 'scan')))).toEqual([
			'LICENSE',
			'LICENSES/Apache-2.0.txt',
			'THIRD-PARTY-LICENSE',
			'THIRDPARTYNOTICES',
			'src/polyfill/once_cell/LICENSE-MIT',
			'third_party/fiat/LICENSE',
		]);
		expect(labels(noticeFilesIn(join(root, 'scan'), { recursive: false }))).toEqual([
			'LICENSE',
			'LICENSES/Apache-2.0.txt',
			'THIRD-PARTY-LICENSE',
			'THIRDPARTYNOTICES',
		]);
	});

	it('#2808: reproduces what a package ships, else the standard text of each licence it declares', () => {
		const own = pkgOf({
			kind: 'crate',
			name: 'own',
			files: [
				{
					label: 'LICENSE',
					file: write('pkg/own/LICENSE', 'Copyright (c) Own\r\n\r\nText   \r\n'),
				},
			],
		});
		const bare = pkgOf({ kind: 'crate', name: 'bare', license: 'MIT OR Apache-2.0' });
		const [first, second] = resolveNotices([own, bare], {
			licenseTexts: LICENSES,
			supplements: {},
		});
		expect(first?.standard).toBe(false);
		expect(first?.notices).toEqual([{ label: 'LICENSE', text: 'Copyright (c) Own\n\nText' }]);
		expect(second?.standard).toBe(true);
		expect(labels(second?.notices)).toEqual([
			'The standard text of MIT',
			'The standard text of Apache-2.0',
		]);
	});

	it('#2808: refuses a package with no notice, naming every one', () => {
		const unknown = pkgOf({ name: 'unknown-licence', version: '2.0.0', license: 'WTFPL' });
		const undeclared = pkgOf({ name: 'undeclared', version: '2.0.0', license: null });
		const empty = pkgOf({ name: 'empty-expression', version: '2.0.0', license: '()' });
		expect(() =>
			resolveNotices([unknown, undeclared, empty], { licenseTexts: LICENSES, supplements: {} })
		).toThrow(
			/npm unknown-licence@2\.0\.0 ships no licence file, and there is no standard text for WTFPL[\s\S]*npm undeclared@2\.0\.0 ships no licence file and declares no licence[\s\S]*npm empty-expression@2\.0\.0 ships no licence file and declares no licence/
		);
	});

	it('#2808: adds a supplement, and its standard text unless the supplement is its own licence', () => {
		const sdk = write('supplements/sdk.txt', 'Copyright (C) Vendor\n');
		const pkg = pkgOf({ kind: 'crate', name: 'links-a-vendor-lib', authors: ['Someone'] });
		const supplements = { 'crate:links-a-vendor-lib': [{ label: 'vendor.lib', file: sdk }] };
		const [withStandard] = resolveNotices([pkg], { licenseTexts: LICENSES, supplements });
		expect(labels(withStandard?.notices)).toEqual(['The standard text of MIT', 'vendor.lib']);
		const [own] = resolveNotices([pkg], {
			licenseTexts: LICENSES,
			supplements: {
				'crate:links-a-vendor-lib': [{ label: 'its licence', file: sdk, ownLicense: true }],
			},
		});
		expect(labels(own?.notices)).toEqual(['its licence']);
	});

	it('#2808: finds the packages a module record names, the bundler runtime and repository notices among them', () => {
		const repo = join(root, 'repo');
		const store = `${repo}/node_modules/.pnpm`;
		const pkgJson = (dir: string, manifest: object) =>
			write(join(dir, 'package.json').slice(root.length + 1), JSON.stringify(manifest));
		pkgJson(`${store}/zod@4.0.0/node_modules/zod`, {
			name: 'zod',
			version: '4.0.0',
			license: 'MIT',
		});
		write('repo/node_modules/.pnpm/zod@4.0.0/node_modules/zod/LICENSE', 'Copyright (c) Zod\n');
		pkgJson(`${store}/@scope+pkg@1.0.0/node_modules/@scope/pkg`, {
			name: '@scope/pkg',
			version: '1.0.0',
			license: 'Apache-2.0',
		});
		pkgJson(`${repo}/web/node_modules/vite`, { name: 'vite', version: '8.0.0', license: 'MIT' });
		pkgJson(`${repo}/web/node_modules/vite/node_modules/rolldown`, {
			name: 'rolldown',
			version: '1.0.0',
			license: 'MIT',
		});
		pkgJson(`${repo}/web`, { name: 'web', version: '0.1.0' });
		pkgJson(`${repo}/first`, { name: 'first', version: '0.1.0', license: 'MIT' });
		write('repo/first/LICENSE', 'MIT License\n\nCopyright (c) 2026 Lushly\n');
		pkgJson(`${repo}/forked/packages/element`, {
			name: 'element',
			version: '3.0.0',
			license: 'MIT',
		});
		write('repo/forked/NOTICE.md', 'Derived from Upstream, copyright Upstream Corp.\n');
		write('repo/forked/packages/element/LICENSE', 'MIT License\n\nCopyright (c) Upstream Corp.\n');
		write('repo/first/src/a.js', '');
		const record = {
			resolveFrom: `${repo}/web`,
			modules: [
				`${store}/zod@4.0.0/node_modules/zod/v4/classic/index.js`,
				`${store}/@scope+pkg@1.0.0/node_modules/@scope/pkg/dist/index.js`,
				'\0vite/preload-helper.js',
				'\0rolldown/runtime.js',
				`${repo}/web/src/main.ts`,
				`${repo}/first/src/a.js`,
				`${repo}/forked/packages/element/dist/index.js`,
			],
		};
		const found = npmPackages([record], { repoRoot: repo });
		expect(found.map((pkg) => `${pkg.kind}:${pkg.name}@${pkg.version}`).sort()).toEqual([
			'npm:@scope/pkg@1.0.0',
			'npm:rolldown@1.0.0',
			'npm:vite@8.0.0',
			'npm:zod@4.0.0',
			'workspace:element@3.0.0',
		]);
		expect(labels(found.find((pkg) => pkg.name === 'element')?.files)).toEqual([
			'forked/NOTICE.md',
			'forked/packages/element/LICENSE',
		]);
		// The scoped package ships nothing: the standard text of what it declares.
		const [scoped] = resolveNotices(
			found.filter((pkg) => pkg.name === '@scope/pkg'),
			{ licenseTexts: LICENSES, supplements: {} }
		);
		expect(labels(scoped?.notices)).toEqual(['The standard text of Apache-2.0']);

		expect(() =>
			npmPackages([{ resolveFrom: `${repo}/web`, modules: ['\0commonjs-helpers.js'] }], {
				repoRoot: repo,
			})
		).toThrow(/an unknown virtual module/);
		expect(() =>
			npmPackages([{ resolveFrom: `${repo}/web`, modules: [join(root, 'elsewhere/x.js')] }], {
				repoRoot: repo,
			})
		).toThrow(/outside the repository/);
	});

	it('#2808: keeps one entry for two pnpm copies of one version, labelled within each copy, in any order', () => {
		const copy = (peer: string, files: string[]) =>
			pkgOf({
				files: files.map((name) => ({
					label: name,
					file: write(`store/pkg@1.0.0_${peer}/node_modules/pkg/${name}`, `${name} of pkg\n`),
				})),
			});
		const a = copy('peerA', ['LICENSE']);
		const b = copy('peerB', ['LICENSE', 'NOTICE']);
		const one = dedupePackages([a, b, pkgOf({ version: '2.0.0' })]);
		expect(one.map((pkg) => `${pkg.name}@${pkg.version}`)).toEqual(['pkg@1.0.0', 'pkg@2.0.0']);
		expect(labels(one[0]?.files)).toEqual(['LICENSE', 'NOTICE']);
		expect(labels(dedupePackages([b, a])[0]?.files)).toEqual(['LICENSE', 'NOTICE']);
	});

	it('#2808: renders the same bytes for the same packages in any order, each distinct text once', () => {
		const make = (name: string, text: string) => ({
			...pkgOf({ name }),
			standard: false,
			notices: [{ label: 'LICENSE', text }],
		});
		const packages = [make('b', 'shared'), make('a', 'only a'), make('c', 'shared')];
		const render = (list: typeof packages) =>
			renderNotices({
				product: 'Loam',
				version: '0.1.0',
				sections: [{ title: 'npm', packages: list }],
			});
		const text = render(packages);
		expect(render([...packages].reverse())).toBe(text);
		expect(text.match(/^-------- \[\d+\]/gm)).toHaveLength(2);
		expect(text).toMatch(/^a 1\.0\.0\n {2}Licence: MIT\n {2}\[1\] LICENSE$/m);
		expect(text).toMatch(/^b 1\.0\.0\n {2}Licence: MIT\n {2}\[2\] LICENSE$/m);
		expect(text).toMatch(/^c 1\.0\.0\n {2}Licence: MIT\n {2}\[2\] LICENSE$/m);
		expect(text.endsWith('shared\n')).toBe(true);
	});

	it('#2808: reads licence expressions, package roots and Lushly-only licences', () => {
		expect(licenseIds('(MIT OR Apache-2.0) AND Unicode-3.0')).toEqual([
			'MIT',
			'Apache-2.0',
			'Unicode-3.0',
		]);
		expect(licenseIds('MIT/Apache-2.0')).toEqual(['MIT', 'Apache-2.0']);
		expect(licenseIds('Apache-2.0 WITH LLVM-exception OR MIT')).toEqual([
			'Apache-2.0',
			'LLVM-exception',
			'MIT',
		]);
		expect(packageRootOf('/r/node_modules/.pnpm/a@1/node_modules/@s/p/dist/x.js')).toBe(
			'/r/node_modules/.pnpm/a@1/node_modules/@s/p'
		);
		expect(packageRootOf('/r/packages/core/dist/x.js')).toBeNull();
		expect(isFirstPartyLicense('MIT License\n\nCopyright (c) 2026 Lushly Dev\n')).toBe(true);
		expect(isFirstPartyLicense('MIT License\n\nCopyright (c) Microsoft Corporation.\n')).toBe(
			false
		);
		expect(
			isFirstPartyLicense('MIT License\n\nCopyright (c) 2026 Lushly\nCopyright 2024 Upstream\n')
		).toBe(false);
		expect(isFirstPartyLicense('MIT License\n\nCopyright (c) 2026 Lushly\n© 2024 Upstream\n')).toBe(
			false
		);
		expect(isFirstPartyLicense('Some notice')).toBe(false);
		expect(normalizeText('﻿\n\na  \r\nb\n\n')).toBe('a\nb');
	});

	it('#2808: the committed standard texts and supplements are real files', () => {
		for (const id of ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'MPL-2.0', 'Zlib']) {
			expect(readFileSync(join(LICENSE_TEXTS, `${id}.txt`), 'utf8').length).toBeGreaterThan(500);
		}
		const all = Object.values(SUPPLEMENTS).flat();
		expect(all.length).toBeGreaterThan(0);
		for (const supplement of all) {
			expect(readFileSync(supplement.file, 'utf8')).toMatch(/Copyright \([cC]\)/);
		}
	});
});
