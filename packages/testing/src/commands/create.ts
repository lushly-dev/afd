/**
 * @lushly-dev/afd-testing - scenario-create command
 *
 * Create new scenario files from templates or scratch.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type CommandResult, failure, success } from '@lushly-dev/afd-core';
import * as yaml from 'yaml';
import { parseScenarioString } from '../parsers/yaml.js';
import type { Scenario } from '../types/scenario.js';
import {
	blankTemplate,
	crudTemplate,
	errorHandlingTemplate,
	stepsFromCommands,
	stepsFromInput,
	workflowTemplate,
} from './create-templates.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Input for scenario-create command.
 */
export interface ScenarioCreateInput {
	/** Scenario name; also the file name unless `filename` is set. Must not contain path separators. */
	name: string;

	/** Job name (user goal being tested) */
	job: string;

	/** Scenario description */
	description?: string;

	/** Output directory */
	directory?: string;

	/** Output filename (without extension). Must not contain path separators. */
	filename?: string;

	/** Tags for categorization */
	tags?: string[];

	/** Fixture file to reference */
	fixture?: string;

	/** Initial steps to include */
	steps?: ScenarioStepInput[];

	/**
	 * Commands to include, one step each expecting success. Ignored when
	 * `steps` is given; replaces the template's steps otherwise.
	 */
	commands?: string[];

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
 * Output for scenario-create command.
 */
export interface ScenarioCreateOutput {
	/** Path to created scenario file */
	path: string;

	/** Created scenario object */
	scenario: Scenario;

	/** Whether file was overwritten */
	overwritten: boolean;
}

/**
 * Check that a scenario or file name is a single path segment.
 */
function invalidFileName(value: string): string | undefined {
	if (value.trim() === '') return 'must not be empty';
	if (/[\\/]/.test(value)) return 'must not contain path separators';
	if (value === '.' || value === '..') return "must not be '.' or '..'";
	// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
	if (/[\u0000-\u001f\u007f]/.test(value)) return 'must not contain control characters';
	return undefined;
}

/**
 * Make a value safe for a single-line YAML comment: line breaks and other
 * control characters become spaces.
 */
function commentSafe(value: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: replacing control characters is the point
	return value.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, ' ').trim();
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
 *     { description: 'Step 1', command: 'action-do', expectSuccess: true },
 *   ],
 * });
 * ```
 */
export async function scenarioCreate(
	input: ScenarioCreateInput
): Promise<CommandResult<ScenarioCreateOutput>> {
	for (const [field, value] of [
		['name', input.name],
		['filename', input.filename],
	] as const) {
		const problem = value === undefined ? undefined : invalidFileName(value);
		if (problem) {
			return failure({
				code: 'INVALID_NAME',
				message: `${field} ${problem}`,
				suggestion: `Use a plain name such as "todo-create"; choose the location with 'directory'`,
			});
		}
	}

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

		// Override with user-provided steps or commands if any
		if (input.steps && input.steps.length > 0) {
			scenario.steps = stepsFromInput(input.steps);
		} else if (input.commands && input.commands.length > 0) {
			scenario.steps = stepsFromCommands(input.commands);
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

		// Generate YAML content, and refuse to write a file the parser would reject
		const yamlContent = generateYaml(scenario);
		const check = parseScenarioString(yamlContent, outputPath);
		if (!check.success) {
			return failure({
				code: 'INVALID_SCENARIO',
				message: `The generated scenario would not parse: ${check.error}`,
				suggestion:
					'Fix the step inputs: data expectations need expectSuccess true, and expectError implies a failure',
			});
		}

		// Ensure directory exists
		const dirPath = path.dirname(outputPath);
		if (!fs.existsSync(dirPath)) {
			fs.mkdirSync(dirPath, { recursive: true });
		}

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
			suggestion: 'Check that the directory is writable',
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

	// Add header comment (a newline in the job must not start a YAML line)
	const header = `# JTBD Scenario: ${commentSafe(scenario.job)}\n# Generated by @lushly-dev/afd-testing\n\n`;

	return (
		header +
		doc.toString({
			indent: 2,
			lineWidth: 80,
		})
	);
}
