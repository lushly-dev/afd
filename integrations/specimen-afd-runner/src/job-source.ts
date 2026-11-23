/**
 * Node-side Specimen `JobSource` entry: `@lushly-dev/specimen-afd-runner/job-source`.
 *
 * Parses AFD `.scenario.yaml` files via `@lushly-dev/afd-testing`, loads and
 * merges sandbox-contained JSON fixtures, and validates job entries for both
 * `specimen-validate` and `bench.runJob()`.
 */

import { isAbsolute, posix } from 'node:path';
import {
	type FixtureConfig,
	type FixtureData,
	parseScenarioString,
	type Scenario,
} from '@lushly-dev/afd-testing';
import {
	defineJobSource,
	type JobBeforeAction,
	type JobCapturePoint,
	type JobScenario,
	type JobSource,
	type JobSourceContext,
	type ResolvedJobCapture,
	resolveJobCapturePlan,
	type SpecimenEntry,
} from '@lushly-dev/specimen';
import own from '@lushly-dev/specimen-afd-runner/package.json' with { type: 'json' };

/** Default Specimen `JobSource` id for AFD `.scenario.yaml` files. */
export const AFD_JOB_SOURCE_ID = 'afd-scenario-yaml' as const;

const PLUGIN_VERSION = own.version;
const FORBIDDEN_MERGE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const WINDOWS_DRIVE_PREFIX = /^[a-zA-Z]:/;
const YAML_EXTENSION = /\.ya?ml$/i;
const JOB_CAPTURE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export type JobScenarioErrorCode =
	| 'JOB_SCENARIO_INVALID'
	| 'CAPTURE_STEP_UNKNOWN'
	| 'CAPTURE_STEP_AMBIGUOUS'
	| 'STEP_HAS_NO_DESCRIPTION'
	| 'NOT_A_JOB';

/** Structured error carrying the Specimen/AFD error code and recovery suggestion. */
export class JobScenarioError extends Error {
	readonly code: JobScenarioErrorCode;
	readonly suggestion: string;
	readonly details?: Record<string, unknown>;

	constructor(
		code: JobScenarioErrorCode,
		message: string,
		suggestion: string,
		details?: Record<string, unknown>
	) {
		super(message);
		this.name = 'JobScenarioError';
		this.code = code;
		this.suggestion = suggestion;
		if (details !== undefined) {
			this.details = details;
		}
	}
}

export interface AfdJobSourceOptions {
	/** Override the `JobSource` id (defaults to `'afd-scenario-yaml'`). */
	id?: string;
}

export interface JobCaptureSelection {
	/** 1-based step number in the scenario. */
	step: number;
	/** Optional capture checkpoint name (defaults to deterministic slug of step description). */
	name?: string;
	/** Optional Specimen person actions run immediately before this step's command. */
	before?: JobBeforeAction[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

function toPosixPath(value: string): string {
	return value.replaceAll('\\', '/');
}

function isAbsoluteOrDrivePath(value: string): boolean {
	return (
		isAbsolute(value) ||
		value.startsWith('/') ||
		value.startsWith('\\') ||
		WINDOWS_DRIVE_PREFIX.test(value)
	);
}

function resolveRelativeTo(fromFile: string, targetPath: string, label: string): string {
	if (typeof targetPath !== 'string' || targetPath.trim() === '') {
		throw new JobScenarioError(
			'JOB_SCENARIO_INVALID',
			`${label} path must be a non-empty string.`,
			'Specify a relative path inside the configured Specimen project root.'
		);
	}
	const normalizedTarget = toPosixPath(targetPath);
	if (isAbsoluteOrDrivePath(targetPath) || isAbsoluteOrDrivePath(normalizedTarget)) {
		throw new JobScenarioError(
			'JOB_SCENARIO_INVALID',
			`${label} '${targetPath}' must be a relative path inside the configured project root.`,
			'Use a path relative to the scenario or fixture file inside the project root.'
		);
	}
	const dir = posix.dirname(toPosixPath(fromFile));
	return dir === '.' ? normalizedTarget : posix.join(dir, normalizedTarget);
}

function assertSafeFixtureValue(value: unknown, label: string): void {
	if (Array.isArray(value)) {
		for (const item of value) {
			assertSafeFixtureValue(item, label);
		}
		return;
	}
	if (typeof value === 'object' && value !== null) {
		for (const key of Object.keys(value)) {
			if (FORBIDDEN_MERGE_KEYS.has(key)) {
				throw new JobScenarioError(
					'JOB_SCENARIO_INVALID',
					`${label} contains forbidden property '${key}'.`,
					`Remove '${key}' from the fixture file or overrides.`
				);
			}
			assertSafeFixtureValue((value as Record<string, unknown>)[key], label);
		}
	}
}

function deepMergeFixture(
	target: Record<string, unknown>,
	source: Record<string, unknown>
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...target };
	for (const key of Object.keys(source)) {
		if (FORBIDDEN_MERGE_KEYS.has(key)) {
			throw new JobScenarioError(
				'JOB_SCENARIO_INVALID',
				`Fixture contains forbidden property '${key}'.`,
				`Remove '${key}' from the fixture file or overrides.`
			);
		}
		const sourceValue = source[key];
		const targetValue = result[key];
		if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
			result[key] = deepMergeFixture(targetValue, sourceValue);
		} else {
			result[key] = sourceValue;
		}
	}
	return result;
}

