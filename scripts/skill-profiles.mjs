#!/usr/bin/env node
/** Deterministic project installations; edit canonical sources, never projections. */
import { lstat, mkdir, readdir, readFile, readlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const textExtensions = new Set(['.md', '.txt', '.yaml', '.yml', '.json', '.toml']);

function relativePath(value) {
	if (
		typeof value !== 'string' ||
		!value ||
		value.includes('\\') ||
		value.split('/').some((part) => !part || part === '.' || part === '..') ||
		path.isAbsolute(value)
	) {
		throw new Error(`Expected a repository-relative path: ${value}`);
	}
	return value;
}

async function inside(root, relative) {
	const parts = relativePath(relative).split('/');
	let current = root;
	for (const part of parts) {
		current = path.join(current, part);
		try {
			if ((await lstat(current)).isSymbolicLink())
				throw new Error(`Symlink is not an authoring path: ${relative}`);
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
		}
	}
	return current;
}

async function files(directory) {
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (error.code === 'ENOENT') return [];
		throw error;
	}
	const result = [];
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		if (entry.isSymbolicLink())
			throw new Error(`Symlink in skill tree: ${directory}/${entry.name}`);
		if (entry.isDirectory()) {
			for (const child of await files(path.join(directory, entry.name)))
				result.push(`${entry.name}/${child}`);
		} else if (entry.isFile()) result.push(entry.name);
		else throw new Error(`Unsupported skill resource: ${directory}/${entry.name}`);
	}
	return result;
}

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function projectText(text, { name, canonical, rewrites = {} }, aliases, file) {
	// Paths and long skill identifiers are unambiguous. Ordinary words such as
	// commit/release/review are rewritten only by explicit per-file literals.
	for (const [source, alias] of aliases) {
		text = text.replace(
			new RegExp(`((?:skills/|\\.\\./))${escapeRegex(source)}(?=/)`, 'g'),
			`$1${alias}`
		);
		if (source.includes('-')) {
			text = text.replace(new RegExp(`\\x60${escapeRegex(source)}\\x60`, 'g'), `\`${alias}\``);
			text = text.replace(new RegExp(`(?<![\\w-])${escapeRegex(source)}(?= skill\\b)`, 'g'), alias);
		}
	}
	if (file === 'SKILL.md') {
		const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
		if (!match || !new RegExp(`^name: ${escapeRegex(canonical)}$`, 'm').test(match[1]))
			throw new Error(`Canonical frontmatter name mismatch: ${canonical}`);
		const frontmatter = match[0].replace(/^name: .+$/m, `name: ${name}`);
		text =
			frontmatter +
			`\n<!-- Generated from skills/exports.json; edit the canonical ${canonical} skill. -->\n` +
			text.slice(match[0].length);
		// Only this skill's own slash invocation, never unrelated command examples.
		text = text.replace(
			new RegExp(`\\x60/${escapeRegex(canonical)}(?=\\x60| )`, 'g'),
			`\`/${name}`
		);
	}
	for (const [from, to] of rewrites[file] ?? []) {
		if (!from || typeof to !== 'string' || !text.includes(from))
			throw new Error(`Stale explicit rewrite: ${name}/${file}: ${from}`);
		text = text.split(from).join(to);
	}
	return text;
}

