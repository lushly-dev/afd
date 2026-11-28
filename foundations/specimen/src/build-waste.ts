import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, sep } from 'node:path';

/**
 * What the static build checks instead of the accessibility and total ceilings (#1072). Growth is
 * reported, never gated on: a dependency that grows for a good reason (axe-core 4.14.0 alone was
 * over the old 650,000-byte ceiling) still builds. What fails is waste, by a named cause:
 *
 * - `duplicated-module`: one module's code in more than one chunk. Rolldown gives each module one
 *   chunk, so this guards that invariant; the same code under two paths is `duplicated-package`;
 * - `duplicated-package`: one version of a package bundled from two installs, which deduping
 *   always fixes;
 * - `multiple-versions`: two versions of one package outside interaction support. The helpers'
 *   own ranges can force a split no consumer can fix (`@testing-library/dom` 10 asks
 *   `dom-accessibility-api` ^0.5.9 and `@testing-library/jest-dom` asks ^0.6.3; `pretty-format` 27
 *   asks `react-is` ^17 where a React consumer may bundle 16), so a split that holds at most one
 *   version outside them is reported in `advisories` instead;
 * - `eager-accessibility`: the accessibility engine in a chunk every case loads (an entry, a
 *   retained preview, a plugin, or what they import statically), rather than only in the cases
 *   that check accessibility;
 * - `eager-interaction`: interaction support (a play's helpers and the retained-story runtime) in
 *   a chunk every case loads, rather than only in the cases that run a play (#2633);
 * - `total-tripwire`: bench JavaScript (shell, interaction support and accessibility) past about
 *   twice what it measures, which only an accident reaches, such as a dependency imported whole.
 *
 * The shell's and the stylesheet's own ceilings are unchanged; interaction support has none (#2633).
 */

/**
 * About twice the bench's measured JavaScript: 1,327,581 bytes on the retained fixtures on
 * 2026-11-26 (shell 69,096, interaction 599,192, accessibility 659,293). Not a budget: no step
 * raises it, and nothing short of an accident comes near it.
 */
export const TOTAL_TRIPWIRE = 2_700_000;

/** The parts of a Rolldown output chunk the checks read. */
export interface WasteChunk {
	fileName: string;
	isEntry: boolean;
	/** Chunks it imports statically, which load with it. */
	imports: readonly string[];
	modules: Readonly<Record<string, { renderedLength: number }>>;
}

/** One module's rendered code in the build, as `specimen-build.json` lists it. */
export interface BuildModule {
	/** Machine-independent: `<package>@<version>/<path>` for a dependency, installed or linked
	 * from a workspace, `@lushly-dev/specimen/<path>`, or the module's path from the project root. */
	id: string;
	chunk: string;
	category: string;
	/** Rolldown's `renderedLength`: the module's code in its chunk before minification. */
	renderedBytes: number;
	/** The dependency it belongs to, from `node_modules` or a linked workspace package. */
	package?: { name: string; version: string };
}

/** One module's growth or shrinkage between two builds: advisory, never a failure. */
export interface BuildSizeDelta {
	/** The module's id without its package's version, so an upgrade is one row. */
	id: string;
	category: string;
	package?: string;
	/** The package's version in each build, when it changed. */
	versions?: { before?: string; after?: string };
	before: number;
	after: number;
	delta: number;
}

interface Identity {
	id: string;
	package?: { name: string; version: string; root: string };
}

/** Where a module id is read from: the bench's own source, the project and the build's site. */
export interface ModuleRoots {
	packageSource: string;
	projectRoot: string;
	siteRoot: string;
	/** Modules every case loads: a retained story's project annotations and the plugins. */
	alwaysLoaded?: readonly string[];
}

const NODE_MODULES = '/node_modules/';
const AXE = /\/node_modules\/axe-core\//;

