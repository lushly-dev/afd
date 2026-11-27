#!/usr/bin/env node
/**
 * One maturity ladder and one map for the repository (#2473).
 *
 * The source is `scripts/release/inventory.json`: every release unit names its `maturity`, and
 * `map` arranges the parts a reader meets by what the reader wants to do. Each part's status is
 * the most mature of its units. This script checks every surface that states a status against it:
 *
 *   - the inventory itself: a published word on a published unit, the npm tag and version shape
 *     each word implies, and the PyPI `Development Status` classifier each word maps to;
 *   - the generated blocks (the README's map and ladder, and llms.txt's map), between
 *     `<!-- generated:maturity:<name>:start -->` and `:end -->` markers;
 *   - every README table row and llms.txt line that names a part, which must state its word;
 *   - every site element carrying `data-maturity="<part>"`, whose text must open with its word.
 *     A `family-status` label without the attribute is refused, so a new one cannot drift.
 *
 * Usage:
 *   node scripts/maturity.mjs             check every surface (offline)
 *   node scripts/maturity.mjs --write     regenerate the marked blocks, then check
 *   node scripts/maturity.mjs --registry  also compare published units with npm, PyPI and crates.io
 *
 * `--registry` reads the network, so it is not part of `pnpm check`: a registry outage must not
 * block a merge. An unreachable registry is reported as unchecked, not as a failure.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { parse as parseToml } from 'smol-toml';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The ladder, most mature first. The words and meanings are fixed (#2473). */
export const LADDER = Object.freeze([
	{
		id: 'stable',
		label: 'Stable',
		meaning:
			'published on the default tag at 1.0 or later, on a final (not release-candidate) AFD contract; breaking changes only in a major version.',
		classifier: 'Development Status :: 5 - Production/Stable',
		published: true,
	},
	{
		id: 'beta',
		label: 'Beta',
		meaning:
			"published on the registry's default tag; breaking changes only in a major version (below 1.0, the minor is the major).",
		classifier: 'Development Status :: 4 - Beta',
		published: true,
	},
	{
		id: 'preview',
		label: 'Preview',
		meaning: 'published, on npm only under the `preview` tag; may change in any release.',
		classifier: 'Development Status :: 3 - Alpha',
		published: true,
	},
	{
		id: 'in-development',
		label: 'In development',
		meaning: 'built and tested here, not published.',
		classifier: 'Development Status :: 2 - Pre-Alpha',
		published: false,
	},
	{
		id: 'internal',
		label: 'Internal',
		meaning: "this repository's own tooling, not offered for use elsewhere.",
		// Internal units are never published, so no PyPI reader sees a classifier on them.
		classifier: null,
		published: false,
	},
]);

const RUNG = new Map(LADDER.map((rung, index) => [rung.id, { ...rung, index }]));
const LABEL_RE = new RegExp(`^(${LADDER.map((rung) => rung.label).join('|')})\\b`);
const MARKER_RE = /<!--\s*generated:maturity:([a-z-]+):(start|end)\s*-->/g;

export function rung(id) {
	const found = RUNG.get(id);
	if (!found) throw new Error(`Unknown maturity: ${id}`);
	return found;
}

/** Resolves each part's units and status, with an error for each gap in the map's coverage. */
export function resolveMap(inventory) {
	const errors = [];
	const units = new Map(inventory.units.map((unit) => [unit.id, unit]));
	for (const unit of inventory.units) {
		if (!RUNG.has(unit.maturity))
			errors.push(`${unit.id}: maturity must be one of the ladder's ids`);
	}
	if (!Array.isArray(inventory.map?.groups) || inventory.map.groups.length === 0)
		return { groups: [], parts: [], errors: [...errors, 'inventory.map.groups is missing'] };
	const owner = new Map();
	const parts = [];
	const groups = inventory.map.groups.map((group) => {
		const resolved = [];
		for (const part of group.parts ?? []) {
			const members = [
				...(part.units ?? []).map((id) => {
					if (!units.has(id)) errors.push(`map part ${part.id} names an unknown unit: ${id}`);
					return units.get(id);
				}),
				...inventory.units.filter((unit) => (part.families ?? []).includes(unit.family)),
			].filter(Boolean);
			if (members.length === 0) errors.push(`map part ${part.id} has no units`);
			for (const unit of members) {
				if (owner.has(unit.id) && owner.get(unit.id) !== part.id)
					errors.push(`${unit.id} belongs to two map parts: ${owner.get(unit.id)} and ${part.id}`);
				owner.set(unit.id, part.id);
			}
			const ranked = members.filter((unit) => RUNG.has(unit.maturity));
			const best = ranked.reduce(
				(top, unit) => (top && rung(top.maturity).index <= rung(unit.maturity).index ? top : unit),
				undefined
			);
			const entry = { ...part, group: group.id, members, maturity: best?.maturity ?? 'internal' };
			resolved.push(entry);
			parts.push(entry);
		}
		return { ...group, parts: resolved };
	});
	for (const unit of inventory.units) {
		if (!owner.has(unit.id) && unit.maturity !== 'internal')
			errors.push(`${unit.id} is in no map part; only an internal unit may stay off the map`);
	}
	return { groups, parts, errors };
}

