/** Complete envelope validation before a batch or pipeline can execute side effects. */
import type { BatchCommand, BatchRequest } from './batch.js';
import type { CommandError } from './errors.js';
import type { PipelineRequest, PipelineStep } from './pipeline.js';
import { isPlainObject, MAX_NESTING_DEPTH } from './pipeline-variables.js';

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function optionalString(value: unknown): boolean {
	return value === undefined || typeof value === 'string';
}
function optionalBoolean(value: unknown): boolean {
	return value === undefined || typeof value === 'boolean';
}
function timeout(value: unknown): boolean {
	return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}
export function isBatchCommand(value: unknown): value is BatchCommand {
	return (
		record(value) &&
		typeof value.command === 'string' &&
		value.command.trim().length > 0 &&
		optionalString(value.id)
	);
}
export function isBatchRequest(value: unknown): value is BatchRequest {
	if (
		!record(value) ||
		!Array.isArray(value.commands) ||
		!Array.from(value.commands).every(isBatchCommand)
	)
		return false;
	const options = value.options;
	return (
		options === undefined ||
		(record(options) &&
			optionalBoolean(options.stopOnError) &&
			timeout(options.timeout) &&
			(options.parallelism === undefined ||
				(typeof options.parallelism === 'number' &&
					Number.isInteger(options.parallelism) &&
					options.parallelism > 0)))
	);
}
function condition(value: unknown, ancestors = new Set<unknown>()): boolean {
	if (!record(value) || ancestors.has(value) || ancestors.size >= 128) return false;
	const keys = Object.keys(value);
	if (keys.length !== 1) return false;
	const key = keys[0];
	if (!key) return false;
	const operand = value[key];
	if (key === '$exists') return typeof operand === 'string';
	if (['$eq', '$ne', '$gt', '$gte', '$lt', '$lte'].includes(key)) {
		return (
			Array.isArray(operand) &&
			operand.length === 2 &&
			typeof operand[0] === 'string' &&
			(key === '$eq' ||
				key === '$ne' ||
				(typeof operand[1] === 'number' && Number.isFinite(operand[1])))
		);
	}
	ancestors.add(value);
	const valid =
		key === '$not'
			? condition(operand, ancestors)
			: (key === '$and' || key === '$or') &&
				Array.isArray(operand) &&
				Array.from(operand).every((item) => condition(item, ancestors));
	ancestors.delete(value);
	return valid;
}
export function isPipelineStep(value: unknown): value is PipelineStep {
	return (
		record(value) &&
		typeof value.command === 'string' &&
		value.command.trim().length > 0 &&
		optionalString(value.as) &&
		optionalBoolean(value.stream) &&
		(value.input === undefined || record(value.input)) &&
		(value.when === undefined || condition(value.when))
	);
}
function jsonLeaf(value: unknown, inArray: boolean): boolean {
	return (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'boolean' ||
		(typeof value === 'number' && Number.isFinite(value)) ||
		(value === undefined && !inArray)
	);
}
/**
 * Walk nested arrays and plain objects without recursion. Returns `too-deep` when they nest
 * more than {@link MAX_NESTING_DEPTH} levels (so cycles terminate), `invalid` when `json` is set
 * and a value is not JSON (an `undefined` object property counts as omitted), and `ok` otherwise.
 */
function nesting(value: unknown, json: boolean): 'ok' | 'too-deep' | 'invalid' {
	const pending = [{ value, depth: 0, inArray: true }];
	for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
		const current = item.value;
		if (Array.isArray(current) || isPlainObject(current)) {
			if (item.depth >= MAX_NESTING_DEPTH) return 'too-deep';
			const inArray = Array.isArray(current);
			const children: unknown[] = Array.isArray(current)
				? Array.from(current)
				: Object.values(current);
			for (const child of children) pending.push({ value: child, depth: item.depth + 1, inArray });
		} else if (json && !jsonLeaf(current, item.inArray)) {
			return 'invalid';
		}
	}
	return 'ok';
}
function depthError(what: string, details: Record<string, unknown>): CommandError {
	return {
		code: 'VALIDATION_ERROR',
		message: `${what} is nested deeper than ${MAX_NESTING_DEPTH} levels`,
		suggestion: `Flatten it to at most ${MAX_NESTING_DEPTH} levels of nested objects and arrays and retry`,
		retryable: false,
		details: { ...details, maxDepth: MAX_NESTING_DEPTH },
	};
}
/**
 * Check pipeline limits that apply after the envelope is valid: step inputs and the request
 * `input` may nest at most 64 levels. Returns a `VALIDATION_ERROR`, or undefined when within
 * limits. Iterative, so deep or cyclic inputs never overflow the stack.
 */
export function pipelineLimitError(request: PipelineRequest): CommandError | undefined {
	if (request.input !== undefined && nesting(request.input, true) === 'too-deep') {
		return depthError('The pipeline input', { field: 'input' });
	}
	for (const [stepIndex, step] of request.steps.entries()) {
		if (step.input !== undefined && nesting(step.input, false) === 'too-deep') {
			return depthError(`The input of step ${stepIndex}`, { stepIndex });
		}
	}
	return undefined;
}
export function isPipelineRequest(value: unknown): value is PipelineRequest {
	if (
		!record(value) ||
		!optionalString(value.id) ||
		(value.input !== undefined && nesting(value.input, true) === 'invalid') ||
		!Array.isArray(value.steps) ||
		!Array.from(value.steps).every(isPipelineStep)
	)
		return false;
	const options = value.options;
	return (
		options === undefined ||
		(record(options) &&
			optionalBoolean(options.continueOnFailure) &&
			optionalBoolean(options.parallel) &&
			timeout(options.timeoutMs) &&
			(options.onProgress === undefined || typeof options.onProgress === 'function'))
	);
}
