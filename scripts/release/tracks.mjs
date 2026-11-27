/**
 * The release tracks that Changesets versions and something else publishes.
 *
 * Python, Botcore, the Rust crate and the contract have no npm package. Each has a private stub `package.json`
 * that holds its version, so a pull request records its change as one file in `.changeset/`
 * instead of a line every other pull request also inserts in the same changelog. `pnpm
 * version-track <track>` (scripts/release-track.mjs) consumes the fragments. This module is the
 * tracks and the text they are written in; it reads and writes nothing.
 */

/** Keep a Changelog's headings, in the order a dated section prints them: breaking first. */
export const CATEGORIES = [
	'Breaking changes',
	'Added',
	'Changed',
	'Deprecated',
	'Removed',
	'Fixed',
	'Security',
];

export const TRACKS = {
	python: {
		package: 'afd-python',
		unit: 'afd-python-changes',
		directory: 'python',
		format: 'keep-a-changelog',
		tagPrefix: 'python-v',
		// The section opens by naming the contract the release implements (cut-release).
		contractLine: true,
		versionFiles: [
			{ file: 'python/pyproject.toml', kind: 'pyproject' },
			{ file: 'python/src/afd/__init__.py', kind: 'dunder' },
		],
	},
	botcore: {
		package: 'lushly-botcore',
		unit: 'botcore-changes',
		directory: 'endpoints/botcore',
		format: 'keep-a-changelog',
		tagPrefix: 'botcore-v',
		versionFiles: [
			{ file: 'endpoints/botcore/pyproject.toml', kind: 'pyproject' },
			{ file: 'endpoints/botcore/src/botcore/__init__.py', kind: 'dunder' },
		],
		// An imported unit: every file the version step rewrites is recorded again.
		provenance: 'scripts/record_provenance.py',
		provenanceRecords: 'provenance/adaptations.json',
	},
	rust: {
		package: 'afd-rust',
		unit: 'afd-rust-changes',
		directory: 'packages/rust',
		format: 'keep-a-changelog',
		tagPrefix: 'rust-v',
		// Each section names the contract the release implements, as Python's does (cut-release).
		contractLine: true,
		versionFiles: [{ file: 'packages/rust/Cargo.toml', kind: 'cargo' }],
		// Every Cargo.lock that builds this crate from its path records its version too, and
		// `cargo --locked` refuses one that disagrees: the version step rewrites each it finds.
		cargoCrate: 'afd',
	},
	spec: {
		package: 'afd-spec',
		unit: 'afd-spec-changes',
		directory: 'spec',
		// Prose under the contract version's heading. The stub's number only counts folds: the
		// contract version is spec/VERSION, which no version step writes.
		format: 'contract-prose',
		contractVersionFile: 'spec/VERSION',
		versionFiles: [],
	},
};

export const stubFile = (track) => `${track.directory}/package.json`;
export const changelogFile = (track) => `${track.directory}/CHANGELOG.md`;
export const trackOfPackage = (name, tracks = TRACKS) =>
	Object.entries(tracks).find(([, track]) => track.package === name)?.[0] ?? null;

const fail = (message) => {
	throw new Error(message);
};
const lf = (text) => text.replace(/\r\n/g, '\n');

/** A fragment's text after its frontmatter. */
export function fragmentBody(text) {
	return lf(text)
		.replace(/^---\n(?:[\s\S]*?\n)?---(?:\n|$)/, '')
		.trim();
}

/** Lines outside fenced code, with their numbers: a `# comment` in a code block is no heading. */
function proseLines(body) {
	const fence = fences();
	return body.split('\n').flatMap((line, index) => (fence(line) ? [] : [{ line, index }]));
}

/**
 * A line reader that says whether a line is a code fence or inside one. A fence closes only on its
 * own character, at least as long: `~~~` inside a backtick fence is text.
 */