const posix = (path: string) => path.split(sep).join('/');
// `relative` compares as the system does, case-insensitively on Windows, and takes either separator.
const inside = (root: string, path: string) => {
	const rel = relative(root, path);
	return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
const samePath = (a: string, b: string) => relative(a, b) === '';

/** The version a package's manifest names, or `unknown`. */
function versionAt(root: string, versions: Map<string, string>): string {
	let version = versions.get(root);
	if (version === undefined) {
		try {
			const named = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')).version;
			version = typeof named === 'string' && named ? named : 'unknown';
		} catch {
			version = 'unknown';
		}
		versions.set(root, version);
	}
	return version;
}

/**
 * The nearest directory above `path` with a named `package.json`: a linked workspace package. The
 * climb stops below a workspace or repository root, whose manifest names no package of the build.
 */
function packageAbove(
	path: string,
	names: Map<string, string | null>
): { root: string; name: string } | undefined {
	for (let dir = dirname(path); dir !== dirname(dir); dir = dirname(dir)) {
		if (existsSync(`${dir}/pnpm-workspace.yaml`) || existsSync(`${dir}/.git`)) return undefined;
		let name = names.get(dir);
		if (name === undefined) {
			try {
				const named = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')).name;
				name = typeof named === 'string' && named ? named : null;
			} catch {
				name = null;
			}
			names.set(dir, name);
		}
		if (name) return { root: dir, name };
	}
	return undefined;
}

/** A module id as the report names it, and the install it comes from. */
export function moduleIdentity(
	moduleId: string,
	roots: ModuleRoots,
	versions = new Map<string, string>(),
	names = new Map<string, string | null>()
): Identity {
	if (moduleId.startsWith('\0')) {
		const rest = moduleId.slice(1);
		// A virtual module named after a file keeps the file's machine-independent id.
		return {
			id: `virtual:${isAbsolute(rest) ? moduleIdentity(rest, roots, versions, names).id : rest}`,
		};
	}
	const [path = moduleId, query] = moduleId.split('?', 2);
	const suffix = query === undefined ? '' : `?${query}`;
	const at = path.lastIndexOf(NODE_MODULES);
	if (at >= 0) {
		const rest = path.slice(at + NODE_MODULES.length).split('/');
		const name = rest[0]?.startsWith('@') ? `${rest[0]}/${rest[1]}` : (rest[0] ?? '');
		const root = `${path.slice(0, at + NODE_MODULES.length)}${name}`;
		const version = versionAt(root, versions);
		const within = rest.slice(name.split('/').length).join('/');
		return { id: `${name}@${version}/${within}${suffix}`, package: { name, version, root } };
	}
	if (inside(roots.packageSource, path))
		return {
			id: `@lushly-dev/specimen/${posix(relative(roots.packageSource, path))}${suffix}`,
		};
	for (const [label, root] of [
		['', roots.projectRoot],
		['site:', roots.siteRoot],
	] as const)
		if (inside(root, path)) return { id: `${label}${posix(relative(root, path))}${suffix}` };
	// A workspace package linked from outside the project, as pnpm links one.
	const linked = isAbsolute(path) ? packageAbove(path, names) : undefined;
	if (linked) {
		const version = versionAt(linked.root, versions);
		return {
			id: `${linked.name}@${version}/${posix(relative(linked.root, path))}${suffix}`,
			package: { name: linked.name, version, root: linked.root },
		};
	}
	return { id: `${posix(path)}${suffix}` };
}

/**
 * Every rendered module with its chunk and category, sorted by id then chunk; the build's waste,
 * an empty list when there is none; and what is reported without failing.
 */
export function inspectBuild(
	chunks: readonly WasteChunk[],
	categoryOf: (fileName: string) => string,
	roots: ModuleRoots,
	total: number
): { modules: BuildModule[]; waste: string[]; advisories: string[] } {
	const versions = new Map<string, string>();
	const names = new Map<string, string | null>();
	const modules: BuildModule[] = [];
	const chunksOf = new Map<string, Set<string>>();
	const installs = new Map<string, Map<string, { version: string; categories: Set<string> }>>();
	for (const chunk of chunks)
		for (const [moduleId, { renderedLength }] of Object.entries(chunk.modules)) {
			if (renderedLength <= 0) continue;
			const identity = moduleIdentity(moduleId, roots, versions, names);
			const category = categoryOf(chunk.fileName);
			modules.push({
				id: identity.id,
				chunk: chunk.fileName,
				category,
				renderedBytes: renderedLength,
				...(identity.package && {
					package: { name: identity.package.name, version: identity.package.version },
				}),
			});
			const held = chunksOf.get(moduleId) ?? new Set<string>();
			held.add(chunk.fileName);
			chunksOf.set(moduleId, held);
			if (identity.package) {
				const { name, version, root } = identity.package;
				const copies = installs.get(name) ?? new Map();
				const copy = copies.get(root) ?? { version, categories: new Set<string>() };
				copy.categories.add(category);
				copies.set(root, copy);
				installs.set(name, copies);
			}
		}
	modules.sort((a, b) => compare(a.id, b.id) || compare(a.chunk, b.chunk));
	const waste: string[] = [];
	for (const [moduleId, held] of chunksOf)
		if (held.size > 1)
			waste.push(
				`duplicated-module: ${moduleIdentity(moduleId, roots, versions, names).id} is in ${[...held].sort().join(', ')}`
			);
	const advisories: string[] = [];
	for (const [name, copies] of installs) {
		const all = [...copies.values()];
		const found = [...new Set(all.map((copy) => copy.version))].sort(byVersion);
		for (const version of found) {
			const count = all.filter((copy) => copy.version === version).length;
			if (count > 1)
				waste.push(
					`duplicated-package: ${name}@${version} is bundled from ${count} installs; dedupe it to one`
				);
		}
		if (found.length < 2) continue;
		const line = `multiple-versions: ${name} is bundled at ${found.join(', ')}; align its dependents' ranges to share one`;
		// The versions bundled outside the helpers: two of them are a split the consumer owns.
		const outside = new Set(
			all
				.filter((copy) => [...copy.categories].some((category) => category !== 'interaction'))
				.map((copy) => copy.version)
		);
		(outside.size > 1 ? waste : advisories).push(line);
	}
	const always = roots.alwaysLoaded ?? [];
	const loadsWithEveryCase = (chunk: WasteChunk) =>
		chunk.isEntry ||
		Object.keys(chunk.modules).some((id) => {
			const file = id.split('?', 1)[0] as string;
			return isAbsolute(file) && always.some((path) => samePath(path, file));
		});
	for (const file of loadedWith(chunks, loadsWithEveryCase)) {
		const chunk = chunks.find((candidate) => candidate.fileName === file);
		const engine = Object.entries(chunk?.modules ?? {}).filter(
			([id, { renderedLength }]) => renderedLength > 0 && AXE.test(id)
		);
		if (engine.length)
			waste.push(
				`eager-accessibility: axe-core loads with every case, in ${file}; import it only where a case checks accessibility`
			);
		if (categoryOf(file) === 'interaction')
			waste.push(
				`eager-interaction: interaction support loads with every case, in ${file}; import a play's helpers only from the stories that run one`
			);
	}
	if (total > TOTAL_TRIPWIRE)
		waste.push(
			`total-tripwire: bench JavaScript is ${total} bytes, past ${TOTAL_TRIPWIRE}, about twice what it measures; look for a dependency imported whole or a data file the bench's own code imports`
		);
	return { modules, waste: waste.sort(), advisories: advisories.sort() };
}

/** The chunks every case loads, the roots `root` picks, and all they import statically. */
function loadedWith(chunks: readonly WasteChunk[], root: (chunk: WasteChunk) => boolean): string[] {
	const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
	const eager = new Set<string>();
	const pending = chunks.filter(root).map((chunk) => chunk.fileName);
	for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
		if (eager.has(file)) continue;
		eager.add(file);
		pending.push(...(byName.get(file)?.imports ?? []));
	}
	return [...eager].sort();
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Versions in numeric order, so 10.0.0 follows 9.0.0. */
const byVersion = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/** A module's id without its package's version, so two builds' copies of it compare. */
function deltaKey(module: BuildModule): string {
	if (!module.package) return module.id;
	const prefix = `${module.package.name}@${module.package.version}/`;
	return module.id.startsWith(prefix)
		? `${module.package.name}/${module.id.slice(prefix.length)}`
		: module.id;
}

/**
 * How each module's size moved between two builds' `specimen-build.json` reports, largest move
 * first; unchanged modules are left out. A module is matched without its package's version, so an
 * upgrade is one row with both versions. Advisory: a reviewer reads it to ask whether a new
 * dependency duplicates something already bundled, and nothing fails on it.
 */
export function buildSizeDeltas(
	before: { modules?: readonly BuildModule[] },
	after: { modules?: readonly BuildModule[] }
): BuildSizeDelta[] {
	const sizes = (modules: readonly BuildModule[] = []) => {
		const byKey = new Map<string, BuildModule & { total: number }>();
		for (const module of modules) {
			const key = deltaKey(module);
			const seen = byKey.get(key);
			byKey.set(key, { ...module, total: (seen?.total ?? 0) + module.renderedBytes });
		}
		return byKey;
	};
	const was = sizes(before.modules);
	const now = sizes(after.modules);
	const deltas: BuildSizeDelta[] = [];
	for (const id of new Set([...was.keys(), ...now.keys()])) {
		const old = was.get(id);
		const current = now.get(id);
		const delta = (current?.total ?? 0) - (old?.total ?? 0);
		const from = old?.package?.version;
		const to = current?.package?.version;
		if (!delta && from === to) continue;
		const module = (current ?? old) as BuildModule;
		deltas.push({
			id,
			category: module.category,
			...(module.package && { package: module.package.name }),
			...(from !== to && {
				versions: { ...(from && { before: from }), ...(to && { after: to }) },
			}),
			before: old?.total ?? 0,
			after: current?.total ?? 0,
			delta,
		});
	}
	return deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || compare(a.id, b.id));
}

