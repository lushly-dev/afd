#!/usr/bin/env node
/**
 * A debug build of the app with its protocols serving the bundled shell (`custom-protocol`), into
 * `$CARGO_TARGET_DIR` or `src-tauri/target`. The WebDriver suite runs it; `tauri build` and the installers
 * are step 12's.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const crate = fileURLToPath(new URL('../src-tauri', import.meta.url));
const result = spawnSync('cargo', ['build', '--locked', '--features', 'custom-protocol'], {
	cwd: crate,
	stdio: 'inherit',
	shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
