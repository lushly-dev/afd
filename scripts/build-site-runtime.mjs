#!/usr/bin/env node
/**
 * Bundle the parts of @lushly-dev/afd-core that afd.dev runs in the browser.
 *
 * The site is an AFD app: every interaction on the page is a real command
 * executed by afd-core's command registry. This script bundles that registry
 * (plus the result helpers and fuzzy command matching) into a single ES module
 * at site/js/vendor/afd-core.js. It needs packages/core built first.
 *
 * Run manually:   pnpm -F @lushly-dev/afd-core build && node scripts/build-site-runtime.mjs
 * Run in CI:      .github/workflows/deploy-pages.yml, before the Pages upload
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ESBUILD = 'esbuild@0.28.2';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const coreEntry = join(root, 'packages/core/dist/index.js');
const outFile = join(root, 'site/js/vendor/afd-core.js');
const entryFile = join(root, 'site/js/vendor/.afd-core-entry.mjs');

if (!existsSync(coreEntry)) {
	console.error('packages/core/dist is missing. Run: pnpm -F @lushly-dev/afd-core build');
	process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(root, 'packages/core/package.json'), 'utf8'));

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
	entryFile,
	`export { createCommandRegistry, success, failure, validationError, findSimilarTools, isSuccess, isFailure } from ${JSON.stringify(coreEntry)};\n`
);

try {
	execFileSync(
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
			`--banner:js=/* @lushly-dev/afd-core ${version}, bundled for afd.dev by scripts/build-site-runtime.mjs. Do not edit. */`,
			`--outfile=${outFile}`,
		],
		// Run outside the repo so npx uses the pinned esbuild, not a workspace link.
		{ stdio: 'inherit', cwd: tmpdir() }
	);
} finally {
	rmSync(entryFile, { force: true });
}

console.log(`Bundled afd-core ${version} → site/js/vendor/afd-core.js`);