/** Preflight all trees before writing; unknown consumer resources are never deleted. */
export async function syncProfiles(root, { write = false } = {}) {
	root = path.resolve(root);
	if ((await lstat(root)).isSymbolicLink())
		throw new Error('Repository root must not be a symlink');
	const manifest = JSON.parse(await readFile(await inside(root, 'skills/exports.json'), 'utf8'));
	if (
		manifest.version !== 1 ||
		manifest.canonical?.owner !== 'botcore' ||
		manifest.canonical.resources !== 'complete-tree'
	)
		throw new Error('Unsupported skill export manifest');
	const canonicalRoot = await inside(root, manifest.canonical.root);
	const catalog = manifest.canonical.skills;
	if (
		!Array.isArray(catalog) ||
		catalog.some((id) => !idPattern.test(id)) ||
		new Set(catalog).size !== catalog.length
	)
		throw new Error('Invalid canonical skill catalog');
	const actual = (await readdir(canonicalRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	if (JSON.stringify(actual) !== JSON.stringify([...catalog].sort()))
		throw new Error('Canonical catalog drift: update skills/exports.json');
	const changes = [];
	for (const [profileName, profile] of Object.entries(manifest.profiles)) {
		const destinationRoot = await inside(root, profile.root);
		const entries = [
			...profile.projections,
			...profile.overrides,
			...profile.local.map((name) => ({ name })),
		];
		if (
			entries.some((entry) => !idPattern.test(entry.name)) ||
			new Set(entries.map((entry) => entry.name)).size !== entries.length
		)
			throw new Error(`Invalid or duplicate profile entry: ${profileName}`);
		if (entries.some((entry) => entry.canonical && !catalog.includes(entry.canonical)))
			throw new Error(`Unknown canonical source: ${profileName}`);
		const aliases = entries
			.filter((entry) => entry.canonical)
			.map((entry) => [entry.canonical, entry.name]);
		if (new Set(aliases.map(([source]) => source)).size !== aliases.length)
			throw new Error(`Duplicate canonical alias: ${profileName}`);
		// The established Codex mirror is verified, never traversed or rewritten.
		if (profile.mirror) {
			const mirror = path.join(root, relativePath(profile.mirror));
			await inside(root, path.posix.dirname(profile.mirror));
			if (
				!(await lstat(mirror)).isSymbolicLink() ||
				path.resolve(path.dirname(mirror), await readlink(mirror)) !== destinationRoot
			)
				throw new Error(`Invalid skill mirror: ${profile.mirror}`);
		}
		const installed = await readdir(destinationRoot, { withFileTypes: true });
		for (const entry of installed) {
			if (entry.isSymbolicLink()) throw new Error(`Symlink in profile: ${entry.name}`);
			if (!entries.some(({ name }) => name === entry.name))
				throw new Error(
					`Unclassified local skill: ${entry.name}; add an explicit local/override entry`
				);
		}
		for (const override of profile.overrides) {
			if (override.owner !== 'afd')
				throw new Error(`Override ownership required: ${override.name}`);
			const source = await inside(root, `${profile.root}/${override.name}/SKILL.md`);
			const text = await readFile(source, 'utf8');
			if (!/^source: afd$/m.test(text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? ''))
				throw new Error(`Local override must declare source: afd: ${override.name}`);
		}
		for (const entry of profile.projections) {
			const source = await inside(root, `${manifest.canonical.root}/${entry.canonical}`);
			const destination = await inside(root, `${profile.root}/${entry.name}`);
			const sourceFiles = await files(source);
			if (!sourceFiles.includes('SKILL.md'))
				throw new Error(`Missing canonical SKILL.md: ${entry.canonical}`);
			for (const file of await files(destination)) {
				if (!sourceFiles.includes(file))
					throw new Error(
						`Unknown local resource: ${entry.name}/${file}; classify as an override before regeneration`
					);
			}
			for (const file of sourceFiles) {
				const original = await readFile(path.join(source, file));
				const expected = textExtensions.has(path.extname(file))
					? Buffer.from(projectText(original.toString('utf8'), entry, aliases, file))
					: original;
				const target = path.join(destination, file);
				let current;
				try {
					current = await readFile(target);
				} catch (error) {
					if (error.code !== 'ENOENT') throw error;
				}
				if (!current?.equals(expected)) changes.push({ path: target, content: expected });
			}
		}
	}
	if (write)
		for (const change of changes) {
			await mkdir(path.dirname(change.path), { recursive: true });
			await writeFile(change.path, change.content);
		}
	return changes.map((change) => path.relative(root, change.path));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const args = process.argv.slice(2);
		if (
			args.some((arg) => !['--write', '--check', '--json'].includes(arg)) ||
			new Set(args).size !== args.length ||
			(args.includes('--write') && args.includes('--check'))
		)
			throw new Error('Usage: node scripts/skill-profiles.mjs [--check|--write] [--json]');
		const write = args.includes('--write');
		const changes = await syncProfiles(fileURLToPath(new URL('..', import.meta.url)), { write });
		if (args.includes('--json')) {
			console.log(
				JSON.stringify({
					success: write || changes.length === 0,
					changed: changes,
					mode: write ? 'write' : 'check',
				})
			);
		} else if (changes.length) {
			console.log(
				`${write ? 'Generated' : 'Stale'} skill resources (${changes.length}):\n${changes.join('\n')}`
			);
		} else console.log('Skill profiles match canonical sources.');
		if (changes.length && !write) process.exitCode = 1;
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
