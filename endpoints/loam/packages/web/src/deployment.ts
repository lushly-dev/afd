/**
 * @fileoverview Reading a `deployment.json` in stage B (phase 2 specification, 2.2; phase 1
 * specification, 9.4), in a chunk of its own, so no first paint loads this or the reader. It also
 * explains a projection `readBoot` could not read at all, for "Loam cannot start".
 */

import type { AppsLoadV2 } from '@lushly-dev/loam-kernel';
import { readProjection } from '@lushly-dev/loam-manifest/validate';
import { type MountChunk, type ViewChunk, webPorts } from './ports.js';

/** The reader's verdict on `raw`: the validated projection with its ports, or its refusal. */
export function readOrNotice(
	raw: unknown,
	document: Document,
	base: string,
	loadView: () => Promise<ViewChunk>,
	loadMount: () => Promise<MountChunk>
): AppsLoadV2 {
	const read = readProjection(raw);
	if (read.ok) {
		const ports = webPorts(document, base, read.projection.sandbox_origin, loadView, loadMount);
		return { deployment: read.projection, ports };
	}
	const first = read.refusals[0];
	return {
		refused: `Its deployment.json is refused: ${first?.message ?? 'it is not a deployment'} (DEPLOYMENT_INVALID). ${first?.suggestion ?? 'Rewrite the deployment with loam deployment write.'}`,
	};
}
