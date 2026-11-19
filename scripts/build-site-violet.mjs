#!/usr/bin/env node
/**
 * Bundle the Violet command layer that the Violet pages run in the browser.
 *
 * The Violet pages are Violet apps: the token tree on the page is a real
 * in-memory Violet store, and every edit is a real Violet command. This
 * script bundles the worker-safe entry of @lushly-dev/violet-afd (the command
 * registry, the commands and the memory store; no Node-only storage) and the
 * CSS value validators of @lushly-dev/violet-core/css into a single ES module
 * at site/js/vendor/violet.js. The bundle is committed, like
 * afd-core.js, so the site deploys without a Violet build.
 *
 * Run manually:
 *   pnpm -F @lushly-dev/afd-core -F @lushly-dev/violet-core -F @lushly-dev/violet-afd build
 *   node scripts/build-site-violet.mjs
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execTool } from './release/exec-tool.mjs';

const ESBUILD = 'esbuild@0.28.2';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = join(root, 'integrations/violet-afd');
const workerEntry = join(packageDir, 'dist/worker.js');
const outFile = join(root, 'site/js/vendor/violet.js');
// Inside the package, so its imports of @lushly-dev/violet-core resolve.
const entryFile = join(packageDir, '.site-entry.mjs');

if (!existsSync(workerEntry)) {
	console.error(
		'integrations/violet-afd/dist is missing. Run: pnpm -F @lushly-dev/afd-core -F @lushly-dev/violet-core -F @lushly-dev/violet-afd build'
	);
	process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
	entryFile,
	[
		`export { registry, initializeWorkerCore, createMemoryDatabase } from ${JSON.stringify(workerEntry)};`,
		// The allow-list validators a page uses before it draws a token value.
		"export { safeCssColor, safeCssLength, safeCssNumber, safeDuration, safeEasing, safeFontFamily, safeShadow } from '@lushly-dev/violet-core/css';",
		'',
	].join('\n')
);

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
			`--banner:js=/* @lushly-dev/violet-afd ${version}, bundled for the Violet pages by scripts/build-site-violet.mjs. Do not edit. */`,
			`--outfile=${outFile}`,
		],
		// Run outside the repo so npx uses the pinned esbuild, not a workspace link.
		{ stdio: 'inherit', cwd: tmpdir() }
	);
} finally {
	rmSync(entryFile, { force: true });
}

console.log(`Bundled violet-afd ${version} → site/js/vendor/violet.js`);
