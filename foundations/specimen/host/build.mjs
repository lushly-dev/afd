#!/usr/bin/env node
/**
 * Builds the native host for release: `pnpm -F @lushly-dev/specimen build:host`.
 *
 * The build goes to `CARGO_TARGET_DIR` when it is set, resolved from `host/` as cargo resolves
 * it, and otherwise to `host/target`. A cargo configuration's `build.target-dir` is overridden,
 * because `src/host.ts` and `stage.mjs` look for the build in those two places only.
 */
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const host = dirname(fileURLToPath(import.meta.url));
const target = process.env.CARGO_TARGET_DIR || 'target';
const result = spawnSync('cargo', ['build', '--release', '--locked', '--target-dir', target], {
	cwd: host,
	stdio: 'inherit',
});
if (result.error) {
	console.error(`cargo could not start: ${result.error.message}`);
	process.exit(1);
}
process.exit(result.status ?? 1);
