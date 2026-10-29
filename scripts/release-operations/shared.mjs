import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

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
/** Repository snapshots have one tracked mirror exception; artifact inputs never opt in. */
export function repositoryEntry(root, file, { allowRepositoryMirror = true } = {}) {
	if (
		typeof file !== 'string' ||
		!file ||
		isAbsolute(file) ||
		file.includes('\\') ||
		file.split('/').some((part) => !part || part === '.' || part === '..')
	)
		throw new Error(`Unsafe repository path: ${file}`);
	let absolute = realpathSync(root),
		status;
	const parts = file.split('/');
	for (const [index, part] of parts.entries()) {
		absolute = join(absolute, part);
		status = lstatSync(absolute, { throwIfNoEntry: false });
		if (!status?.isSymbolicLink()) continue;
		const target = readlinkSync(absolute);
		if (
			!allowRepositoryMirror ||
			file !== '.codex/skills' ||
			index !== parts.length - 1 ||
			target !== '../.claude/skills'
		)
			throw new Error(`Symlink is not release input: ${file}`);
		const tracked = run('git', ['ls-files', '--stage', '-z', '--', file], root);
		if (!/^120000 [a-f0-9]+ 0\t\.codex\/skills\0$/.test(tracked))
			throw new Error(`Repository mirror must be a tracked symlink: ${file}`);
		return { absolute, kind: 'symlink', target };
	}
	return { absolute, kind: status ? 'file' : 'missing' };
}
export function entryHash(entry) {
	if (entry.kind === 'missing') return null;
	return entry.kind === 'symlink'
		? hash(JSON.stringify({ type: 'symlink', target: entry.target }))
		: hash(readFileSync(entry.absolute));
}
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
				return [file, entryHash(repositoryEntry(root, file))];
			})
		)
	);
}
export function tree(root, prefix = '', options = {}) {
	return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
		if (['.git', 'node_modules'].includes(entry.name)) return [];
		const file = prefix ? `${prefix}/${entry.name}` : entry.name;
		const input = repositoryEntry(root, file, { allowRepositoryMirror: false, ...options });
		if (entry.isDirectory()) return tree(root, file, options);
		return [[file, entryHash(input)]];
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