/** A manifest's parsed form and version, for each format the release inventory names. */
export function readManifest(root, distribution) {
	const file = join(root, distribution.manifest);
	if (!existsSync(file)) return undefined;
	const text = readFileSync(file, 'utf8');
	if (distribution.format === 'npm') {
		const manifest = JSON.parse(text);
		return { manifest, version: manifest.version };
	}
	if (distribution.format === 'python' || distribution.format === 'rust') {
		const manifest = parseToml(text);
		const section = distribution.format === 'python' ? manifest.project : manifest.package;
		return { manifest, version: section?.version };
	}
	if (distribution.format === 'cpp')
		return {
			manifest: {},
			version: text.match(/\bproject\s*\(\s*[\w-]+\s+VERSION\s+([\d.]+)/m)?.[1],
		};
	return { manifest: {}, version: undefined };
}

/** The inventory's own consistency: each word against state, route, tag, version and classifier. */
export function checkInventory(root, inventory) {
	const errors = [];
	const contract = existsSync(join(root, 'spec/VERSION'))
		? readFileSync(join(root, 'spec/VERSION'), 'utf8').trim()
		: undefined;
	for (const unit of inventory.units) {
		if (!RUNG.has(unit.maturity)) continue;
		const word = rung(unit.maturity);
		const admitted = unit.state === 'admitted';
		// A held unit is paused mid-release: it may already be on its registry, or not yet.
		if (unit.state !== 'held' && word.published !== admitted)
			errors.push(
				`${unit.id}: "${word.label}" says ${word.published ? 'published' : 'not published'}, but the unit is ${unit.state}`
			);
		const npm = unit.distributions.some((distribution) => distribution.registry === 'npm');
		if (admitted && npm) {
			if (word.id === 'preview' && unit.distTag !== 'preview')
				errors.push(`${unit.id}: a Preview npm unit publishes under the preview tag`);
			if ((word.id === 'beta' || word.id === 'stable') && unit.distTag !== undefined)
				errors.push(`${unit.id}: a ${word.label} npm unit publishes on the default tag`);
		}
		if (word.id === 'stable' && (!contract || contract.includes('-')))
			errors.push(`${unit.id}: Stable needs a final AFD contract; spec/VERSION is ${contract}`);
		for (const distribution of unit.distributions) {
			if (distribution.private) continue;
			const read = readManifest(root, distribution);
			if (!read) {
				errors.push(`${distribution.manifest}: the manifest is missing`);
				continue;
			}
			const { manifest, version } = read;
			if (distribution.format === 'npm' && admitted) {
				const prerelease = semver.prerelease(version) ?? [];
				if (word.id === 'preview' && prerelease[0] !== 'preview')
					errors.push(
						`${distribution.manifest}: a Preview version is x.y.z-preview.N, not ${version}`
					);
				if ((word.id === 'beta' || word.id === 'stable') && prerelease.length > 0)
					errors.push(
						`${distribution.manifest}: a ${word.label} version has no prerelease, not ${version}`
					);
			}
			if (word.id === 'stable') {
				const parsed = semver.coerce(version);
				// A release is digits and dots alone: `-preview.1` (npm) and `rc1` (PEP 440) are not.
				if (!parsed || parsed.major < 1 || !/^\d+(\.\d+)*$/.test(version ?? ''))
					errors.push(
						`${distribution.manifest}: Stable needs a 1.0 or later release, not ${version}`
					);
			}
			if (distribution.format === 'python' && word.classifier) {
				const statuses = (manifest.project?.classifiers ?? []).filter((classifier) =>
					classifier.startsWith('Development Status ::')
				);
				// A published package states its word; an unpublished one may omit it, never contradict it.
				const omitted = statuses.length === 0 && !word.published;
				if (!omitted && (statuses.length !== 1 || statuses[0] !== word.classifier))
					errors.push(
						`${distribution.manifest}: "${word.label}" maps to "${word.classifier}", found ${JSON.stringify(statuses)}`
					);
			}
		}
	}
	return errors;
}

const mermaidId = (id) => id.replace(/[^a-z0-9]/gi, '');

/** The generated blocks, keyed by marker name and file. */
export function renderBlocks(map) {
	const nodes = map.groups.map((group) =>
		[
			`    subgraph ${mermaidId(group.id)}["${group.label}"]`,
			'        direction TB',
			...group.parts.map(
				(part) =>
					`        ${mermaidId(part.id)}["${part.name}<br/><em>${rung(part.maturity).label}</em>"]`
			),
			'    end',
		].join('\n')
	);
	const standalone = map.parts.filter((part) => part.standalone).map((part) => mermaidId(part.id));
	const readmeMap = [
		'```mermaid',
		'graph LR',
		...nodes,
		...(standalone.length
			? [
					'    classDef standalone stroke-dasharray: 5 4',
					`    class ${standalone.join(',')} standalone`,
				]
			: []),
		'```',
		'',
		`Each box shows its status. A dashed box's foundation packages depend on nothing in AFD (\`pnpm check:boundaries\` enforces it), so it can be adopted on its own; its CLI, server and AFD-command packages add AFD on top.`,
	].join('\n');
	const readmeLadder = [
		'| Status | What it means |',
		'|--------|---------------|',
		...LADDER.map((word) => {
			const parts = map.parts.filter((part) => part.maturity === word.id).map((part) => part.name);
			return `| **${word.label}** | ${word.meaning[0].toUpperCase()}${word.meaning.slice(1)} ${parts.length ? `Now: ${parts.join(', ')}.` : 'None yet.'} |`;
		}),
	].join('\n');
	const llmsMap = [
		...map.groups.map((group) => {
			const items = group.parts.map((part) => `${part.name} (${rung(part.maturity).label})`);
			const alone = group.parts.every((part) => part.standalone)
				? "; each one's foundation packages depend on nothing in AFD"
				: '';
			return `- ${group.label}: ${items.join(', ')}${alone}`;
		}),
		'',
		`Status words. ${LADDER.map((word) => `${word.label}: ${word.meaning}`).join(' ')}`,
	].join('\n');
	return {
		'README.md': { map: readmeMap, ladder: readmeLadder },
		'site/llms.txt': { map: llmsMap },
	};
}

/** Replaces or checks every marked block in `text`. Returns the new text and any errors. */
export function applyBlocks(text, blocks, file) {
	const errors = [];
	const seen = new Set();
	let output = '';
	let cursor = 0;
	const matches = [...text.matchAll(MARKER_RE)];
	for (let index = 0; index < matches.length; index++) {
		const start = matches[index];
		if (start[2] !== 'start') {
			errors.push(`${file}: an end marker without a start: ${start[1]}`);
			continue;
		}
		const end = matches[index + 1];
		if (!end || end[1] !== start[1] || end[2] !== 'end') {
			errors.push(`${file}: the ${start[1]} block has no matching end marker`);
			continue;
		}
		index++;
		const name = start[1];
		if (!(name in blocks)) {
			errors.push(`${file}: unknown generated block: ${name}`);
			continue;
		}
		seen.add(name);
		output += `${text.slice(cursor, start.index + start[0].length)}\n${blocks[name]}\n`;
		cursor = end.index;
	}
	output += text.slice(cursor);
	for (const name of Object.keys(blocks))
		if (!seen.has(name)) errors.push(`${file}: the generated:maturity:${name} block is missing`);
	return { output, errors };
}

const plain = (cell) =>
	cell
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[*_`]/g, '')
		.trim();

/** README table rows whose first cell is a part's name must carry exactly that part's word. */
export function checkReadmeRows(text, parts) {
	const errors = [];
	const byName = new Map(parts.map((part) => [part.name, part]));
	const found = new Set();
	for (const line of text.split('\n')) {
		if (!line.startsWith('|')) continue;
		const cells = line.split(/(?<!\\)\|/).slice(1, -1);
		const part = byName.get(plain(cells[0] ?? ''));
		if (!part) continue;
		found.add(part.id);
		const expected = rung(part.maturity).label;
		const words = cells
			.slice(1)
			.map(
				(cell) =>
					plain(cell)
						.replace(/^[^\p{L}]+/u, '')
						.match(LABEL_RE)?.[1]
			)
			.filter(Boolean);
		if (words.length !== 1 || words[0] !== expected)
			errors.push(
				`README.md: the ${part.name} row states ${JSON.stringify(words)}, expected "${expected}"`
			);
	}
	for (const part of parts)
		if (!found.has(part.id))
			errors.push(`README.md: no table row names ${part.name} with its status`);
	return errors;
}

/**
 * llms.txt states each part outside the build group on a `- [Name](...)` line with
 * `Status: <word>.` The four AFD libraries appear there by package name instead, under
 * Install and Packages, and the generated map states their words.
 */
export function checkLlmsLines(text, parts) {
	const errors = [];
	const lines = text.split('\n');
	for (const part of parts) {
		const prefix = `- [${part.name}](`;
		const matching = lines.filter((line) => line.startsWith(prefix));
		if (matching.length === 0 && part.group !== 'build')
			errors.push(`site/llms.txt: no "${prefix}" line states ${part.name}'s status`);
		for (const line of matching) {
			const stated = line.match(/Status: ([^.]+)\./)?.[1];
			if (stated !== rung(part.maturity).label)
				errors.push(
					`site/llms.txt: the ${part.name} line says Status: ${stated}, expected ${rung(part.maturity).label}`
				);
		}
	}
	return errors;
}

function htmlFiles(dir) {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...htmlFiles(full));
		else if (entry.name.endsWith('.html')) out.push(full);
	}
	return out;
}

