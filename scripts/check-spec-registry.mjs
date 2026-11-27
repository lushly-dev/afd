#!/usr/bin/env node
/**
 * The contract registry's check and renderer (#1925).
 *
 * `spec/registry.json` assigns every file under `spec/`, every shared error code and every
 * capability ID to the core or to exactly one versioned profile (`spec/registry.md` says why).
 * This script fails when something has no owner or two, when an error code's `profile` in
 * `spec/vectors/error-codes.json` disagrees with the registry, when a profile's vectors are legacy
 * reference-generated, or when a profile's page claims to bind every implementation. It also
 * renders the tables that are read from the registry: the profile list in `spec/registry.md` and,
 * from the capability manifests (#1738), the core and the profiles each language implements in
 * `docs/language-parity.md`.
 *
 * Usage:
 *   node scripts/check-spec-registry.mjs           check the registry and the rendered tables
 *   node scripts/check-spec-registry.mjs --write   regenerate the rendered tables
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VECTOR_MANIFEST } from './check-vector-drift.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const OWNER_LISTS = Object.freeze(['pages', 'vectors', 'fixtures', 'conformance']);
const PROFILE_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+$/;
const EVERY_IMPLEMENTATION = /\bevery\s+(?:AFD\s+)?implementation\b/gi;
const PROFILE_LINE_WITHIN = 10;
const MARKER = (id, edge) => `<!-- generated:spec-registry:${id}:${edge} -->`;

export const RENDERED = Object.freeze([
	{ id: 'profiles', file: 'spec/registry.md', render: renderProfiles },
	{ id: 'languages', file: 'docs/language-parity.md', render: renderLanguages },
]);

function readJson(root, rel, problems) {
	const abs = join(root, rel);
	if (!existsSync(abs)) {
		problems.push(`${rel}: file is missing`);
		return null;
	}
	try {
		return JSON.parse(readFileSync(abs, 'utf8'));
	} catch (error) {
		problems.push(
			`${rel}: invalid JSON (${error instanceof Error ? error.message : String(error)})`
		);
		return null;
	}
}

/** The files under `dir` that git tracks or would add (ignored files are skipped); outside a repository, every file. */
function specFiles(root, dir) {
	try {
		const out = execFileSync(
			'git',
			['ls-files', '--cached', '--others', '--exclude-standard', '--', dir],
			{
				cwd: root,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
			}
		);
		const top = execFileSync('git', ['rev-parse', '--show-prefix'], {
			cwd: root,
			encoding: 'utf8',
		}).trim();
		if (top === '') return out.split('\n').filter((file) => file && existsSync(join(root, file)));
	} catch {
		// Not a repository: walk the directory.
	}
	return walk(root, dir);
}

function walk(root, dir) {
	const out = [];
	for (const name of readdirSync(join(root, dir))) {
		const rel = `${dir}/${name}`;
		if (statSync(join(root, rel)).isDirectory()) out.push(...walk(root, rel));
		else out.push(rel);
	}
	return out;
}

/** A glob with `*` matching within one path segment. */
export function globMatches(glob, path) {
	const pattern = glob
		.split('*')
		.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
		.join('[^/]*');
	return new RegExp(`^${pattern}$`).test(path);
}

/** Every owner in registry order: the core first, then each profile. */
export function owners(registry) {
	return [{ id: 'core', ...registry.core }, ...(registry.profiles ?? [])];
}

/** Load the registry, the error-code vector file and the capability manifests. */
export function load(root = REPO_ROOT) {
	const problems = [];
	const registry = readJson(root, 'spec/registry.json', problems);
	const errorCodes = readJson(root, 'spec/vectors/error-codes.json', problems);
	const catalog = readJson(root, 'spec/capabilities/catalog.json', problems);
	const manifests = new Map();
	for (const lang of catalog?.languages ?? []) {
		manifests.set(lang.id, readJson(root, `spec/capabilities/${lang.id}.json`, problems));
	}
	return { registry, errorCodes, catalog, manifests, problems };
}

