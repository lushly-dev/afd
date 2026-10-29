import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safePath } from '../release/control.mjs';

export const registryUrl = 'https://registry.npmjs.org';
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const run = (command, args, cwd) =>
	execFileSync(command, args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
export { safePath } from '../release/control.mjs';
export function sourceDigest(root, exclude = [], include = []) {
	const files = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root)
		.split('\0')
		.filter(Boolean)
		.filter((file) => !exclude.some((item) => file === item || file.startsWith(`${item}/`)))
		.filter(
			(file) =>
				!include.length || include.some((item) => file === item || file.startsWith(`${item}/`))
		);
	return hash(
		JSON.stringify(
			files.sort().map((file) => {
				const absolute = safePath(root, file);
				return [file, existsSync(absolute) ? hash(readFileSync(absolute)) : null];
			})
		)
	);
}
export function tree(root, prefix = '') {
	return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
		if (['.git', 'node_modules'].includes(entry.name)) return [];
		const file = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) return tree(root, file);
		if (lstatSync(join(root, file)).isSymbolicLink())
			throw new Error(`Symlink in release candidate: ${file}`);
		return [[file, hash(readFileSync(join(root, file)))]];
	});
}
export function readRegistry(name) {
	try {
		const result = JSON.parse(
			run('npm', ['view', name, 'versions', '--json', '--registry', registryUrl], process.cwd())
		);
		return { registry: 'npm', name, versions: Array.isArray(result) ? result : [result] };
	} catch (error) {
		let response;
		try {
			response = JSON.parse(error.stdout?.toString() || error.stderr?.toString());
		} catch {
			/* fail closed below */
		}
		if (response?.error?.code === 'E404') return { registry: 'npm', name, versions: [] };
		throw new Error(`Registry lookup failed for ${name}: ${error.message}`);
	}
}

export { registryNames } from './prerequisites.mjs';
