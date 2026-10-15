import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';

// Keep entrypoint discovery aligned with Convex 1.32.0's
// packages/auth/node_modules/convex/src/bundler/index.ts.
const entryPointExtensions = new Set([
	'.js',
	'.mjs',
	'.cjs',
	'.ts',
	'.tsx',
	'.mts',
	'.cts',
	'.jsx',
]);
const validModulePathComponent = /^[A-Za-z0-9_.]+$/;

export async function discoverConvexEntryPoints(directory) {
	const root = resolve(directory);
	const entryPoints = [];

	async function visit(currentDirectory) {
		const entries = await readdir(currentDirectory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));

		for (const entry of entries) {
			const absolutePath = join(currentDirectory, entry.name);
			const relativePath = relative(root, absolutePath);
			const modulePath = relativePath.split(sep).join('/');

			if (entry.isDirectory()) {
				if (!existsSync(join(absolutePath, 'convex.config.ts'))) {
					await visit(absolutePath);
				}
				continue;
			}
			if (!entry.isFile()) continue;

			if (relativePath.startsWith(`_deps${sep}`)) {
				throw new Error('Convex CLI rejects files in the reserved _deps directory');
			}

			const basename = entry.name;
			const extension = extname(basename);
			if (!entryPointExtensions.has(extension)) continue;
			if (relativePath.startsWith(`_generated${sep}`)) continue;
			if (basename.startsWith('.') || basename.startsWith('#')) continue;
			if (basename === 'schema.ts' || basename === 'schema.js') continue;
			if ((basename.match(/\./g) ?? []).length > 1) continue;
			if (relativePath.includes(' ')) continue;

			entryPoints.push(modulePath);
		}
	}

	await visit(root);
	return entryPoints.sort();
}

export function assertValidConvexModulePaths(entryPoints) {
	for (const entryPoint of entryPoints) {
		for (const component of entryPoint.split(/[\\/]/)) {
			if (!validModulePathComponent.test(component)) {
				throw new Error(
					`Convex module path component is not supported by the hosted deployment: ${component}`
				);
			}
		}
	}
	return entryPoints;
}

export async function checkConvexModulePaths(directory) {
	const entryPoints = await discoverConvexEntryPoints(directory);
	if (entryPoints.length === 0) {
		throw new Error('Convex backend contains no deployable modules');
	}
	return assertValidConvexModulePaths(entryPoints);
}
