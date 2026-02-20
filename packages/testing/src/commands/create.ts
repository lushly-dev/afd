/**
 * @lushly-dev/afd-testing - scenario.create command
 *
 * Create new scenario files from templates or scratch.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type CommandResult, failure, success } from '@lushly-dev/afd-core';
import * as yaml from 'yaml';
import type { Expectation, FixtureConfig, Scenario, Step } from '../types/scenario.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Input for scenario.create command.
 */
export interface ScenarioCreateInput {
	/** Scenario name */
	name: string;

	/** Job name (user goal being tested) */
	job: string;

	/** Scenario description */
	description?: string;

	/** Output directory */
	directory?: string;

	/** Output filename (without extension) */
	filename?: string;

	/** Tags for categorization */
	tags?: string[];

	/** Fixture file to reference */
	fixture?: string;

	/** Initial steps to include */
	steps?: ScenarioStepInput[];

	/** Whether to overwrite existing file */
	overwrite?: boolean;

	/** Template to use */
	template?: 'blank' | 'crud' | 'error-handling' | 'workflow';
}

/**
 * Simplified step input for creation.
 */
export interface ScenarioStepInput {
	/** Step description */
	description: string;

	/** Command to invoke */
	command: string;

	/** Input data */
	input?: Record<string, unknown>;

	/** Expected success */
	expectSuccess?: boolean;

	/** Expected data fields */
	expectData?: Record<string, unknown>;

	/** Expected error code (for error testing) */
	expectError?: string;
}

/**
 * Output for scenario.create command.
 */
export interface ScenarioCreateOutput {
	/** Path to created scenario file */
	path: string;

	/** Created scenario object */
	scenario: Scenario;

	/** Whether file was overwritten */
	overwritten: boolean;
}

// ============================================================================
// Templates
// ============================================================================

/**
 * Create fixture config from file path.
 */
function createFixtureConfig(filePath?: string): FixtureConfig | undefined {
	if (!filePath) return undefined;
	return { file: filePath };
}

/**
 * Generate a blank template.
 */
function blankTemplate(input: ScenarioCreateInput): Scenario {
	return {
		name: input.name,
		description: input.description ?? `Test scenario for ${input.job}`,
		job: input.job,
		tags: input.tags ?? [],
		fixture: createFixtureConfig(input.fixture),
		steps: input.steps ? stepsFromInput(input.steps) : [],
	};
}

/**
 * Generate a CRUD template.
 */
