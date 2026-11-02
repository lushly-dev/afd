/**
 * @fileoverview A deployment file's or projection's validator errors as refusals.
 */

import { ADMITTED_KEYS } from './_generated/facts.js';
import { admittedAt, keyOf, suggestKey } from './pointers.js';
import type { DeploymentRefusal } from './types.js';
import { pointerOf, refusesKey, reportedErrors, type ValidatorError } from './validator-errors.js';

const EXPOSE_KEY = /^\/apps\/[^/]+\/(?:commands\/[^/]+\/)?expose\/(apps|mcp|cli)$/;

function deploymentRow(
	pointer: string,
	error: ValidatorError,
	schema: 'deployment' | 'projection'
): Omit<DeploymentRefusal, 'key'> {
	const key = keyOf(pointer);
	if (schema === 'deployment') {
		if (pointer === '/deployment_version') {
			return {
				code: 'DEPLOYMENT_VERSION_UNSUPPORTED',
				message: `\`deployment_version\` ${error.message ?? 'is not served'}.`,
				suggestion: 'This shell reads `deployment_version = 1`.',
			};
		}
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
	schema: 'deployment' | 'projection'
): DeploymentRefusal[] {
	return [...reportedErrors(errors).values()].map((error) => {
		const pointer = pointerOf(error);
		return { ...deploymentRow(pointer, error, schema), key: keyOf(pointer) };
	});
}
