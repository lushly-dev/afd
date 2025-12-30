/**
 * @fileoverview Custom assertions for command testing
 *
 * These assertions provide clear error messages when tests fail.
 */

import type { CommandError, CommandResult } from '@afd/core';
import { isFailure, isSuccess } from '@afd/core';

/**
 * Assert that a result is successful.
 *
 * @throws If the result is not successful
 */
export function assertSuccess<T>(
	result: CommandResult<T>,
	message?: string
): asserts result is CommandResult<T> & { success: true; data: T } {
	if (!isSuccess(result)) {
		const errorMsg = result.error
			? `${result.error.code}: ${result.error.message}`
			: 'Unknown error';
		throw new Error(
			message ?? `Expected success but got failure: ${errorMsg}`
		);
	}
}

/**
 * Assert that a result is a failure.
 *
 * @throws If the result is not a failure
 */
export function assertFailure<T>(
	result: CommandResult<T>,
	message?: string
): asserts result is CommandResult<T> & { success: false; error: CommandError } {
	if (!isFailure(result)) {
		throw new Error(
			message ?? `Expected failure but got success with data: ${JSON.stringify(result.data)}`
		);
	}
}

/**
 * Assert that a result has a specific error code.
 *
 * @throws If the result doesn't have the expected error code
 */
export function assertErrorCode<T>(
	result: CommandResult<T>,
	expectedCode: string,
	message?: string
): void {
	assertFailure(result, message);

	if (result.error.code !== expectedCode) {
		throw new Error(
			message ??
				`Expected error code '${expectedCode}' but got '${result.error.code}'`
		);
	}
}

/**
 * Assert that a result has confidence above a threshold.
 *
 * @throws If the result doesn't have sufficient confidence
 */
export function assertConfidence<T>(
	result: CommandResult<T>,
	minConfidence: number,
	message?: string
): void {
	if (result.confidence === undefined) {
		throw new Error(
			message ?? 'Expected confidence score but none was provided'
		);
	}

	if (result.confidence < minConfidence) {
		throw new Error(
			message ??
				`Expected confidence >= ${minConfidence} but got ${result.confidence}`
		);
	}
}

/**
 * Assert that a result has reasoning.
 *
 * @throws If the result doesn't have reasoning
 */
export function assertHasReasoning<T>(
	result: CommandResult<T>,
	message?: string
): void {
	if (!result.reasoning) {
		throw new Error(message ?? 'Expected reasoning but none was provided');
	}
}

/**
 * Assert that a result has sources.
 *
 * @throws If the result doesn't have sources
 */
export function assertHasSources<T>(
	result: CommandResult<T>,
	minSources?: number,
	message?: string
): void {
	if (!result.sources || result.sources.length === 0) {
		throw new Error(message ?? 'Expected sources but none were provided');
	}

	if (minSources !== undefined && result.sources.length < minSources) {
		throw new Error(
			message ??
				`Expected at least ${minSources} sources but got ${result.sources.length}`
		);
	}
}

/**
 * Assert that a result has a plan.
 *
 * @throws If the result doesn't have a plan
 */
export function assertHasPlan<T>(
	result: CommandResult<T>,
	message?: string
): void {
	if (!result.plan || result.plan.length === 0) {
		throw new Error(message ?? 'Expected plan but none was provided');
	}
}

/**
 * Assert that a plan step has a specific status.
 */
export function assertStepStatus<T>(
	result: CommandResult<T>,
	stepId: string,
	expectedStatus: 'pending' | 'in_progress' | 'complete' | 'failed' | 'skipped',
	message?: string
): void {
	assertHasPlan(result);

	const step = result.plan?.find((s) => s.id === stepId);
	if (!step) {
		throw new Error(
			message ?? `Plan step '${stepId}' not found`
		);
	}

	if (step.status !== expectedStatus) {
		throw new Error(
			message ??
				`Expected step '${stepId}' to have status '${expectedStatus}' but got '${step.status}'`
		);
	}
}

/**
 * Assert that an error has a suggestion.
 *
 * @throws If the error doesn't have a suggestion
 */
export function assertHasSuggestion<T>(
	result: CommandResult<T>,
	message?: string
): void {
	assertFailure(result);

	if (!result.error.suggestion) {
		throw new Error(
			message ?? 'Expected error to have a suggestion but none was provided'
		);
	}
}

/**
 * Assert that an error is retryable.
 *
 * @throws If the error is not marked as retryable
 */
export function assertRetryable<T>(
	result: CommandResult<T>,
	expectedRetryable: boolean = true,
	message?: string
): void {
	assertFailure(result);

	if (result.error.retryable !== expectedRetryable) {
		throw new Error(
			message ??
				`Expected error.retryable to be ${expectedRetryable} but got ${result.error.retryable}`
		);
	}
}

/**
 * Assert that a result has all UX-enabling fields for AI-powered commands.
 *
 * This is the recommended assertion for AI-powered commands.
 *
 * @throws If any UX-enabling field is missing
 */
export function assertAiResult<T>(
	result: CommandResult<T>,
	options?: {
		minConfidence?: number;
		requireSources?: boolean;
		requireAlternatives?: boolean;
	}
): void {
	assertSuccess(result);

	// Confidence is required for AI results
	if (result.confidence === undefined) {
		throw new Error('AI result must include confidence score');
	}

	if (options?.minConfidence !== undefined && result.confidence < options.minConfidence) {
		throw new Error(
			`AI result confidence ${result.confidence} is below minimum ${options.minConfidence}`
		);
	}

	// Reasoning is recommended
	if (!result.reasoning) {
		throw new Error('AI result should include reasoning');
	}

	// Sources may be required
	if (options?.requireSources && (!result.sources || result.sources.length === 0)) {
		throw new Error('AI result must include sources');
	}

	// Alternatives may be required
	if (
		options?.requireAlternatives &&
		(!result.alternatives || result.alternatives.length === 0)
	) {
		throw new Error('AI result must include alternatives');
	}
}
