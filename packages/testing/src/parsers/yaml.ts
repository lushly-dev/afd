/**
 * @lushly-dev/afd-testing - YAML Scenario Parser
 *
 * Parses .scenario.yaml files into typed Scenario objects.
 *
 * The parser is strict: a field it would otherwise ignore is an error, so a
 * typo or an unimplemented feature can never produce a green run that checked
 * nothing. YAML syntax errors report the line but never echo the source.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml, YAMLError } from 'yaml';
import { findExpectationProblems } from '../types/matchers.js';
import type {
	AssertionMatcher,
	Expectation,
	FixtureConfig,
	Scenario,
	Step,
} from '../types/scenario.js';
import { UNSUPPORTED_SCENARIO_FIELDS } from '../types/scenario.js';

// ============================================================================
// Parser Result Types
// ============================================================================

export interface ParseSuccess {
	success: true;
	scenario: Scenario;
}

export interface ParseError {
	success: false;
	error: string;
	path?: string;
	line?: number;
}

export type ParseResult = ParseSuccess | ParseError;

// ============================================================================
// Schema
// ============================================================================

const SCENARIO_KEYS = [
	'name',
	'description',
	'job',
	'tags',
	'version',
	'fixture',
	'timeout',
	'steps',
] as const;
const STEP_KEYS = ['command', 'input', 'description', 'expect', 'continueOnFailure'] as const;
const EXPECT_KEYS = ['success', 'data', 'error', 'reasoning', 'confidence'] as const;
const EXPECT_ERROR_KEYS = ['code', 'message', 'suggestion'] as const;
const FIXTURE_KEYS = ['file', 'base', 'overrides'] as const;

/** A shape problem found while validating the parsed YAML. */
class ScenarioShapeError extends Error {}

function fail(message: string): never {
	throw new ScenarioShapeError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string): void {
	const unknown = Object.keys(obj).filter((key) => !allowed.includes(key));
	if (unknown.length > 0) {
		const list = unknown.map((key) => `'${key}'`).join(', ');
		fail(
			`Unknown ${unknown.length === 1 ? 'field' : 'fields'} ${list} in ${where} (allowed: ${allowed.join(', ')})`
		);
	}
}

function requireString(value: unknown, message: string): string {
	if (typeof value !== 'string' || value.trim() === '') {
		fail(message);
	}
	return value;
}

function optionalString(value: unknown, where: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'string') fail(`${where} must be a string`);
	return value;
}

function optionalRecord(value: unknown, where: string): Record<string, unknown> | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) fail(`${where} must be an object`);
	return value;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate and transform raw YAML into a Scenario object.
 */
function toScenario(raw: unknown): Scenario {
	if (!isRecord(raw)) {
		fail('Scenario file must contain a YAML object');
	}

	for (const [field, message] of Object.entries(UNSUPPORTED_SCENARIO_FIELDS)) {
		if (field in raw) fail(message);
	}
	checkKeys(raw, SCENARIO_KEYS, 'scenario');

	const name = requireString(raw.name, "Scenario must have a non-empty 'name' field");
	const description = requireString(
		raw.description,
		"Scenario must have a non-empty 'description' field"
	);
	const job = requireString(
		raw.job,
		"Scenario must have a non-empty 'job' field (kebab-case identifier)"
	);

	if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
		fail('Scenario must have at least one step');
	}

	let tags: string[] = [];
	if (raw.tags !== undefined && raw.tags !== null) {
		if (!Array.isArray(raw.tags) || !raw.tags.every((tag) => typeof tag === 'string')) {
			fail("'tags' must be a list of strings");
		}
		tags = raw.tags;
	}

	let timeout: number | undefined;
	if (raw.timeout !== undefined && raw.timeout !== null) {
		if (typeof raw.timeout !== 'number' || !Number.isFinite(raw.timeout) || raw.timeout <= 0) {
			fail("'timeout' must be a positive number of milliseconds");
		}
		timeout = raw.timeout;
	}

	return {
		name,
		description,
		job,
		tags,
		version: optionalString(raw.version, "'version'"),
		fixture: parseFixture(raw.fixture),
		timeout,
		steps: raw.steps.map((item, index) => parseStep(item, index + 1)),
	};
}

/**
 * Parse one step.
 */
function parseStep(raw: unknown, stepNum: number): Step {
	if (!isRecord(raw)) {
		fail(`Step ${stepNum} must be an object`);
	}
	checkKeys(raw, STEP_KEYS, `step ${stepNum}`);

	const command = requireString(
		raw.command,
		`Step ${stepNum} must have a non-empty 'command' field`
	);

	if (raw.expect === undefined || raw.expect === null) {
		fail(`Step ${stepNum} must have an 'expect' block`);
	}

	const continueOnFailure = raw.continueOnFailure;
	if (continueOnFailure !== undefined && typeof continueOnFailure !== 'boolean') {
		fail(`Step ${stepNum} 'continueOnFailure' must be true or false`);
	}

	return {
		command,
		input: optionalRecord(raw.input, `Step ${stepNum} 'input'`),
		description: optionalString(raw.description, `Step ${stepNum} 'description'`),
		expect: parseExpectation(raw.expect, stepNum),
		continueOnFailure: continueOnFailure === true,
	};
}

