/**
 * @fileoverview The browser projection's reader, versions 2 and 3 (phase 3 specification, 2.2). The web host runs it on
 * `deployment.json` in stage B (phase 2 specification, 2.2); its schema has no key for a location, a
 * credential or a command line.
 */

import { deploymentRefusals } from './deployment-refusals.js';
import { keyOf } from './pointers.js';
import type { DeploymentRefusal, ProjectionRead, ProjectionV3 } from './types.js';
import { validateProjection } from './validate.generated.js';

/** The bound organization's slug, as the deployment file has it (2.2). */
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** `path` relative to `site.base_path`: no leading `/`, no `.` or `..` segment (2.2). */
const AUTH_PATH = /^(?!(.*\/)?\.\.?(\/|$))[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/;
const METHOD = /^(passkey|password|oidc:[a-z0-9][a-z0-9-]{0,31})$/;

/**
 * Whether a version 3 projection's `identity` is one `projection.v3.json` admits (2.2): none, exactly
 * `{ mode: 'local' }`, or `provider` with its slug, path and methods and no other key. Stage B's alone:
 * stage A boots anything but an exact `local` as `provider` (`readBoot`).
 */
function admitted(value: unknown): boolean {
	if (value === undefined) return true;
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const { mode, organization, path, methods, ...rest } = value as Record<string, unknown>;
	if (Object.keys(rest).length > 0) return false;
	if (mode === 'local') return organization === path && path === methods && methods === undefined;
	return (
		mode === 'provider' &&
		typeof organization === 'string' &&
		SLUG.test(organization) &&
		typeof path === 'string' &&
		AUTH_PATH.test(path) &&
		Array.isArray(methods) &&
		methods.length > 0 &&
		new Set(methods).size === methods.length &&
		methods.every((method) => typeof method === 'string' && METHOD.test(method))
	);
}

/**
 * Reads versions 2 and 3. The generated validator is version 2's; a version 3 projection is version 2's
 * fields and `identity`, which `admitted` checks as `projection.v3.json` has it (its test holds the two
 * equal). Ajv's code for that one key costs the page's `apps` row about 6,700 bytes (phase 3 specification,
 * 13); stage A boots anything but an exact `local` as `provider`.
 */
export function readProjection(json: unknown): ProjectionRead {
	let checked = json;
	const { identity, ...rest } = (json ?? {}) as Record<string, unknown>;
	if (rest.deployment_version === 3) {
		if (!admitted(identity)) {
			// As the validator would report it: `DEPLOYMENT_INVALID`, keyed `identity`.
			const error = {
				instancePath: '/identity',
				keyword: 'identity',
				message: 'is invalid',
				params: {},
			};
			return { ok: false, refusals: deploymentRefusals([error], 'projection'), warnings: [] };
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
