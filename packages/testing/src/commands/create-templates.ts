/**
 * @lushly-dev/afd-testing - scenario-create templates
 *
 * Scenario templates for scenario-create. Every template produces a scenario
 * that parses; command names follow the kebab-case `domain-action` convention.
 */

import type { Expectation, FixtureConfig, Scenario, Step } from '../types/scenario.js';
import type { ScenarioCreateInput, ScenarioStepInput } from './create.js';

/**
 * Create fixture config from file path.
 */
function createFixtureConfig(filePath?: string): FixtureConfig | undefined {
	if (!filePath) return undefined;
	return { file: filePath };
}

/**
 * Generate a blank template. It has one placeholder step, so the generated
 * file parses; running it fails until the step names a real command.
 */
export function blankTemplate(input: ScenarioCreateInput): Scenario {
	return {
		name: input.name,
		description: input.description ?? `Test scenario for ${input.job}`,
		job: input.job,
		tags: input.tags ?? [],
		fixture: createFixtureConfig(input.fixture),
		steps: [
			{
				description: 'Replace with the command under test',
				command: 'domain-action',
				input: {},
				expect: { success: true },
			},
		],
	};
}

/**
 * Generate a CRUD template.
 */
export function crudTemplate(input: ScenarioCreateInput): Scenario {
	const resourceName = input.name.replace(/-/g, ' ');
	const commandPrefix = input.name.split('-')[0] ?? 'resource';

	return {
		name: input.name,
		description: input.description ?? `CRUD operations for ${resourceName}`,
		job: input.job,
		tags: input.tags ?? ['crud', 'smoke'],
		fixture: createFixtureConfig(input.fixture),
		steps: [
			{
				description: `Create ${resourceName}`,
				command: `${commandPrefix}-create`,
				input: { name: `Test ${resourceName}` },
				expect: {
					success: true,
					data: { name: `Test ${resourceName}` },
				},
			},
			{
				description: `Read ${resourceName}`,
				command: `${commandPrefix}-get`,
				input: { id: '${{ steps[0].data.id }}' },
				expect: {
					success: true,
					data: { name: `Test ${resourceName}` },
				},
			},
			{
				description: `Update ${resourceName}`,
				command: `${commandPrefix}-update`,
				input: { id: '${{ steps[0].data.id }}', name: `Updated ${resourceName}` },
				expect: {
					success: true,
					data: { name: `Updated ${resourceName}` },
				},
			},
			{
				description: `Delete ${resourceName}`,
				command: `${commandPrefix}-delete`,
				input: { id: '${{ steps[0].data.id }}' },
				expect: {
					success: true,
				},
			},
			{
				description: `Verify deleted`,
				command: `${commandPrefix}-get`,
				input: { id: '${{ steps[0].data.id }}' },
				expect: {
					success: false,
					error: { code: 'NOT_FOUND' },
				},
			},
		],
	};
}

/**
 * Generate an error handling template.
 */
export function errorHandlingTemplate(input: ScenarioCreateInput): Scenario {
	const commandPrefix = input.name.split('-')[0] ?? 'resource';

	return {
		name: input.name,
		description: input.description ?? `Error handling tests for ${input.name}`,
		job: input.job,
		tags: input.tags ?? ['error', 'negative'],
		fixture: createFixtureConfig(input.fixture),
		steps: [
			{
				description: 'Invalid input',
				command: `${commandPrefix}-create`,
				input: {},
				expect: {
					success: false,
					error: { code: 'VALIDATION_ERROR' },
				},
			},
			{
				description: 'Not found',
				command: `${commandPrefix}-get`,
				input: { id: 'non-existent-id' },
				expect: {
					success: false,
					error: { code: 'NOT_FOUND' },
				},
			},
			{
				description: 'Invalid update',
				command: `${commandPrefix}-update`,
				input: { id: 'non-existent-id', name: 'test' },
				expect: {
					success: false,
					error: { code: 'NOT_FOUND' },
				},
			},
		],
	};
}

/**
 * Generate a workflow template.
 */
export function workflowTemplate(input: ScenarioCreateInput): Scenario {
	return {
		name: input.name,
		description: input.description ?? `Workflow test for ${input.job}`,
		job: input.job,
		tags: input.tags ?? ['workflow', 'integration'],
		fixture: createFixtureConfig(input.fixture),
		steps: [
			{
				description: 'Setup - Create initial state',
				command: 'setup-initialize',
				input: {},
				expect: { success: true },
			},
			{
				description: 'Step 1 - First action',
				command: 'action-first',
				input: { setupId: '${{ steps[0].data.id }}' },
				expect: { success: true },
			},
			{
				description: 'Step 2 - Second action',
				command: 'action-second',
				input: { previousId: '${{ steps[1].data.id }}' },
				expect: { success: true },
			},
			{
				description: 'Verification - Check final state',
				command: 'verify-state',
				input: { id: '${{ steps[0].data.id }}' },
				expect: {
					success: true,
					data: { status: 'completed' },
				},
			},
		],
	};
}

/**
 * One step per command, each expecting success.
 */
export function stepsFromCommands(commands: string[]): Step[] {
	return commands.map((command) => ({
		description: `Run ${command}`,
		command,
		input: {},
		expect: { success: true },
	}));
}

/**
 * Convert step inputs to full Step objects.
 */
export function stepsFromInput(inputs: ScenarioStepInput[]): Step[] {
	return inputs.map((input): Step => {
		const expect: Expectation = {
			success: input.expectSuccess ?? true,
		};

		if (input.expectData) {
			expect.data = input.expectData;
		}
		if (input.expectError) {
			expect.success = false;
			expect.error = { code: input.expectError };
		}

		return {
			description: input.description,
			command: input.command,
			input: input.input,
			expect,
		};
	});
}

/**
 * List available templates.
 */
export function listTemplates(): Array<{
	name: string;
	description: string;
}> {
	return [
		{
			name: 'blank',
			description: 'One placeholder step to replace with the command under test',
		},
		{
			name: 'crud',
			description: 'Create, Read, Update, Delete test pattern',
		},
		{
			name: 'error-handling',
			description: 'Tests for error cases and validation',
		},
		{
			name: 'workflow',
			description: 'Multi-step workflow with state verification',
		},
	];
}
