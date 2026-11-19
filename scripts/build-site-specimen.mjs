#!/usr/bin/env node
/**
 * Capture and bundle what the Specimen pages show.
 *
 * The Specimen pages compare real captures with the real specimen-diff command.
 * This script produces both halves:
 *
 * 1. Captures. It runs the Specimen CLI, with the native host and Chromium, over
 *    the small project in site/specimen/bench/ and writes each result as the CLI
 *    prints it, a CommandResult envelope, into site/specimen/captures/, with the
 *    screenshots. It also builds the project's component pack into
 *    site/specimen/pack/. Nothing is edited afterwards.
 * 2. The command layer. It bundles @lushly-dev/specimen-afd for the browser into
 *    site/js/vendor/specimen.js. Comparing captures needs no browser bench, so
 *    the page runs specimen-diff itself.
 *
 * Both outputs are committed, like vendor/violet.js, so the site deploys without
 * a Specimen build. Run it again when the bench project or Specimen changes:
 *
 *   pnpm -F @lushly-dev/specimen-cli... build
 *   pnpm -F @lushly-dev/specimen build:host
 *   pnpm -F @lushly-dev/specimen exec playwright install --only-shell chromium
 *   node scripts/build-site-specimen.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execTool } from './release/exec-tool.mjs';

const ESBUILD = 'esbuild@0.28.2';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'endpoints/specimen-cli/dist/bin.js');
const bench = join(root, 'site/specimen/bench');
const captures = join(root, 'site/specimen/captures');
const packageDir = join(root, 'integrations/specimen-afd');
const outFile = join(root, 'site/js/vendor/specimen.js');

/** One frame for every capture: the bar and a little room under it. */
const VIEWPORT = '480x100';
/** The theme audit's frame: narrower, so three sit side by side on the page near full size. */
const THEME_VIEWPORT = '360x110';
const STATES = [
	'bar',
	'bar-token-changed',
	'bar-relabelled',
	'bar-disabled',
	'bar-disabled-fixed',
	'bar-unnamed',
];
const THEMED = ['bar', 'receipt', 'empty-state'];
const THEMES = ['light', 'dark', 'high-contrast'];

if (!existsSync(cli) || !existsSync(join(packageDir, 'dist/index.js'))) {
	console.error('Specimen is not built. Run: pnpm -F @lushly-dev/specimen-cli... build');
	process.exit(1);
}

/** Run the CLI over the bench project. Paths are relative to the project, as the CLI reads them. */
function specimen(...args) {
	return execFileSync(process.execPath, [cli, '--root', bench, ...args], {
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});
}

rmSync(captures, { recursive: true, force: true });
mkdirSync(join(captures, 'themes'), { recursive: true });

const scratch = join(captures, 'scratch.json');
specimen('list', '--output', '../captures/list.json');
for (const id of STATES) {
	specimen('render', id, '--viewport', VIEWPORT, '--output', `../captures/${id}.json`);
	// A capture records its screenshot's absolute path, which is this machine's. So the picture
	// comes from a second render of the same state, and the capture that is kept names no file.
	specimen(
		'render',
		id,
		'--viewport',
		VIEWPORT,
		'--output',
		'../captures/scratch.json',
		'--screenshot',
		`../captures/${id}.png`
	);
	console.log(`Captured ${id}`);
}
// The same state a second time, in a new browser context: the pair that shows no change.
specimen('render', 'bar', '--viewport', VIEWPORT, '--output', '../captures/bar-again.json');
console.log('Captured bar again');

// The audit exits 1 when an entry ignores the theme and nothing declares it. That is the finding.
try {
	specimen('themes', '--viewport', THEME_VIEWPORT, '--output', '../captures/themes.json');
} catch (error) {
	if (error.status !== 1 || !existsSync(join(captures, 'themes.json'))) throw error;
}
for (const id of THEMED) {
	for (const theme of THEMES) {
		specimen(
			'render',
			id,
			'--viewport',
			THEME_VIEWPORT,
			'--theme',
			theme,
			'--output',
			'../captures/scratch.json',
			'--screenshot',
			`../captures/themes/${id}-${theme}.png`
		);
	}
}
rmSync(scratch, { force: true });
console.log('Ran the theme audit');

// The component pack: what an agent is told about <change-bar>, each fact with its basis.
// `pack` runs every case twice and writes the committed form itself, into site/specimen/pack/.
// Its result names this machine's directory, so it is not kept; the records name nothing local.
const packed = JSON.parse(specimen('pack'));
if (!packed.success || packed.data.problems.length || packed.data.cases.failed.length) {
	console.error(JSON.stringify(packed, null, 2));
	process.exit(1);
}
console.log(`Built the pack: ${packed.data.written.join(', ') || 'unchanged'}`);

// ── The command layer, for the browser ──────────────────────────────────

const { version } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
const specimenDist = join(root, 'foundations/specimen/dist');
// Inside the package, so its other imports resolve.
const entryFile = join(packageDir, '.site-entry.mjs');
// The commands import Specimen's main entry, which also loads the bench and with it Vite and
// Playwright. They use two things from it: the comparison and the schemas. Both are plain code.
const shimDir = join(packageDir, '.site-shim');
mkdirSync(shimDir, { recursive: true });
writeFileSync(
	join(shimDir, 'index.js'),
	`export { diffObservations } from ${JSON.stringify(join(specimenDist, 'diff.js'))};\n`
);
writeFileSync(
	join(shimDir, 'schema.js'),
	`export * from ${JSON.stringify(join(specimenDist, 'schema.js'))};\n`
);
writeFileSync(
	entryFile,
	`export { createSpecimenCommands, executeSpecimenCommand, executeSpecimenDiff } from ${JSON.stringify(join(packageDir, 'dist/index.js'))};\n`
);
mkdirSync(dirname(outFile), { recursive: true });
try {
	execTool(
		'npx',
		[
			'--yes',
			ESBUILD,
			entryFile,
			'--bundle',
			'--format=esm',
			'--platform=browser',
			'--target=es2022',
			'--minify',
			'--legal-comments=none',
			`--alias:@lushly-dev/specimen=${shimDir}`,
			`--banner:js=/* @lushly-dev/specimen-afd ${version}, bundled for the Specimen pages by scripts/build-site-specimen.mjs. Do not edit. */`,
			`--outfile=${outFile}`,
		],
		// Run outside the repo so npx uses the pinned esbuild, not a workspace link.
		{ stdio: 'inherit', cwd: tmpdir() }
	);
} finally {
	rmSync(entryFile, { force: true });
	rmSync(shimDir, { recursive: true, force: true });
}

console.log(`Bundled specimen-afd ${version} → site/js/vendor/specimen.js`);
