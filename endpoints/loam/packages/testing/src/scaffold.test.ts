/**
 * E13: the scaffold's own test passes, run by Vitest with the Loam units from the workspace's `dist`
 * (phase 1 specification, section 14). It runs in its own process, as an author's `vitest run` does.
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appNew } from '@lushly-dev/loam-cli';
import { describe, expect, it } from 'vitest';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));

describe('the scaffold test', () => {
	for (const kind of ['native', 'view'] as const) {
		it(`passes for a new ${kind} app`, async () => {
			const root = await mkdtemp(join(tmpdir(), 'loam-scaffold-'));
			try {
				const dir = join(root, 'demo');
				const made = await appNew({ id: 'demo', kind, dir });
				expect(made.report.ok).toBe(true);
				// The app's own dependencies, as an installed scaffold has them, and this unit itself.
				await symlink(join(PACKAGE, 'node_modules'), join(dir, 'node_modules'));
				await writeFile(
					join(dir, 'vitest.config.mjs'),
					`export default {
	resolve: { alias: { '@lushly-dev/loam-testing': ${JSON.stringify(join(PACKAGE, 'dist/index.js'))} } },
	test: { include: ['test/**/*.test.ts'], environment: 'node' },
};
`
				);
				const run = spawnSync(
					process.execPath,
					[join(PACKAGE, 'node_modules/vitest/vitest.mjs'), 'run', '--root', dir],
					{ cwd: dir, encoding: 'utf8', timeout: 60_000 }
				);
				expect(`${run.stdout}${run.stderr}`).toContain('1 passed');
				expect(run.status).toBe(0);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		}, 90_000);
	}
});
