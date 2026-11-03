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

// Hosts list every model-invocable skill's description in a shared budget (Claude Code
// about 1% of the context window, Codex about 2%) and drop entries once it overflows.
const listedFields = ['description', 'when_to_use'];
const maxDescription = 1024;

function blockScalar(indicator, lines, field, terminated) {
	const header = indicator.match(/^([>|])([-+]?)$/);
	if (!header || header[2] === '+')
		throw new Error(`Unsupported ${field} block scalar: ${indicator}`);
	// Clipping keeps the final line break only when the content has one.
	const broken = terminated || (lines.length > 0 && !lines.at(-1).trim());
	while (lines.length && !lines.at(-1).trim()) lines.pop();
	const indent = Math.min(
		...lines.filter((line) => line.trim()).map((line) => line.match(/^ */)[0].length)
	);
	if (!lines.length) return '';
	const body = lines.map((line) => line.slice(indent));
	if (header[1] === '>' && body.some((line) => /^\s/.test(line)))
		throw new Error(`Unsupported indented ${field} folding`);
	const text =
		header[1] === '|'
			? body.join('\n')
			: body.reduce(
					(result, line, index) =>
						index === 0
							? line
							: result + (line === '' ? '\n' : body[index - 1] === '' ? '' : ' ') + line,
					''
				);
	return header[2] === '-' || !broken ? text : `${text}\n`;
}

function scalar(value, lines, field, terminated) {
	if (/^[>|]/.test(value))
		return blockScalar(value.replace(/\s+#.*$/, ''), lines, field, terminated);
	if (value.startsWith('"') || value.startsWith("'")) {
		const quote = value[0];
		if (lines.length || value.length < 2 || !value.endsWith(quote))
			throw new Error(`Unsupported multi-line quoted ${field}`);
		return quote === '"' ? JSON.parse(value) : value.slice(1, -1).replaceAll("''", "'");
	}
	if (lines.some((line) => /^\s*(?:- |[\w-]+:\s)/.test(line)))
		throw new Error(`Expected a scalar ${field}`);
	return [value.replace(/\s+#.*$/, ''), ...lines.map((line) => line.trim())]
		.filter((part, index) => index === 0 || part)
		.join(' ')
		.trim();
}

/** The listed frontmatter scalars; any syntax outside this narrow subset fails closed. */
export function listingFields(text) {
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!match) return {};
	const lines = match[1].split(/\r?\n/);
	const fields = {};
	for (let index = 0; index < lines.length; index++) {
		const key = lines[index].match(/^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/);
		if (!key) continue;
		const continuation = [];
		while (index + 1 < lines.length && /^(?:\s|$)/.test(lines[index + 1]))
			continuation.push(lines[++index]);
		const [, field, value = ''] = key;
		if ([...listedFields, 'disable-model-invocation'].includes(field))
			fields[field] = scalar(value.trim(), continuation, field, index + 1 < lines.length);
	}
	return fields;
}

/** Characters a skill adds to the host listing; user-only skills are not listed. */
export function listingCharacters(text, skill) {
	const fields = listingFields(text);
	if (/^(?:true|True|TRUE)$/.test(fields['disable-model-invocation'] ?? '')) return 0;
	const size = listedFields.reduce((total, field) => total + (fields[field]?.length ?? 0), 0);
	if ((fields.description?.length ?? 0) > maxDescription)
		throw new Error(`Description over ${maxDescription} characters: ${skill}`);
	return size;
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

/**
 * Preflight all trees before writing; unknown consumer resources are never deleted.
 * Each profile's listing must fit its declared listingBudget (description characters).
 */
export async function syncProfiles(root, { write = false, onListing } = {}) {
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
		if (!Number.isSafeInteger(profile.listingBudget) || profile.listingBudget <= 0)
			throw new Error(`Profile listingBudget must be a positive integer: ${profileName}`);
		const listing = new Map();
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
			listing.set(override.name, listingCharacters(text, override.name));
		}
		for (const name of profile.local) {
			let text = '';
			try {
				text = await readFile(await inside(root, `${profile.root}/${name}/SKILL.md`), 'utf8');
			} catch (error) {
				if (error.code !== 'ENOENT') throw error;
			}
			listing.set(name, listingCharacters(text, name));
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
				if (file === 'SKILL.md')
					listing.set(entry.name, listingCharacters(expected.toString('utf8'), entry.name));
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
		const characters = [...listing.values()].reduce((total, size) => total + size, 0);
		if (characters > profile.listingBudget) {
			const largest = [...listing]
				.filter(([, size]) => size > 0)
				.sort(([, a], [, b]) => b - a)
				.slice(0, 3)
				.map(([name, size]) => `${name} (${size})`);
			throw new Error(
				`Skill listing over budget for ${profileName}: ${characters} description characters exceed listingBudget ${profile.listingBudget}. Shorten descriptions (largest: ${largest.join(', ')}) or remove skills that add no unique context.`
			);
		}
		onListing?.(profileName, { characters, budget: profile.listingBudget, skills: listing.size });
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
		const listings = [];
		const changes = await syncProfiles(fileURLToPath(new URL('..', import.meta.url)), {
			write,
			onListing: (profile, { characters, budget, skills }) =>
				listings.push(
					`Skill listing (${profile}): ${characters} of ${budget} description characters across ${skills} skills.`
				),
		});
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
		if (!args.includes('--json')) for (const line of listings) console.log(line);
		if (changes.length && !write) process.exitCode = 1;
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
