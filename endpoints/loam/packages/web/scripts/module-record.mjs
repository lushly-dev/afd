/**
 * recordModules: a Vite plugin that writes every source file a build put into its output, so the desktop's
 * third-party notices (`@lushly-dev/loam-desktop`'s `build:notices`, #2808) cover exactly the packages the shell
 * ships. It changes no output: the record is written beside `dist/`, never into it.
 *
 * Each chunk's `moduleIds` and each asset's `originalFileNames` (a font, the scoped-registry polyfill), with
 * slashes forward and any query dropped. Rolldown's and Vite's virtual modules (`\0rolldown/runtime.js`,
 * `\0vite/preload-helper.js`) stay as they are: the notices name their packages.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** The sorted, unique source files of a build's outputs, as `moduleIds` and `originalFileNames` give them. */
export function bundleModules(outputs, root) {
	const ids = new Set();
	const add = (id) => {
		const bare = id.split('?')[0];
		const path = bare.startsWith('\0') || isAbsolute(bare) ? bare : resolve(root, bare);
		ids.add(path.replaceAll('\\', '/'));
	};
	for (const item of outputs) {
		if (item.type === 'chunk') for (const id of item.moduleIds) add(id);
		else for (const name of item.originalFileNames ?? []) add(name);
	}
	return [...ids].sort();
}

/** `path` relative to `base`, with forward slashes; a virtual module (`\0...`) as it is. */
export function relativeTo(base, path) {
	if (path.startsWith('\0')) return path;
	return relative(base, path).split(sep).join('/');
}

/**
 * Writes `{ resolveFrom, modules }` to `file`: `resolveFrom` is the package that ran the build. Both are written
 * relative to the record's own folder, so the record names no machine's paths (the portability gate reads it) and
 * `readModuleRecord` (`@lushly-dev/loam-desktop`'s notices) resolves them back.
 */
export function writeModuleRecord(file, resolveFrom, modules) {
	const base = dirname(resolve(file));
	mkdirSync(base, { recursive: true });
	const record = {
		resolveFrom: relativeTo(base, resolve(resolveFrom)),
		modules: modules.map((id) => relativeTo(base, id)),
	};
	writeFileSync(file, `${JSON.stringify(record, null, '\t')}\n`);
}

export function recordModules(file, root) {
	return {
		name: 'loam-module-record',
		apply: 'build',
		generateBundle(_options, bundle) {
			writeModuleRecord(file, root, bundleModules(Object.values(bundle), root));
		},
	};
}
