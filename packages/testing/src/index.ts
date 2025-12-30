/**
 * @fileoverview @afd/testing - Testing utilities for Agent-First Development
 *
 * This package provides utilities for testing AFD commands:
 *
 * - **Validators**: Validate command results and definitions
 * - **Test Helpers**: Easy command testing with validation
 * - **Assertions**: Custom assertions for command results
 * - **Mock Server**: In-memory MCP server for testing
 *
 * @packageDocumentation
 */

// Validators
export {
	validateResult,
	validateError,
	validateCommandDefinition,
	type ValidationResult,
	type ValidationError,
	type ValidationWarning,
	type ResultValidationOptions,
} from './validators.js';

// Test helpers
export {
	testCommand,
	testCommandDefinition,
	testCommandMultiple,
	createTestContext,
	createMockCommand,
	createSuccessCommand,
	createFailureCommand,
	createTestRegistry,
	type TestContext,
	type CommandTestResult,
} from './test-helpers.js';

// Assertions
export {
	assertSuccess,
	assertFailure,
	assertErrorCode,
	assertConfidence,
	assertHasReasoning,
	assertHasSources,
	assertHasPlan,
	assertStepStatus,
	assertHasSuggestion,
	assertRetryable,
	assertAiResult,
} from './assertions.js';

// Mock server
export { MockMcpServer, createMockServer } from './mock-server.js';

// Re-export core types commonly used in testing
export {
	success,
	failure,
	isSuccess,
	isFailure,
	type CommandResult,
	type CommandDefinition,
	type CommandError,
} from '@afd/core';
