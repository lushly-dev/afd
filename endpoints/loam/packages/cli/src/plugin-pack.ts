/**
 * @fileoverview `loam plugin pack`: `plugin check` over a plugin's source, then a directory bundle the desktop installs
 * (phase 5 no-terminal amendment, 4.1 and 10): `plugin-manifest.json`, each packed app and each engine artifact,
 * nothing else. The bundle is checked again as written, and its digest reported. With `--out <name>.loam-plugin` the
 * checked bundle is written as an archive instead (step 9a2), which is checked again as read back, to the same digest.
 */

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
	chmod,
	lstat,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, posix, resolve } from 'node:path';
import type { Finding } from './check.js';
import { archiveOf, checkPluginArchive, PLUGIN_ARCHIVE_EXTENSION } from './plugin-archive.js';
import {
	PLUGIN_BUNDLE_LIMITS,
	PLUGIN_MANIFEST,
	type PluginCheckReport,
	packedManifestText,
	pluginCheck,
} from './plugin-check.js';
import { bytesSeen, dirChain, lstatExact } from './seen-file.js';
import { isWithin, realish } from './tree.js';

export interface PluginPackOptions {
	/** The plugin's source, holding `loam-plugin.toml`; the working directory when left out. */
	dir?: string;
	/** The bundle directory to write, or a `.loam-plugin` archive. */
	out: string;
}

export interface PluginPackResult {
	report: PluginCheckReport;
	/** Where it was written; only when nothing was refused. */
	out?: string;
	/** Each file written, relative to `out`. */
	files: string[];
	/** The written bundle's digest (7.1), which the desktop's consent screen shows. */
	bundleSha256?: string;
}

const outInvalid = (message: string, suggestion: string): Finding => ({
	code: 'PLUGIN_PACK_OUT_INVALID',
	key: '--out',
	message,
	suggestion,
});

/** Beside `--out`: the digest of the bundle this command wrote there, which is what lets it replace that bundle. */
export const packRecordOf = (out: string): string =>
	join(dirname(out), `.${basename(out)}.loam-pack.json`);

/**
 * Whether `out` may be replaced: absent, empty, or the bundle this command wrote, unchanged since, as the record beside
 * it shows: a file added anywhere in it, an app's directory included, changes its digest. Neither a file with a common
 * name nor a bundle that merely checks authorizes a recursive delete.
 */
async function replaceableBundle(out: string): Promise<boolean> {
	if (!existsSync(out)) return true;
	if (out.endsWith(PLUGIN_ARCHIVE_EXTENSION)) return replaceableArchive(out);
	const names = await readdir(out).catch(() => undefined);
	if (names === undefined) return false;
	if (names.length === 0) return true;
	let recorded: unknown;
	try {
		recorded = (JSON.parse(await readFile(packRecordOf(out), 'utf8')) as { bundleSha256?: unknown })
			.bundleSha256;
	} catch {
		return false;
	}
	const bundle = await pluginCheck({ dir: out });
	return bundle.ok && bundle.form === 'bundle' && bundle.bundleSha256 === recorded;
}

/** An archive at `out` is replaced only when it is the one this command wrote, unchanged, as its record shows. */
async function replaceableArchive(out: string): Promise<boolean> {
	const stats = await lstat(out).catch(() => undefined);
	if (!stats?.isFile()) return false;
	let recorded: unknown;
	try {
		recorded = (JSON.parse(await readFile(packRecordOf(out), 'utf8')) as { bundleSha256?: unknown })
			.bundleSha256;
	} catch {
		return false;
	}
	const archive = await checkPluginArchive(out, pluginCheck, PLUGIN_BUNDLE_LIMITS);
	return archive.ok && archive.bundleSha256 === recorded;
}

/** The checked bundle in `staging`, written as an archive beside `--out` and read back to the digest it was written with. */
async function stageArchive(
	staging: string,
	report: PluginCheckReport
): Promise<{ archive: string; written: PluginCheckReport }> {
	const paths = [PLUGIN_MANIFEST, ...(report.files ?? []).map(({ path }) => path)];
	const files = await Promise.all(
		paths.map(async (path) => ({ path, data: await readFile(join(staging, ...path.split('/'))) }))
	);
	const engines = new Set((report.engines ?? []).map(({ path }) => path));
	const archive = `${staging}${PLUGIN_ARCHIVE_EXTENSION}`;
	await writeFile(archive, archiveOf(files, engines), { flag: 'wx' });
	return { archive, written: await checkPluginArchive(archive, pluginCheck, PLUGIN_BUNDLE_LIMITS) };
}

