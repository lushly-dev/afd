/**
 * @fileoverview The reader with a validator compiled from the core's `manifest` definition alone,
 * since a profile may refuse what the core accepts. `spec/plugin-manifest.json` runs through it.
 */

import { coreRules } from './core-rules.js';
import { toRead } from './read-common.js';
import { refusalsFrom } from './refusal-map.js';
import type { ManifestRead, ManifestV1 } from './types.js';
import { validateCoreManifest } from './validate-host.generated.js';

export function readCoreManifest(json: unknown): ManifestRead {
	if (!validateCoreManifest(json)) {
		return {
			ok: false,
			refusals: refusalsFrom(validateCoreManifest.errors ?? [], json),
			warnings: [],
		};
	}
	const { refusals, warnings } = coreRules(json as Parameters<typeof coreRules>[0]);
	return toRead(json as ManifestV1, refusals, warnings);
}
