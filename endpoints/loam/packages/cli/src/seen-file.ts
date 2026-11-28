/**
 * @fileoverview A file read only while it is the one a walk's `lstat` saw (phase 5 no-terminal amendment, 4.4, rule 3):
 * what `plugin check` and `plugin pack` read a directory bundle's files with, and `plugin check` an archive. Node has
 * no `openat`, so the directories a file is reached through are held instead: each was a real directory (not a link)
 * when it was listed, by its device and inode, and each still is just before the file is opened and again once it is
 * read. A directory swapped for a link, or a file swapped for a link or another file, is never read through.
 */

import { type BigIntStats, constants } from 'node:fs';
import { type FileHandle, lstat, open } from 'node:fs/promises';
import { join } from 'node:path';

/** What `lstat` saw of a file, which its open handle must still be: exact, as bigints. */
export type SeenFile = Pick<BigIntStats, 'ino' | 'dev' | 'size'>;

/** A directory a file is reached through, as `lstat` saw it when it was listed. */
export interface SeenDir {
	path: string;
	dev: bigint;
	ino: bigint;
}

/** Read whole; changed (a link, another file, gone, or a directory on the way swapped); or not readable, and why. */
export type SeenRead =
	| { ok: true }
	| { ok: false; changed: true }
	| { ok: false; changed: false; error: string };

/** `lstat`, exact. */
export const lstatExact = (path: string): Promise<BigIntStats> => lstat(path, { bigint: true });

const errorCode = (cause: unknown): string | undefined =>
	typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string'
		? cause.code
		: undefined;

/**
 * What an open or `lstat` error says: a link refused by `O_NOFOLLOW` (`ELOOP`; `EMLINK` on the BSDs), or a path
 * that no longer leads where it did (`ENOENT`, `ENOTDIR`), is a change; anything else (`EACCES`, `EMFILE`, `EIO`) is
 * not, and is reported as what it is. A file swapped for a directory opens with `EISDIR`, and on Windows a file pending
 * deletion fails with `EPERM`: both are changes too (elsewhere `EPERM` is a refusal, reported as what it is).
 */
const CHANGED = new Set([
	'ELOOP',
	'EMLINK',
	'ENOENT',
	'ENOTDIR',
	'EISDIR',
	...(process.platform === 'win32' ? ['EPERM'] : []),
]);
function failure(cause: unknown): SeenRead {
	const code = errorCode(cause);
	if (code !== undefined && CHANGED.has(code)) return { ok: false, changed: true };
	return {
		ok: false,
		changed: false,
		error: code ?? (cause instanceof Error ? cause.message : String(cause)),
	};
}

/** A real directory's identity, or undefined when `path` is a link or not a directory. */
export async function seenDir(path: string): Promise<SeenDir | undefined> {
	const stats = await lstatExact(path).catch(() => undefined);
	if (!stats) return undefined;
	return stats.isDirectory() && !stats.isSymbolicLink()
		? { path, dev: stats.dev, ino: stats.ino }
		: undefined;
}

/** `root` and each directory of `prefix` below it, or undefined when one is a link or not a directory. */
export async function dirChain(root: string, prefix: string): Promise<SeenDir[] | undefined> {
	const segments = prefix === '' || prefix === '.' ? [] : prefix.split('/');
	const chain: SeenDir[] = [];
	for (let index = 0; index <= segments.length; index++) {
		const dir = await seenDir(join(root, ...segments.slice(0, index)));
		if (!dir) return undefined;
		chain.push(dir);
	}
	return chain;
}

/** Whether each directory is still the real one listed: not a link, the same device and inode. */
export async function dirsUnchanged(dirs: readonly SeenDir[]): Promise<SeenRead> {
	for (const { path, dev, ino } of dirs) {
		let stats: BigIntStats;
		try {
			stats = await lstatExact(path);
		} catch (cause) {
			return failure(cause);
		}
		if (!stats.isDirectory() || stats.isSymbolicLink() || stats.dev !== dev || stats.ino !== ino)
			return { ok: false, changed: true };
	}
	return { ok: true };
}

/**
 * Reads the file `lstat` saw as `seen`, reached through `dirs`: each directory checked before the open and after the
 * read; the file opened without following a link (`O_NOFOLLOW`, and `O_NONBLOCK` so a FIFO swapped in does not hold
 * the open; Windows has neither, and is held by the identity) and read only while its handle is a regular file with
 * the same device, inode and size, and only that many bytes. Each chunk goes to `use`.
 */
export async function readSeen(
	source: string,
	seen: SeenFile,
	use: (chunk: Buffer) => void,
	dirs: readonly SeenDir[] = []
): Promise<SeenRead> {
	const before = await dirsUnchanged(dirs);
	if (!before.ok) return before;
	let handle: FileHandle;
	try {
		handle = await open(
			source,
			constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
		);
	} catch (cause) {
		return failure(cause);
	}
	try {
		const opened = await handle.stat({ bigint: true });
		if (
			!opened.isFile() ||
			opened.ino !== seen.ino ||
			opened.dev !== seen.dev ||
			opened.size !== seen.size
		)
			return { ok: false, changed: true };
		const size = Number(seen.size);
		let read = 0;
		const chunk = Buffer.alloc(Math.min(Math.max(size, 1), 1024 * 1024));
		// One byte past the size is asked for, so a file that grew since is seen to.
		while (read <= size) {
			const { bytesRead } = await handle.read(chunk, 0, chunk.length, read);
			if (bytesRead === 0) break;
			read += bytesRead;
			if (read > size) break;
			use(chunk.subarray(0, bytesRead));
		}
		if (read !== size) return { ok: false, changed: true };
	} catch (cause) {
		return failure(cause);
	} finally {
		await handle.close();
	}
	return dirsUnchanged(dirs);
}

/** `readSeen`'s bytes. */
export async function bytesSeen(
	source: string,
	seen: SeenFile,
	dirs: readonly SeenDir[] = []
): Promise<{ ok: true; bytes: Buffer } | Exclude<SeenRead, { ok: true }>> {
	const chunks: Buffer[] = [];
	const read = await readSeen(source, seen, (chunk) => chunks.push(Buffer.from(chunk)), dirs);
	return read.ok ? { ok: true, bytes: Buffer.concat(chunks) } : read;
}
