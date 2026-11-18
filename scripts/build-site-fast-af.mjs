#!/usr/bin/env node
/**
 * Build what the FAST-AF pages run in the browser.
 *
 * The FAST-AF pages run the real library: every component on them is the one
 * in @lushly-dev/violet-elements, on the @lushly-dev/fast-element runtime.
 * This script writes three files, all committed so the site deploys without a
 * build:
 *
 *   site/js/vendor/fast-af.js       every component, the theme runtime, and the
 *                                   parts of the runtime the pages call (scoped
 *                                   registries, the definition schema)
 *   site/js/vendor/ms-fast-element.js
 *                                   Microsoft's own @microsoft/fast-element, at
 *                                   the release FAST-AF carries, from npm. The
 *                                   page runs one test on both runtimes.
 *   site/fast-af/library.json       the component pack as Specimen wrote it
 *                                   (every record, unedited, and the shared
 *                                   rules), with the versions and counts read
 *                                   from the packages
 *
 * Run manually:
 *   pnpm -F "@lushly-dev/violet-elements..." build
 *   node scripts/build-site-fast-af.mjs
 */

import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { execTool } from './release/exec-tool.mjs';

const ESBUILD = 'esbuild@0.28.2';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// FAST_AF_SOURCE and FAST_AF_NAME build a second bundle from another checkout,
// for comparing a branch of the components with the one on the pages:
//   FAST_AF_SOURCE=../violet-refined FAST_AF_NAME=ported node scripts/build-site-fast-af.mjs
// writes fast-af.ported.js and library.ported.json, which a page loads with
// `?bundle=ported`.
const source = process.env.FAST_AF_SOURCE ? resolve(process.env.FAST_AF_SOURCE) : root;
const suffix = process.env.FAST_AF_NAME ? `.${process.env.FAST_AF_NAME}` : '';
const family = join(source, 'foundations/fast-af');
const libraryDir = join(family, 'packages/violet-elements');
const runtimeDir = join(family, 'packages/element/packages/fast-element');
const packDir = join(libraryDir, 'pack');
const vendorDir = join(root, 'site/js/vendor');
const bundleFile = join(vendorDir, `fast-af${suffix}.js`);
const microsoftFile = join(vendorDir, 'ms-fast-element.js');
const dataFile = join(root, `site/fast-af/library${suffix}.json`);

const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const git = (...args) =>
	execFileSync('git', ['-c', 'safe.directory=*', ...args], {
		cwd: source,
		encoding: 'utf8',
	}).trim();

for (const dist of [join(libraryDir, 'dist/index.js'), join(runtimeDir, 'dist/esm/index.js')]) {
	if (!existsSync(dist)) {
		console.error(`${dist} is missing. Run: pnpm -F "@lushly-dev/violet-elements..." build`);
		process.exit(1);
	}
}

const library = read(join(libraryDir, 'package.json'));
const runtime = read(join(runtimeDir, 'package.json'));
const provenance = read(join(family, 'provenance/provenance.json'));
const upstream = provenance.reconciliations.findLast((entry) =>
	entry.source_repository?.endsWith('microsoft/fast')
);
if (!upstream) throw new Error('provenance.json records no reconciliation with microsoft/fast');
const microsoftVersion = upstream.to_tag.split('_v')[1];

function bundle(entry, outFile, banner) {
	execTool(
		'npx',
		[
			'--yes',
			ESBUILD,
			entry,
			'--bundle',
			'--format=esm',
			'--platform=browser',
			'--target=es2022',
			'--minify',
			'--legal-comments=none',
			`--banner:js=/* ${banner} Do not edit. */`,
			`--outfile=${outFile}`,
		],
		// Run outside the repo so npx uses the pinned esbuild, not a workspace link.
		{ stdio: 'inherit', cwd: tmpdir() }
	);
	const code = readFileSync(outFile);
	return { bytes: code.length, gzip: gzipSync(code).length };
}

mkdirSync(vendorDir, { recursive: true });
mkdirSync(dirname(dataFile), { recursive: true });