export async function pluginPack(options: PluginPackOptions): Promise<PluginPackResult> {
	const root = await realish(options.dir ?? '.');
	const out = await realish(resolve(options.out));
	const report = await pluginCheck({ dir: root });
	const refused = (...findings: Finding[]): PluginPackResult => ({
		report: { ...report, ok: false, refusals: [...report.refusals, ...findings] },
		files: [],
	});
	if (!report.ok || !report.manifest || !report.files) return refused();
	// A link at `--out` is followed to what it names; one that names nothing is refused, never replaced.
	const named = await lstat(resolve(options.out)).catch(() => undefined);
	if (named?.isSymbolicLink() && !(await realpath(resolve(options.out)).catch(() => undefined))) {
		return refused(
			outInvalid(
				'`--out` is a symbolic link that leads to nothing.',
				'Name the bundle or archive itself, or a link to one that exists.'
			)
		);
	}
	if (report.form !== 'source') {
		return refused({
			code: 'PLUGIN_MANIFEST_INVALID',
			key: PLUGIN_MANIFEST,
			message: 'The directory is a packed bundle already.',
			suggestion:
				'Pack the source that holds `loam-plugin.toml`; to check this bundle, run `loam plugin check`.',
		});
	}
	if (isWithin(out, root) || isWithin(root, out)) {
		return refused(
			outInvalid(
				'`--out` is the plugin itself, a directory inside it or one above it.',
				'Pack into a directory of its own, such as `dist/<id>-bundle`, outside the source.'
			)
		);
	}
	if (!(await replaceableBundle(out))) {
		return refused(
			outInvalid(
				'`--out` holds files `loam plugin pack` did not write, or a bundle or archive that changed since it wrote it.',
				'Choose an empty directory or a new `.loam-plugin` name; a bundle or archive `loam plugin pack` wrote there, unchanged, is replaced.'
			)
		);
	}

	// Written beside `--out` and checked there first, so a failed pack leaves the earlier bundle as it was.
	const staging = join(
		dirname(out),
		`.${basename(out)}.loam-pack-${randomBytes(6).toString('hex')}`
	);
	const asArchive = out.endsWith(PLUGIN_ARCHIVE_EXTENSION);
	const failed = async (refusals: Finding[]): Promise<PluginPackResult> => {
		await rm(staging, { recursive: true, force: true });
		await rm(`${staging}${PLUGIN_ARCHIVE_EXTENSION}`, { force: true });
		return { report: { ...report, ok: false, refusals }, files: [] };
	};
	let written: PluginCheckReport;
	try {
		await mkdir(staging, { recursive: true, mode: 0o700 });
		await writeFile(join(staging, PLUGIN_MANIFEST), packedManifestText(report.manifest));
		// Each file is read as `plugin check` read it, never through a link, below directories that are still the real
		// ones, and only while it is the size checked; the bundle written is then checked again, to the source's digest.
		for (const { path, source, size } of report.files) {
			const seen = await lstatExact(source);
			const dirs = await dirChain(root, posix.dirname(path));
			const read =
				dirs && seen.isFile() && seen.size === BigInt(size)
					? await bytesSeen(source, seen, dirs)
					: ({ ok: false, changed: true } as const);
			if (!read.ok) {
				return failed([
					read.changed
						? {
								code: 'PLUGIN_PATH_ESCAPE',
								key: path,
								message: `\`${path}\` changed while it was packed, or is or passes through a link.`,
								suggestion:
									'A bundle holds regular files only: leave the source as it is while it is packed, then pack again.',
							}
						: {
								code: 'PLUGIN_PACK_FAILED',
								key: path,
								message: `\`${path}\` could not be read (${read.error}).`,
								suggestion: 'Make the file readable by you, then pack again.',
							},
				]);
			}
			const data = read.bytes;
			const target = join(staging, ...path.split('/'));
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, data, { flag: 'wx' });
		}
		// An engine is a program the desktop runs; the rest are data.
		if (process.platform !== 'win32') {
			for (const { path } of report.engines ?? [])
				await chmod(join(staging, ...path.split('/')), 0o755);
		}
		// What was written is what the desktop's inspect reads: check it as a bundle, and as the source checked.
		written = await pluginCheck({ dir: staging });
		// An archive is written from the checked directory, and read back and checked as the desktop reads one.
		if (asArchive && written.ok && written.bundleSha256 === report.bundleSha256) {
			const staged = await stageArchive(staging, written);
			written = staged.written;
		}
	} catch (cause) {
		return failed([
			{
				code: 'PLUGIN_PACK_FAILED',
				key: '--out',
				message: `Writing the bundle failed: ${cause instanceof Error ? cause.message : String(cause)}`,
				suggestion: 'Check the space and permissions where `--out` is, then pack again.',
			},
		]);
	}
	if (!written.ok || written.bundleSha256 !== report.bundleSha256) {
		return failed([
			...written.refusals,
			{
				code: 'PLUGIN_HASH_MISMATCH',
				key: '--out',
				message: 'The bundle as written does not match the source it was packed from.',
				suggestion: 'A file changed while packing: pack again.',
			},
		]);
	}
	// The record is written first and renamed into place last, so a bundle in `--out` always has its own record or
	// none, never an earlier one's that would keep the next pack from replacing it.
	const record = `${staging}.json`;
	try {
		await writeFile(
			record,
			`${JSON.stringify({ written_by: 'loam plugin pack', bundleSha256: written.bundleSha256 }, null, '\t')}\n`
		);
		await rm(packRecordOf(out), { force: true });
		if (asArchive) {
			// A file replaces a file in one rename, so `--out` is the earlier archive or this one, never neither.
			await rename(`${staging}${PLUGIN_ARCHIVE_EXTENSION}`, out);
			await rm(staging, { recursive: true, force: true });
		} else {
			await rm(out, { recursive: true, force: true });
			await rename(staging, out);
		}
		await rename(record, packRecordOf(out));
	} catch (cause) {
		await rm(record, { force: true });
		await rm(`${staging}${PLUGIN_ARCHIVE_EXTENSION}`, { force: true });
		return failed([
			{
				code: 'PLUGIN_PACK_FAILED',
				key: '--out',
				message: `Putting the bundle in place failed: ${cause instanceof Error ? cause.message : String(cause)}`,
				suggestion: 'Check the permissions where `--out` is, then pack again.',
			},
		]);
	}
	return {
		report,
		out,
		files: [PLUGIN_MANIFEST, ...report.files.map(({ path }) => path)].sort(),
		bundleSha256: written.bundleSha256,
	};
}
