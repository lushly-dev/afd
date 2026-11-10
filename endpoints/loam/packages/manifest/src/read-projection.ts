/**
 * @fileoverview The browser projection's reader, versions 2 and 3 (phase 3 specification, 2.2). The web host runs it on
 * `deployment.json` in stage B (phase 2 specification, 2.2); its schema has no key for a location, a
 * credential or a command line.
 */

import { deploymentRefusals } from './deployment-refusals.js';
import { keyOf } from './pointers.js';
import { identityOf } from './read-boot.js';
import type { DeploymentRefusal, ProjectionRead, ProjectionV3 } from './types.js';
import { validateProjection } from './validate.generated.js';

/**
 * Reads versions 2 and 3. The generated validator is version 2's; a version 3 projection is version 2's
 * fields and `identity`, which `identityOf` checks as `projection.v3.json` has it (its test holds the two
 * equal). Ajv's code for that one key costs the page's `apps` row about 6,700 bytes (phase 3 specification,
 * 13), and stage A reads it by hand anyway.
 */
export function readProjection(json: unknown): ProjectionRead {
	const record =
		typeof json === 'object' && json !== null && !Array.isArray(json)
			? (json as Record<string, unknown>)
			: undefined;
	let checked = json;
	if (record?.deployment_version === 3) {
		const { identity, ...rest } = record;
		if (identityOf(identity) === undefined) {
			return {
				ok: false,
				refusals: [
					{
						code: 'DEPLOYMENT_INVALID',
						key: 'identity',
						message: '`identity` is not an identity this shell reads.',
						suggestion: 'Rewrite it with `loam deployment write`.',
					},
				],
				warnings: [],
			};
		}
		checked = { ...rest, deployment_version: 2 };
	}
	if (!validateProjection(checked)) {
		return {
			ok: false,
			refusals: deploymentRefusals(validateProjection.errors ?? [], 'projection'),
			warnings: [],
		};
	}
	const projection = json as ProjectionV3;
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
