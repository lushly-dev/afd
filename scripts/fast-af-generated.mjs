#!/usr/bin/env node
// `pnpm verify`'s copy of fast-af.yml's "Regenerated theme, icons and custom-elements manifest match
// the tracked files" step. CI checks a clean checkout with `git diff --exit-code`; a local checkout
// may carry edits, so this compares the tree under foundations/fast-af before and after
// regenerating, and fails only when regenerating changed it.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const windows = process.platform === 'win32';
const scope = 'foundations/fast-af';
const state = () =>
	execFileSync('git', ['diff', '--', scope], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 }) +
	execFileSync('git', ['status', '--porcelain', '--', scope], { cwd: root, encoding: 'utf8' });

const before = state();
for (const script of ['theme:build', 'icons:build', 'cem:analyze'])
	execFileSync('pnpm', ['-F', '@lushly-dev/violet-elements', script], {
		cwd: root,
		stdio: 'inherit',
		shell: windows,
	});
if (state() !== before) {
	console.error(
		`Regenerating changed files under ${scope}; run theme:build, icons:build and cem:analyze in violet-elements and commit the result.`
	);
	execFileSync('git', ['status', '--short', '--', scope], { cwd: root, stdio: 'inherit' });
	process.exit(1);
}
console.log('The theme, icons and custom-elements manifest match the tracked files.');
