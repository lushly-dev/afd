/**
 * @fileoverview A `.loam-plugin` archive in `loam plugin check` and `loam plugin pack` (phase 5 no-terminal amendment,
 * 4.4's archive rules; step 9a2). An archive is read whole, under the bundle's bounds, and must be in the one canonical
 * form `loam plugin pack` writes (`zip.ts`), every field its value, before any entry is judged: then each name is a
 * bundle path (4.4, rule 3), claimed once by its fold. Then its files are staged in a private directory and checked
 * there as the packed bundle they hold, by the same `pluginCheck` a directory bundle passes, so an archive and the
 * directory it unpacks to are held to one set of rules and one digest; last, the executable mode marks exactly the
 * engines.
 */

import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	BUNDLE_PATH_MAX_BYTES,
	bundlePathProblem,
	foldBundlePath,
} from '@lushly-dev/loam-manifest/plugin';
import type { Finding } from './check.js';
import type { PluginCheckReport } from './plugin-check.js';
import { readZip, writeZip, type ZipEntry } from './zip.js';

/** A packed bundle's archive: what `plugin pack --out <name>.loam-plugin` writes and `plugin check` reads. */
export const PLUGIN_ARCHIVE_EXTENSION = '.loam-plugin';

/** The bounds an archive is read under: 4.4, rule 3's, which `plugin-check.ts` holds a directory to. */
export interface ArchiveLimits {
	bytes: number;
	files: number;
}

/**
 * The most an archive of a bundle within `limits` can exceed its files' bytes (4.4, rule 3), so `pack --out
 * <name>.loam-plugin` is refused for size exactly when a directory bundle would be: per file, a local header (30
 * bytes) and a central entry (46) and the name twice, at most `BUNDLE_PATH_MAX_BYTES` each; zlib's bound on what raw
 * deflate adds to data (`deflateBound` less its 6-byte wrapper: a byte per 4 KiB and another per 16 KiB, a little
 * more, and 7 bytes a stream, for `writeZip`'s default deflate parameters); and the end record.
 */
export function archiveAllowance(limits: ArchiveLimits): number {
	const headers = limits.files * (30 + 46 + 2 * BUNDLE_PATH_MAX_BYTES);
	const deflate =
		Math.floor(limits.bytes / 4096) +
		Math.floor(limits.bytes / 16384) +
		Math.floor(limits.bytes / 33554432) +
		7 * limits.files;
	return headers + deflate + 22;
}

const finding = (code: string, key: string, message: string, suggestion: string): Finding => ({
	code,
	key,
	message,
	suggestion,
});

const unreadable = (reason: string, detail: string): Finding => ({
	...finding(
		'PLUGIN_MANIFEST_INVALID',
		'(archive)',
		`The file is not in the \`.loam-plugin\` form \`loam plugin pack\` writes: ${detail}.`,
		'Pack the plugin again with `loam plugin pack <dir> --out <name>.loam-plugin`.'
	),
	reason,
});

const tooLarge = (reason: string, detail: string): Finding => ({
	...finding(
		'PLUGIN_BUNDLE_TOO_LARGE',
		'(archive)',
		`The archive is past the bundle's bounds: ${detail}.`,
		'Keep the plugin bundle under 256 MiB and 2,000 files.'
	),
	reason,
});

const escaped = (reason: string, path: string, message: string): Finding => ({
	...finding(
		'PLUGIN_PATH_ESCAPE',
		path,
		message,
		'An archive holds regular files only, each named once: pack it again with `loam plugin pack`.'
	),
	reason,
});

/**
 * Each file's place, judged before anything is written: named as a bundle path (4.4, rule 3) and claimed once. Every
 * name, and each directory above it, is claimed by its fold (`foldBundlePath`: NFC, then lower case, upper case and
 * lower case again, then NFC), so two spellings of one name, a parent spelled two ways, or a file where another
 * entry has a directory, are refused, as `collisionRefusals` refuses them in a directory. The file count is the
 * reader's, a bound judged before any name (`readZip`).
 */
export function entryRefusals(entries: readonly ZipEntry[]): Finding[] {
	const refusals: Finding[] = [];
	const claimed = new Map<string, { spelled: string; kind: 'file' | 'directory' }>();
	const claim = (spelled: string, kind: 'file' | 'directory', path: string) => {
		const fold = foldBundlePath(spelled);
		const held = claimed.get(fold);
		if (!held) {
			claimed.set(fold, { spelled, kind });
			return true;
		}
		const [reason, problem] =
			held.kind !== kind
				? [
						'file-in-file',
						`\`${held.kind === 'file' ? held.spelled : spelled}\` is a file, and another entry is inside it.`,
					]
				: held.spelled !== spelled
					? [
							'fold',
							`\`${spelled}\` and \`${held.spelled}\` fold to one name (\`foldBundlePath\`), as a case-insensitive volume such as macOS's or Windows' would make them one ${kind}.`,
						]
					: kind === 'file'
						? ['duplicate', 'The archive names this entry twice.']
						: [undefined, undefined];
		if (reason && problem) {
			refusals.push(escaped(reason, path, problem));
			return false;
		}
		return true;
	};
	for (const { path } of entries) {
		const problem = bundlePathProblem(path);
		if (problem) {
			refusals.push(escaped('path', path, `\`${path}\` ${problem}.`));
			continue;
		}
		const segments = path.split('/');
		let placed = true;
		for (let end = 1; end < segments.length && placed; end++)
			placed = claim(segments.slice(0, end).join('/'), 'directory', path);
		if (placed) claim(path, 'file', path);
	}
	return refusals;
}

/**
 * The archive at `path`, read and checked: the zip and its entries here, then its files staged in a private directory
 * (owner-only, under the system's temporary directory) and held there by `check`, `pluginCheck`, to every rule a packed
 * directory bundle is. The staging is removed before this returns, so each file's `source` is the archive's.
 */
