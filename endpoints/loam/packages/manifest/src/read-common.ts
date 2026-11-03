/**
 * @fileoverview A rule's findings as a reader's result.
 */

import type { Finding } from './core-rules.js';
import { keyOf } from './pointers.js';
import type { ManifestRead, ManifestRefusal, ManifestV2 } from './types.js';

const toRefusal = ({ pointer, ...finding }: Finding): ManifestRefusal => ({
	...finding,
	key: keyOf(pointer),
});

export function toRead(
	manifest: ManifestV2,
	refusals: readonly Finding[],
	warnings: readonly Finding[]
): ManifestRead {
	const warned = warnings.map(toRefusal);
	return refusals.length > 0
		? { ok: false, refusals: refusals.map(toRefusal), warnings: warned }
		: { ok: true, manifest, warnings: warned };
}
