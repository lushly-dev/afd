/**
 * @fileoverview The steps of an `afd-batch` or `afd-pipe` as its up-front approval sees them
 * (#459): each step's command and validated input, or that its input comes from an earlier step.
 */

import type { BatchRequest, PipelineRequest } from '@lushly-dev/afd-core';
import { resolveVariables } from '@lushly-dev/afd-core';
import { canonicalJson } from './approval-crypto.js';
import type { UpFrontStep } from './approval-relay.js';
import type { ZodCommandDefinition } from './schema.js';
import { type EnhancedValidationResult, validateInputEnhanced } from './validation.js';

/** Deeper inputs are rejected by the pipeline before any step runs. */
const MAX_DEPTH = 64;
/** Longer strings are literals (`spec/pipeline-variables.md`, "Limits"). */
const MAX_REFERENCE_LENGTH = 1024;
/**
 * The reference grammar of `spec/pipeline-variables.md` (as Rust's resolver spells it): group 1
 * is `prev`, `first` or `input`; a match without `input` there reads an earlier step's data.
 */
const REFERENCE =
	/^\$(?:(prev|first|input)|steps\[\d+\]|steps\.[^.[\]\s]+)(?:\.[^.[\]\s]+(?:\[\d+\])?)*$/;

/** Whether `value` holds a reference to an earlier step's data (`$prev`, `$first`, `$steps`). */
export function readsStepData(value: unknown, depth = 0): boolean {
	if (typeof value === 'string') {
		if (value.length > MAX_REFERENCE_LENGTH || value.startsWith('$$')) return false;
		const match = REFERENCE.exec(value);
		return match !== null && match[1] !== 'input';
	}
	const isArray = Array.isArray(value);
	if (!isArray && !(value && typeof value === 'object')) return false;
	// Deeper containers are rejected by the pipeline before any step runs.
	if (depth >= MAX_DEPTH) return true;
	const items = isArray ? (value as unknown[]) : Object.values(value as object);
	return items.some((item) => readsStepData(item, depth + 1));
}

/**
 * What a step's input was before validation, as canonical JSON: the engine finds the step it is
 * about to run by it. `undefined` for an input canonical JSON cannot spell, which matches no step.
 */
export function sentKey(input: unknown): string | undefined {
	try {
		return input === undefined ? 'undefined' : canonicalJson(input);
	} catch {
		return undefined;
	}
}

/**
 * The canonical validated input the human approved for each step in an earlier round of the same
 * request, by step index (#1414).
 */
export type ApprovedInputs = ReadonlyMap<number, string>;

/**
 * The input approved earlier, as the schema reads it back: the same value (so what runs is what
 * was approved), with what JSON cannot carry (a coerced date) restored. `undefined` when the
 * schema does not read it back unchanged; the step is then validated as sent.
 */
function restored(
	definition: ZodCommandDefinition,
	approved: string
): { input: unknown } | undefined {
	try {
		const result = validateInputEnhanced(definition.inputSchema, JSON.parse(approved));
		return result.success && canonicalJson(result.data) === approved
			? { input: result.data }
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * Validate, as a gated step starts, the approved input it is about to run (#1511): a refinement
 * that reads live state (`id: default(nextId).refine(notExists)`) then checks the value that runs,
 * not only a fresh default of the input as sent, and the schema must read the approved input back
 * to the same canonical JSON. A failure is a `VALIDATION_ERROR`; nothing then runs.
 */
export function checkApprovedAtRun(
	definition: ZodCommandDefinition,
	approved: unknown,
	maxIssues?: number
): EnhancedValidationResult<unknown> {
	let canonical: string | undefined;
	try {
		canonical = canonicalJson(approved);
	} catch {
		canonical = undefined;
	}
	// An input with no canonical form was never approved (the gate refuses it), only let through.
	if (canonical === undefined) return { success: true, data: approved, errors: [] };
	const result = validateInputEnhanced(definition.inputSchema, JSON.parse(canonical), maxIssues);
	if (!result.success) return result;
	let again: string | undefined;
	try {
		again = canonicalJson(result.data);
	} catch {
		again = undefined;
	}
	if (again === canonical) return { success: true, data: approved, errors: [] };
	return {
		success: false,
		data: undefined,
		errors: [
			{
				path: '',
				code: 'custom',
				message:
					'The approved input no longer validates to itself: the schema changed it when the step ran',
			},
		],
	};
}

function validated(
	commands: readonly ZodCommandDefinition[],
	index: number,
	command: string,
	input: unknown,
	approved?: string
): UpFrontStep {
	const definition = commands.find((candidate) => candidate.name === command);
	if (!definition) return { index, command, dynamic: false, valid: false };
	const kept = approved === undefined ? undefined : restored(definition, approved);
	if (kept) {
		return {
			index,
			command,
			dynamic: false,
			valid: true,
			input: kept.input,
			sent: sentKey(input),
			kept: true,
		};
	}
	try {
		const result = validateInputEnhanced(definition.inputSchema, input);
		return result.success
			? { index, command, dynamic: false, valid: true, input: result.data, sent: sentKey(input) }
			: { index, command, dynamic: false, valid: false };
	} catch {
		// The step fails validation when it runs too.
		return { index, command, dynamic: false, valid: false };
	}
}

/** The steps of an `afd-batch`: every item's input is known up front. */
export function batchSteps(
	request: BatchRequest,
	commands: readonly ZodCommandDefinition[],
	approved?: ApprovedInputs
): UpFrontStep[] {
	return request.commands.map((item, index) =>
		validated(commands, index, item.command, item.input, approved?.get(index))
	);
}

/**
 * The steps of an `afd-pipe`: a step whose input reads an earlier step's data is not known up
 * front; any other has its `$input` references resolved, as the pipeline will.
 */
export function pipelineSteps(
	request: PipelineRequest,
	commands: readonly ZodCommandDefinition[],
	approved?: ApprovedInputs
): UpFrontStep[] {
	// Resolved values are copies, so validation cannot change the request.
	const context = { pipelineInput: request.input, steps: [] };
	return request.steps.map((step, index) => {
		// A command the caller cannot run is not one: it fails as a missing name, telling nothing.
		if (!commands.some((command) => command.name === step.command)) {
			return { index, command: step.command, dynamic: false, valid: false };
		}
		if (readsStepData(step.input)) {
			return { index, command: step.command, dynamic: true, valid: false };
		}
		let input: unknown;
		try {
			input = step.input ? resolveVariables(step.input, context) : {};
		} catch {
			return { index, command: step.command, dynamic: false, valid: false };
		}
		return validated(commands, index, step.command, input, approved?.get(index));
	});
}
