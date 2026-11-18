#!/usr/bin/env node
/**
 * Resolves a merge whose only conflicts are imported units' provenance records.
 *
 * Every edit to FAST-AF, Specimen, Violet, Botcore or Health records itself in its unit's
 * `provenance/` directory: a row per file in `adaptations.json`, and in `provenance.json` the
 * sha256 of each manifest. Two branches that edit different files of one unit both change the
 * envelope's hash line, so their merge always conflicts, though nothing they recorded does
 * (lushly-dev/afd#1410). The factory lane runs this, as the adapter's `regenerate` command, in its
 * validation checkout while the merge of the base is still open:
 *
 *   node scripts/provenance-merge.mjs
 *
 * For each unit with an unmerged record it merges three ways, from the merge base, `HEAD` (the
 * branch) and `MERGE_HEAD` (the base): rows by `path`, every other value by its place in the
 * document. A row both sides changed records one file both edited, which git merged cleanly (or
 * the merge would conflict outside the records): its hash is read from the merged file and its
 * reasons are joined. Any other value both sides changed, differently, is a real conflict: the
 * script exits 1 naming it and writes nothing. Otherwise it writes the merged manifests, recomputes each
 * manifest's sha256 in `provenance.json`, copies Botcore's records to their packaged mirror and
 * stages the files. It touches nothing but records, and refuses an unmerged path that is not one.
 * The unit's own provenance tests then check the result, as they check any edit.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Each unit's records, where a copy of them must match byte for byte, and what its rows' paths are
 * relative to.
 */
export const UNITS = [
	{ dir: 'foundations/fast-af/provenance', root: '' },
	{ dir: 'foundations/specimen/provenance', root: '' },
	// Violet hashes released manifests and changelogs as they were before release, not their raw
	// bytes, so a file both sides recorded cannot be hashed here.
	{ dir: 'foundations/violet/provenance', root: '', rawHashes: false },
	{
		dir: 'endpoints/botcore/provenance',
		mirror: 'endpoints/botcore/src/botcore/provenance',
		root: 'endpoints/botcore',
	},
];
/** A row's hash of its file's current bytes, and its reasons (Violet calls them `reason`). */
const HASH = 'current_import_sha256';
const REASONS = ['import_reason', 'reason'];

/** The serialization every unit's records already use (a test pins it). */
export const encode = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export class RecordConflict extends Error {}

/** The unit a path belongs to, and the record's file name, or null when it is not a record. */
export function unitOf(path) {
	const parent = posix.dirname(path);
	const unit = UNITS.find((u) => u.dir === parent || u.mirror === parent);
	return unit && path.endsWith('.json') ? { unit, name: posix.basename(path) } : null;
}

/** `adaptations.json`'s rows, three ways, by `path`; the base's order, its new rows in place. */
function mergeRows(base, ours, theirs, where, fileSha) {
	const index = (rows) => new Map((rows ?? []).map((row) => [row.path, row]));
	const [b, o, t] = [index(base), index(ours), index(theirs)];
	const merged = new Map();
	for (const path of new Set([...t.keys(), ...o.keys(), ...b.keys()])) {
		const row = mergeRow(b.get(path), o.get(path), t.get(path), `${where}[${path}]`, fileSha);
		if (row !== undefined) merged.set(path, row);
	}
	const order = (theirs ?? []).map((row) => row.path).filter((path) => merged.has(path));
	for (const [i, row] of (ours ?? []).entries()) {
		if (order.includes(row.path) || !merged.has(row.path)) continue;
		const before = ours.slice(0, i).findLast((r) => order.includes(r.path));
		order.splice(before ? order.indexOf(before.path) + 1 : order.length, 0, row.path);
	}
	const paths = (theirs ?? []).map((row) => row.path);
	if (paths.every((path, i) => i === 0 || paths[i - 1] < path)) order.sort();
	return order.map((path) => merged.get(path));
}

/** Reasons joined: the base's, then each side's new ones (`; ` separates them). */
function joinReasons(ours, theirs) {
	if (ours === undefined || theirs === undefined) return theirs ?? ours;
	const parts = (text) => (text ? String(text).split('; ') : []);
	const known = new Set(parts(theirs));
	return [...parts(theirs), ...parts(ours).filter((part) => !known.has(part))].join('; ');
}

/**
 * One file's row. Both sides recording the same file means both edited it, and git merged the
 * edits: the hash is the merged file's, the reasons both sides'. Its other fields merge as values.
 */
function mergeRow(base, ours, theirs, where, fileSha) {
	if (same(ours, theirs) || same(ours, base)) return theirs;
	if (same(theirs, base)) return ours;
	if (!isObject(ours) || !isObject(theirs))
		throw new RecordConflict(`both sides changed ${where}, one removing it`);
	// A manifest is recorded by its shape, not its bytes: record it again by hand.
	if (!fileSha || 'manifest_shape_sha256' in ours || 'manifest_shape_sha256' in theirs)
		throw new RecordConflict(`both sides changed ${where}, which is not hashed by its bytes`);
	const strip = (row) =>
		Object.fromEntries(
			Object.entries(row ?? {}).filter(([key]) => key !== HASH && !REASONS.includes(key))
		);
	const rest = merge3(strip(base), strip(ours), strip(theirs), where);
	const row = {};
	for (const key of new Set([...Object.keys(theirs), ...Object.keys(ours)])) {
		if (key === HASH) row[key] = fileSha(theirs.path);
		else if (REASONS.includes(key)) row[key] = joinReasons(ours[key], theirs[key]);
		else if (key in rest) row[key] = rest[key];
	}
	return row;
}

