#!/usr/bin/env node
/**
 * Resolves a merge whose only conflicts are imported units' provenance records.
 *
 * Every edit to FAST-AF, Specimen, Violet, Botcore or Health records itself in its unit's
 * `provenance/` directory: a row per file in `adaptations.json`, and in `provenance.json` the
 * sha256 of each frozen manifest. Units once committed `adaptations.json`'s sha256 too, so two
 * branches that edit different files of one both changed that hash line and their merge always
 * conflicted, though nothing they recorded did (lushly-dev/afd#1410). None commits it now
 * (#1610): branches conflict only where the rows themselves do, which this merges the same way.
 * The factory lane runs this, as the adapter's `regenerate` command, in its validation checkout
 * while the merge of the base is still open:
 *
 *   node scripts/provenance-merge.mjs
 *
 * For each unit with an unmerged record it merges three ways, from the merge base, `HEAD` (the
 * branch) and `MERGE_HEAD` (the base): rows by `path`, every other value by its place in the
 * document. A row both sides changed records one file both edited, which git merged cleanly (or
 * the merge would conflict outside the records): its hash (and `manifest_shape_sha256` when
 * present) is read from the merged file as that unit hashes it (pre-release bytes for Violet's
 * released manifests and changelogs) and its reasons are joined. Health keeps its rows in
 * `provenance.json` and pins its digest in `endpoints/health/tests/test_provenance.py`, which is
 * updated only when both sides' pins matched their own records and no conflict lies outside
 * `RECORD_SHA256`. Any other value both sides changed, differently, is a real conflict: the
 * script exits 1 naming it and writes nothing. Otherwise it writes the merged manifests, recomputes
 * each sha256 the merged `provenance.json` commits, copies Botcore's records to their packaged
 * mirror and stages the files. It touches nothing but records, and refuses an unmerged path that is
 * not one. The unit's own provenance tests then check the result, as they check any edit.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	manifestShape,
	violetBeforeRelease,
	violetInitialVersions,
} from './release/provenance.mjs';

/**
 * Each unit's records, where a copy of them must match byte for byte, and what its rows' paths are
 * relative to.
 */
export const UNITS = [
	{ dir: 'foundations/fast-af/provenance', root: '' },
	{ dir: 'foundations/specimen/provenance', root: '' },
	// Violet hashes released manifests and changelogs as they were before release (violetBeforeRelease).
	{ dir: 'foundations/violet/provenance', root: '', beforeHash: 'violet' },
	{
		dir: 'endpoints/botcore/provenance',
		mirror: 'endpoints/botcore/src/botcore/provenance',
		root: 'endpoints/botcore',
	},
	// Health keeps its file rows in provenance.json and pins its digest in test_provenance.py.
	{
		dir: 'endpoints/health/provenance',
		root: 'endpoints/health',
		singleRecord: true,
		pinFile: 'endpoints/health/tests/test_provenance.py',
	},
];
/** A row's hash of its file's bytes, its manifest shape hash, and its reasons. */
const HASH = 'current_import_sha256';
const SHAPE = 'manifest_shape_sha256';
const REASONS = ['import_reason', 'reason'];
const HEALTH_PIN = /^RECORD_SHA256 = "([0-9a-f]{64})"(?=\r?$)/gm;
const PIN_PLACEHOLDER = 'RECORD_SHA256 = "__AFD_PROVENANCE_MERGE_PIN__"';

/** The serialization every unit's records already use (a test pins it). */
export const encode = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export class RecordConflict extends Error {}

/** The unit a path belongs to, and the record's file name, or null when it is not a record. */
export function unitOf(path) {
	const pinned = UNITS.find((u) => u.pinFile === path);
	if (pinned) return { unit: pinned, name: posix.basename(path), pin: true };
	const parent = posix.dirname(path);
	const unit = UNITS.find((u) => u.dir === parent || u.mirror === parent);
	return unit && path.endsWith('.json') ? { unit, name: posix.basename(path) } : null;
}