export async function checkPluginArchive(
	path: string,
	check: (options: { dir: string }) => Promise<PluginCheckReport>,
	limits: ArchiveLimits,
	/** Writes one staged file; a test's seam for a system that refuses one. */
	stage: (target: string, data: Buffer) => Promise<void> = (target, data) =>
		writeFile(target, data, { mode: 0o600, flag: 'wx' })
): Promise<PluginCheckReport> {
	const refused = (refusals: Finding[]): PluginCheckReport => ({
		ok: false,
		refusals,
		form: 'archive',
	});
	const seen = await lstat(path);
	if (seen.isSymbolicLink() || !seen.isFile())
		return refused([escaped('archive-file', '(archive)', 'The archive is not a regular file.')]);
	if (seen.size > limits.bytes + archiveAllowance(limits))
		return refused([tooLarge('archive-size', `the file is ${seen.size} bytes`)]);
	// Opened without following a link, and checked to be the file `lstat` saw.
	let bytes: Buffer;
	try {
		const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		try {
			const opened = await handle.stat();
			if (!opened.isFile() || opened.ino !== seen.ino || opened.dev !== seen.dev)
				return refused([
					escaped('archive-file', '(archive)', 'The archive changed while it was read.'),
				]);
			bytes = await handle.readFile();
		} finally {
			await handle.close();
		}
	} catch {
		return refused([
			escaped('archive-file', '(archive)', 'The archive changed while it was read, or is a link.'),
		]);
	}
	// The entry count's bound is the file limit's: a canonical archive holds files only.
	const zip = readZip(bytes, limits.bytes, limits.files);
	if (!zip.ok) {
		return refused([
			zip.problem === 'too-large'
				? tooLarge(zip.reason, zip.detail)
				: zip.problem === 'not-regular'
					? escaped(zip.reason, zip.path, `\`${zip.path}\` is refused: ${zip.detail}.`)
					: unreadable(zip.reason, zip.detail),
		]);
	}
	const refusals = entryRefusals(zip.entries);
	if (refusals.length > 0) return refused(refusals);
	const names = new Set(zip.entries.map(({ path: name }) => name));
	if (!names.has('plugin-manifest.json') || names.has('loam-plugin.toml')) {
		return refused([
			{
				...finding(
					'PLUGIN_MANIFEST_MISSING',
					'(archive)',
					names.has('loam-plugin.toml')
						? 'The archive holds `loam-plugin.toml`, a source: an archive holds a packed bundle.'
						: 'The archive holds no `plugin-manifest.json` at its root.',
					'Pack the plugin with `loam plugin pack <dir> --out <name>.loam-plugin`.'
				),
				reason: 'manifest-missing',
			},
		]);
	}

	const staging = await mkdtemp(join(tmpdir(), 'loam-plugin-archive-'));
	try {
		// A name this system cannot hold (too long here, or refused by its file system) is refused, never thrown.
		const failures: Finding[] = [];
		for (const entry of zip.entries) {
			const target = join(staging, ...entry.path.split('/'));
			try {
				await mkdir(join(target, '..'), { recursive: true, mode: 0o700 });
				await stage(target, entry.data);
			} catch (cause) {
				const code = (cause as { code?: unknown }).code;
				failures.push(
					escaped(
						'staging',
						entry.path,
						`\`${entry.path}\` could not be staged on this system${typeof code === 'string' ? ` (${code})` : ''}.`
					)
				);
			}
		}
		if (failures.length > 0) return refused(failures);
		const checked = await check({ dir: staging });
		// Last: the mode `100755` marks exactly the manifest's engine artifacts, as `pack` writes it, and nothing else.
		const engines = new Set((checked.engines ?? []).map(({ path: engine }) => engine));
		const modes = checked.ok
			? zip.entries
					.filter(({ path: entry, executable }) => executable !== engines.has(entry))
					.map(({ path: entry, executable }) => ({
						...finding(
							'PLUGIN_MANIFEST_INVALID',
							entry,
							executable
								? `\`${entry}\` has mode 100755, and only an engine artifact the manifest names has.`
								: `\`${entry}\` is an engine artifact and has mode 100644, not 100755.`,
							'Pack the plugin again with `loam plugin pack`, which marks exactly its engines executable.'
						),
						reason: executable ? 'mode-executable' : 'mode-engine',
					}))
			: [];
		const report: PluginCheckReport =
			modes.length > 0 ? { ...checked, ok: false, refusals: modes } : checked;
		// A refusal names the file in the bundle; the staging directory is no place a person can find.
		const scrub = (text: string) => text.split(staging).join('(archive)');
		return {
			...report,
			form: 'archive',
			// The directory bundle's own refusals (rule 6 and the rest) are the bundle check's.
			refusals: report.refusals.map((refusal) => ({
				...refusal,
				key: scrub(refusal.key),
				message: scrub(refusal.message),
				reason: refusal.reason ?? 'bundle',
			})),
			...(report.files
				? {
						files: report.files.map((file) => ({
							...file,
							source: `${path}!${file.path}`,
						})),
					}
				: {}),
		};
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

/**
 * The canonical archive of a checked bundle directory (`writeZip`): every file, sorted by its path's UTF-8 bytes (the
 * digest's order, 7.1), deflated, an engine with mode `100755` and the rest `100644`. With one Node.js and zlib build,
 * one bundle packs to the same bytes.
 */
export function archiveOf(
	files: ReadonlyArray<{ path: string; data: Buffer }>,
	engines: ReadonlySet<string>
): Buffer {
	return writeZip(files.map(({ path, data }) => ({ path, data, executable: engines.has(path) })));
}