// 1. FAST-AF: the whole library and the runtime calls the pages make. The two
// entry files sit inside the package so its imports of the runtime resolve.
const entryFile = join(libraryDir, '.site-entry.mjs');
const enableFile = join(libraryDir, '.site-enable.mjs');
// The definition schema is opt-in and has to be on before an element is
// defined, so it is its own module, imported first.
writeFileSync(
	enableFile,
	[
		"import { enableDefinitionSchema } from '@lushly-dev/fast-element/definition-schema.js';",
		'enableDefinitionSchema();',
		'',
	].join('\n')
);
// The icons are data an application registers. The page registers all of them.
const iconsFile = join(libraryDir, '.site-icons.mjs');
writeFileSync(
	iconsFile,
	[
		"import * as icons from './dist/icon/generated/index.js';",
		"import { registerVioletIcons } from './dist/icon/icon-registry.js';",
		"registerVioletIcons(Object.values(icons).filter((icon) => typeof icon?.svg === 'string'));",
		'',
	].join('\n')
);
writeFileSync(
	entryFile,
	[
		"import './.site-enable.mjs';",
		"import './.site-icons.mjs';",
		// The root registers every element.
		"export { applyVioletThemeRoot, getVioletThemePresets, installVioletTheme, installVioletThemeSet, loadVioletBuiltInTheme } from './dist/index.js';",
		"export { FASTElement, FASTElementDefinition, html } from '@lushly-dev/fast-element';",
		"export { ensureScopedRegistrySupport, supportsScopedRegistries } from '@lushly-dev/fast-element/scoped.js';",
		"export { getAllSchemas, getSchema } from '@lushly-dev/fast-element/definition-schema.js';",
		'',
	].join('\n')
);
let bundled;
try {
	bundled = bundle(
		entryFile,
		bundleFile,
		`${library.name} ${library.version} on ${runtime.name} ${runtime.version}, bundled for the FAST-AF pages by scripts/build-site-fast-af.mjs.`
	);
} finally {
	rmSync(entryFile, { force: true });
	rmSync(enableFile, { force: true });
	rmSync(iconsFile, { force: true });
}

// 2. Microsoft's runtime, from npm, at the release FAST-AF carries.
const scratch = mkdtempSync(join(tmpdir(), 'afd-site-fast-'));
let microsoft;
try {
	writeFileSync(join(scratch, 'package.json'), '{ "private": true }\n');
	execTool(
		'npm',
		[
			'install',
			'--no-audit',
			'--no-fund',
			'--ignore-scripts',
			`@microsoft/fast-element@${microsoftVersion}`,
		],
		{ stdio: 'inherit', cwd: scratch }
	);
	const installed = read(join(scratch, 'node_modules/@microsoft/fast-element/package.json'));
	if (installed.version !== microsoftVersion) {
		throw new Error(`npm gave @microsoft/fast-element ${installed.version}`);
	}
	const microsoftEntry = join(scratch, 'entry.mjs');
	writeFileSync(
		microsoftEntry,
		"export { FASTElement, FASTElementDefinition, html } from '@microsoft/fast-element';\n"
	);
	microsoft = bundle(
		microsoftEntry,
		microsoftFile,
		`@microsoft/fast-element ${installed.version} (MIT, Microsoft), from npm, bundled for the FAST-AF pages by scripts/build-site-fast-af.mjs.`
	);
} finally {
	rmSync(scratch, { recursive: true, force: true });
}

// 3. The pack, as Specimen wrote it.
const recordsDir = join(packDir, 'data/violet-elements/components');
const records = readdirSync(recordsDir)
	.filter((name) => name.endsWith('.json'))
	.sort()
	.map((name) => read(join(recordsDir, name)));
const rules = read(join(packDir, 'rules/violet-elements.json'));
const packBytes = readdirSync(recordsDir).reduce(
	(sum, name) => sum + statSync(join(recordsDir, name)).size,
	0
);

const data = {
	built: new Date().toISOString().slice(0, 10),
	source: {
		revision: git('rev-parse', '--short', 'HEAD'),
		// Changes to the packages themselves, not to the site.
		dirty: git('status', '--porcelain', '--', 'foundations/fast-af') !== '',
	},
	library: { name: library.name, version: library.version },
	runtime: {
		name: runtime.name,
		version: runtime.version,
		exports: Object.keys(runtime.exports).length,
	},
	microsoft: {
		name: '@microsoft/fast-element',
		version: microsoftVersion,
		forkedFrom: upstream.from_tag.split('_v')[1],
		taken: upstream.date,
		commits: upstream.commits.length,
	},
	bundle: bundled,
	microsoftBundle: microsoft,
	pack: { bytes: packBytes, directory: 'foundations/fast-af/packages/violet-elements/pack' },
	rules: rules.rules,
	records,
};
writeFileSync(dataFile, `${JSON.stringify(data)}\n`);

console.log(
	`${records.length} records, ${library.name} ${library.version} (${bundled.bytes} bytes), @microsoft/fast-element ${microsoftVersion} (${microsoft.bytes} bytes)`
);
