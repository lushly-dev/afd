/**
 * @fileoverview The narrowing kernel interface 1 relies on (phase 2 specification, 8.1). Interface 1
 * holds a `ManifestV1`, and `readManifest` returns a `ManifestV2`. Until interface 2 (step 4) holds
 * the latter, every key only version 2 has is refused by the reader (`NOT_YET_SERVED` in
 * `loam-rules.ts`), so a manifest that reaches the kernel is a version 1 manifest in all but its
 * `manifest_version`, which this sets to what interface 1 holds.
 */

import type { ManifestV1, ManifestV2 } from './types.js';

export function forInterfaceOne(manifest: ManifestV2): ManifestV1 {
	return { ...manifest, manifest_version: 1 } as ManifestV1;
}