/**
 * Three-way merge of JSON values; `undefined` is absent. Objects merge key by key, and
 * `adaptations.json`'s `files` row by row (`fileSha` reads a row's file as merged).
 */
export function merge3(base, ours, theirs, where = '$', fileSha = undefined) {
	if (same(ours, theirs) || same(ours, base)) return theirs;
	if (same(theirs, base)) return ours;
	if ([base, ours, theirs].every(isObject)) {
		const result = {};
		for (const key of new Set([...Object.keys(theirs), ...Object.keys(ours)])) {
			const value =
				key === 'files' && where === '$' && fileSha !== undefined
					? mergeRows(base[key], ours[key], theirs[key], `${where}.${key}`, fileSha)
					: merge3(base[key], ours[key], theirs[key], `${where}.${key}`);
			if (value !== undefined) result[key] = value;
		}
		return result;
	}
	throw new RecordConflict(`both sides changed ${where}`);
}

/** Merges one unit's records; returns the files to write as `{ name: text }`. */
export function mergeUnit(read) {
	const names = new Set(['provenance.json', ...read.names()]);
	const out = {};
	for (const name of names) {
		if (name === 'provenance.json') continue;
		const [b, o, t] = read.versions(name);
		if (o === undefined && t === undefined) continue;
		const value =
			name === 'adaptations.json'
				? merge3(b, o, t, '$', read.fileSha ?? null)
				: merge3(b, o, t, name);
		if (value !== undefined) out[name] = encode(value);
	}
	const [b, o, t] = read.versions('provenance.json');
	const envelope = merge3(withoutHashes(b), withoutHashes(o), withoutHashes(t), 'provenance.json');
	for (const [key, record] of Object.entries(envelope.records ?? {})) {
		const text = out[record.manifest] ?? read.current(record.manifest);
		if (text === undefined) throw new RecordConflict(`${record.manifest} is missing (${key})`);
		record.sha256 = sha256(text);
	}
	out['provenance.json'] = encode(envelope);
	return out;
}

/** The envelope without the manifest hashes, which are recomputed rather than merged. */
function withoutHashes(envelope) {
	if (!isObject(envelope?.records)) return envelope;
	const copy = structuredClone(envelope);
	for (const record of Object.values(copy.records)) delete record.sha256;
	return copy;
}

/** Resolves the open merge in `root`; returns what it wrote, or throws why it cannot. */
export function resolve(git, root) {
	const unmerged = git(['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
	if (unmerged.length === 0) throw new RecordConflict('no merge conflict to resolve');
	const units = new Set();
	for (const path of unmerged) {
		const found = unitOf(path);
		if (!found) throw new RecordConflict(`${path} is not a provenance record`);
		units.add(found.unit);
	}
	const base = git(['merge-base', 'HEAD', 'MERGE_HEAD']).trim();
	const show = (ref, path) => {
		try {
			return JSON.parse(git(['show', `${ref}:${path}`]));
		} catch {
			return undefined;
		}
	};
	const merged = [];
	for (const unit of units) {
		const listed = (ref) => {
			try {
				return git(['ls-tree', '--name-only', `${ref}:${unit.dir}`])
					.split('\n')
					.filter((name) => name.endsWith('.json'));
			} catch {
				return []; // The unit has no records on that side.
			}
		};
		const files = mergeUnit({
			names: () => new Set(['HEAD', 'MERGE_HEAD'].flatMap(listed)),
			versions: (name) =>
				[base, 'HEAD', 'MERGE_HEAD'].map((ref) => show(ref, `${unit.dir}/${name}`)),
			current: (name) => {
				const path = join(root, unit.dir, name);
				return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
			},
			fileSha:
				unit.rawHashes === false
					? undefined
					: (path) => {
							const file = join(root, unit.root, path);
							return existsSync(file) ? sha256(readFileSync(file)) : null;
						},
		});
		merged.push([unit, files]);
	}
	// Every unit merged before any is written, so a conflict in one leaves all of them as they were.
	const written = [];
	for (const [unit, files] of merged)
		for (const dir of [unit.dir, unit.mirror].filter(Boolean))
			for (const [name, text] of Object.entries(files)) {
				writeFileSync(join(root, dir, name), text);
				written.push(`${dir}/${name}`);
			}
	git(['add', '--', ...written]);
	return written;
}

function isEntry() {
	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
}

if (process.argv[1] && isEntry()) {
	const git = (args, cwd) =>
		execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			maxBuffer: 64 * 1024 * 1024,
		});
	try {
		const root = git(['rev-parse', '--show-toplevel']).trim();
		const written = resolve((args) => git(args, root), root);
		console.log(`provenance-merge: merged and staged ${written.join(', ')}`);
	} catch (error) {
		const why = error instanceof RecordConflict ? error.message : String(error.stderr || error);
		console.error(`provenance-merge: ${why.trim().split('\n')[0]}`);
		process.exitCode = 1;
	}
}
