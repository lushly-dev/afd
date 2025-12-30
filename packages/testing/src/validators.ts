/**
 * @fileoverview Validators for command results and schemas
 *
 * These validators help ensure commands return proper results
 * with all the expected fields for good agent UX.
 */

import type { CommandDefinition, CommandError, CommandResult } from '@afd/core';
import { isCommandError, isFailure, isSuccess } from '@afd/core';

/**
 * Validation result.
 */
export interface ValidationResult {
	valid: boolean;
	errors: ValidationError[];
	warnings: ValidationWarning[];
}

/**
 * Validation error - something that must be fixed.
 */
export interface ValidationError {
	path: string;
	message: string;
	code: string;
}

/**
 * Validation warning - something that should be considered.
 */
export interface ValidationWarning {
	path: string;
	message: string;
	code: string;
}

/**
 * Validate a CommandResult against expected structure.
 *
 * @param result - The result to validate
 * @param options - Validation options
 */
export function validateResult<T>(
	result: CommandResult<T>,
	options: ResultValidationOptions = {}
): ValidationResult {
	const errors: ValidationError[] = [];
	const warnings: ValidationWarning[] = [];

	// Check required fields
	if (typeof result.success !== 'boolean') {
		errors.push({
			path: 'success',
			message: 'success must be a boolean',
			code: 'INVALID_SUCCESS_TYPE',
		});
	}

	// Check success/data consistency
	if (result.success && result.data === undefined && options.requireData !== false) {
		warnings.push({
			path: 'data',
			message: 'Successful result has no data',
			code: 'MISSING_DATA',
		});
	}

	// Check failure/error consistency
	if (!result.success && !result.error) {
		errors.push({
			path: 'error',
			message: 'Failed result must have error details',
			code: 'MISSING_ERROR',
		});
	}

	// Validate error structure if present
	if (result.error) {
		const errorValidation = validateError(result.error);
		errors.push(...errorValidation.errors.map((e) => ({ ...e, path: `error.${e.path}` })));
		warnings.push(...errorValidation.warnings.map((w) => ({ ...w, path: `error.${w.path}` })));
	}

	// Check UX-enabling fields if required
	if (options.requireConfidence && result.confidence === undefined) {
		warnings.push({
			path: 'confidence',
			message: 'AI-powered commands should include confidence score',
			code: 'MISSING_CONFIDENCE',
		});
	}

	if (result.confidence !== undefined) {
		if (typeof result.confidence !== 'number') {
			errors.push({
				path: 'confidence',
				message: 'confidence must be a number',
				code: 'INVALID_CONFIDENCE_TYPE',
			});
		} else if (result.confidence < 0 || result.confidence > 1) {
			errors.push({
				path: 'confidence',
				message: 'confidence must be between 0 and 1',
				code: 'INVALID_CONFIDENCE_RANGE',
			});
		}
	}

	if (options.requireReasoning && !result.reasoning) {
		warnings.push({
			path: 'reasoning',
			message: 'AI-powered commands should include reasoning',
			code: 'MISSING_REASONING',
		});
	}

	if (options.requireSources && (!result.sources || result.sources.length === 0)) {
		warnings.push({
			path: 'sources',
			message: 'Commands using external data should include sources',
			code: 'MISSING_SOURCES',
		});
	}

	// Validate plan if present
	if (result.plan) {
		for (let i = 0; i < result.plan.length; i++) {
			const step = result.plan[i];
			if (!step) continue;

			if (!step.id) {
				errors.push({
					path: `plan[${i}].id`,
					message: 'Plan step must have an id',
					code: 'MISSING_STEP_ID',
				});
			}
			if (!step.action) {
				errors.push({
					path: `plan[${i}].action`,
					message: 'Plan step must have an action',
					code: 'MISSING_STEP_ACTION',
				});
			}
			if (!step.status) {
				errors.push({
					path: `plan[${i}].status`,
					message: 'Plan step must have a status',
					code: 'MISSING_STEP_STATUS',
				});
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * Options for result validation.
 */
export interface ResultValidationOptions {
	/** Whether to require data on success (default: true via warning) */
	requireData?: boolean;
	/** Whether to require confidence score */
	requireConfidence?: boolean;
	/** Whether to require reasoning */
	requireReasoning?: boolean;
	/** Whether to require sources */
	requireSources?: boolean;
}

/**
 * Validate a CommandError.
 */
export function validateError(error: unknown): ValidationResult {
	const errors: ValidationError[] = [];
	const warnings: ValidationWarning[] = [];

	if (!isCommandError(error)) {
		errors.push({
			path: '',
			message: 'Error must have code and message properties',
			code: 'INVALID_ERROR_STRUCTURE',
		});
		return { valid: false, errors, warnings };
	}

	if (!error.code || typeof error.code !== 'string') {
		errors.push({
			path: 'code',
			message: 'Error code must be a non-empty string',
			code: 'INVALID_ERROR_CODE',
		});
	}

	if (!error.message || typeof error.message !== 'string') {
		errors.push({
			path: 'message',
			message: 'Error message must be a non-empty string',
			code: 'INVALID_ERROR_MESSAGE',
		});
	}

	// Check for actionable error
	if (!error.suggestion) {
		warnings.push({
			path: 'suggestion',
			message: 'Errors should include a suggestion for recovery',
			code: 'MISSING_SUGGESTION',
		});
	}

	if (error.retryable === undefined) {
		warnings.push({
			path: 'retryable',
			message: 'Errors should indicate if they are retryable',
			code: 'MISSING_RETRYABLE',
		});
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * Validate a command definition.
 */
export function validateCommandDefinition(
	command: CommandDefinition
): ValidationResult {
	const errors: ValidationError[] = [];
	const warnings: ValidationWarning[] = [];

	// Validate name
	if (!command.name || typeof command.name !== 'string') {
		errors.push({
			path: 'name',
			message: 'Command must have a name',
			code: 'MISSING_NAME',
		});
	} else if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/.test(command.name)) {
		warnings.push({
			path: 'name',
			message: 'Command name should use dot notation (e.g., "document.create")',
			code: 'INVALID_NAME_FORMAT',
		});
	}

	// Validate description
	if (!command.description || typeof command.description !== 'string') {
		errors.push({
			path: 'description',
			message: 'Command must have a description',
			code: 'MISSING_DESCRIPTION',
		});
	} else if (command.description.length < 10) {
		warnings.push({
			path: 'description',
			message: 'Description should be more detailed',
			code: 'SHORT_DESCRIPTION',
		});
	}

	// Validate parameters
	if (!command.parameters || !Array.isArray(command.parameters)) {
		errors.push({
			path: 'parameters',
			message: 'Command must have a parameters array',
			code: 'MISSING_PARAMETERS',
		});
	} else {
		for (let i = 0; i < command.parameters.length; i++) {
			const param = command.parameters[i];
			if (!param) continue;

			if (!param.name) {
				errors.push({
					path: `parameters[${i}].name`,
					message: 'Parameter must have a name',
					code: 'MISSING_PARAM_NAME',
				});
			}
			if (!param.type) {
				errors.push({
					path: `parameters[${i}].type`,
					message: 'Parameter must have a type',
					code: 'MISSING_PARAM_TYPE',
				});
			}
			if (!param.description) {
				warnings.push({
					path: `parameters[${i}].description`,
					message: 'Parameter should have a description',
					code: 'MISSING_PARAM_DESCRIPTION',
				});
			}
		}
	}

	// Validate handler
	if (!command.handler || typeof command.handler !== 'function') {
		errors.push({
			path: 'handler',
			message: 'Command must have a handler function',
			code: 'MISSING_HANDLER',
		});
	}

	// Check for recommended fields
	if (!command.category) {
		warnings.push({
			path: 'category',
			message: 'Command should have a category for organization',
			code: 'MISSING_CATEGORY',
		});
	}

	if (!command.errors || command.errors.length === 0) {
		warnings.push({
			path: 'errors',
			message: 'Command should document possible error codes',
			code: 'MISSING_ERROR_DOCS',
		});
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}