function checkShape(registry, problems) {
	if (!registry || typeof registry !== 'object') {
		problems.push('spec/registry.json: top-level value must be an object');
		return false;
	}
	const ids = new Set();
	for (const owner of owners(registry)) {
		const where = owner.id === 'core' ? 'core' : `profile "${owner.id}"`;
		for (const list of [...OWNER_LISTS, 'errorCodes', 'capabilities']) {
			if (!Array.isArray(owner[list])) problems.push(`${where}: "${list}" must be an array`);
		}
		if (owner.id === 'core') continue;
		if (typeof owner.id !== 'string' || !PROFILE_ID.test(owner.id)) {
			problems.push(`${where}: "id" must be kebab-case`);
		}
		if (ids.has(owner.id)) problems.push(`${where}: listed twice`);
		ids.add(owner.id);
		if (typeof owner.title !== 'string' || !owner.title) problems.push(`${where}: needs a "title"`);
		if (typeof owner.version !== 'string' || !VERSION.test(owner.version)) {
			problems.push(`${where}: "version" must be MAJOR.MINOR`);
		}
		if (typeof owner.optIn !== 'string' || !owner.optIn) {
			problems.push(`${where}: needs an "optIn", the condition under which a server has it`);
		}
		if (!owner.pages?.length) problems.push(`${where}: needs at least one page`);
	}
	if (ids.has('core')) problems.push('profile "core": "core" is not a profile id');
	return problems.length === 0;
}

function checkFiles(root, registry, problems) {
	const ownerOf = new Map();
	for (const owner of owners(registry)) {
		for (const list of OWNER_LISTS) {
			for (const file of owner[list]) {
				if (!existsSync(join(root, file)))
					problems.push(`${owner.id} ${list}: ${file} does not exist`);
				if (ownerOf.has(file)) {
					problems.push(`${file}: owned by both ${ownerOf.get(file)} and ${owner.id}`);
				}
				ownerOf.set(file, owner.id);
			}
		}
	}
	const outside = registry.outsideContract?.files ?? [];
	for (const file of specFiles(root, 'spec')) {
		const isOutside = outside.some((glob) => globMatches(glob, file));
		if (isOutside && ownerOf.has(file)) {
			problems.push(`${file}: owned by ${ownerOf.get(file)} and listed outside the contract`);
		} else if (!isOutside && !ownerOf.has(file)) {
			problems.push(`${file}: has no owner in spec/registry.json`);
		}
	}
	return ownerOf;
}

/**
 * Resolve an entries path in a vector file: segments split by `/`, where `name[key=value]` picks
 * the element of array `name` whose `key` is `value`. Returns the array the path ends at.
 */
export function resolveEntries(json, path) {
	let node = json;
	for (const segment of path.split('/')) {
		const match = /^([^[\]]+)(?:\[([^=\]]+)=([^\]]+)\])?$/.exec(segment);
		if (!match || node === null || typeof node !== 'object') return undefined;
		const [, name, key, value] = match;
		node = node[name];
		if (key !== undefined) {
			if (!Array.isArray(node)) return undefined;
			node = node.find((item) => String(item?.[key]) === value);
		}
	}
	return node;
}

/** Check `parts`; returns the owners each file's parts give work to. */
function checkParts(root, registry, ownerOf, problems) {
	const ids = new Set(owners(registry).map((o) => o.id));
	const claimed = new Map();
	const partOwners = new Set();
	const claim = (where, owner) => {
		if (claimed.has(where) && claimed.get(where) !== owner) {
			problems.push(`parts: ${where} has two owners, ${claimed.get(where)} and ${owner}`);
		}
		claimed.set(where, owner);
		partOwners.add(owner);
	};
	for (const part of registry.parts ?? []) {
		const fileOwner = ownerOf.get(part.file);
		if (!fileOwner) {
			problems.push(`parts: ${part.file} is not owned by the core or a profile`);
			continue;
		}
		const json = readJson(root, part.file, problems);
		if (!json) continue;
		for (const [section, owner] of Object.entries(part.sections ?? {})) {
			if (!Object.hasOwn(json, section))
				problems.push(`parts: ${part.file} has no section "${section}"`);
			if (!ids.has(owner))
				problems.push(`parts: ${part.file} "${section}" names unknown owner "${owner}"`);
			if (owner === fileOwner)
				problems.push(`parts: ${part.file} "${section}" repeats the file's owner`);
			claim(`${part.file} "${section}"`, owner);
		}
		for (const rule of part.entries ?? []) {
			const items = resolveEntries(json, rule.path ?? '');
			if (!Array.isArray(items)) {
				problems.push(`parts: ${part.file} "${rule.path}" is not an array`);
				continue;
			}
			const names = new Set(items.map((item) => item?.[rule.key]));
			for (const [owner, list] of Object.entries(rule.owners ?? {})) {
				if (!ids.has(owner))
					problems.push(`parts: ${part.file} "${rule.path}" names unknown owner "${owner}"`);
				if (owner === fileOwner)
					problems.push(`parts: ${part.file} "${rule.path}" repeats the file's owner`);
				for (const name of list) {
					if (!names.has(name))
						problems.push(`parts: ${part.file} "${rule.path}" has no entry "${name}"`);
					claim(`${part.file} "${rule.path}" entry "${name}"`, owner);
				}
			}
		}
	}
	return partOwners;
}

