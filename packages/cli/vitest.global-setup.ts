/**
 * Vitest global setup: rebuild the CLI when `dist` is older than `src`.
 *
 * The end-to-end tests spawn `dist/bin.js`, and the pre-push hook runs
 * `pnpm test` without building first, so they could otherwise pass or fail
 * against a stale build. Rebuilding here makes a plain `vitest run` test the
 * current source. `src/e2e.test.ts` then checks, with {@link staleOutputs},
 * that the CLI and the workspace packages it runs on are all fresh, and fails
 * with a clear message when they are not.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directory of this package (`packages/cli`). */
export const CLI_PACKAGE_DIR = fileURLToPath(new URL('.', import.meta.url));

/** Workspace packages whose `dist` the built CLI or the e2e test server imports. */
export const WORKSPACE_DEPENDENCIES = ['core', 'client', 'server', 'testing'].map((name) =>
	join(CLI_PACKAGE_DIR, '..', name)
);

/**
 * Sources whose compiled `dist/*.js` is missing or older than the source, as
 * `src/`-relative paths. Every package here compiles `src/**\/*.ts` (except
 * tests) to the same path under `dist`. Empty when the build is fresh.
 */
export function staleOutputs(packageDir: string): string[] {
	const srcDir = join(packageDir, 'src');
	if (!existsSync(srcDir)) return [];
	return readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
		.filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.d.ts'))
		.filter((file) => {
			const output = join(packageDir, 'dist', file.replace(/\.ts$/, '.js'));
			return !existsSync(output) || statSync(output).mtimeMs < statSync(join(srcDir, file)).mtimeMs;
		});
}

export default function setup(): void {
	const stale = staleOutputs(CLI_PACKAGE_DIR);
	if (stale.length === 0) return;

	const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
	try {
		execFileSync(process.execPath, [tsc, '-p', join(CLI_PACKAGE_DIR, 'tsconfig.json')], {
			cwd: CLI_PACKAGE_DIR,
			stdio: 'pipe',
		});
	} catch (error) {
		// A type error still emits JavaScript, and unit tests do not need `dist`,
		// so do not stop the run here: the e2e tests re-check freshness and fail
		// with this output if the build did not happen.
		const output = (error as { stdout?: Buffer }).stdout?.toString() ?? String(error);
		process.stderr.write(`afd-cli: rebuilding dist for the e2e tests failed:\n${output}\n`);
	}
}
