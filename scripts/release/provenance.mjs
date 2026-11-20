#!/usr/bin/env node
/**
 * Records changes to imported files in a family's provenance: each changed or new file's digest in
 * `adaptations.json`, with the reason, and that file's digest in `provenance.json` where the family
 * commits it. FAST-AF does not, so two branches that record different files do not both rewrite
 * one line (lushly-dev/afd#1610); its npm packages ship no provenance records, so nothing is
 * stamped for it.
 *
 * Run from the command line, it also records a removal. A recorded file that is gone is recorded
 * as removed, never dropped: its record keeps its history and digest, takes the
 * `removed-after-import` classification and gains `removed`, the date, the reason and the
 * classification it had. The provenance tests skip a removed record when they look for the file,
 * and it still accounts for its upstream file. A removed file that comes back takes its earlier
 * classification again, and `removed` moves to `earlier_removals`. The release path never records
 * a removal, so a file deleted by accident fails the tests instead of being written off, and a
 * recorded file that is still on disk but ignored by Git is refused, not recorded as removed.
 *
 * `pnpm version-packages` runs it after Changesets, before it writes the release intent, so the
 * release pull request passes the provenance tests and its intent already covers the records.
 *
 * An imported `package.json` also records `manifest_shape_sha256`, the digest of the manifest with
 * every dependency range blanked, so a change to ranges alone (a Dependabot update) is not an
 * adaptation: the provenance tests accept it until the file's next recorded change. A record whose
 * digest was updated by hand keeps a stale shape; running this again refreshes it.
 *
 *   node scripts/release/provenance.mjs <family> "<reason>"
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The families whose imported files carry per-file provenance, the paths each covers, and whether
 * its `provenance.json` commits the digest of `adaptations.json`. FAST-AF's does not: its one line
 * made any two branches that recorded different files conflict (#1610).
 */
export const PROVENANCE_FAMILIES = {
	specimen: {
		commitsAdaptationsDigest: true,
		directory: 'foundations/specimen/provenance',
		paths: [
			'foundations/specimen',
			'integrations/specimen-afd',
			'endpoints/specimen-cli',
			'docs/features/complete/specimens',
			'docs/features/complete/platform-monorepo/specimen-transition.md',
			'tests/consumers/specimen',
		],
	},
	'fast-af': {
		commitsAdaptationsDigest: false,
		directory: 'foundations/fast-af/provenance',
		paths: ['foundations/fast-af', 'tests/consumers/fast-af'],
	},
};

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const DEPENDENCY_FIELDS = [
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies',
];

/** The digest of a manifest with each dependency's range blanked: names and every other field count. */
export function manifestShape(bytes) {
	const manifest = JSON.parse(bytes.toString('utf8'));
	for (const field of DEPENDENCY_FIELDS)
		if (manifest[field])
			manifest[field] = Object.fromEntries(Object.keys(manifest[field]).map((name) => [name, '']));
	return sha(JSON.stringify(manifest));
}

/**
 * Whether an imported file's bytes match its record: its digest, or, for a manifest, its shape, so
 * a dependency update changing ranges only passes and any other edit still needs recording.
 */
export function matchesRecord(file, bytes) {
	if (sha(bytes) === file.current_import_sha256) return true;
	return Boolean(file.manifest_shape_sha256) && manifestShape(bytes) === file.manifest_shape_sha256;
}

/**
 * Whether a manifest's recorded shape is stale: the record's digest is the file's, but its shape is
 * not. A digest updated by hand, with the shape left behind, passes on `main` and then fails every
 * dependency update to that manifest.
 */
export function hasStaleShape(file, bytes) {
	return (
		Boolean(file.manifest_shape_sha256) &&
		sha(bytes) === file.current_import_sha256 &&
		manifestShape(bytes) !== file.manifest_shape_sha256
	);
}

const isManifest = (path) => path === 'package.json' || path.endsWith('/package.json');

/** The classification of a record whose file was removed after import. */
export const REMOVED = 'removed-after-import';

/** Whether a record is of a file removed after import, which the tests do not look for. */
export const isRemoved = (file) => file.import_classification === REMOVED;

/** The family's files Git sees, tracked or untracked but not ignored, outside its records. */
export function provenancePaths(root, family) {
	const { directory, paths } = PROVENANCE_FAMILIES[family];
	return execFileSync(
		'git',
		['ls-files', '--cached', '--others', '--exclude-standard', '--', ...paths],
		{ cwd: root, encoding: 'utf8' }
	)
		.split('\n')
		.filter((path) => path && !path.startsWith(`${directory}/`));
}

/** Records Changesets' edits for every family this repository carries; returns the paths. */
export function recordReleaseProvenance(root, reason) {
	// Changesets never removes an imported file, so a release records no removal.
	return Object.entries(PROVENANCE_FAMILIES)
		.filter(([, { directory }]) => existsSync(join(root, directory, 'adaptations.json')))
		.flatMap(([family]) => recordProvenance(root, family, reason, { removals: false }));
}

