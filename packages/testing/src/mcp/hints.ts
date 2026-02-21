/**
 * @fileoverview Agent hints system for @lushly-dev/afd-testing
 *
 * Provides structured hints to help AI agents interpret command results
 * and determine next actions.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { TestReport } from '../types/report.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Hints to help AI agents interpret results and decide next actions.
 */
export interface AgentHints {
	/** Should the agent retry this operation? */
	shouldRetry: boolean;

	/** Related commands to consider */
	relatedCommands: string[];

	/** Suggested next actions */
	nextSteps: string[];

	/** Confidence in result interpretation (0-1) */
	interpretationConfidence: number;

	/** Steps with low confidence that may need human review */
	lowConfidenceSteps?: number[];

	/** Commands that have no test coverage */
	untestedCommands?: string[];

	/** Error codes encountered */
	errorCodes?: string[];
}

/**
 * Command result with agent hints added.
 */
export interface AgentEnhancedResult<T> extends CommandResult<T> {
	_agentHints: AgentHints;
}

// ============================================================================
// Hint Generation
// ============================================================================

/**
 * Generate agent hints for a command result.
 */
export function generateAgentHints<T>(commandName: string, result: CommandResult<T>): AgentHints {
	const hints: AgentHints = {
		shouldRetry: shouldRetryCommand(result),
		relatedCommands: getRelatedCommands(commandName, result),
		nextSteps: suggestNextSteps(commandName, result),
		interpretationConfidence: calculateInterpretationConfidence(result),
	};

	// Add error codes if present
	if (!result.success && result.error) {
		hints.errorCodes = [result.error.code];
	}

	return hints;
}

/**
 * Generate agent hints specific to test reports.
 */
export function generateTestReportHints(report: TestReport): AgentHints {
	const { summary, scenarios } = report;

	const hints: AgentHints = {
		shouldRetry: false,
		relatedCommands: [],
		nextSteps: [],
		interpretationConfidence: summary.passRate,
	};

	// Check for failures
	const failedScenarios = scenarios.filter((s) => s.outcome === 'fail' || s.outcome === 'error');

	if (failedScenarios.length > 0) {
		hints.nextSteps.push(
			`Review ${failedScenarios.length} failed scenario(s)`,
			'Run with --verbose for detailed step output'
		);
		hints.relatedCommands.push('scenario-suggest --context failed');

		// Extract error types from failed steps
		const errorTypes = new Set<string>();
		for (const scenario of failedScenarios) {
			for (const step of scenario.stepResults) {
				if (step.error?.type) {
					errorTypes.add(step.error.type);
				}
			}
		}
		if (errorTypes.size > 0) {
			hints.errorCodes = Array.from(errorTypes);
		}
	}

	// Check for steps with expectation mismatches (lower confidence results)
	const mismatchSteps: number[] = [];
	let stepIndex = 0;
	for (const scenario of scenarios) {
		for (const step of scenario.stepResults) {
			if (step.error?.type === 'expectation_mismatch') {
				mismatchSteps.push(stepIndex);
			}
			stepIndex++;
		}
	}
	if (mismatchSteps.length > 0) {
		hints.lowConfidenceSteps = mismatchSteps;
		hints.nextSteps.push(
			`${mismatchSteps.length} step(s) have expectation mismatches - consider reviewing assertions`
		);
	}

	// Suggest based on pass rate
	if (summary.passRate >= 0.95) {
		hints.nextSteps.push('All tests passing - safe to proceed');
	} else if (summary.passRate >= 0.8) {
		hints.nextSteps.push('Most tests passing - review failures before proceeding');
	} else {
		hints.shouldRetry = true;
		hints.nextSteps.push('Significant failures detected - fix issues before continuing');
	}

	return hints;
}

/**
 * Generate agent hints for coverage results.
 */
