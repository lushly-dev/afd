/**
 * Browser-safe Specimen command runner `'afd'`.
 *
 * Dispatches explicit AFD application commands against a mounted element that
 * exposes `call(name, input)` returning a structured `CommandResult`.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { CommandRunner } from '@lushly-dev/specimen';

/** Default Specimen runner and job driver identifier for AFD application commands. */
export const AFD_RUNNER_ID = 'afd' as const;

/** A mounted DOM element exposing an AFD command dispatch method. */
export interface AfdCallableElement extends Element {
	call?: (name: string, input?: Record<string, unknown>) => unknown;
	commands?: readonly string[] | (() => readonly string[]);
}

/** Check whether a value conforms to AFD's structured `CommandResult` wire shape (`spec/schema/result.json`). */
export function isCommandResult(value: unknown): value is CommandResult<unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.success !== 'boolean') {
		return false;
	}
	if (record.success) {
		return record.error === undefined;
	}
	if (record.data !== undefined) {
		return false;
	}
	const err = record.error;
	if (typeof err !== 'object' || err === null || Array.isArray(err)) {
		return false;
	}
	const errRecord = err as Record<string, unknown>;
	return (
		typeof errRecord.code === 'string' &&
		errRecord.code.length > 0 &&
		typeof errRecord.message === 'string'
	);
}

function normalizeCommandInput(input: unknown, name: string): Record<string, unknown> {
	if (input === undefined || input === null) {
		return {};
	}
	if (typeof input === 'object' && !Array.isArray(input)) {
		return input as Record<string, unknown>;
	}
	throw new Error(
		`AFD command '${name}' expects an object input, received ${Array.isArray(input) ? 'array' : typeof input}.`
	);
}

/**
 * Create the Specimen `'afd'` `CommandRunner`.
 *
 * Invokes `element.call(name, input)` on the resolved target element and verifies
 * that the returned value is a structured `CommandResult`. Failure results
 * (`{ success: false, error }`) are returned intact so scenario expectations can
 * evaluate them.
 */
export function createAfdCommandRunner(): CommandRunner {
	return {
		commands(element: Element): string[] | undefined {
			const callable = element as AfdCallableElement;
			const raw = typeof callable.commands === 'function' ? callable.commands() : callable.commands;
			if (Array.isArray(raw) && raw.every((item) => typeof item === 'string')) {
				return [...raw];
			}
			return undefined;
		},

		async run(element: Element, name: string, input: unknown): Promise<CommandResult<unknown>> {
			if (typeof name !== 'string' || name.trim() === '') {
				throw new Error("AFD command name must be a non-empty string for the 'afd' runner.");
			}
			const callable = element as AfdCallableElement;
			if (typeof callable.call !== 'function') {
				throw new Error(
					`Target element <${element.localName}> does not expose a call(name, input) method for the '${AFD_RUNNER_ID}' runner.`
				);
			}
			const normalizedInput = normalizeCommandInput(input, name);
			const result: unknown = await callable.call(name, normalizedInput);
			if (!isCommandResult(result)) {
				throw new Error(
					`AFD command '${name}' on <${element.localName}> did not return a structured CommandResult (expected an object with boolean 'success').`
				);
			}
			return result;
		},
	};
}
