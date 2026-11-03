/**
 * @fileoverview The reader of Loam's profile: the schema, then the rules of spec/plugin-manifest.md,
 * then Loam's own (phase 1 specification, 2.4). A manifest is untrusted input, so the kernel reads
 * it at load even though `app pack` did.
 */

import { coreRules } from './core-rules.js';
import { loamRules, versionKeyFindings } from './loam-rules.js';
import { toRead, toRefusal } from './read-common.js';
import { refusalsFrom } from './refusal-map.js';
import type { ManifestRead, ManifestV2 } from './types.js';
import { validateManifest } from './validate.generated.js';
import { pointerOf } from './validator-errors.js';

export function readManifest(json: unknown): ManifestRead {
	if (!validateManifest(json)) {
		// A version 1 manifest holding a version 2 key is told the version, whatever the key's shape
		// or what else is wrong: phase 1 refused these keys before it looked inside them.
		const told = versionKeyFindings(json);
		const toldPointers = told.map((finding) => finding.pointer);
		const errors = (validateManifest.errors ?? []).filter((error) => {
			const pointer = pointerOf(error);
			return !toldPointers.some(
				(key) =>
					pointer === key ||
					pointer.startsWith(`${key}/`) ||
					// A `tree` sidebar needs no `command` under version 1, where `tree` was refused first.
					(key === '/ui/surfaces/sidebar/shape' &&
						error.keyword === 'required' &&
						pointer === '/ui/surfaces/sidebar/command')
			);
		});
		return {
			ok: false,
			refusals: [...told.map(toRefusal), ...refusalsFrom(errors, json)],
			warnings: [],
		};
	}
	// A well-formed version 2 key under version 1 is told the version, and nothing else: the core's
	// rules would otherwise lead, and a loader reports the first refusal.
	const told = versionKeyFindings(json);
	if (told.length > 0) return { ok: false, refusals: told.map(toRefusal), warnings: [] };
	const manifest = json as ManifestV2;
	const core = coreRules(json as Parameters<typeof coreRules>[0]);
	const loam = loamRules(manifest);
	return toRead(
		manifest,
		[...core.refusals, ...loam.refusals],
		[...core.warnings, ...loam.warnings]
	);
}