/** `adaptations.json`'s rows, three ways, by `path`; the base's order, its new rows in place. */
function mergeRows(base, ours, theirs, where, readFile, rowMerger = mergeRow, keyField = 'path') {
	const index = (rows) => new Map((rows ?? []).map((row) => [row[keyField], row]));
	const [b, o, t] = [index(base), index(ours), index(theirs)];
	const merged = new Map();
	for (const id of new Set([...t.keys(), ...o.keys(), ...b.keys()])) {
		const row = rowMerger(b.get(id), o.get(id), t.get(id), `${where}[${id}]`, readFile);
		if (row !== undefined) merged.set(id, row);
	}
	const order = (theirs ?? []).map((row) => row[keyField]).filter((id) => merged.has(id));
	for (const [i, row] of (ours ?? []).entries()) {
		if (order.includes(row[keyField]) || !merged.has(row[keyField])) continue;
		const before = ours.slice(0, i).findLast((r) => order.includes(r[keyField]));
		order.splice(before ? order.indexOf(before[keyField]) + 1 : order.length, 0, row[keyField]);
	}
	const ids = (theirs ?? []).map((row) => row[keyField]);
	if (ids.every((id, i) => i === 0 || ids[i - 1] < id)) order.sort();
	return order.map((id) => merged.get(id));
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
 * edits: the hash (and manifest shape, when present) is read from the merged file's bytes as
 * hashed by that unit, and the reasons are joined. Other fields merge as values.
 */
function mergeRow(base, ours, theirs, where, readFile) {
	if (same(ours, theirs) || same(ours, base)) return theirs;
	if (same(theirs, base)) return ours;
	if (!isObject(ours) || !isObject(theirs))
		throw new RecordConflict(`both sides changed ${where}, one removing it`);
	const strip = (row) =>
		Object.fromEntries(
			Object.entries(row ?? {}).filter(
				([key]) => key !== HASH && key !== SHAPE && !REASONS.includes(key)
			)
		);
	const rest = merge3(strip(base), strip(ours), strip(theirs), where);
	if (!readFile)
		throw new RecordConflict(`both sides changed ${where}, which is not hashed by its bytes`);
	const bytes = readFile(theirs.path);
	if (!bytes)
		throw new RecordConflict(`both sides changed ${where}, whose merged file cannot be read`);
	const needsShape = SHAPE in ours || SHAPE in theirs;
	let shape;
	if (needsShape) {
		try {
			shape = manifestShape(bytes);
		} catch {
			throw new RecordConflict(
				`both sides changed ${where}, whose merged manifest is not valid JSON`
			);
		}
	}
	const row = {};
	for (const key of new Set([...Object.keys(theirs), ...Object.keys(ours)])) {
		if (key === HASH) row[key] = sha256(bytes);
		else if (key === SHAPE) row[key] = shape;
		else if (REASONS.includes(key)) row[key] = joinReasons(ours[key], theirs[key]);
		else if (key in rest) row[key] = rest[key];
	}
	return row;
}

/**
 * One file row in Health's `provenance.json`. Authored files carry no digest, so both sides
 * recording adaptations on the same authored file joins their `adaptation` notes; derived and
 * license rows are bound to frozen hashes and refuse.
 */
function mergeHealthFileRow(base, ours, theirs, where) {
	if (same(ours, theirs) || same(ours, base)) return theirs;
	if (same(theirs, base)) return ours;
	if (!isObject(ours) || !isObject(theirs))
		throw new RecordConflict(`both sides changed ${where}, one removing it`);
	if (
		'sha256' in ours ||
		'sha256' in theirs ||
		ours.origin !== 'authored' ||
		theirs.origin !== 'authored'
	)
		throw new RecordConflict(`both sides changed ${where}, which is bound by a frozen hash`);
	const strip = (row) =>
		Object.fromEntries(Object.entries(row ?? {}).filter(([key]) => key !== 'adaptation'));
	const rest = merge3(strip(base), strip(ours), strip(theirs), where);
	const row = {};
	for (const key of new Set([...Object.keys(theirs), ...Object.keys(ours)])) {
		if (key === 'adaptation') row[key] = joinReasons(ours[key], theirs[key]);
		else if (key in rest) row[key] = rest[key];
	}
	return row;
}

/** One entry in Health's `adapted_functions`, keyed by `name`; conflicting edits to one refuse. */
function mergeNamedRow(base, ours, theirs, where) {
	if (same(ours, theirs) || same(ours, base)) return theirs;
	if (same(theirs, base)) return ours;
	throw new RecordConflict(`both sides changed ${where}`);
}

/**
 * Three-way merge of JSON values; `undefined` is absent. Objects merge key by key, and
 * `adaptations.json`'s `files` row by row (`readFile` reads a row's file as merged).
 */
export function merge3(base, ours, theirs, where = '$', readFile = undefined) {
	if (same(ours, theirs) || same(ours, base)) return theirs;
	if (same(theirs, base)) return ours;
	if ([base, ours, theirs].every(isObject)) {
		const result = {};
		for (const key of new Set([...Object.keys(theirs), ...Object.keys(ours)])) {
			const value =
				key === 'files' && where === '$' && readFile !== undefined
					? mergeRows(base[key], ours[key], theirs[key], `${where}.${key}`, readFile)
					: merge3(base[key], ours[key], theirs[key], `${where}.${key}`);
			if (value !== undefined) result[key] = value;
		}
		return result;
	}
	throw new RecordConflict(`both sides changed ${where}`);
}

function mergeHealthRecord(base, ours, theirs) {
	if (same(ours, theirs) || same(ours, base)) return theirs;
	if (same(theirs, base)) return ours;
	if (![base, ours, theirs].every(isObject))
		throw new RecordConflict('both sides changed provenance.json');
	const isNamedList = (rows) =>
		rows === undefined ||
		(Array.isArray(rows) && rows.every((r) => isObject(r) && typeof r.name === 'string'));
	const result = {};
	for (const key of new Set([...Object.keys(theirs), ...Object.keys(ours)])) {
		const [b, o, t] = [base[key], ours[key], theirs[key]];
		const value =
			key === 'files'
				? mergeRows(b, o, t, '$.files', null, mergeHealthFileRow, 'path')
				: key === 'adapted_functions' && [b, o, t].every(isNamedList)
					? mergeRows(b, o, t, '$.adapted_functions', null, mergeNamedRow, 'name')
					: merge3(b, o, t, `$.${key}`);
		if (value !== undefined) result[key] = value;
	}
	return result;
}

function extractHealthPin(text, label) {
	if (typeof text !== 'string') throw new RecordConflict(`${label} test_provenance.py is missing`);
	const matches = [...text.matchAll(HEALTH_PIN)];
	if (matches.length !== 1)
		throw new RecordConflict(`${label} test_provenance.py must declare RECORD_SHA256 once`);
	return matches[0][1];
}

/**
 * Merges Health's `test_provenance.py` pin file: confirms both sides' pins matched their own
 * `provenance.json`, merges any non-conflicting edits outside `RECORD_SHA256`, and writes the
 * merged record's digest into the pin line.
 */
export function mergeHealthPin({
	base,
	ours,
	theirs,
	ourProvenanceRaw,
	theirProvenanceRaw,
	mergedSha256,
	mergeText,
}) {
	if (ourProvenanceRaw === undefined || theirProvenanceRaw === undefined)
		throw new RecordConflict('Health provenance.json is missing on one side of the merge');
	if (extractHealthPin(ours, 'HEAD') !== sha256(Buffer.from(ourProvenanceRaw, 'utf8')))
		throw new RecordConflict("HEAD's RECORD_SHA256 does not match HEAD's provenance.json");
	if (extractHealthPin(theirs, 'MERGE_HEAD') !== sha256(Buffer.from(theirProvenanceRaw, 'utf8')))
		throw new RecordConflict(
			"MERGE_HEAD's RECORD_SHA256 does not match MERGE_HEAD's provenance.json"
		);
	if (base !== undefined) extractHealthPin(base, 'base');
	const norm = (s) => (s === undefined ? undefined : s.replace(HEALTH_PIN, PIN_PLACEHOLDER));
	const [normBase, normOurs, normTheirs] = [norm(base), norm(ours), norm(theirs)];
	const merged =
		normOurs === normTheirs || normOurs === normBase
			? normTheirs
			: normTheirs === normBase
				? normOurs
				: normBase !== undefined && mergeText
					? mergeText(normOurs, normBase, normTheirs)
					: null;
	if (merged === null)
		throw new RecordConflict(
			'endpoints/health/tests/test_provenance.py has conflicts outside RECORD_SHA256'
		);
	if (merged.split(PIN_PLACEHOLDER).length - 1 !== 1)
		throw new RecordConflict('merged test_provenance.py must carry RECORD_SHA256 once');
	return merged.replace(PIN_PLACEHOLDER, `RECORD_SHA256 = "${mergedSha256}"`);
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
				? merge3(b, o, t, '$', read.readFile ?? null)
				: merge3(b, o, t, name);
		if (value !== undefined) out[name] = encode(value);
	}
	const [b, o, t] = read.versions('provenance.json');
	const envelope = merge3(withoutHashes(b), withoutHashes(o), withoutHashes(t), 'provenance.json');
	for (const [key, record] of Object.entries(envelope.records ?? {})) {
		if (record.sha256 !== HASHED) continue; // Not committed (#1610).
		const text = out[record.manifest] ?? read.current(record.manifest);
		if (text === undefined) throw new RecordConflict(`${record.manifest} is missing (${key})`);
		record.sha256 = sha256(text);
	}
	out['provenance.json'] = encode(envelope);
	return out;
}