/** A profile shows its shared cases: a file of its own, a part of another's, or the issue adding them. */
function checkEvidence(registry, partOwners, problems) {
	for (const profile of registry.profiles ?? []) {
		const owns = ['vectors', 'fixtures', 'conformance'].some((list) => profile[list]?.length);
		if (owns || partOwners.has(profile.id)) {
			if (profile.pendingVectors !== undefined) {
				problems.push(`profile "${profile.id}": has shared cases, so drop "pendingVectors"`);
			}
			continue;
		}
		if (
			typeof profile.pendingVectors !== 'string' ||
			!/^https:\/\/github\.com\/.+\/issues\/\d+$/.test(profile.pendingVectors)
		) {
			problems.push(
				`profile "${profile.id}": has no vectors, fixtures, conformance cases or parts; add them, or name the issue that adds them in "pendingVectors"`
			);
		}
	}
}

function checkErrorCodes(registry, errorCodes, problems) {
	const ownerOf = new Map();
	for (const owner of owners(registry)) {
		for (const code of owner.errorCodes) {
			if (ownerOf.has(code))
				problems.push(`error code ${code}: owned by both ${ownerOf.get(code)} and ${owner.id}`);
			ownerOf.set(code, owner.id);
		}
	}
	const inFile = new Set();
	for (const entry of errorCodes?.codes ?? []) {
		inFile.add(entry.code);
		const owner = ownerOf.get(entry.code);
		if (!owner) problems.push(`error code ${entry.code}: has no owner in spec/registry.json`);
		else if (entry.profile !== owner) {
			problems.push(
				`error code ${entry.code}: spec/vectors/error-codes.json says profile "${entry.profile}", the registry says "${owner}"`
			);
		}
	}
	for (const code of ownerOf.keys()) {
		if (!inFile.has(code))
			problems.push(`error code ${code}: in the registry but not in spec/vectors/error-codes.json`);
	}
}

function checkCapabilities(registry, catalog, problems) {
	const ownerOf = new Map();
	const claim = (id, owner) => {
		if (ownerOf.has(id))
			problems.push(`capability ${id}: owned by both ${ownerOf.get(id)} and ${owner}`);
		ownerOf.set(id, owner);
	};
	for (const owner of owners(registry)) for (const id of owner.capabilities) claim(id, owner.id);
	for (const id of registry.outsideContract?.capabilities ?? []) claim(id, 'outside the contract');
	const known = new Set((catalog?.capabilities ?? []).map((cap) => cap.id));
	for (const id of known) {
		if (!ownerOf.has(id)) problems.push(`capability ${id}: has no owner in spec/registry.json`);
	}
	for (const id of ownerOf.keys()) {
		if (!known.has(id)) problems.push(`capability ${id}: not in spec/capabilities/catalog.json`);
	}
}

function checkProfiles(root, registry, problems) {
	for (const profile of registry.profiles ?? []) {
		for (const file of ['vectors', 'fixtures', 'conformance'].flatMap(
			(list) => profile[list] ?? []
		)) {
			const name = file.startsWith('spec/vectors/') ? file.slice('spec/vectors/'.length) : null;
			if (name && VECTOR_MANIFEST[name]?.kind === 'reference-generated') {
				problems.push(
					`profile "${profile.id}": ${file} is legacy reference-generated; a profile's vectors are specification-authored or format-generated`
				);
			}
		}
		for (const page of profile.pages) {
			if (!existsSync(join(root, page))) continue;
			const text = readFileSync(join(root, page), 'utf8');
			const opening = text.split('\n').slice(0, PROFILE_LINE_WITHIN).join('\n');
			if (!opening.includes(`Profile: \`${profile.id}\``)) {
				problems.push(
					`${page}: a profile's page names its profile in its first ${PROFILE_LINE_WITHIN} lines ("Profile: \`${profile.id}\`")`
				);
			}
			// Pages are hard-wrapped, so match across line breaks and report the line a match starts on.
			for (const match of text.matchAll(EVERY_IMPLEMENTATION)) {
				const line = text.slice(0, match.index).split('\n').length;
				problems.push(
					`${page}:${line}: says "every implementation" on a profile's page; say it of the profile's implementations`
				);
			}
		}
	}
}

