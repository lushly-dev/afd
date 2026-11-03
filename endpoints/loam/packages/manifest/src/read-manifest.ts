/**
 * @fileoverview The reader of Loam's profile: the schema, then the rules of spec/plugin-manifest.md,
 * then Loam's own (phase 1 specification, 2.4). A manifest is untrusted input, so the kernel reads
 * it at load even though `app pack` did.
 */

import { coreRules } from './core-rules.js';
import { loamRules } from './loam-rules.js';
import { toRead } from './read-common.js';
import { refusalsFrom } from './refusal-map.js';
import type { ManifestRead, ManifestV2 } from './types.js';
import { validateManifest } from './validate.generated.js';

export function readManifest(json: unknown): ManifestRead {
	if (!validateManifest(json)) {
		return {
			ok: false,
			refusals: refusalsFrom(validateManifest.errors ?? [], json),
			warnings: [],
		};
	}
	const manifest = json as ManifestV2;
	const core = coreRules(json as Parameters<typeof coreRules>[0]);
	const loam = loamRules(manifest);
	return toRead(
		manifest,
		[...core.refusals, ...loam.refusals],
		[...core.warnings, ...loam.warnings]
	);
}