/**
 * Parse the expectation of a step.
 */
function parseExpectation(raw: unknown, stepNum: number): Expectation {
	if (!isRecord(raw)) {
		fail(`Step ${stepNum} 'expect' must be an object`);
	}
	checkKeys(raw, EXPECT_KEYS, `step ${stepNum} 'expect'`);

	if (typeof raw.success !== 'boolean') {
		fail(`Step ${stepNum} 'expect' must have a boolean 'success' field`);
	}

	let error: Expectation['error'];
	const rawError = optionalRecord(raw.error, `Step ${stepNum} 'expect.error'`);
	if (rawError) {
		checkKeys(rawError, EXPECT_ERROR_KEYS, `step ${stepNum} 'expect.error'`);
		const suggestion = rawError.suggestion;
		error = {
			code: optionalString(rawError.code, `Step ${stepNum} 'expect.error.code'`),
			message: optionalString(rawError.message, `Step ${stepNum} 'expect.error.message'`),
			// Checked with the other assertions by findExpectationProblems below
			...(suggestion !== undefined && suggestion !== null
				? { suggestion: suggestion as string | AssertionMatcher }
				: {}),
		};
	}

	let confidence: number | undefined;
	if (raw.confidence !== undefined && raw.confidence !== null) {
		if (typeof raw.confidence !== 'number' || raw.confidence < 0 || raw.confidence > 1) {
			fail(`Step ${stepNum} 'expect.confidence' must be a number between 0 and 1`);
		}
		confidence = raw.confidence;
	}

	const expectation: Expectation = {
		success: raw.success,
		data: optionalRecord(raw.data, `Step ${stepNum} 'expect.data'`),
		error,
		reasoning: optionalString(raw.reasoning, `Step ${stepNum} 'expect.reasoning'`),
		confidence,
	};

	const problems = findExpectationProblems(expectation);
	if (problems.length > 0) {
		fail(`Step ${stepNum}: ${problems.join('; ')}`);
	}

	return expectation;
}

/**
 * Parse the fixture configuration: `file` (required), `base`, `overrides`.
 */
function parseFixture(raw: unknown): FixtureConfig | undefined {
	if (raw === undefined || raw === null) {
		return undefined;
	}
	if (!isRecord(raw)) {
		fail('Fixture must be an object');
	}
	checkKeys(raw, FIXTURE_KEYS, 'fixture');

	return {
		file: requireString(raw.file, "Fixture must have a 'file' field (path to fixture JSON)"),
		base: optionalString(raw.base, "Fixture 'base'"),
		overrides: optionalRecord(raw.overrides, "Fixture 'overrides'"),
	};
}

/**
 * Convert a YAML syntax error to a message and line without echoing the source.
 */
function describeYamlError(err: unknown, source: string): { message: string; line?: number } {
	const text = err instanceof Error ? err.message : String(err);
	// Keep only the first line and cap the length: never echo file contents.
	const message = (text.split('\n')[0] ?? '').slice(0, 200);
	if (err instanceof YAMLError) {
		const offset = err.pos[0];
		const line = source.slice(0, offset).split('\n').length;
		return { message, line };
	}
	return { message };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a scenario from a YAML string.
 */
export function parseScenarioString(yaml: string, filePath = '<string>'): ParseResult {
	let raw: unknown;
	try {
		raw = parseYaml(yaml, { prettyErrors: false });
	} catch (err) {
		const { message, line } = describeYamlError(err, yaml);
		return {
			success: false,
			error: `YAML parse error${line ? ` at line ${line}` : ''}: ${message}`,
			path: filePath,
			line,
		};
	}

	try {
		return { success: true, scenario: toScenario(raw) };
	} catch (err) {
		if (err instanceof ScenarioShapeError) {
			return { success: false, error: err.message, path: filePath };
		}
		throw err;
	}
}

/**
 * Parse a scenario from a file path. The result records the file's absolute
 * path as `scenario.sourcePath`, so relative fixture paths resolve against
 * the scenario file rather than the process working directory.
 */
export async function parseScenarioFile(filePath: string): Promise<ParseResult> {
	let content: string;
	try {
		content = await readFile(filePath, 'utf-8');
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			success: false,
			error: `Failed to read file: ${message}`,
			path: filePath,
		};
	}

	const result = parseScenarioString(content, filePath);
	if (result.success) {
		result.scenario.sourcePath = resolve(filePath);
	}
	return result;
}

/**
 * Parse multiple scenario files
 */
export async function parseScenarioFiles(filePaths: string[]): Promise<ParseResult[]> {
	return Promise.all(filePaths.map(parseScenarioFile));
}
