/**
 * @fileoverview A deployment file's or projection's validator errors as refusals.
 */

import { ADMITTED_KEYS } from './_generated/facts.js';
import { admittedAt, keyOf, suggestKey } from './pointers.js';
import type { DeploymentRefusal } from './types.js';
import { pointerOf, refusesKey, reportedErrors, type ValidatorError } from './validator-errors.js';

const EXPOSE_KEY = /^\/apps\/[^/]+\/(?:commands\/[^/]+\/)?expose\/(apps|mcp|cli)$/;

/** A schema the readers report against: a deployment file of either version, or the projection. */
export type DeploymentSchema = 'deployment' | 'deploymentV2' | 'deploymentV3' | 'projection';

const PROJECT_KEY = /^\/apps\/[^/]+\/projects\/\d+$/;

/** The rows version 2 adds (phase 2 specification, 4.2), by the pointer that failed. */
function versionTwoRow(pointer: string, key: string): Omit<DeploymentRefusal, 'key'> | undefined {
	if (pointer === '/workspace/id') {
		return {
			code: 'DEPLOYMENT_WORKSPACE_INVALID',
			message: `\`${key}\` must be lowercase letters, digits and \`-\`, at most 63, and not a name a deployment's own files use.`,
			suggestion:
				'Choose another id, such as `acme`: `apps`, `assets`, `mounts`, `sandbox`, `p`, `~`, `deployment.json`, `index.html` and `404.html` are reserved.',
		};
	}
	if (pointer === '/site/base_path') {
		return {
			code: 'DEPLOYMENT_BASE_PATH_INVALID',
			message: `\`${key}\` must be a path with both slashes and no \`.\` or \`..\` segment.`,
			suggestion: 'Write it as `/`, or `/loam/`.',
		};
	}
	if (PROJECT_KEY.test(pointer)) {
		return {
			code: 'DEPLOYMENT_PROJECT_INVALID',
			message: `\`${key}\` is not a project slug.`,
			suggestion:
				'A slug is lowercase letters, digits and `-`, at most 63, starting and ending with a letter or digit.',
		};
	}
	return undefined;
}

/** Any `[identity]` key out of shape (phase 3 specification, 2.2). */
const identityRow = (key: string): Omit<DeploymentRefusal, 'key'> => ({
	code: 'DEPLOYMENT_IDENTITY_INVALID',
	message: `\`${key}\` is not an identity this shell reads.`,
	suggestion:
		'Write `[identity]` with `mode`, `provider = "better-auth"`, `organization`, `path` and `methods`, and nothing else.',
});

function deploymentRow(
	pointer: string,
	error: ValidatorError,
	schema: DeploymentSchema
): Omit<DeploymentRefusal, 'key'> {
	const key = keyOf(pointer);
	if (schema !== 'projection') {
		if (pointer === '/deployment_version') {
			return {
				code: 'DEPLOYMENT_VERSION_UNSUPPORTED',
				message: `\`deployment_version\` ${error.message ?? 'is not served'}.`,
				suggestion:
					'This shell reads `deployment_version = 1`, `2` and `3`; `3` is needed only for `[identity]`.',
			};
		}
		if (schema === 'deploymentV3' && pointer.startsWith('/identity')) return identityRow(key);
		const versionTwo = schema !== 'deployment' ? versionTwoRow(pointer, key) : undefined;
		if (versionTwo) return versionTwo;
		const expose = pointer.match(EXPOSE_KEY)?.[1];
		if (expose) {
			return {
				code: 'DEPLOYMENT_EXPOSE_UNAVAILABLE',
				message:
					expose === 'apps'
						? '`expose.apps` waits for D30, in phase 5.'
						: `\`expose.${expose}\` has no surface in phase 1.`,
				suggestion:
					expose === 'apps'
						? 'Remove `apps` until phase 5.'
						: `Set \`${expose} = false\`, or remove it.`,
			};
		}
	}
	const table = ADMITTED_KEYS[schema] as Readonly<Record<string, readonly string[]>>;
	if (refusesKey(error)) {
		const parts = pointer.split('/');
		const name = parts.at(-1) as string;
		return {
			code: 'DEPLOYMENT_INVALID',
			message: `\`${key}\` is not a key here.`,
			suggestion: suggestKey(name, admittedAt(table, parts.slice(0, -1).join('/'))),
		};
	}
	return {
		code: 'DEPLOYMENT_INVALID',
		message: `\`${key}\` ${error.message ?? `fails \`${error.keyword}\``}.`,
		suggestion:
			schema === 'projection'
				? 'Rewrite it with `loam deployment write`.'
				: `Correct \`${key}\`, as ${error.message ?? 'the schema says'}.`,
	};
}

/** The validator's errors, each key once. */
export function deploymentRefusals(
	errors: readonly ValidatorError[],
	schema: DeploymentSchema
): DeploymentRefusal[] {
	return [...reportedErrors(errors).values()].map((error) => {
		const pointer = pointerOf(error);
		return { ...deploymentRow(pointer, error, schema), key: keyOf(pointer) };
	});
}
