/**
 * @fileoverview Scenario validation without execution
 *
 * Validates scenario structure, step references, and fixtures
 * for CI/CD pre-flight checks without running commands.
 */

import type { Scenario } from '../types/scenario.js';
import { loadFixture } from './fixture-loader.js';

/**
 * Validation result from validateScenario.
 */
export interface ScenarioValidationResult {
	/** Whether scenario is valid */
	valid: boolean;

	/** Validation errors (if any) */
	errors: string[];

	/** Validation warnings (if any) */
	warnings: string[];

	/** Scenario metadata */
	metadata: {
		name: string;
		job: string;
		stepCount: number;
		hasFixture: boolean;
		tags: string[];
	};
}

/**
 * Validate a scenario without executing it.
 * Useful for CI/CD validation and pre-flight checks.
 *
 * @param scenario - The scenario to validate
 * @param options - Validation options
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = await validateScenario(scenario, {
 *   basePath: './scenarios',
 *   checkFixtures: true,
 * });
 * if (!result.valid) {
 *   console.error('Validation failed:', result.errors);
 * }
 * ```
 */
export async function validateScenario(
	scenario: Scenario,
	options: { basePath?: string; checkFixtures?: boolean } = {}
): Promise<ScenarioValidationResult> {
	const errors: string[] = [];
	const warnings: string[] = [];

	// Basic structural validation
	if (!scenario.name) {
		errors.push('Missing required field: name');
	}

	if (!scenario.job) {
		errors.push('Missing required field: job');
	}

	if (!scenario.steps || scenario.steps.length === 0) {
		errors.push('Scenario must have at least one step');
	}

	// Validate each step
	for (const [index, step] of (scenario.steps ?? []).entries()) {
		const stepNum = index + 1;

		if (!step.command) {
			errors.push(`Step ${stepNum}: Missing required field 'command'`);
		}

		if (!step.expect) {
			warnings.push(`Step ${stepNum}: Missing 'expect' - step result won't be validated`);
		}

		// Check for invalid step references
		if (step.input) {
			const refs = JSON.stringify(step.input).match(/\$\{\{\s*steps\[(\d+)\]/g);
			if (refs) {
				for (const ref of refs) {
					const match = ref.match(/steps\[(\d+)\]/);
					if (match?.[1]) {
						const refIndex = parseInt(match[1], 10);
						if (refIndex >= index) {
							errors.push(
								`Step ${stepNum}: Invalid reference to step ${refIndex} (can only reference earlier steps)`
							);
						}
					}
				}
			}
		}
	}

	// Validate fixture if present and checkFixtures is enabled
	if (scenario.fixture && options.checkFixtures !== false) {
		const fixtureResult = await loadFixture(scenario.fixture, {
			basePath: options.basePath,
		});

		if (!fixtureResult.success) {
			errors.push(`Fixture error: ${fixtureResult.error}`);
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
		metadata: {
			name: scenario.name,
			job: scenario.job,
			stepCount: scenario.steps?.length ?? 0,
			hasFixture: !!scenario.fixture,
			tags: scenario.tags ?? [],
		},
	};
}