export function fences() {
	let open = null;
	return (line) => {
		const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
		if (open) {
			if (marker && marker[0] === open[0] && marker.length >= open.length) open = null;
			return true;
		}
		if (marker) open = marker;
		return Boolean(marker);
	};
}

/**
 * A fragment's entries by category: `{ intro, sections }`. The body is written as it will read in
 * the changelog, so each entry sits under one of Keep a Changelog's `### ` headings, and text
 * before the first heading is a sentence for the release's introduction.
 */
export function parseEntries(body, where = 'fragment') {
	const lines = body.split('\n');
	const prose = proseLines(body);
	const shallow = prose.find(({ line }) => /^#{1,2}\s/.test(line));
	if (shallow)
		fail(`${where} has a "${shallow.line.trim()}" heading; a fragment's headings are "### "`);
	const headings = prose
		.filter(({ line }) => /^###\s/.test(line))
		.map(({ line, index }) => {
			const written = line.replace(/^###\s+/, '').trim();
			const category = CATEGORIES.find((name) => name.toLowerCase() === written.toLowerCase());
			if (!category)
				fail(`${where} has the heading "### ${written}"; use ${CATEGORIES.join(', ')}`);
			return { category, index };
		});
	if (!headings.length)
		fail(
			`${where} needs its entries under a heading: ${CATEGORIES.map((name) => `### ${name}`).join(', ')}`
		);
	const sections = new Map();
	headings.forEach(({ category, index }, position) => {
		const end = headings[position + 1]?.index ?? lines.length;
		const text = lines
			.slice(index + 1, end)
			.join('\n')
			.trim();
		if (!text) fail(`${where} has nothing under "### ${category}"`);
		sections.set(category, sections.has(category) ? `${sections.get(category)}\n\n${text}` : text);
	});
	return { intro: lines.slice(0, headings[0].index).join('\n').trim(), sections };
}

/**
 * A fragment for a track names that track alone, checked wherever fragments are read: each track is
 * versioned by its own step, which consumes whole fragments, and a fragment shared with an npm
 * package would tie that package's release to the track's. `packages` is the frontmatter,
 * `[{ name, type }]`. A fragment that names no track is left alone.
 */
export function assertTrackOwnership(path, packages, tracks = TRACKS) {
	const named = packages.filter(({ name }) => trackOfPackage(name, tracks));
	if (named.length && packages.length !== 1)
		fail(
			`${path} names ${packages.map(({ name }) => name).join(', ')}; a fragment for ${named[0].name} names only it, so write one fragment per track and another for the npm packages`
		);
}

/**
 * The rules a track fragment's bump and entry keep. The check and the track's version step apply
 * them; the npm release does not, so a track's prose can never stop an npm release.
 */
export function assertTrackEntry(path, packages, text, { tracks = TRACKS, stubVersion } = {}) {
	const named = packages.filter(({ name }) => trackOfPackage(name, tracks));
	if (!named.length) return;
	const track = tracks[trackOfPackage(named[0].name, tracks)];
	const body = fragmentBody(text);
	if (!body) fail(`${path} has no entry`);
	if (track.format === 'contract-prose') {
		if (named[0].type !== 'patch')
			fail(
				`${path} bumps ${track.package} by ${named[0].type}; use patch. Its number only counts changelog folds, and the contract version changes in ${track.contractVersionFile}`
			);
		const heading = proseLines(body).find(({ line }) => /^#{1,6}\s/.test(line));
		if (heading) fail(`${path} has a heading; a contract entry is prose paragraphs`);
	} else {
		parseEntries(body, path);
		// Before 1.0 a breaking change is a minor release; `major` would make the track 1.0.0.
		const current = stubVersion?.(stubFile(track));
		if (named[0].type === 'major' && (!current || /^0\./.test(current)))
			fail(
				`${path} bumps ${track.package} by major, which would release 1.0.0; before 1.0 a breaking change is minor`
			);
	}
}

/** The dated section a Keep a Changelog track gets, from its fragments' bodies in file order. */
export function renderSection({ version, date, bodies, contract }) {
	const entries = bodies.map((body, index) => parseEntries(body, `fragment ${index + 1}`));
	const parts = [`## [${version}] - ${date}`];
	if (contract) parts.push(`Implements AFD contract \`${contract}\`.`);
	parts.push(...entries.map((entry) => entry.intro).filter(Boolean));
	for (const category of CATEGORIES) {
		const texts = entries.map((entry) => entry.sections.get(category)).filter(Boolean);
		if (texts.length) parts.push(`### ${category}`, texts.join('\n\n'));
	}
	return parts.join('\n\n');
}

const UNRELEASED = /^## \[Unreleased\][ \t]*$/m;
const SECTION = /^## /m;

/**
 * The `## ` headings after `## [Unreleased]`, as `{ text, version, line }`: `version` is the one a
 * heading opens with (`## [1.2.3] - 2026-01-02`), or null for any other heading.
 */
export function releaseHeadings(changelog) {
	const lines = lf(changelog).split('\n');
	const start = lines.findIndex((line) => UNRELEASED.test(line));
	const fence = fences();
	return lines.flatMap((text, index) => {
		if (fence(text) || index <= start || !/^## /.test(text)) return [];
		const version = text.match(/^## \[(\d+\.\d+\.\d+)\]/)?.[1] ?? null;
		return [{ text, version, line: index + 1 }];
	});
}

/** What sits under `## [Unreleased]`: `{ body, line }`, the line being that of its first content. */
export function unreleasedBody(changelog) {
	const text = lf(changelog);
	const heading = text.match(UNRELEASED);
	if (!heading) return null;
	const start = heading.index + heading[0].length;
	const next = text.slice(start).search(SECTION);
	const body = next < 0 ? text.slice(start) : text.slice(start, start + next);
	// Link definitions close the file when no section follows the heading.
	const content = body.replace(/^\[[^\]]+\]:\s+\S+[ \t]*$/gm, '');
	const offset = content.search(/\S/);
	return {
		body: content.trim(),
		line: offset < 0 ? null : text.slice(0, start + offset).split('\n').length,
	};
}

/**
 * A Keep a Changelog file with the new dated section under an empty `## [Unreleased]`, and its
 * compare links, where the file keeps them, moved on to the new tag.
 */
export function releaseChangelog(changelog, { section, version, tagPrefix }) {
	const text = lf(changelog);
	const unreleased = unreleasedBody(text);
	if (!unreleased) fail('The changelog has no "## [Unreleased]" heading');
	if (unreleased.body)
		fail(
			`The changelog has entries under "## [Unreleased]" (line ${unreleased.line}); move each to a fragment in .changeset/ first`
		);
	if (new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(text))
		fail(`The changelog already has a section for ${version}`);
	let result = text.replace(UNRELEASED, (heading) => `${heading}\n\n${section}`);
	const link = new RegExp(
		`^\\[Unreleased\\]:[ \\t]+(\\S+)/compare/${tagPrefix}(\\S+?)\\.\\.\\.(\\S+)[ \\t]*$`,
		'm'
	);
	if (/^\[Unreleased\]:/m.test(result) && !link.test(result))
		fail(
			`The changelog's [Unreleased] link does not compare ${tagPrefix}X.Y.Z with a branch, so it cannot be moved on; fix the link first`
		);
	result = result.replace(
		link,
		(_, base, previous, head) =>
			`[Unreleased]: ${base}/compare/${tagPrefix}${version}...${head}\n` +
			`[${version}]: ${base}/compare/${tagPrefix}${previous}...${tagPrefix}${version}`
	);
	return result;
}

/**
 * The contract changelog with the fragments' paragraphs first under the heading of the contract
 * version in force, which is created above the earlier versions when it is not there yet.
 */
export function foldContractChangelog(changelog, { contract, bodies }) {
	const text = lf(changelog);
	const entries = bodies.join('\n\n');
	const escaped = contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const heading = text.match(new RegExp(`^## ${escaped}[ \\t]*$`, 'm'));
	if (heading) {
		const end = heading.index + heading[0].length;
		return `${text.slice(0, end)}\n\n${entries}${text.slice(end)}`;
	}
	const first = text.search(/^## \d/m);
	if (first < 0) return `${text.trimEnd()}\n\n## ${contract}\n\n${entries}\n`;
	return `${text.slice(0, first)}## ${contract}\n\n${entries}\n\n${text.slice(first)}`;
}

/** The TOML table each manifest kind states its version in. */
const VERSION_TABLES = { pyproject: 'project', cargo: 'package' };
const TOML_VERSION = /^version\s*=\s*"([^"]*)"/;
const DUNDER_VERSION = /^__version__\b[^=\n]*=\s*(['"])([^'"\n]*)\1/;

/**
 * The index of the line that states the version, or -1: `version = "…"` in the manifest's table
 * (`[project]` for `pyproject`, `[package]` for `cargo`), `__version__ = '…'` for `dunder`, and for
 * `cargo-lock` the `version` of the `[[package]]` entry named `crate` that has no `source`, the
 * crate built from its path rather than downloaded from a registry.
 */
function versionLine(lines, kind, crate) {
	if (kind === 'dunder') return lines.findIndex((line) => DUNDER_VERSION.test(line));
	if (kind === 'cargo-lock') {
		const starts = lines.flatMap((line, index) => (/^\s*\[/.test(line) ? [index] : []));
		for (const [position, start] of starts.entries()) {
			if (!/^\[\[package\]\]\s*$/.test(lines[start])) continue;
			const end = starts[position + 1] ?? lines.length;
			const body = lines.slice(start + 1, end);
			if (!body.includes(`name = "${crate}"`) || body.some((line) => /^source\s*=/.test(line)))
				continue;
			const at = body.findIndex((line) => TOML_VERSION.test(line));
			return at < 0 ? -1 : start + 1 + at;
		}
		return -1;
	}
	const table = VERSION_TABLES[kind];
	if (!table) fail(`Unknown version file kind: ${kind}`);
	let inTable = false;
	return lines.findIndex((line) => {
		// A table or an array-of-tables header (`[[bin]]`), with an optional comment after it.
		const header = line.match(/^\s*(\[\[?)([^\]]+)\]\]?\s*(?:#.*)?$/);
		if (header) inTable = header[1] === '[' && header[2].trim() === table;
		return inTable && TOML_VERSION.test(line);
	});
}

/** `text` with its version set: see `versionLine` for where each kind states it. */
export function setVersion(text, kind, version, file, crate) {
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const lines = text.split(/\r?\n/);
	const index = versionLine(lines, kind, crate);
	if (index < 0) fail(`${file} states no version to set`);
	lines[index] =
		kind === 'dunder'
			? lines[index].replace(/(['"])[^'"]*\1/, `$1${version}$1`)
			: lines[index].replace(/"[^"]*"/, `"${version}"`);
	return lines.join(eol);
}

/** The version `text` states, or null. */
export function readVersion(text, kind, crate) {
	const lines = text.split(/\r?\n/);
	const index = versionLine(lines, kind, crate);
	if (index < 0) return null;
	return (
		(kind === 'dunder'
			? lines[index].match(DUNDER_VERSION)?.[2]
			: lines[index].match(TOML_VERSION)?.[1]) ?? null
	);
}

/** Whether an `ignore` pattern is only a name with `*` for part of it, which `ignores` can read. */
export const plainPattern = (pattern) => !/[!?{}[\]()]/.test(pattern);

/** Whether a Changesets `ignore` pattern, a name with `*` for part of one, matches `name`. */
export function ignores(pattern, name) {
	const expression = pattern
		.split('*')
		.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
		.join('[^/]*');
	return new RegExp(`^${expression}$`).test(name);
}