/**
 * A label's words, for comparison only (never rendered): markup is cut until none is left, so
 * a tag that nesting splits (`<<b>i>`) leaves no `<` behind, and whitespace is collapsed.
 */
export function visibleText(html) {
	let text = html;
	for (let previous; previous !== text; ) {
		previous = text;
		text = text.replace(/<[^<>]*>/g, '');
	}
	return text.replaceAll('<', '').replace(/\s+/g, ' ').trim();
}

const STATUS_CLASS = /\bclass="(?:[^"]*\s)?(family-status|edition)(?:\s[^"]*)?"/;

/**
 * Each element carrying `data-maturity` opens with its part's word, however deeply it is
 * nested; every `.family-status` and `.edition` label carries one. Returns the errors and
 * the number of labels checked.
 */
export function checkSiteText(file, text, parts) {
	const errors = [];
	let checked = 0;
	const byId = new Map(parts.map((part) => [part.id, part]));
	for (const open of text.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
		const [, tag, attributes] = open;
		const id = attributes.match(/\bdata-maturity="([^"]+)"/)?.[1];
		const status = attributes.match(STATUS_CLASS)?.[1];
		if (status && !id)
			errors.push(
				`${file}: a .${status} label has no data-maturity attribute (data-maturity="none" marks one that is not a status)`
			);
		if (!id || id === 'none') continue;
		const part = byId.get(id);
		if (!part) {
			errors.push(`${file}: data-maturity names an unknown part: ${id}`);
			continue;
		}
		const start = open.index + open[0].length;
		const end = text.indexOf(`</${tag}`, start);
		const content = visibleText(text.slice(start, end < 0 ? start : end));
		const expected = rung(part.maturity).label;
		checked++;
		if (content.match(LABEL_RE)?.[1] !== expected)
			errors.push(
				`${file}: the ${part.name} label reads "${content.slice(0, 40)}", expected it to open with "${expected}"`
			);
	}
	return { errors, checked };
}

export function checkRepository(root = REPO_ROOT, { write = false } = {}) {
	const inventory = JSON.parse(readFileSync(join(root, 'scripts/release/inventory.json'), 'utf8'));
	const map = resolveMap(inventory);
	const errors = [...map.errors];
	if (errors.length) return { errors, map };
	errors.push(...checkInventory(root, inventory));
	for (const [file, blocks] of Object.entries(renderBlocks(map))) {
		const path = join(root, file);
		const text = readFileSync(path, 'utf8');
		const { output, errors: blockErrors } = applyBlocks(text, blocks, file);
		errors.push(...blockErrors);
		if (output !== text) {
			if (write && blockErrors.length === 0) writeFileSync(path, output);
			else errors.push(`${file}: generated maturity blocks are stale; run pnpm maturity:sync`);
		}
	}
	errors.push(...checkReadmeRows(readFileSync(join(root, 'README.md'), 'utf8'), map.parts));
	errors.push(...checkLlmsLines(readFileSync(join(root, 'site/llms.txt'), 'utf8'), map.parts));
	let labels = 0;
	for (const file of htmlFiles(join(root, 'site'))) {
		const site = checkSiteText(
			relative(root, file).replaceAll('\\', '/'),
			readFileSync(file, 'utf8'),
			map.parts
		);
		labels += site.checked;
		errors.push(...site.errors);
	}
	if (labels === 0) errors.push('site/: no data-maturity labels found');
	return { errors, map, inventory };
}

async function fetchJson(url) {
	try {
		const response = await fetch(url, {
			headers: { 'user-agent': 'afd-maturity-check', accept: 'application/json' },
		});
		if (response.status === 404) return { missing: true };
		if (!response.ok) return { unreachable: `HTTP ${response.status}` };
		return { body: await response.json() };
	} catch (error) {
		return { unreachable: error.message };
	}
}

/** Compares each published unit with its registry. Returns errors, warnings and unchecked items. */
export async function checkRegistries(inventory) {
	const errors = [];
	const warnings = [];
	const unchecked = [];
	for (const unit of inventory.units) {
		const word = rung(unit.maturity);
		if (!word.published) continue;
		for (const distribution of unit.distributions) {
			if (distribution.private) continue;
			const { name, registry } = distribution;
			if (registry === 'npm') {
				const result = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
				if (result.unreachable) unchecked.push(`${name}: ${result.unreachable}`);
				else if (result.missing) errors.push(`${name}: not on npm`);
				else {
					const tags = result.body['dist-tags'] ?? {};
					const latest = result.body.versions?.[tags.latest];
					if (word.id === 'preview') {
						if (!tags.preview) errors.push(`${name}: Preview, but npm has no preview tag`);
						if (latest && !latest.deprecated && !semver.prerelease(tags.latest))
							errors.push(`${name}: Preview, but latest is ${tags.latest}, a release`);
						else if (latest?.deprecated)
							warnings.push(
								`${name}: latest is the deprecated placeholder ${tags.latest} (an owner step, #2766)`
							);
					} else if (
						!tags.latest ||
						latest?.deprecated ||
						semver.prerelease(tags.latest) ||
						(word.id === 'stable' && semver.major(tags.latest) < 1)
					)
						errors.push(`${name}: ${word.label}, but npm's latest is ${tags.latest ?? 'missing'}`);
				}
			} else if (registry === 'pypi') {
				const result = await fetchJson(`https://pypi.org/pypi/${name}/json`);
				if (result.unreachable) unchecked.push(`${name}: ${result.unreachable}`);
				else if (result.missing) errors.push(`${name}: not on PyPI`);
				else {
					const status = (result.body.info?.classifiers ?? []).find((c) =>
						c.startsWith('Development Status ::')
					);
					if (status !== word.classifier)
						errors.push(
							`${name}: PyPI ${result.body.info?.version} says "${status}", the ladder says "${word.classifier}" (fixed by the next release)`
						);
				}
			} else if (registry === 'crates') {
				const result = await fetchJson(`https://crates.io/api/v1/crates/${name}`);
				if (result.unreachable) unchecked.push(`${name}: ${result.unreachable}`);
				else if (result.missing) errors.push(`${name}: not on crates.io`);
				else if (word.id === 'beta' || word.id === 'stable') {
					const newest = result.body.crate?.max_stable_version;
					if (!newest || (word.id === 'stable' && semver.major(newest) < 1))
						errors.push(
							`${name}: ${word.label}, but crates.io's newest release is ${newest ?? 'missing'}`
						);
				}
			} else unchecked.push(`${name}: ${registry} has no registry to read (a git tag)`);
		}
	}
	return { errors, warnings, unchecked };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const args = process.argv.slice(2);
	const { errors, inventory } = checkRepository(REPO_ROOT, { write: args.includes('--write') });
	if (args.includes('--registry') && inventory) {
		const registry = await checkRegistries(inventory);
		errors.push(...registry.errors.map((error) => `registry: ${error}`));
		for (const warning of registry.warnings) console.warn(`warning: ${warning}`);
		for (const item of registry.unchecked) console.warn(`unchecked: ${item}`);
	}
	if (errors.length) {
		for (const error of errors) console.error(error);
		console.error(
			`maturity: ${errors.length} problem(s). The ladder and map live in scripts/release/inventory.json.`
		);
		process.exitCode = 1;
	} else
		console.log('maturity: every surface matches the ladder in scripts/release/inventory.json');
}