export function generateCoverageHints(
	_testedCommands: string[],
	untestedCommands: string[],
	coveragePercent: number
): AgentHints {
	const hints: AgentHints = {
		shouldRetry: false,
		relatedCommands: [],
		nextSteps: [],
		interpretationConfidence: 0.95,
	};

	if (untestedCommands.length > 0) {
		hints.untestedCommands = untestedCommands;
		hints.relatedCommands.push('scenario-create --template crud');
		hints.nextSteps.push(
			`${untestedCommands.length} command(s) have no test coverage`,
			'Consider using scenario-create to generate test templates'
		);

		// Prioritize high-value commands
		const priorityCommands = untestedCommands.filter(
			(cmd) => cmd.includes('.create') || cmd.includes('.delete')
		);
		if (priorityCommands.length > 0) {
			hints.nextSteps.push(`Priority: Test ${priorityCommands.join(', ')} (mutation commands)`);
		}
	}

	if (coveragePercent >= 90) {
		hints.nextSteps.push('Excellent coverage - focus on edge cases');
	} else if (coveragePercent >= 70) {
		hints.nextSteps.push('Good coverage - add tests for remaining commands');
	} else {
		hints.nextSteps.push('Low coverage - prioritize adding test scenarios');
	}

	return hints;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Determine if a command should be retried based on result.
 */
function shouldRetryCommand<T>(result: CommandResult<T>): boolean {
	if (result.success) return false;
	if (!result.error) return false;

	// Check explicit retryable flag
	if (result.error.retryable === true) return true;
	if (result.error.retryable === false) return false;

	// Check suggestion text for retry hints
	const suggestion = result.error.suggestion?.toLowerCase() ?? '';
	if (
		suggestion.includes('try again') ||
		suggestion.includes('retry') ||
		suggestion.includes('temporary')
	) {
		return true;
	}

	// Check error codes that are typically transient
	const transientCodes = ['TIMEOUT', 'CONNECTION_ERROR', 'RATE_LIMITED', 'SERVICE_UNAVAILABLE'];
	if (transientCodes.includes(result.error.code)) {
		return true;
	}

	return false;
}

/**
 * Get related commands based on the executed command.
 */
function getRelatedCommands<T>(commandName: string, result: CommandResult<T>): string[] {
	const related: string[] = [];

	// Parse command category (e.g., "scenario" from "scenario-list")
	const [category] = commandName.split('-');

	// Suggest related scenario commands
	if (category === 'scenario') {
		if (commandName === 'scenario-list') {
			related.push('scenario-evaluate', 'scenario-coverage');
		} else if (commandName === 'scenario-evaluate') {
			related.push('scenario-coverage', 'scenario-suggest');
		} else if (commandName === 'scenario-coverage') {
			related.push('scenario-suggest', 'scenario-create');
		} else if (commandName === 'scenario-create') {
			related.push('scenario-evaluate');
		}
	}

	// On failure, suggest diagnostic commands
	if (!result.success) {
		if (!related.includes('scenario-suggest')) {
			related.push('scenario-suggest --context failed');
		}
	}

	return related;
}

/**
 * Suggest next steps based on command result.
 */
function suggestNextSteps<T>(commandName: string, result: CommandResult<T>): string[] {
	const steps: string[] = [];

	if (result.success) {
		// Success suggestions
		if (commandName === 'scenario-list') {
			steps.push('Run scenario-evaluate to execute listed scenarios');
		} else if (commandName === 'scenario-create') {
			steps.push('Edit the generated scenario to add specific test cases');
			steps.push('Run scenario-evaluate to test the new scenario');
		} else if (commandName === 'scenario-evaluate') {
			steps.push('Run scenario-coverage to check test coverage');
		} else if (commandName === 'scenario-coverage') {
			steps.push('Use scenario-suggest to find gaps');
			steps.push('Create scenarios for untested commands');
		}
	} else {
		// Failure suggestions
		const error = result.error;
		if (error?.suggestion) {
			steps.push(error.suggestion);
		}

		if (error?.code === 'PARSE_ERROR') {
			steps.push('Check scenario YAML syntax');
		} else if (error?.code === 'FILE_NOT_FOUND') {
			steps.push('Verify the scenario file path exists');
		} else if (error?.code === 'VALIDATION_ERROR') {
			steps.push('Review the scenario schema requirements');
		}
	}

	return steps;
}

/**
 * Calculate confidence in how accurately we can interpret the result.
 */
function calculateInterpretationConfidence<T>(result: CommandResult<T>): number {
	let confidence = 0.9; // Base confidence

	// Lower confidence for errors without clear codes
	if (!result.success && !result.error?.code) {
		confidence -= 0.2;
	}

	// Higher confidence when reasoning is provided
	if (result.reasoning) {
		confidence += 0.05;
	}

	// Higher confidence when sources are provided
	if (result.sources && result.sources.length > 0) {
		confidence += 0.05;
	}

	// Clamp to 0-1 range
	return Math.max(0, Math.min(1, confidence));
}

// ============================================================================
// Result Enhancement
// ============================================================================

/**
 * Enhance a command result with agent hints.
 */
export function enhanceWithAgentHints<T>(
	commandName: string,
	result: CommandResult<T>
): AgentEnhancedResult<T> {
	return {
		...result,
		_agentHints: generateAgentHints(commandName, result),
	};
}
