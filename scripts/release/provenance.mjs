#!/usr/bin/env node
/**
 * Records changes to imported files in a family's provenance: each changed or new file's digest in
 * `adaptations.json`, with the reason, and that file's digest in `provenance.json`.
 *
 * `pnpm version-packages` runs it after Changesets, before it writes the release intent, so the
 * release pull request passes the provenance tests and its intent already covers the records.
 *
 *   node scripts/release/provenance.mjs <family> "<reason>"
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The families whose imported files carry per-file provenance, and the paths each covers. */
export const PROVENANCE_FAMILIES = {
	specimen: {
		directory: 'foundations/specimen/provenance',
		paths: [
			'foundations/specimen',
			'integrations/specimen-afd',
			'endpoints/specimen-cli',
			'docs/features/active/specimens',
			'docs/features/proposed/specimens',
			'docs/features/active/platform-monorepo/specimen-transition.md',
			'tests/consumers/specimen',
		],
	},
	'fast-af': {
		directory: 'foundations/fast-af/provenance',
		paths: ['foundations/fast-af', 'tests/consumers/fast-af'],
	},
};

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

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
	return Object.entries(PROVENANCE_FAMILIES)
		.filter(([, { directory }]) => existsSync(join(root, directory, 'adaptations.json')))
		.flatMap(([family]) => recordProvenance(root, family, reason));
}

/** Records every changed or new file with `reason`; returns the paths it recorded. */
export function recordProvenance(root, family, reason) {
	if (!PROVENANCE_FAMILIES[family]) throw new Error(`No provenance for family: ${family}`);
	if (typeof reason !== 'string' || !reason.trim())
		throw new Error('A provenance reason is required');
	const directory = join(root, PROVENANCE_FAMILIES[family].directory);
	const adaptationsPath = join(directory, 'adaptations.json');
	const adaptations = JSON.parse(readFileSync(adaptationsPath, 'utf8'));
	const recorded = new Map(adaptations.files.map((file) => [file.path, file]));
	const changed = [];
	for (const path of provenancePaths(root, family)) {
		const digest = sha(readFileSync(join(root, path)));
		const file = recorded.get(path);
		if (!file)
			adaptations.files.push({
				path,
				upstream_path: null,
				upstream_sha256: null,
				staged_path: null,
				staged_sha256: null,
				current_import_sha256: digest,
				stage_classification: 'post-import-addition',
				stage_reason: 'New local work with no selected upstream or staging predecessor',
				import_classification: 'added-after-import',
				import_reason: reason,
			});
		else if (file.current_import_sha256 !== digest) {
			file.current_import_sha256 = digest;
			if (file.import_classification === 'unchanged-staged') {
				file.import_classification = 'modified-after-staging';
				file.import_reason = reason;
				file.stage_reason ??= 'Recorded at import';
			} else if (!file.import_reason?.includes(reason))
				file.import_reason = `${file.import_reason}; ${reason}`;
		} else continue;
		changed.push(path);
	}
	if (!changed.length) return changed;
	writeFileSync(adaptationsPath, `${JSON.stringify(adaptations, null, 2)}\n`);
	const provenancePath = join(directory, 'provenance.json');
	const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
	provenance.records.adaptations.sha256 = sha(readFileSync(adaptationsPath));
	writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
	return changed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const [family, reason] = process.argv.slice(2);
		const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
		for (const path of recordProvenance(root, family, reason)) console.log(`recorded ${path}`);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