async function readFixtureJson(
	context: JobSourceContext,
	relativePath: string,
	label: string
): Promise<FixtureData> {
	const text = await context.read(relativePath);
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		const position = error instanceof Error ? /position (\d+)/.exec(error.message)?.[1] : undefined;
		throw new JobScenarioError(
			'JOB_SCENARIO_INVALID',
			`Invalid JSON in ${label} '${relativePath}'${position ? ` (at position ${position})` : ''}.`,
			`Fix the JSON syntax in '${relativePath}' and run specimen-validate.`
		);
	}
	if (!isPlainObject(parsed)) {
		throw new JobScenarioError(
			'JOB_SCENARIO_INVALID',
			`${label} '${relativePath}' must contain a JSON object.`,
			`Ensure '${relativePath}' exports a top-level JSON object matching your fixture schema.`
		);
	}
	assertSafeFixtureValue(parsed, `${label} '${relativePath}'`);
	return parsed as FixtureData;
}

async function loadScenarioFixture(
	context: JobSourceContext,
	fixture: FixtureConfig
): Promise<FixtureData> {
	const mainPath = resolveRelativeTo(context.scenarioPath, fixture.file, 'Fixture file');
	let merged: Record<string, unknown> = await readFixtureJson(context, mainPath, 'Fixture file');

	if (fixture.base !== undefined) {
		const basePath = resolveRelativeTo(mainPath, fixture.base, 'Base fixture');
		const baseData = await readFixtureJson(context, basePath, 'Base fixture');
		merged = deepMergeFixture(baseData, merged);
	}

	if (fixture.overrides !== undefined) {
		assertSafeFixtureValue(fixture.overrides, 'Fixture overrides');
		merged = deepMergeFixture(merged, fixture.overrides);
	}

	return merged as FixtureData;
}

function assertSupportedSpecimenScenarioFields(scenario: Scenario, scenarioPath?: string): void {
	const label = scenarioPath ? `'${scenarioPath}'` : `'${scenario.job}'`;
	if (scenario.timeout !== undefined) {
		throw new JobScenarioError(
			'JOB_SCENARIO_INVALID',
			`Scenario ${label} declares 'timeout', which Specimen's JobScenario transport does not carry.`,
			"Remove 'timeout' from the scenario file and configure Specimen's render deadline via timeoutMs instead.",
			{ field: 'timeout', value: scenario.timeout }
		);
	}
	for (const field of ['verify', 'isolation', 'dependsOn'] as const) {
		if (scenario[field] !== undefined) {
			throw new JobScenarioError(
				'JOB_SCENARIO_INVALID',
				`Scenario ${label} declares unsupported field '${field}'.`,
				`Remove '${field}' from the scenario file before running it through Specimen.`,
				{ field }
			);
		}
	}
}

/** Convert a parsed AFD `Scenario` and optional resolved fixture into Specimen's `JobScenario`. */
export function toJobScenario(
	scenario: Scenario,
	resolvedFixture?: FixtureData,
	scenarioPath?: string
): JobScenario {
	assertSupportedSpecimenScenarioFields(scenario, scenarioPath);
	return {
		job: scenario.job,
		name: scenario.name,
		description: scenario.description,
		...(resolvedFixture !== undefined ? { fixture: resolvedFixture } : {}),
		steps: scenario.steps.map((step, index) => {
			const trimmedDescription =
				typeof step.description === 'string' && step.description.trim() !== ''
					? step.description
					: undefined;
			return {
				step: index + 1,
				command: step.command,
				...(trimmedDescription !== undefined ? { description: trimmedDescription } : {}),
				...(step.input !== undefined ? { input: step.input } : {}),
				expect: step.expect,
				...(step.continueOnFailure ? { continueOnFailure: true } : {}),
			};
		}),
	};
}

