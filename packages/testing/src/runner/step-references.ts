/**
 * @lushly-dev/afd-testing - Step reference resolution
 *
 * Resolves `${{ steps[N].path.to.value }}` references in step input against
 * the results of earlier steps. A reference that does not resolve to a value
 * throws a `StepReferenceError`; it never silently becomes `''` or `undefined`.
 */

import type { CommandResult } from '@lushly-dev/afd-core';

/** Thrown when a step reference cannot be resolved. */
export class StepReferenceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'StepReferenceError';
	}
}

const EXACT_REFERENCE = /^\$\{\{\s*steps\[(\d+)\]\.(.+?)\s*\}\}$/;
const EMBEDDED_REFERENCE = /\$\{\{\s*steps\[(\d+)\]\.(.+?)\s*\}\}/g;

/**
 * Get a value at a dot-notation path, with `name[index]` array access.
 */
export function getValueAtPath(obj: unknown, path: string): unknown {
	let current: unknown = obj;

	for (const part of path.split('.')) {
		if (current === null || current === undefined || typeof current !== 'object') {
			return undefined;
		}

		const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
		if (arrayMatch?.[1] !== undefined && arrayMatch[2] !== undefined) {
			const list = (current as Record<string, unknown>)[arrayMatch[1]];
			if (!Array.isArray(list)) {
				return undefined;
			}
			current = list[Number.parseInt(arrayMatch[2], 10)];
		} else {
			current = (current as Record<string, unknown>)[part];
		}
	}

	return current;
}

function lookup(
	stepOutputs: ReadonlyArray<CommandResult<unknown>>,
	stepIndexText: string,
	path: string,
	reference: string
): unknown {
	const stepIndex = Number.parseInt(stepIndexText, 10);
	if (stepIndex >= stepOutputs.length) {
		throw new StepReferenceError(
			`Unresolved step reference ${reference}: step ${stepIndex} has not run (only steps before the current one can be referenced)`
		);
	}
	const value = getValueAtPath(stepOutputs[stepIndex], path);
	if (value === undefined) {
		throw new StepReferenceError(
			`Unresolved step reference ${reference}: steps[${stepIndex}] has no value at '${path}'`
		);
	}
	return value;
}

function stringify(value: unknown): string {
	return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

function resolveString(value: string, stepOutputs: ReadonlyArray<CommandResult<unknown>>): unknown {
	// A string that is exactly one reference keeps the referenced value's type
	const exact = value.match(EXACT_REFERENCE);
	if (exact?.[1] !== undefined && exact[2] !== undefined) {
		return lookup(stepOutputs, exact[1], exact[2], value);
	}

	return value.replace(EMBEDDED_REFERENCE, (reference, stepIndex: string, path: string) =>
		stringify(lookup(stepOutputs, stepIndex, path, reference))
	);
}

function resolveValue(value: unknown, stepOutputs: ReadonlyArray<CommandResult<unknown>>): unknown {
	if (typeof value === 'string') {
		return resolveString(value, stepOutputs);
	}
	if (Array.isArray(value)) {
		return value.map((item) => resolveValue(item, stepOutputs));
	}
	if (typeof value === 'object' && value !== null) {
		const resolved: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			resolved[key] = resolveValue(item, stepOutputs);
		}
		return resolved;
	}
	return value;
}

/**
 * Resolve every step reference in a step's input.
 *
 * @param input - The step input (may be undefined)
 * @param stepOutputs - Results of the steps that already ran, by index
 * @throws StepReferenceError when a reference points at a step that has not
 *   run or at a path with no value
 */
export function resolveStepReferences(
	input: Record<string, unknown> | undefined,
	stepOutputs: ReadonlyArray<CommandResult<unknown>>
): Record<string, unknown> | undefined {
	if (!input) {
		return undefined;
	}
	return resolveValue(input, stepOutputs) as Record<string, unknown>;
}
