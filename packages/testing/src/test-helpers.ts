/**
 * @fileoverview Test helpers for command testing
 *
 * These helpers make it easy to test commands in isolation.
 */

import type {
	CommandContext,
	CommandDefinition,
	CommandHandler,
	CommandResult,
} from '@lushly-dev/afd-core';
import {
	createCommandRegistry,
	failure,
	isFailure,
	isSuccess,
	success,
	wrapError,
} from '@lushly-dev/afd-core';

import {
	validateCommandDefinition,
	validateResult,
	type ResultValidationOptions,
	type ValidationResult,
} from './validators.js';

/**
 * Test context for command execution.
 */
export interface TestContext extends CommandContext {
	/** Mock current time */
	now?: Date;
	/** Mock user ID */
	userId?: string;
	/** Additional test data */
	testData?: Record<string, unknown>;
}

/**
 * Create a test context.
 */
export function createTestContext(overrides?: Partial<TestContext>): TestContext {
	return {
		traceId: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		timeout: 5000,
		...overrides,
	};
}

/**
 * Result of running a command test.
 */
export interface CommandTestResult<T> {
	/** The command result */
	result: CommandResult<T>;
	/** Validation results */
	validation: ValidationResult;
	/** Execution time in ms */
	executionTimeMs: number;
	/** Whether the result passed validation */
	isValid: boolean;
	/** Convenience checks */
	isSuccess: boolean;
	isFailure: boolean;
}

/**
 * Test a command handler with input and validate the result.
 *
 * @example
 * ```typescript
 * const test = await testCommand(createDocument.handler, {
 *   title: 'Test Document'
 * });
 *
 * expect(test.isSuccess).toBe(true);
 * expect(test.isValid).toBe(true);
 * expect(test.result.data?.id).toBeDefined();
 * ```
 */
export async function testCommand<TInput, TOutput>(
	handler: CommandHandler<TInput, TOutput>,
	input: TInput,
	options?: {
		context?: TestContext;
		validation?: ResultValidationOptions;
	}
): Promise<CommandTestResult<TOutput>> {
	const context = options?.context ?? createTestContext();
	const start = performance.now();

	let result: CommandResult<TOutput>;
	try {
		result = await handler(input, context);
	} catch (error) {
		result = failure(wrapError(error));
	}

	const executionTimeMs = performance.now() - start;
	const validation = validateResult(result, options?.validation);

	return {
		result,
		validation,
		executionTimeMs,
		isValid: validation.valid,
		isSuccess: isSuccess(result),
		isFailure: isFailure(result),
	};
}

/**
 * Test a full command definition (validates both definition and handler).
 */
export async function testCommandDefinition<TInput, TOutput>(
	command: CommandDefinition<TInput, TOutput>,
	input: TInput,
	options?: {
		context?: TestContext;
		resultValidation?: ResultValidationOptions;
	}
): Promise<{
	definitionValidation: ValidationResult;
	resultValidation: ValidationResult;
	result: CommandResult<TOutput>;
	executionTimeMs: number;
}> {
	// Validate definition
	const definitionValidation = validateCommandDefinition(command as CommandDefinition);

	// Execute and validate result
	const testResult = await testCommand(command.handler, input, {
		context: options?.context,
		validation: options?.resultValidation,
	});

	return {
		definitionValidation,
		resultValidation: testResult.validation,
		result: testResult.result,
		executionTimeMs: testResult.executionTimeMs,
	};
}

/**
 * Test multiple inputs against a command.
 *
 * @example
 * ```typescript
 * const results = await testCommandMultiple(createDocument.handler, [
 *   { input: { title: 'Doc 1' }, expectSuccess: true },
 *   { input: { title: '' }, expectSuccess: false },
 *   { input: {}, expectSuccess: false },
 * ]);
 * ```
 */
export async function testCommandMultiple<TInput, TOutput>(
	handler: CommandHandler<TInput, TOutput>,
	testCases: Array<{
		input: TInput;
		expectSuccess?: boolean;
		expectError?: string;
		description?: string;
	}>,
	options?: {
		context?: TestContext;
		validation?: ResultValidationOptions;
	}
): Promise<
	Array<
		CommandTestResult<TOutput> & {
			input: TInput;
			passed: boolean;
			description?: string;
		}
	>
> {
	const results: Array<
		CommandTestResult<TOutput> & {
			input: TInput;
			passed: boolean;
			description?: string;
		}
	> = [];

	for (const testCase of testCases) {
		const testResult = await testCommand(handler, testCase.input, options);

		let passed = testResult.isValid;

		if (testCase.expectSuccess !== undefined) {
			passed = passed && testResult.isSuccess === testCase.expectSuccess;
		}

		if (testCase.expectError && testResult.isFailure) {
			passed = passed && testResult.result.error?.code === testCase.expectError;
		}

		results.push({
			...testResult,
			input: testCase.input,
			passed,
			description: testCase.description,
		});
	}

	return results;
}

/**
 * Create a mock command for testing.
 */
export function createMockCommand<TInput = unknown, TOutput = unknown>(
	name: string,
	mockHandler: (input: TInput) => TOutput | Promise<TOutput>
): CommandDefinition<TInput, TOutput> {
	return {
		name,
		description: `Mock command: ${name}`,
		category: 'mock',
		parameters: [],
		handler: async (input) => {
			try {
				const data = await mockHandler(input);
				return success(data);
			} catch (error) {
				return failure(wrapError(error));
			}
		},
	};
}

/**
 * Create a mock command that always succeeds.
 */
export function createSuccessCommand<T>(name: string, data: T): CommandDefinition<unknown, T> {
	return createMockCommand(name, () => data);
}

/**
 * Create a mock command that always fails.
 */
export function createFailureCommand(
	name: string,
	error: { code: string; message: string }
): CommandDefinition<unknown, never> {
	return {
		name,
		description: `Mock failing command: ${name}`,
		category: 'mock',
		parameters: [],
		handler: async () => failure(error),
	};
}

/**
 * Create a test registry with mock commands.
 */
export function createTestRegistry(
	commands: CommandDefinition[]
): ReturnType<typeof createCommandRegistry> {
	const registry = createCommandRegistry();
	for (const command of commands) {
		registry.register(command);
	}
	return registry;
}
