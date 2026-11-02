/**
 * @fileoverview Reading a `deployment.json` that lists apps (phase 1 specification, 9.4), in a chunk of
 * its own, so the empty shell loads neither this nor the reader.
 */

import type { KernelOptionsV1 } from '@lushly-dev/loam-kernel';
import { readProjection } from '@lushly-dev/loam-manifest/validate';
import { type ViewChunk, webPorts } from './ports.js';

export type DeploymentRead =
	| { ok: true; apps: Pick<KernelOptionsV1, 'deployment' | 'ports'> }
	| { ok: false; message: string };

export function readOrNotice(
	raw: unknown,
	document: Document,
	loadView: () => Promise<ViewChunk>
): DeploymentRead {
	const read = readProjection(raw);
	if (read.ok) {
		const ports = webPorts(document, read.projection.sandbox_origin, loadView);
		return { ok: true, apps: { deployment: read.projection, ports } };
	}
	const first = read.refusals[0];
	return {
		ok: false,
		message: `Its deployment.json is refused: ${first?.message ?? 'it is not a deployment'} (DEPLOYMENT_INVALID). ${first?.suggestion ?? 'Rewrite the deployment with loam deployment write.'}`,
	};
}