/** Stands in for a manifest's hash, which is recomputed rather than merged. */
const HASHED = '(recomputed)';

/**
 * The envelope with each manifest hash replaced by `HASHED`, so whether a record carries one
 * merges as a value: no unit commits `adaptations.json`'s any more (#1610), and a
 * branch from before that merges to the base's choice.
 */
function withoutHashes(envelope) {
	if (!isObject(envelope?.records)) return envelope;
	const copy = structuredClone(envelope);
	for (const record of Object.values(copy.records)) if ('sha256' in record) record.sha256 = HASHED;
	return copy;
}

function gitMergeFile(git, ours, base, theirs) {
	const dir = mkdtempSync(join(tmpdir(), 'afd-provenance-pin-'));
	try {
		const [ourPath, basePath, theirPath] = ['ours', 'base', 'theirs'].map((n) => join(dir, n));
		writeFileSync(ourPath, ours, 'utf8');
		writeFileSync(basePath, base, 'utf8');
		writeFileSync(theirPath, theirs, 'utf8');
		try {
			return git(['merge-file', '-p', ourPath, basePath, theirPath]);
		} catch {
			return null;
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
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
	const showRaw = (ref, path) => {
		try {
			return git(['show', `${ref}:${path}`]);
		} catch {
			return undefined;
		}
	};
	const show = (ref, path) => {
		const raw = showRaw(ref, path);
		if (raw === undefined) return undefined;
		try {
			return JSON.parse(raw);
		} catch {
			return undefined;
		}
	};
	const violetVersions = units.has(UNITS.find((u) => u.beforeHash === 'violet'))
		? violetInitialVersions(root)
		: null;
	const merged = [];
	const pins = [];
	for (const unit of units) {
		if (unit.singleRecord) {
			const recordPath = `${unit.dir}/provenance.json`;
			const [bRaw, oRaw, tRaw] = [base, 'HEAD', 'MERGE_HEAD'].map((ref) =>
				showRaw(ref, recordPath)
			);
			const parseOrThrow = (raw, label) => {
				if (raw === undefined) return undefined;
				try {
					return JSON.parse(raw);
				} catch {
					throw new RecordConflict(`${label}:${recordPath} is not valid JSON`);
				}
			};
			const record = mergeHealthRecord(
				parseOrThrow(bRaw, 'base'),
				parseOrThrow(oRaw, 'HEAD'),
				parseOrThrow(tRaw, 'MERGE_HEAD')
			);
			const text = encode(record);
			if (unit.pinFile) {
				const [bPin, oPin, tPin] = [base, 'HEAD', 'MERGE_HEAD'].map((ref) =>
					showRaw(ref, unit.pinFile)
				);
				const mergedPin = mergeHealthPin({
					base: bPin,
					ours: oPin,
					theirs: tPin,
					ourProvenanceRaw: oRaw,
					theirProvenanceRaw: tRaw,
					mergedSha256: sha256(Buffer.from(text, 'utf8')),
					mergeText: (o, b, t) => gitMergeFile(git, o, b, t),
				});
				pins.push([unit.pinFile, mergedPin]);
			}
			merged.push([unit, { 'provenance.json': text }]);
			continue;
		}
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
			readFile: (path) => {
				const file = join(root, unit.root, path);
				if (!existsSync(file)) return null;
				const raw = readFileSync(file);
				if (unit.beforeHash === 'violet') {
					try {
						return violetBeforeRelease(root, path, raw, violetVersions);
					} catch {
						return null;
					}
				}
				return raw;
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
	for (const [pinPath, text] of pins) {
		writeFileSync(join(root, pinPath), text);
		written.push(pinPath);
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