/**
 * Parse an AFD `.scenario.yaml` string into Specimen's AFD-free `JobScenario` shape.
 * Throws `JobScenarioError` with `JOB_SCENARIO_INVALID` on YAML or schema errors.
 */
export function parseAfdJobScenario(
	yamlText: string,
	options: { scenarioPath?: string; fixture?: FixtureData } = {}
): JobScenario {
	const filePath = options.scenarioPath ?? '<scenario.yaml>';
	const parsed = parseScenarioString(yamlText, filePath);
	if (!parsed.success) {
		throw new JobScenarioError(
			'JOB_SCENARIO_INVALID',
			`Invalid AFD scenario '${filePath}': ${parsed.error}`,
			`Fix the scenario YAML in '${filePath}', then run afd scenario validate or specimen-validate.`,
			parsed.line !== undefined ? { path: filePath, line: parsed.line } : { path: filePath }
		);
	}
	return toJobScenario(parsed.scenario, options.fixture, filePath);
}

/** Convert a step description into a deterministic kebab-case capture checkpoint slug. */
export function slugifyStepDescription(description: string, fallbackStep?: number): string {
	const slug = description
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 128)
		.replace(/-+$/g, '');
	if (slug.length > 0) {
		return slug;
	}
	if (fallbackStep !== undefined) {
		return `step-${fallbackStep}`;
	}
	throw new JobScenarioError(
		'STEP_HAS_NO_DESCRIPTION',
		'Step description contains no alphanumeric characters to form a capture name.',
		'Add a descriptive text string to the step or pass an explicit capture name.'
	);
}

/**
 * Build validated `JobCapturePoint[]` entries from 1-based step selections
 * (used by `specimen-job-create` and job entry validation).
 *
 * Enforces:
 * - `CAPTURE_STEP_UNKNOWN` for out-of-range step numbers.
 * - `STEP_HAS_NO_DESCRIPTION` when a selected step lacks a non-empty `description`.
 * - `CAPTURE_STEP_AMBIGUOUS` when two steps share the selected step's `description`,
 *   when the same step is selected twice, or when two capture names collide.
 */
export function buildJobCaptures(
	scenario: JobScenario,
	selections: readonly (number | JobCaptureSelection)[]
): JobCapturePoint[] {
	if (selections.length === 0) {
		throw new JobScenarioError(
			'JOB_SCENARIO_INVALID',
			'At least one capture step must be selected.',
			'Pass one or more 1-based step numbers or { step, name?, before? } objects.'
		);
	}

	const normalized = selections.map((item) =>
		typeof item === 'number' ? { step: item } : { ...item }
	);
	const seenSteps = new Set<number>();
	const seenNames = new Set<string>();
	const points: JobCapturePoint[] = [];

	for (const selection of normalized) {
		if (!Number.isInteger(selection.step) || selection.step < 1) {
			throw new JobScenarioError(
				'CAPTURE_STEP_UNKNOWN',
				`Capture step ${String(selection.step)} is invalid; steps are numbered from 1.`,
				`Choose a step number between 1 and ${scenario.steps.length}.`
			);
		}
		const matchedStep = scenario.steps.find((step) => step.step === selection.step);
		if (!matchedStep) {
			throw new JobScenarioError(
				'CAPTURE_STEP_UNKNOWN',
				`Step ${selection.step} does not exist in scenario '${scenario.job}' (which has ${scenario.steps.length} steps).`,
				`Choose a step number between 1 and ${scenario.steps.length}, or update the scenario.`
			);
		}
		if (seenSteps.has(matchedStep.step)) {
			throw new JobScenarioError(
				'CAPTURE_STEP_AMBIGUOUS',
				`Step ${matchedStep.step} is selected more than once in captures.`,
				'Select each scenario step at most once.'
			);
		}
		seenSteps.add(matchedStep.step);

		const description = matchedStep.description;
		if (typeof description !== 'string' || description.trim() === '') {
			throw new JobScenarioError(
				'STEP_HAS_NO_DESCRIPTION',
				`Step ${matchedStep.step} ('${matchedStep.command}') has no description and cannot be marked for capture.`,
				`Add a description to step ${matchedStep.step} in the scenario; it does not change the format.`,
				{ step: matchedStep.step, command: matchedStep.command }
			);
		}

		const matchingSteps = scenario.steps.filter((step) => step.description === description);
		if (matchingSteps.length > 1) {
			const nums = matchingSteps.map((s) => s.step).join(', ');
			throw new JobScenarioError(
				'CAPTURE_STEP_AMBIGUOUS',
				`Step ${matchedStep.step}'s description "${description}" matches ${matchingSteps.length} steps (${nums}).`,
				'Give each captured step a unique description in the scenario file.'
			);
		}

		const name = selection.name ?? slugifyStepDescription(description, matchedStep.step);
		if (!JOB_CAPTURE_NAME.test(name)) {
			throw new JobScenarioError(
				'JOB_SCENARIO_INVALID',
				`Capture name '${name}' for step ${matchedStep.step} is invalid; expected /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.`,
				'Use an alphanumeric capture name containing only letters, digits, dots, underscores, or hyphens.',
				{ step: matchedStep.step, name }
			);
		}
		if (seenNames.has(name)) {
			throw new JobScenarioError(
				'CAPTURE_STEP_AMBIGUOUS',
				`Capture name '${name}' is produced more than once.`,
				'Pass distinct explicit capture names or give each captured step a distinct description.'
			);
		}
		seenNames.add(name);

		points.push({
			after: description,
			name,
			...(selection.before && selection.before.length > 0 ? { before: [...selection.before] } : {}),
		});
	}

	return points;
}

