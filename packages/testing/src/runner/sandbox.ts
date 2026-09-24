/**
 * @lushly-dev/afd-testing - Path containment
 *
 * Resolves paths against a root directory and rejects any that escape it,
 * lexically (`..`, absolute paths) or through a symlinked parent.
 */

import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Thrown when a path resolves outside the directory it must stay in. */
export class PathOutsideRootError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PathOutsideRootError';
	}
}

function isInside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * The real path of `target`, following symlinks in its nearest existing
 * ancestor (the target itself may not exist yet, e.g. a file to be written).
 */
function realpathOfNearestExisting(target: string): string {
	try {
		return realpathSync(target);
	} catch {
		const parent = dirname(target);
		if (parent === target) {
			return target;
		}
		return join(realpathOfNearestExisting(parent), basename(target));
	}
}

/**
 * Resolve `value` against `root` and make sure the result stays inside it.
 *
 * @param root - Directory the path must stay inside
 * @param value - Relative or absolute path
 * @param label - What the path is, for the error message (e.g. "output")
 * @returns The absolute path
 * @throws PathOutsideRootError when the path leaves `root`, including via a
 *   symlinked parent directory
 */
export function resolveInsideRoot(root: string, value: string, label: string): string {
	const rootPath = resolve(root);
	const target = resolve(rootPath, value);
	if (
		!isInside(rootPath, target) ||
		!isInside(realpathOfNearestExisting(rootPath), realpathOfNearestExisting(target))
	) {
		const shown = value.length > 200 ? `${value.slice(0, 200)}...` : value;
		throw new PathOutsideRootError(`${label} '${shown}' resolves outside the allowed directory`);
	}
	return target;
}
