/**
 * @fileoverview `loam app new`: the scaffold, checked before anything is written, so a refused id
 * writes nothing, and checked again where it landed.
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { appCheck } from './app-check.js';
import { type AppCheckReport, checkApp } from './check.js';
import { type AppKind, scaffold } from './templates.js';

export interface AppNewOptions {
	id: string;
	kind: AppKind;
	/** The app's directory; `./<id>` when left out. */
	dir?: string;
	/** The dependency spec of the Loam units in `package.json`. */
	depSpec?: string;
}

export interface AppNewResult {
	report: AppCheckReport;
	/** Where it was written; only when nothing was refused. */
	dir?: string;
	/** Each file written, relative to `dir`. */
	files: string[];
}

export async function appNew(options: AppNewOptions): Promise<AppNewResult> {
	const files = scaffold(options.id, options.kind, options.depSpec ?? 'workspace:*');
	const planned = checkApp(files);
	if (!planned.ok) return { report: planned, files: [] };
	const dir = resolve(options.dir ?? options.id);
	if (existsSync(dir) && (await readdir(dir)).length > 0) {
		return {
			report: {
				...planned,
				ok: false,
				refusals: [
					{
						code: 'APP_DIR_NOT_EMPTY',
						key: '--dir',
						message: 'The directory is not empty, and `app new` overwrites nothing.',
						suggestion: 'Name a new directory with `--dir`.',
					},
				],
			},
			files: [],
		};
	}
	for (const [path, text] of Object.entries(files)) {
		const target = join(dir, path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, text);
	}
	return { report: await appCheck({ dir }), dir, files: Object.keys(files).sort() };
}
