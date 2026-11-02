/**
 * @fileoverview The disk behind `checkApp`'s map, and the copies `app pack` and `deployment write`
 * make. A symbolic link is followed only while it stays inside the root it was found under.
 */

import { existsSync } from 'node:fs';
import {
	copyFile,
	lstat,
	mkdir,
	readdir,
	readFile,
	readlink,
	realpath,
	stat,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { AppTree } from './file-rules.js';

const SKIP = new Set(['node_modules', '.git']);

/**
 * Marks a directory `app pack` or `deployment write` made, which is all either will replace. Its name
 * is one nobody else writes: a file with a common name must not authorize a recursive delete.
 */
export const OUTPUT_MARKER = '.loam-output';

const slash = (path: string): string => path.split(sep).join('/');

/** Whether `path` is `root` or below it. Both are absolute. */
export function isWithin(path: string, root: string): boolean {
	const rel = relative(root, path);
	return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/** `realpath` of what exists of `path`, with the rest kept, so a path not created yet compares. */
export async function realish(path: string): Promise<string> {
	const absolute = resolve(path);
	try {
		return await realpath(absolute);
	} catch {
		const parent = dirname(absolute);
		if (parent === absolute) return absolute;
		return join(await realish(parent), relative(parent, absolute));
	}
}

/** A link's target, already followed to its end. Undefined when it leads to nothing. */
async function linkTarget(link: string): Promise<string | undefined> {
	try {
		return await realpath(link);
	} catch {
		return undefined;
	}
}

/**
 * Reads an app's source as `checkApp` wants it. What a link outside the root names is listed, empty
 * and unread, since the rules ask only whether it exists.
 */
export async function readAppTree(root: string): Promise<AppTree> {
	const realRoot = await realpath(root);
	const files: Record<string, string> = {};
	const symlinks: Record<string, string> = {};

	const walk = async (directory: string): Promise<void> => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const full = join(directory, entry.name);
			const path = slash(relative(realRoot, full));
			if (entry.isSymbolicLink()) {
				const target = await linkTarget(full);
				if (target === undefined) {
					const written = await readlink(full);
					symlinks[path] = isAbsolute(written)
						? slash(relative(directory, written))
						: slash(written);
					continue;
				}
				symlinks[path] = slash(relative(directory, target));
				const fromRoot = slash(relative(realRoot, target));
				if (!isWithin(target, realRoot)) files[fromRoot] = '';
				else if (fromRoot.split('/').some((part) => SKIP.has(part))) {
					files[fromRoot] = (await stat(target)).isFile() ? await readFile(target, 'utf8') : '';
				}
			} else if (entry.isDirectory()) {
				if (!SKIP.has(entry.name)) await walk(full);
			} else if (entry.isFile()) {
				files[path] = await readFile(full, 'utf8');
			}
		}
	};
	await walk(realRoot);
	return { files, symlinks };
}

export interface CopyOptions {
	/** Links must stay inside this directory. */
	root: string;
	/** Not copied, with everything below it. */
	skip?: string;
	/** Called with a link that leaves `root`, leads to nothing or loops, which is not copied. */
	onEscape(link: string): void;
}

/** The files below `from`, each with where it really is. Nothing is written. */
export async function listCopy(
	from: string,
	options: CopyOptions
): Promise<Array<{ source: string; path: string }>> {
	const copies: Array<{ source: string; path: string }> = [];
	const visit = async (full: string, path: string, within: readonly string[]): Promise<void> => {
		if (options.skip && isWithin(full, options.skip)) return;
		const info = await lstat(full);
		if (info.isSymbolicLink()) {
			const target = await linkTarget(full);
			if (target === undefined || !isWithin(target, options.root) || within.includes(target)) {
				options.onEscape(full);
				return;
			}
			await visit(target, path, within);
		} else if (info.isDirectory()) {
			const here = await realpath(full);
			const names = await readdir(full);
			// Another package left in the tree, such as hello's for another manifest, is not part of this.
			if (path !== '' && names.includes(OUTPUT_MARKER)) return;
			for (const name of names) {
				if (SKIP.has(name) || name === OUTPUT_MARKER) continue;
				await visit(join(full, name), path ? `${path}/${name}` : name, [...within, here]);
			}
		} else if (info.isFile()) {
			copies.push({ source: full, path });
		}
	};
	await visit(from, '', []);
	return copies;
}

/** Writes what `listCopy` listed below `to`. */
export async function copyListed(
	copies: ReadonlyArray<{ source: string; path: string }>,
	to: string
): Promise<void> {
	for (const { source, path } of copies) {
		const target = join(to, path);
		await mkdir(dirname(target), { recursive: true });
		await copyFile(source, target);
	}
}

/** Whether a directory is absent, empty or one this CLI wrote, so replacing it loses nothing. */
export async function replaceable(directory: string): Promise<boolean> {
	if (!existsSync(directory)) return true;
	const names = await readdir(directory);
	return names.length === 0 || names.includes(OUTPUT_MARKER);
}