const signed = (bytes: number) =>
	`${bytes > 0 ? '+' : bytes < 0 ? '−' : ''}${Math.abs(bytes).toLocaleString('en-US')}`;
/** A table cell's text: a backslash, then a pipe, escaped, so neither can end the cell. */
const cell = (text: string) => text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

/**
 * `buildSizeDeltas`' rows as Markdown for a reviewer (#2634): the net move per category, then the
 * largest moves module by module, each named as a dependency (with its version change) or as own
 * code. Advisory, like the rows: it states what moved and fails nothing.
 */
export function formatBuildSizeDeltas(
	deltas: readonly BuildSizeDelta[],
	options: { title?: string; base?: string; limit?: number } = {}
): string {
	const { title = 'Bench size against main', base, limit = 25 } = options;
	const lines = [`### ${title}`, ''];
	if (base) lines.push(`Compared with ${base}. Advisory: nothing fails on it.`, '');
	if (deltas.length === 0) {
		lines.push('No module changed size.');
		return `${lines.join('\n')}\n`;
	}
	const net = new Map<string, number>();
	for (const row of deltas) net.set(row.category, (net.get(row.category) ?? 0) + row.delta);
	lines.push('| Category | Net bytes |', '| --- | ---: |');
	for (const [category, bytes] of [...net].sort(([a], [b]) => compare(a, b)))
		lines.push(`| ${cell(category)} | ${signed(bytes)} |`);
	lines.push(
		'',
		'| Module | Source | Category | Before | After | Change |',
		'| --- | --- | --- | ---: | ---: | ---: |'
	);
	for (const row of deltas.slice(0, limit)) {
		const versions = row.versions
			? row.versions.before === undefined
				? `, new at ${row.versions.after}`
				: row.versions.after === undefined
					? `, removed at ${row.versions.before}`
					: ` ${row.versions.before} → ${row.versions.after}`
			: '';
		const source = row.package
			? `dependency ${row.package}${versions}`
			: row.before === 0
				? 'own code, new'
				: row.after === 0
					? 'own code, removed'
					: 'own code';
		lines.push(
			`| \`${cell(row.id)}\` | ${cell(source)} | ${cell(row.category)} | ${row.before.toLocaleString('en-US')} | ${row.after.toLocaleString('en-US')} | ${signed(row.delta)} |`
		);
	}
	const left = deltas.length - limit;
	if (left > 0) lines.push('', `${left} smaller ${left === 1 ? 'move' : 'moves'} left out.`);
	return `${lines.join('\n')}\n`;
}
