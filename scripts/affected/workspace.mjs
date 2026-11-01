/**
 * Reads the pnpm workspace graph from pnpm-workspace.yaml and package manifests, without
 * installed dependencies, so CI can decide what to run before `pnpm install`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

/** Workspace globs from pnpm-workspace.yaml (`packages:` list, one entry per line). */
export function workspaceGlobs(text) {
	const globs = [];
	let inPackages = false;
	for (const line of text.split(/\r?\n/)) {
		if (/^\S/.test(line)) inPackages = /^packages:\s*$/.test(line);
		const entry = inPackages && line.match(/^\s+-\s+["']?([^"'#]+?)["']?\s*(#.*)?$/);
		if (entry) globs.push(entry[1]);
	}
	return globs;
}

/** Expands a glob whose `*` segments match a single directory level. */
function expand(root, glob) {
	let dirs = [''];
	for (const segment of glob.split('/').filter(Boolean)) {
		dirs = dirs.flatMap((dir) => {
			if (segment !== '*') return [posix.join(dir, segment)];
			const absolute = join(root, dir);
			if (!existsSync(absolute)) return [];
			return readdirSync(absolute, { withFileTypes: true })
				.filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
				.map((entry) => posix.join(dir, entry.name));
		});
	}
	return dirs;
}

const DEPENDENCY_FIELDS = [
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies',
];

/**
 * Returns the named workspace packages (the root excluded) as `{ name, dir, dependencies }`,
 * where `dependencies` lists the workspace packages each one declares in any dependency field.
 */
export function readWorkspace(root) {
	const globs = workspaceGlobs(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'));
	const manifests = new Map();
	for (const dir of globs.flatMap((glob) => expand(root, glob))) {
		const file = join(root, dir, 'package.json');
		if (!existsSync(file) || manifests.has(dir)) continue;
		const manifest = JSON.parse(readFileSync(file, 'utf8'));
		if (manifest.name) manifests.set(dir, manifest);
	}
	const names = new Set([...manifests.values()].map((manifest) => manifest.name));
	return [...manifests]
		.map(([dir, manifest]) => ({
			name: manifest.name,
			dir,
			dependencies: [
				...new Set(
					DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})).filter(
						(name) => names.has(name) && name !== manifest.name
					)
				),
			].sort(),
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Follows `next(name)` edges from `start`, returning the start set plus everything reached. */
function closure(start, next) {
	const seen = new Set();
	const pending = [...start];
	while (pending.length > 0) {
		const name = pending.pop();
		if (seen.has(name)) continue;
		seen.add(name);
		pending.push(...next(name));
	}
	return seen;
}

/** The given packages and every workspace package that depends on them, directly or not. */
export function withDependents(packages, names) {
	const dependents = new Map(packages.map((pkg) => [pkg.name, []]));
	for (const pkg of packages)
		for (const dependency of pkg.dependencies) dependents.get(dependency).push(pkg.name);
	return closure(names, (name) => dependents.get(name) ?? []);
}

/** The given packages and every workspace package they depend on, directly or not. */
export function withDependencies(packages, names) {
	const byName = new Map(packages.map((pkg) => [pkg.name, pkg.dependencies]));
	return closure(names, (name) => byName.get(name) ?? []);
}
