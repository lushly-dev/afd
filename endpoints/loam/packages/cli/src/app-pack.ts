/**
 * @fileoverview `loam app pack`: `app check`, then `app-manifest.json` and the files it names, in a
 * directory a deployment can list (phase 1 specification, 2.1 and 11).
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, posix, resolve, sep } from 'node:path';
import type { ManifestV2 } from '@lushly-dev/loam-manifest';
import { type AppCheckOptions, appCheck } from './app-check.js';
import type { AppCheckReport, Finding } from './check.js';
import { builtPaths } from './file-rules.js';
import { copyListed, isWithin, listCopy, OUTPUT_MARKER, realish, replaceable } from './tree.js';

export interface AppPackOptions extends AppCheckOptions {
	out: string;
}

export interface AppPackResult {
	report: AppCheckReport;
	/** Where it was written; only when nothing was refused. */
	out?: string;
	/** Each file written, relative to `out`. */
	files: string[];
}

export const PACKED_MANIFEST = 'app-manifest.json';

function refused(report: AppCheckReport, ...findings: Finding[]): AppPackResult {
	return {
		report: { ...report, ok: false, refusals: [...report.refusals, ...findings] },
		files: [],
	};
}

/** Refuses an `--out` this command must not delete: the source, or someone else's files. */
async function outProblem(root: string, out: string): Promise<Finding | undefined> {
	if (isWithin(root, out)) {
		return {
			code: 'APP_PACK_OUT_INVALID',
			key: '--out',
			message: '`--out` is the app itself or a directory above it.',
			suggestion: 'Pack into a directory of its own, such as `dist/package`.',
		};
	}
	if (!(await replaceable(out))) {
		return {
			code: 'APP_PACK_OUT_INVALID',
			key: '--out',
			message: '`--out` holds files `loam app pack` did not write.',
			suggestion: 'Choose an empty directory; a package there is replaced.',
		};
	}
	return undefined;
}

/** What a package holds beside its manifest, as paths relative to the root. */
function packagedPaths(
	manifest: ManifestV2,
	built: ReadonlyArray<{ path: string; pointer: string }>
) {
	const paths = (manifest.skills ?? []).map((skill) => skill.path);
	for (const { path, pointer } of built) {
		// An entry may import its own chunks, so its whole directory goes with it.
		paths.push(pointer === '/native/entry' ? posix.dirname(path) : path);
	}
	return paths;
}

export async function appPack(options: AppPackOptions): Promise<AppPackResult> {
	const root = await realish(options.dir ?? '.');
	const out = await realish(resolve(options.out));
	const report = await appCheck({ ...options, dir: root });
	const notBuilt = report.warnings.filter((warning) => warning.code === 'ENTRY_NOT_BUILT');
	if (!report.ok || !report.manifest || notBuilt.length > 0) {
		return refused(
			report,
			...notBuilt.map((warning) => ({ ...warning, suggestion: 'Build the app, then pack it.' }))
		);
	}
	const outFinding = await outProblem(root, out);
	if (outFinding) return refused(report, outFinding);
	const { manifest } = report;
	const built = builtPaths(manifest);
	const entry = built.find(({ pointer }) => pointer === '/native/entry');
	if (entry && posix.dirname(entry.path) === '.') {
		return refused(report, {
			code: 'APP_ENTRY_AT_ROOT',
			key: 'native.entry',
			message: "The entry's directory goes in the package, and here it is the whole source.",
			suggestion: 'Build the entry into a directory of its own, such as `dist/native.js`.',
		});
	}

	const packaged = packagedPaths(manifest, built);
	if (packaged.some((path) => isWithin(join(root, path), out))) {
		return refused(report, {
			code: 'APP_PACK_OUT_INVALID',
			key: '--out',
			message: '`--out` holds what is being packed, and replacing it would lose it.',
			suggestion: 'Pack into a directory of its own, such as `dist/package`.',
		});
	}

	const escapes: Finding[] = [];
	const copies = new Map<string, string>();
	for (const path of packaged) {
		const listed = await listCopy(join(root, path), {
			root,
			skip: out,
			onEscape(link) {
				escapes.push({
					code: 'MANIFEST_PATH_ESCAPE',
					key: link
						.slice(root.length + 1)
						.split(sep)
						.join('/'),
					message:
						'A symbolic link in the package leaves the plugin root, leads to nothing or loops.',
					suggestion: 'Keep the path inside the plugin root, or remove the link.',
				});
			},
		});
		for (const { source, path: below } of listed) {
			copies.set(below ? `${path}/${below}` : path, source);
		}
	}
	if (escapes.length > 0) return refused(report, ...escapes);

	await rm(out, { recursive: true, force: true });
	await mkdir(out, { recursive: true });
	await writeFile(join(out, PACKED_MANIFEST), `${JSON.stringify(manifest, null, '\t')}\n`);
	const listedCopies = [...copies].map(([path, source]) => ({ path, source }));
	await copyListed(listedCopies, out);
	await writeFile(join(out, OUTPUT_MARKER), 'Written by loam app pack.\n');
	return {
		report,
		out,
		files: [PACKED_MANIFEST, ...listedCopies.map(({ path }) => path)].sort(),
	};
}
