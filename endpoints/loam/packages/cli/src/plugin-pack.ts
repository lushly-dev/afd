/**
 * @fileoverview `loam plugin pack`: `plugin check` over a plugin's source, then a directory bundle the desktop installs
 * (phase 5 no-terminal amendment, 4.1 and 10): `plugin-manifest.json`, each packed app and each engine artifact,
 * nothing else. The bundle is checked again as written, and its digest reported. With `--out <name>.loam-plugin` the
 * checked bundle is written as an archive instead (step 9a2), which is checked again as read back, to the same digest.
 */

import { randomBytes } from 'node:crypto';
import {
	chmod,
	link,
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	rmdir,
	writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { Finding } from './check.js';
import { archiveOf, checkPluginArchive, PLUGIN_ARCHIVE_EXTENSION } from './plugin-archive.js';
import {
	PLUGIN_BUNDLE_LIMITS,
	PLUGIN_MANIFEST,
	type PluginCheckReport,
	packedManifestText,
	pluginCheck,
} from './plugin-check.js';
import { copyListed, isWithin, realish } from './tree.js';
import { findSignatureCollision } from './zip.js';

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

/** Internal hooks used by unit tests to inject commit-time races and rename failures deterministically. */
export interface PluginPackCommitHooks {
	beforeCommit?: () => Promise<void>;
	rename?: (oldPath: string, newPath: string) => Promise<void>;
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

/** Beside `--out`: the lock serializing concurrent `loam plugin pack` runs targeting the same destination. */
export const packLockOf = (out: string): string =>
	join(dirname(out), `.${basename(out)}.loam-pack.lock`);

type DestinationState =
	| { ok: true; mode: 'new' }
	| { ok: true; mode: 'empty-dir' }
	| { ok: true; mode: 'replace-archive'; recorded: string; dev: number; ino: number }
	| { ok: true; mode: 'replace-dir'; recorded: string; dev: number; ino: number }
	| { ok: false; message: string; suggestion: string };

async function readPackRecord(recordPath: string): Promise<string | undefined> {
	const recStat = await lstat(recordPath).catch(() => undefined);
	if (!recStat?.isFile()) return undefined;
	try {
		const recorded = (JSON.parse(await readFile(recordPath, 'utf8')) as { bundleSha256?: unknown })
			.bundleSha256;
		return typeof recorded === 'string' ? recorded : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Inspects `--out` and its sibling pack record to decide whether publication is authorized:
 * - Absent `--out` requires no pre-existing sibling record (never silently deletes an unowned sidecar).
 * - Empty directory `--out` (non-archive) requires no pre-existing sibling record.
 * - Existing archive or non-empty bundle directory requires a regular-file sibling record whose `bundleSha256`
 *   still matches the checked output on disk.
 */
async function inspectDestination(out: string, asArchive: boolean): Promise<DestinationState> {
	const outStat = await lstat(out).catch(() => undefined);
	const recordPath = packRecordOf(out);
	const recStat = await lstat(recordPath).catch(() => undefined);
	if (!outStat) {
		if (recStat) {
			return {
				ok: false,
				message: `A sibling pack record already exists at \`${recordPath}\` even though \`--out\` does not exist.`,
				suggestion:
					'Inspect or remove the stray `.loam-pack.json` sidecar, or choose a different `--out` path.',
			};
		}
		return { ok: true, mode: 'new' };
	}
	if (asArchive) {
		if (!outStat.isFile()) {
			return {
				ok: false,
				message:
					'`--out` holds a directory or non-regular file where a `.loam-plugin` archive was requested.',
				suggestion: 'Choose a new `.loam-plugin` file path outside existing directories.',
			};
		}
		const recorded = await readPackRecord(recordPath);
		if (!recorded) {
			return {
				ok: false,
				message:
					'`--out` holds files `loam plugin pack` did not write, or a bundle or archive that changed since it wrote it.',
				suggestion:
					'Choose an empty directory or a new `.loam-plugin` name; a bundle or archive `loam plugin pack` wrote there, unchanged, is replaced.',
			};
		}
		const archive = await checkPluginArchive(out, pluginCheck, PLUGIN_BUNDLE_LIMITS);
		if (!archive.ok || archive.bundleSha256 !== recorded) {
			return {
				ok: false,
				message:
					'`--out` holds files `loam plugin pack` did not write, or a bundle or archive that changed since it wrote it.',
				suggestion:
					'Choose an empty directory or a new `.loam-plugin` name; a bundle or archive `loam plugin pack` wrote there, unchanged, is replaced.',
			};
		}
		return { ok: true, mode: 'replace-archive', recorded, dev: outStat.dev, ino: outStat.ino };
	}
	if (!outStat.isDirectory()) {
		return {
			ok: false,
			message:
				'`--out` holds files `loam plugin pack` did not write, or a bundle or archive that changed since it wrote it.',
			suggestion:
				'Choose an empty directory or a new `.loam-plugin` name; a bundle or archive `loam plugin pack` wrote there, unchanged, is replaced.',
		};
	}
	const names = await readdir(out).catch(() => undefined);
	if (names === undefined) {
		return {
			ok: false,
			message: '`--out` could not be read as a directory.',
			suggestion: 'Check permissions on `--out` or choose a new output directory.',
		};
	}
	if (names.length === 0) {
		if (recStat) {
			return {
				ok: false,
				message: `A sibling pack record already exists at \`${recordPath}\` for an empty \`--out\` directory.`,
				suggestion:
					'Inspect or remove the stray `.loam-pack.json` sidecar, or choose a different `--out` path.',
			};
		}
		return { ok: true, mode: 'empty-dir' };
	}
	const recorded = await readPackRecord(recordPath);
	if (!recorded) {
		return {
			ok: false,
			message:
				'`--out` holds files `loam plugin pack` did not write, or a bundle or archive that changed since it wrote it.',
			suggestion:
				'Choose an empty directory or a new `.loam-plugin` name; a bundle or archive `loam plugin pack` wrote there, unchanged, is replaced.',
		};
	}
	const bundle = await pluginCheck({ dir: out });
	if (!bundle.ok || bundle.form !== 'bundle' || bundle.bundleSha256 !== recorded) {
		return {
			ok: false,
			message:
				'`--out` holds files `loam plugin pack` did not write, or a bundle or archive that changed since it wrote it.',
			suggestion:
				'Choose an empty directory or a new `.loam-plugin` name; a bundle or archive `loam plugin pack` wrote there, unchanged, is replaced.',
		};
	}
	return { ok: true, mode: 'replace-dir', recorded, dev: outStat.dev, ino: outStat.ino };
}

function sameDestinationAuthorization(
	initial: Extract<DestinationState, { ok: true }>,
	current: Extract<DestinationState, { ok: true }>
): boolean {
	if (initial.mode !== current.mode) return false;
	if (
		(initial.mode === 'replace-archive' && current.mode === 'replace-archive') ||
		(initial.mode === 'replace-dir' && current.mode === 'replace-dir')
	) {
		return (
			initial.recorded === current.recorded &&
			initial.dev === current.dev &&
			initial.ino === current.ino
		);
	}
	return true;
}

/** The checked bundle in `staging`, written as an archive beside `--out` and read back to the digest it was written with. */
async function stageArchive(
	staging: string,
	report: PluginCheckReport
): Promise<{ archive: string; written: PluginCheckReport; unrepresentable?: Finding }> {
	const paths = [PLUGIN_MANIFEST, ...(report.files ?? []).map(({ path }) => path)];
	// Sequential reads avoid hitting EMFILE on bundles with up to 2,000 files under low file-descriptor limits.
	const files: Array<{ path: string; data: Buffer }> = [];
	for (const path of paths) {
		files.push({ path, data: await readFile(join(staging, ...path.split('/'))) });
	}
	const engines = new Set((report.engines ?? []).map(({ path }) => path));
	const bytes = archiveOf(files, engines);
	const archive = `${staging}${PLUGIN_ARCHIVE_EXTENSION}`;
	await writeFile(archive, bytes, { flag: 'wx' });
	const written = await checkPluginArchive(archive, pluginCheck, PLUGIN_BUNDLE_LIMITS);
	const sigRefusal = written.refusals.find(
		({ reason }) => reason === 'signature-in-directory' || reason === 'signature-in-end-record'
	);
	if (!written.ok && sigRefusal) {
		const collision = findSignatureCollision(bytes);
		const target = collision?.path
			? `\`${collision.path}\`'s central directory fields`
			: "the archive's end record";
		return {
			archive,
			written,
			unrepresentable: {
				code: 'PLUGIN_PACK_FAILED',
				key: collision?.path ?? '--out',
				reason: sigRefusal.reason,
				message: `The bundle cannot be packed as a canonical \`.loam-plugin\` archive because ${target} spell a ZIP record signature (${sigRefusal.reason}).`,
				suggestion:
					'Pack as a directory bundle (`loam plugin pack <dir> --out <bundle-dir>`) instead, or change the asset so its size, CRC-32 and offset do not spell a ZIP signature.',
			},
		};
	}
	return { archive, written };
}

export async function pluginPack(options: PluginPackOptions): Promise<PluginPackResult> {
	return pluginPackWithHooks(options);
}

/** Internal entry point exposing commit-time hooks for deterministic race and failure-recovery tests. */
export async function pluginPackWithHooks(
	options: PluginPackOptions,
	hooks: PluginPackCommitHooks = {}
): Promise<PluginPackResult> {
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
	const asArchive = out.endsWith(PLUGIN_ARCHIVE_EXTENSION);
	const initialDest = await inspectDestination(out, asArchive);
	if (!initialDest.ok) {
		return refused(outInvalid(initialDest.message, initialDest.suggestion));
	}

	// Acquire an exclusive sibling lock so competing packs targeting `--out` serialize instead of clobbering.
	const lockPath = packLockOf(out);
	try {
		await mkdir(dirname(out), { recursive: true });
		const lockHandle = await open(lockPath, 'wx', 0o600);
		await lockHandle.close();
	} catch (cause) {
		const code = (cause as { code?: unknown }).code;
		if (code === 'EEXIST') {
			return refused(
				outInvalid(
					`Another \`loam plugin pack\` is currently writing to \`--out\` (\`${lockPath}\` exists).`,
					'Wait for the other pack to finish, or remove a stale `.loam-pack.lock` file if a previous pack exited abnormally.'
				)
			);
		}
		return refused({
			code: 'PLUGIN_PACK_FAILED',
			key: '--out',
			message: `Writing the bundle failed: ${cause instanceof Error ? cause.message : String(cause)}`,
			suggestion: 'Check the space and permissions where `--out` is, then pack again.',
		});
	}

	// Written beside `--out` and checked there first, so a failed pack leaves the earlier bundle as it was.
	const staging = join(
		dirname(out),
		`.${basename(out)}.loam-pack-${randomBytes(6).toString('hex')}`
	);
	const record = `${staging}.json`;
	const backup = `${staging}.prev`;
	const stagedArchive = `${staging}${PLUGIN_ARCHIVE_EXTENSION}`;
	const cleanup = async () => {
		await rm(record, { force: true });
		await rm(stagedArchive, { force: true });
		await rm(staging, { recursive: true, force: true });
		await rm(backup, { recursive: true, force: true });
	};
	const failed = async (refusals: Finding[]): Promise<PluginPackResult> => {
		await cleanup();
		return { report: { ...report, ok: false, refusals }, files: [] };
	};
	const doRename = hooks.rename ?? rename;
	try {
		let written: PluginCheckReport;
		let unrepresentable: Finding | undefined;
		try {
			await mkdir(staging, { recursive: true, mode: 0o700 });
			await writeFile(join(staging, PLUGIN_MANIFEST), packedManifestText(report.manifest));
			await copyListed(
				report.files.map(({ path, source }) => ({ path: join(...path.split('/')), source })),
				staging
			);
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
				unrepresentable = staged.unrepresentable;
			}
		} catch (cause) {
			return await failed([
				{
					code: 'PLUGIN_PACK_FAILED',
					key: '--out',
					message: `Writing the bundle failed: ${cause instanceof Error ? cause.message : String(cause)}`,
					suggestion: 'Check the space and permissions where `--out` is, then pack again.',
				},
			]);
		}
		if (unrepresentable) {
			return await failed([unrepresentable]);
		}
		if (!written.ok || written.bundleSha256 !== report.bundleSha256) {
			return await failed([
				...written.refusals,
				{
					code: 'PLUGIN_HASH_MISMATCH',
					key: '--out',
					message: 'The bundle as written does not match the source it was packed from.',
					suggestion: 'A file changed while packing: pack again.',
				},
			]);
		}

		// Write the new pack record before committing; never delete an existing record before `--out` is replaced.
		try {
			await writeFile(
				record,
				`${JSON.stringify({ written_by: 'loam plugin pack', bundleSha256: written.bundleSha256 }, null, '\t')}\n`,
				{ flag: 'wx' }
			);
			await hooks.beforeCommit?.();
			// Re-verify destination ownership and identity immediately before commit under the lock.
			const currentDest = await inspectDestination(out, asArchive);
			if (!currentDest.ok || !sameDestinationAuthorization(initialDest, currentDest)) {
				return await failed([
					outInvalid(
						'`--out` or its pack record changed while packing.',
						'Inspect `--out` and pack again.'
					),
				]);
			}
			const recordPath = packRecordOf(out);
			if (currentDest.mode === 'new') {
				if (asArchive) {
					// Atomic no-clobber publication: `link` fails with EEXIST if anything appeared at `--out`.
					await link(stagedArchive, out);
					try {
						await link(record, recordPath);
					} catch (cause) {
						await rm(out, { force: true }).catch(() => {});
						throw cause;
					}
					await rm(stagedArchive, { force: true });
					await rm(record, { force: true });
					await rm(staging, { recursive: true, force: true });
				} else {
					await doRename(staging, out);
					try {
						await link(record, recordPath);
					} catch (cause) {
						await rename(out, staging).catch(() => {});
						throw cause;
					}
					await rm(record, { force: true });
				}
			} else if (currentDest.mode === 'empty-dir') {
				await rmdir(out);
				try {
					await doRename(staging, out);
				} catch (cause) {
					await mkdir(out).catch(() => {});
					throw cause;
				}
				try {
					await link(record, recordPath);
				} catch (cause) {
					await rename(out, staging).catch(() => {});
					await mkdir(out).catch(() => {});
					throw cause;
				}
				await rm(record, { force: true });
			} else if (currentDest.mode === 'replace-archive') {
				// Replace `--out` first, then atomically replace its record; a failed rename keeps the old pair intact.
				await doRename(stagedArchive, out);
				await doRename(record, recordPath);
				await rm(staging, { recursive: true, force: true });
			} else {
				// Move old bundle aside so a failed publish restores the previous directory and its untouched record.
				await doRename(out, backup);
				try {
					await doRename(staging, out);
				} catch (cause) {
					await rename(backup, out).catch(() => {});
					throw cause;
				}
				await doRename(record, recordPath);
				await rm(backup, { recursive: true, force: true });
			}
		} catch (cause) {
			const code = (cause as { code?: unknown }).code;
			if (code === 'EEXIST' || code === 'ENOTEMPTY' || code === 'ENOTDIR') {
				return await failed([
					outInvalid(
						'`--out` or its pack record appeared while packing.',
						'Inspect `--out` and pack again.'
					),
				]);
			}
			return await failed([
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
	} finally {
		await rm(lockPath, { force: true }).catch(() => {});
	}
}