function crudTemplate(input: ScenarioCreateInput): Scenario {
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
				command: `${commandPrefix}.create`,
				input: { name: `Test ${resourceName}` },
				expect: {
					success: true,
					data: { name: `Test ${resourceName}` },
				},
			},
			{
				description: `Read ${resourceName}`,
				command: `${commandPrefix}.get`,
				input: { id: '${{ steps[0].data.id }}' },
				expect: {
					success: true,
					data: { name: `Test ${resourceName}` },
				},
			},
			{
				description: `Update ${resourceName}`,
				command: `${commandPrefix}.update`,
				input: { id: '${{ steps[0].data.id }}', name: `Updated ${resourceName}` },
				expect: {
					success: true,
					data: { name: `Updated ${resourceName}` },
				},
			},
			{
				description: `Delete ${resourceName}`,
				command: `${commandPrefix}.delete`,
				input: { id: '${{ steps[0].data.id }}' },
				expect: {
					success: true,
				},
			},
			{
				description: `Verify deleted`,
				command: `${commandPrefix}.get`,
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
function errorHandlingTemplate(input: ScenarioCreateInput): Scenario {
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
				command: `${commandPrefix}.create`,
				input: {},
				expect: {
					success: false,
					error: { code: 'VALIDATION_ERROR' },
				},
			},
			{
				description: 'Not found',
				command: `${commandPrefix}.get`,
				input: { id: 'non-existent-id' },
				expect: {
					success: false,
					error: { code: 'NOT_FOUND' },
				},
			},
			{
				description: 'Invalid update',
				command: `${commandPrefix}.update`,
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
function workflowTemplate(input: ScenarioCreateInput): Scenario {
	return {
		name: input.name,
		description: input.description ?? `Workflow test for ${input.job}`,
		job: input.job,
		tags: input.tags ?? ['workflow', 'integration'],
		fixture: createFixtureConfig(input.fixture),
		steps: [
			{
				description: 'Setup - Create initial state',
				command: 'setup.initialize',
				input: {},
				expect: { success: true },
			},
			{
				description: 'Step 1 - First action',
				command: 'action.first',
				input: { setupId: '${{ steps[0].data.id }}' },
				expect: { success: true },
			},
			{
				description: 'Step 2 - Second action',
				command: 'action.second',
				input: { previousId: '${{ steps[1].data.id }}' },
				expect: { success: true },
			},
			{
				description: 'Verification - Check final state',
				command: 'verify.state',
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
 * Convert step inputs to full Step objects.
 */
function stepsFromInput(inputs: ScenarioStepInput[]): Step[] {
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

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a new scenario file.
 *
 * @example
 * ```typescript
 * // Create blank scenario
 * const result = await scenarioCreate({
 *   name: 'create-todo',
 *   job: 'Create a new todo item',
 *   directory: './scenarios',
 * });
 *
 * // Create from CRUD template
 * const result = await scenarioCreate({
 *   name: 'todo-crud',
 *   job: 'Manage todo items',
 *   template: 'crud',
 * });
 *
 * // Create with initial steps
 * const result = await scenarioCreate({
 *   name: 'custom-workflow',
 *   job: 'Complete custom workflow',
 *   steps: [
 *     { name: 'Step 1', command: 'action.do', expectSuccess: true },
 *   ],
 * });
 * ```
 */
export async function scenarioCreate(
	input: ScenarioCreateInput
): Promise<CommandResult<ScenarioCreateOutput>> {
	try {
		// Generate scenario from template
		let scenario: Scenario;

		switch (input.template) {
			case 'crud':
				scenario = crudTemplate(input);
				break;
			case 'error-handling':
				scenario = errorHandlingTemplate(input);
				break;
			case 'workflow':
				scenario = workflowTemplate(input);
				break;
			default:
				scenario = blankTemplate(input);
				break;
		}

		// Override with user-provided steps if any
		if (input.steps && input.steps.length > 0) {
			scenario.steps = stepsFromInput(input.steps);
		}

		// Determine output path
		const directory = input.directory ?? '.';
		const filename = input.filename ?? input.name;
		const outputPath = path.join(directory, `${filename}.scenario.yaml`);

		// Check if file exists
		const exists = fs.existsSync(outputPath);
		if (exists && !input.overwrite) {
			return failure({
				code: 'FILE_EXISTS',
				message: `File already exists: ${outputPath}`,
				suggestion: 'Use overwrite: true to replace the existing file',
			});
		}

		// Ensure directory exists
		const dirPath = path.dirname(outputPath);
		if (!fs.existsSync(dirPath)) {
			fs.mkdirSync(dirPath, { recursive: true });
		}

		// Generate YAML content
		const yamlContent = generateYaml(scenario);

		// Write file
		fs.writeFileSync(outputPath, yamlContent, 'utf-8');

		return success(
			{
				path: outputPath,
				scenario,
				overwritten: exists,
			},
			{
				reasoning: `Created scenario file: ${outputPath}`,
			}
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return failure({
			code: 'CREATE_ERROR',
			message: `Failed to create scenario: ${message}`,
		});
	}
}

/**
 * Generate YAML content with proper formatting.
 */
function generateYaml(scenario: Scenario): string {
	// Build the document structure with comments
	const doc = new yaml.Document();

	// Create the scenario object
	const scenarioObj: Record<string, unknown> = {
		name: scenario.name,
		description: scenario.description,
		job: scenario.job,
	};

	if (scenario.tags && scenario.tags.length > 0) {
		scenarioObj.tags = scenario.tags;
	}

	if (scenario.fixture) {
		scenarioObj.fixture = scenario.fixture;
	}

	if (scenario.steps && scenario.steps.length > 0) {
		scenarioObj.steps = scenario.steps.map((step) => {
			const stepObj: Record<string, unknown> = {
				command: step.command,
			};

			if (step.description) {
				stepObj.description = step.description;
			}

			if (step.input && Object.keys(step.input).length > 0) {
				stepObj.input = step.input;
			}

			if (step.expect) {
				stepObj.expect = step.expect;
			}

			return stepObj;
		});
	}

	doc.contents = doc.createNode(scenarioObj);

	// Add header comment
	const header = `# JTBD Scenario: ${scenario.job}\n# Generated by @lushly-dev/afd-testing\n\n`;

	return (
		header +
		doc.toString({
			indent: 2,
			lineWidth: 80,
		})
	);
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
			description: 'Empty scenario with just job and description',
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