/**
 * Records every changed or new file with `reason`, and with `removals` every recorded file that is
 * gone; returns the paths it recorded. `today` dates a removal (YYYY-MM-DD), for tests. Then the
 * envelope's adaptations digest follows the family's rule (`alignAdaptationsDigest`), and
 * `onDigest` hears what changed there.
 */
export function recordProvenance(root, family, reason, { today, removals = false, onDigest } = {}) {
	if (!PROVENANCE_FAMILIES[family]) throw new Error(`No provenance for family: ${family}`);
	if (typeof reason !== 'string' || !reason.trim())
		throw new Error('A provenance reason is required');
	const directory = join(root, PROVENANCE_FAMILIES[family].directory);
	const adaptationsPath = join(directory, 'adaptations.json');
	const adaptations = JSON.parse(readFileSync(adaptationsPath, 'utf8'));
	const recorded = new Map(adaptations.files.map((file) => [file.path, file]));
	const changed = [];
	const present = provenancePaths(root, family);
	for (const path of present) {
		const bytes = readFileSync(join(root, path));
		const digest = sha(bytes);
		const shape = isManifest(path) ? { manifest_shape_sha256: manifestShape(bytes) } : {};
		const file = recorded.get(path);
		const restored = Boolean(file && isRemoved(file));
		if (restored) {
			if (!file.removed?.import_classification)
				throw new Error(
					`${path}: its record is ${REMOVED} without \`removed.import_classification\`; restore the record by hand`
				);
			// Back after a removal: it takes its earlier classification and the removal is history.
			file.import_classification = file.removed.import_classification;
			file.earlier_removals = [...(file.earlier_removals ?? []), file.removed];
			delete file.removed;
		}
		if (!file)
			adaptations.files.push({
				path,
				upstream_path: null,
				upstream_sha256: null,
				staged_path: null,
				staged_sha256: null,
				current_import_sha256: digest,
				...shape,
				stage_classification: 'post-import-addition',
				stage_reason: 'New local work with no selected upstream or staging predecessor',
				import_classification: 'added-after-import',
				import_reason: reason,
			});
		else if (file.current_import_sha256 !== digest) {
			file.current_import_sha256 = digest;
			Object.assign(file, shape);
			if (file.import_classification === 'unchanged-staged') {
				file.import_classification = 'modified-after-staging';
				file.import_reason = reason;
				file.stage_reason ??= 'Recorded at import';
			} else if (!file.import_reason?.includes(reason))
				file.import_reason = `${file.import_reason}; ${reason}`;
		} else if (hasStaleShape(file, bytes)) {
			// The file is as recorded, so there is no reason to add: only the shape follows it.
			Object.assign(file, shape);
		} else if (!restored) continue;
		changed.push(path);
	}
	const visible = new Set(present);
	const date = today ?? new Date().toISOString().slice(0, 10);
	for (const file of adaptations.files) {
		if (!removals || visible.has(file.path) || isRemoved(file)) continue;
		if (existsSync(join(root, file.path)))
			throw new Error(
				`${file.path} is on disk but ignored by Git; it is not removed (check .gitignore)`
			);
		file.removed = { on: date, reason, import_classification: file.import_classification };
		file.import_classification = REMOVED;
		changed.push(file.path);
	}
	if (changed.length) writeFileSync(adaptationsPath, `${JSON.stringify(adaptations, null, 2)}\n`);
	const digest = alignAdaptationsDigest(root, family);
	if (digest) onDigest?.(digest);
	return changed;
}

/**
 * Brings the envelope's adaptations digest in line with the family's rule, whatever the recording
 * found: written where the family commits it, removed where it does not. A merge made by an older
 * `pnpm base:sync` writes the digest back into FAST-AF's records (#1610), and running the recorder
 * removes it. Returns `'written'`, `'removed'` or `undefined` when the envelope was already right.
 */
export function alignAdaptationsDigest(root, family) {
	const { directory, commitsAdaptationsDigest } = PROVENANCE_FAMILIES[family];
	const provenancePath = join(root, directory, 'provenance.json');
	const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
	const record = provenance.records.adaptations;
	const digest = sha(readFileSync(join(root, directory, record.manifest)));
	let outcome;
	if (commitsAdaptationsDigest && record.sha256 !== digest) {
		record.sha256 = digest;
		outcome = 'written';
	} else if (!commitsAdaptationsDigest && 'sha256' in record) {
		delete record.sha256;
		outcome = 'removed';
	}
	if (outcome) writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
	return outcome;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const [family, reason] = process.argv.slice(2);
		const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
		const onDigest = (outcome) =>
			console.log(`provenance.json: the adaptations digest ${outcome} (#1610)`);
		for (const path of recordProvenance(root, family, reason, { removals: true, onDigest }))
			console.log(`recorded ${path}`);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