function assertJobCaptureDescriptions(entry: SpecimenEntry, scenario: JobScenario): void {
	if (!entry.job) {
		return;
	}
	for (const capture of entry.job.captures) {
		if (capture.after.trim() === '') {
			throw new JobScenarioError(
				'STEP_HAS_NO_DESCRIPTION',
				`Capture '${capture.name}' on '${entry.id}' has an empty step description.`,
				'Add a description to the target step in the scenario and reference it in job.captures[].after.'
			);
		}
	}
	if (
		entry.job.captures.length > 0 &&
		scenario.steps.every(
			(step) => typeof step.description !== 'string' || step.description.trim() === ''
		)
	) {
		throw new JobScenarioError(
			'STEP_HAS_NO_DESCRIPTION',
			`Scenario '${entry.job.scenario}' for '${entry.id}' has no step descriptions to match declared captures.`,
			'Add a description to each step you want to capture in the scenario; it does not change the format.',
			{ id: entry.id, scenario: entry.job.scenario }
		);
	}
}

/**
 * Validate a `SpecimenEntry`'s job capture plan against a parsed `JobScenario`.
 *
 * Enforces `NOT_A_JOB`, `STEP_HAS_NO_DESCRIPTION`, `CAPTURE_STEP_UNKNOWN`, and
 * `CAPTURE_STEP_AMBIGUOUS`.
 */
export function validateAfdJobEntry(
	entry: SpecimenEntry,
	scenario: JobScenario
): ResolvedJobCapture[] {
	if (!entry.job) {
		throw new JobScenarioError(
			'NOT_A_JOB',
			`Specimen '${entry.id}' is not a job specimen.`,
			'Use specimen-list with kind: job to find job specimens, or specimen-render for a component specimen.',
			{ id: entry.id }
		);
	}
	assertJobCaptureDescriptions(entry, scenario);
	return resolveJobCapturePlan(entry, scenario);
}

/**
 * Create Specimen's Node-side `JobSource` for AFD `.scenario.yaml` files.
 */
export function afdJobSource(options: AfdJobSourceOptions = {}): JobSource {
	return defineJobSource({
		id: options.id ?? AFD_JOB_SOURCE_ID,
		version: PLUGIN_VERSION,
		supports(scenarioPath: string): boolean {
			return YAML_EXTENSION.test(scenarioPath);
		},
		async parseScenario(context: JobSourceContext): Promise<JobScenario> {
			const yamlText = await context.read(context.scenarioPath);
			const parsed = parseScenarioString(yamlText, context.scenarioPath);
			if (!parsed.success) {
				throw new JobScenarioError(
					'JOB_SCENARIO_INVALID',
					`Invalid AFD scenario '${context.scenarioPath}': ${parsed.error}`,
					`Fix the scenario YAML in '${context.scenarioPath}', then run afd scenario validate or specimen-validate.`,
					parsed.line !== undefined
						? { path: context.scenarioPath, line: parsed.line }
						: { path: context.scenarioPath }
				);
			}

			const resolvedFixture = parsed.scenario.fixture
				? await loadScenarioFixture(context, parsed.scenario.fixture)
				: undefined;

			const jobScenario = toJobScenario(parsed.scenario, resolvedFixture, context.scenarioPath);
			assertJobCaptureDescriptions(context.entry, jobScenario);
			return jobScenario;
		},
	});
}

export default afdJobSource();
