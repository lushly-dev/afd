/**
 * @fileoverview The steps of an `afd-batch` or `afd-pipe` as its up-front approval sees them
 * (#459): each step's command and validated input, or that its input comes from an earlier step.
 */

import type { BatchRequest, PipelineRequest } from '@lushly-dev/afd-core';
import { resolveVariables } from '@lushly-dev/afd-core';
import type { UpFrontStep } from './approval-relay.js';
import type { ZodCommandDefinition } from './schema.js';
import { validateInputEnhanced } from './validation.js';

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
	if (depth >= MAX_DEPTH) return true;
	if (Array.isArray(value)) return value.some((item) => readsStepData(item, depth + 1));
	if (value && typeof value === 'object') {
		return Object.values(value).some((item) => readsStepData(item, depth + 1));
	}
	return false;
}

function validated(
	commands: readonly ZodCommandDefinition[],
	index: number,
	command: string,
	input: unknown
): UpFrontStep {
	const definition = commands.find((candidate) => candidate.name === command);
	if (!definition) return { index, command, dynamic: false, valid: false };
	try {
		const result = validateInputEnhanced(definition.inputSchema, input);
		return result.success
			? { index, command, dynamic: false, valid: true, input: result.data }
			: { index, command, dynamic: false, valid: false };
	} catch {
		// The step fails validation when it runs too.
		return { index, command, dynamic: false, valid: false };
	}
}

/** The steps of an `afd-batch`: every item's input is known up front. */
export function batchSteps(
	request: BatchRequest,
	commands: readonly ZodCommandDefinition[]
): UpFrontStep[] {
	return request.commands.map((item, index) =>
		validated(commands, index, item.command, item.input)
	);
}

/**
 * The steps of an `afd-pipe`: a step whose input reads an earlier step's data is not known up
 * front; any other has its `$input` references resolved, as the pipeline will.
 */
export function pipelineSteps(
	request: PipelineRequest,
	commands: readonly ZodCommandDefinition[]
): UpFrontStep[] {
	// Resolved values are copies, so validation cannot change the request.
	const context = { pipelineInput: request.input, steps: [] };
	return request.steps.map((step, index) => {
		if (readsStepData(step.input)) {
			return { index, command: step.command, dynamic: true, valid: false };
		}
		let input: unknown;
		try {
			input = step.input ? resolveVariables(step.input, context) : {};
		} catch {
			return { index, command: step.command, dynamic: false, valid: false };
		}
		return validated(commands, index, step.command, input);
	});
}