/** One language's state on one owner: every required capability `yes`, some, or none. */
export function ownerStatus(owner, manifest) {
	const statuses = owner.capabilities.map((id) => manifest?.capabilities?.[id]?.status);
	const yes = statuses.filter((s) => s === 'yes').length;
	if (statuses.length === 0) return 'Not tracked';
	if (statuses.every((s) => s === 'na')) return 'N/A';
	// N/A is a capability that does not apply to the language by design (an HTTP-only client in a
	// server-only crate), so it never holds a language back from an owner it otherwise has.
	if (yes > 0 && statuses.every((s) => s === 'yes' || s === 'na')) return 'Yes';
	if (statuses.some((s) => s === 'yes' || s === 'partial')) {
		const applicable = statuses.filter((s) => s !== 'na').length;
		return applicable > 1 ? `Partial (${yes} of ${applicable})` : 'Partial';
	}
	return 'No';
}

function link(path, fromFile) {
	const rel = relative(dirname(fromFile), path).split(sep).join('/');
	return rel.startsWith('.') ? rel : `./${rel}`;
}

function renderProfiles(loaded, file) {
	const { registry } = loaded;
	const lines = [
		'| Profile | Version | Applies to | Pages | Error codes |',
		'| --- | --- | --- | --- | --- |',
	];
	for (const p of registry.profiles) {
		const pages = p.pages
			.map((page) => `[\`${page.split('/').pop()}\`](${link(page, file)})`)
			.join(', ');
		const codes = p.errorCodes.length ? p.errorCodes.map((c) => `\`${c}\``).join(', ') : 'None';
		lines.push(`| \`${p.id}\` | ${p.version} | ${p.optIn} | ${pages} | ${codes} |`);
	}
	return lines;
}

function renderLanguages(loaded) {
	const { registry, catalog, manifests, version } = loaded;
	const langs = catalog.languages;
	const lines = [
		`|  | ${langs.map((l) => l.displayName).join(' | ')} |`,
		`| --- | ${langs.map(() => '---').join(' | ')} |`,
	];
	for (const owner of owners(registry)) {
		const label = owner.id === 'core' ? `Core ${version}` : `\`${owner.id}\` ${owner.version}`;
		lines.push(
			`| ${label} | ${langs.map((l) => ownerStatus(owner, manifests.get(l.id))).join(' | ')} |`
		);
	}
	return lines;
}

function replaceRegion(text, id, body, file, problems) {
	const start = MARKER(id, 'start');
	const end = MARKER(id, 'end');
	const s = text.indexOf(start);
	const e = text.indexOf(end);
	if (s < 0 || e < s) {
		problems.push(`${file}: needs the markers ${start} and ${end}`);
		return text;
	}
	return `${text.slice(0, s + start.length)}\n${body.join('\n')}\n${text.slice(e)}`;
}

/** Check everything; with `write`, regenerate the rendered tables first. */
export function checkSpecRegistry(root = REPO_ROOT, { write = false } = {}) {
	const loaded = load(root);
	const { registry, errorCodes, catalog, problems } = loaded;
	if (!checkShape(registry, problems)) return { problems, written: [] };
	const versionPath = join(root, 'spec/VERSION');
	loaded.version = existsSync(versionPath) ? readFileSync(versionPath, 'utf8').trim() : '?';
	const ownerOf = checkFiles(root, registry, problems);
	const partOwners = checkParts(root, registry, ownerOf, problems);
	checkEvidence(registry, partOwners, problems);
	checkErrorCodes(registry, errorCodes, problems);
	checkCapabilities(registry, catalog, problems);
	checkProfiles(root, registry, problems);

	const written = [];
	if (catalog) {
		for (const table of RENDERED) {
			const abs = join(root, table.file);
			if (!existsSync(abs)) {
				problems.push(`${table.file}: file is missing`);
				continue;
			}
			const text = readFileSync(abs, 'utf8');
			const next = replaceRegion(
				text,
				table.id,
				table.render(loaded, table.file),
				table.file,
				problems
			);
			if (next === text) continue;
			if (write) {
				writeFileSync(abs, next);
				written.push(table.file);
			} else {
				problems.push(
					`${table.file}: the ${table.id} table is out of date; run node scripts/check-spec-registry.mjs --write`
				);
			}
		}
	}
	return { problems, written };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { problems, written } = checkSpecRegistry(REPO_ROOT, {
		write: process.argv.includes('--write'),
	});
	for (const file of written) console.log(`  ✎ Updated ${file}`);
	if (problems.length) {
		for (const problem of problems) console.error(`check-spec-registry: ${problem}`);
		console.error(`check-spec-registry: ${problems.length} problem(s)`);
		process.exit(1);
	}
	console.log('check-spec-registry: every spec file, error code and capability has one owner');
}
