/**
 * @fileoverview The browser projection's reader, version 2 only. The web host runs it on
 * `deployment.json` in stage B (phase 2 specification, 2.2); its schema has no key for a location, a
 * credential or a command line.
 */

import { deploymentRefusals } from './deployment-refusals.js';
import { keyOf } from './pointers.js';
import type { DeploymentRefusal, ProjectionRead, ProjectionV2 } from './types.js';
import { validateProjection } from './validate.generated.js';

export function readProjection(json: unknown): ProjectionRead {
	if (!validateProjection(json)) {
		return {
			ok: false,
			refusals: deploymentRefusals(validateProjection.errors ?? [], 'projection'),
			warnings: [],
		};
	}
	const projection = json as ProjectionV2;
	const refusals: DeploymentRefusal[] = [];
	const seen = new Set<string>();
	projection.apps.forEach((app, index) => {
		if (seen.has(app.instance)) {
			refusals.push({
				code: 'DEPLOYMENT_INVALID',
				key: keyOf(`/apps/${index}/instance`),
				message: `The instance \`${app.instance}\` is repeated.`,
				suggestion: 'Rewrite it with `loam deployment write`.',
			});
		}
		seen.add(app.instance);
	});
	return refusals.length > 0
		? { ok: false, refusals, warnings: [] }
		: { ok: true, projection, warnings: [] };
}
