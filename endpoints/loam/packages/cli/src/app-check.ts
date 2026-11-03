/**
 * @fileoverview `loam app check`: `checkApp` over a directory, with what needs a process: the surface
 * validator and the token lint. It runs none of the app's code: the lint reads its source as text.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCommandSurface } from '@lushly-dev/afd-testing';
import type { ManifestV2 } from '@lushly-dev/loam-manifest';
import {
	type AppCheckReport,
	checkApp,
	type Finding,
	type SurfaceCheck,
	type SurfaceFindingSummary,
} from './check.js';
import { readAppTree } from './tree.js';

export interface AppCheckOptions {
	/** The app's directory; the working directory when left out. */
	dir?: string;
	/** The manifest, relative to `dir`: how one source packs several ways. */
	manifest?: string;
}

const surface: SurfaceCheck = (commands) =>
	validateCommandSurface(commands).findings as SurfaceFindingSummary[];

function findLintScript(): string | undefined {
	let directory = dirname(fileURLToPath(import.meta.url));
	for (;;) {
		const script = join(directory, 'node_modules/@lushly-dev/loam-theme/scripts/lint-tokens.mjs');
		if (existsSync(script)) return script;
		const parent = dirname(directory);
		if (parent === directory) return undefined;
		directory = parent;
	}
}

/** The lint's own exit codes: 1 is a violation, 2 is that it could not run. */
function lintTokens(root: string): Promise<{ refusal?: Finding; warning?: Finding }> {
	const script = findLintScript();
	const unavailable = (message: string): { warning: Finding } => ({
		warning: {
			code: 'TOKEN_LINT_UNAVAILABLE',
			key: 'src',
			message,
			suggestion:
				'Add `package.json`, or run `pnpm -F @lushly-dev/loam-theme theme:build`; then check again.',
		},
	});
	if (!script) return Promise.resolve(unavailable('`loam-lint-tokens` could not be found.'));
	// The lint reads the package it is linting, to decide what that package may use.
	if (!existsSync(join(root, 'package.json'))) {
		return Promise.resolve(unavailable('`loam-lint-tokens` needs a `package.json` beside `src`.'));
	}
	return new Promise((done) => {
		execFile(
			process.execPath,
			[script, 'src/**/*.ts', 'src/**/*.css'],
			{ cwd: root },
			(error, _stdout, stderr) => {
				if (!error) {
					done({});
				} else if (error.code === 1) {
					done({
						refusal: {
							code: 'APP_TOKEN_LINT',
							key: 'src',
							message: stderr.trim(),
							suggestion: 'Use the token contract: no raw colors, lengths or shell tokens.',
						},
					});
				} else if (stderr.includes('no file matches')) {
					done({});
				} else {
					done(unavailable(stderr.trim() || error.message));
				}
			}
		);
	});
}

/** Runs every check of section 11 and reports all it finds. */
export async function appCheck(options: AppCheckOptions = {}): Promise<AppCheckReport> {
	const root = resolve(options.dir ?? '.');
	if (!existsSync(root)) {
		return {
			ok: false,
			refusals: [
				{
					code: 'APP_MANIFEST_MISSING',
					key: root,
					message: 'The directory does not exist.',
					suggestion: 'Check the path.',
				},
			],
			warnings: [],
			exposure: {},
		};
	}
	const { files, symlinks } = await readAppTree(root);
	const report = checkApp(files, {
		symlinks,
		surface,
		...(options.manifest ? { manifest: options.manifest } : {}),
	});
	if ((report.kind === 'native' || report.kind === 'view') && existsSync(join(root, 'src'))) {
		const { refusal, warning } = await lintTokens(root);
		if (refusal) {
			report.refusals.push(refusal);
			report.ok = false;
		}
		if (warning) report.warnings.push(warning);
	}
	return report;
}

/**
 * The manifest as `app pack` writes it, for an app's own tests. Throws when it is refused, naming each
 * refusal.
 */
export async function readAppManifest(dir: string, manifest?: string): Promise<ManifestV2> {
	const { files, symlinks } = await readAppTree(resolve(dir));
	const report = checkApp(files, { symlinks, ...(manifest ? { manifest } : {}) });
	if (!report.manifest || !report.ok) {
		const names = report.refusals.map((refusal) => `${refusal.code} at ${refusal.key}`);
		throw new Error(`The manifest in ${dir} is refused: ${names.join(', ')}`);
	}
	return report.manifest;
}
