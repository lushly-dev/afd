#!/usr/bin/env node
/**
 * Builds the stock `umbel` and the mounted `hello-mcp` that `test:mounted` runs, into
 * `$LOAM_UMBEL_TARGET_DIR`, else `$CARGO_TARGET_DIR`, else Umbel's own `target` (an empty value
 * counts as unset, as the shell's `:-` did). A script rather than a shell line: pnpm runs package
 * scripts through cmd.exe on Windows, which has no `export` or `${...:-...}`.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const umbel = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../umbel');
const target = process.env.LOAM_UMBEL_TARGET_DIR || process.env.CARGO_TARGET_DIR || 'target';
const env = { ...process.env, CARGO_TARGET_DIR: target };
for (const args of [
	['build', '--locked', '-p', 'umbel', '--bin', 'umbel'],
	['build', '--locked', '-p', 'umbel-plugin-hello', '--features', 'mounted', '--bin', 'hello-mcp'],
]) {
	const result = spawnSync('cargo', args, { cwd: umbel, env, stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}
