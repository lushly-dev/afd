/**
 * Lockfile-aware change detection for pnpm lockfile v9.
 *
 * A lockfile edit affects a workspace importer only when the resolved dependency closure of that
 * importer changes. Anything outside `importers`, `packages` and `snapshots` (settings, overrides,
 * patches, catalogs, the lockfile version) can affect every importer, so it is reported as global.
 * The parser reads the machine-written v9 layout line by line, so the scripts that use it need no
 * installed dependencies; an unrecognised layout is reported as global rather than guessed at.
 */

const STRUCTURED = new Set(['importers', 'packages', 'snapshots']);
const DEPENDENCY_GROUPS = new Set(['dependencies', 'devDependencies', 'optionalDependencies']);

const unquote = (value) => {
	const text = value.trim();
	if (text.length >= 2 && (text[0] === "'" || text[0] === '"') && text.at(-1) === text[0])
		return text.slice(1, -1).replaceAll("''", "'");
	return text;
};

/** Splits `key: value` at the first `: ` outside quotes. */
function splitEntry(line) {
	const text = line.trim();
	let quote = null;
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (quote) {
			if (char === quote) quote = null;
		} else if (char === "'" || char === '"') quote = char;
		else if (char === ':' && (index === text.length - 1 || text[index + 1] === ' '))
			return [unquote(text.slice(0, index)), text.slice(index + 1).trim()];
	}
	return [unquote(text), ''];
}

const indentOf = (line) => line.length - line.trimStart().length;

/** Parses entries at indent 2 of a section into `{ key, body, dependencies }`. */
function parseEntries(lines) {
	const entries = new Map();
	let current = null;
	let group = null;
	for (const line of lines) {
		if (line.trim() === '') continue;
		const indent = indentOf(line);
		if (indent === 2) {
			current = { body: [], dependencies: [] };
			entries.set(splitEntry(line)[0], current);
			group = null;
			continue;
		}
		if (!current || indent < 2) throw new Error(`unexpected lockfile line: ${line}`);
		current.body.push(line.trimEnd());
		if (indent === 4) group = DEPENDENCY_GROUPS.has(splitEntry(line)[0]) ? [] : null;
		if (indent === 4 && group) current.dependencies.push(group);
		if (indent === 6 && group) {
			const [name, value] = splitEntry(line);
			group.push({ name, version: value ? unquote(value) : null });
		}
		// Importers nest `version:` one level deeper than snapshots.
		if (indent === 8 && group && splitEntry(line)[0] === 'version')
			group.at(-1).version = unquote(splitEntry(line)[1]);
	}
	for (const entry of entries.values()) {
		entry.dependencies = entry.dependencies.flat();
		entry.body = entry.body.join('\n');
	}
	return entries;
}

/** Parses lockfile text into its sections. Throws on a layout the parser does not understand. */
export function parseLockfile(text) {
	const sections = new Map();
	let name = null;
	for (const line of text.replaceAll('\r\n', '\n').split('\n')) {
		if (line === '' || line.startsWith('#')) {
			if (name) sections.get(name).push(line);
			continue;
		}
		if (indentOf(line) === 0) {
			const [key, value] = splitEntry(line);
			name = key;
			sections.set(name, value ? [value] : []);
		} else if (name) sections.get(name).push(line);
		else throw new Error(`unexpected lockfile line: ${line}`);
	}
	const version = sections.get('lockfileVersion')?.[0];
	if (unquote(version ?? '') !== '9.0') throw new Error(`unsupported lockfile version ${version}`);
	const global = [...sections]
		.filter(([key]) => !STRUCTURED.has(key))
		.map(([key, lines]) => `${key}\n${lines.join('\n').trim()}`)
		.join('\n');
	return {
		global,
		importers: parseEntries(sections.get('importers') ?? []),
		packages: parseEntries(sections.get('packages') ?? []),
		snapshots: parseEntries(sections.get('snapshots') ?? []),
	};
}

/** Maps a dependency reference to its snapshot key, or null for workspace links. */
function snapshotKey(name, version) {
	if (!version || version.startsWith('link:')) return null;
	// Aliases resolve to `real-name@version`; plain references are bare versions.
	return /^[0-9]/.test(version) ? `${name}@${version}` : version;
}

const packageKey = (key) => {
	const peers = key.indexOf('(', 1);
	return peers === -1 ? key : key.slice(0, peers);
};

/** A string that changes exactly when the importer's resolved dependency closure changes. */
export function importerFingerprint(lock, path) {
	const importer = lock.importers.get(path);
	if (!importer) return null;
	const seen = new Set();
	const pending = importer.dependencies.map((dep) => snapshotKey(dep.name, dep.version));
	while (pending.length > 0) {
		const key = pending.pop();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		for (const dep of lock.snapshots.get(key)?.dependencies ?? [])
			pending.push(snapshotKey(dep.name, dep.version));
	}
	const closure = [...seen]
		.sort()
		.map(
			(key) =>
				`${key}\n${lock.snapshots.get(key)?.body ?? ''}\n${lock.packages.get(packageKey(key))?.body ?? ''}`
		);
	return [importer.body, ...closure].join('\n');
}

/**
 * Compares two lockfile texts. Returns `{ global: reason }` when every importer may be affected,
 * otherwise `{ importers: [...paths] }` naming the importers whose closure changed.
 */
export function changedImporters(baseText, headText) {
	if (baseText === headText) return { importers: [] };
	if (baseText === null || headText === null)
		return { global: 'pnpm-lock.yaml was added or removed' };
	let base;
	let head;
	try {
		base = parseLockfile(baseText);
		head = parseLockfile(headText);
	} catch (error) {
		return { global: `pnpm-lock.yaml could not be compared (${error.message})` };
	}
	if (base.global !== head.global)
		return { global: 'pnpm-lock.yaml settings, overrides or patches changed' };
	const paths = new Set([...base.importers.keys(), ...head.importers.keys()]);
	const importers = [...paths]
		.filter((path) => importerFingerprint(base, path) !== importerFingerprint(head, path))
		.sort();
	if (importers.includes('.'))
		return { global: 'pnpm-lock.yaml changed the root importer, which every package shares' };
	return { importers };
}
