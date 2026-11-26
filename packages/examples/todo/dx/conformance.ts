import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv';

/**
 * Conformance Test Runner
 *
 * This script runs the shared test-cases.json against a target MCP server.
 * It ensures that all backends (TS, Python, etc.) behave identically.
 *
 * Each `expect` entry maps a dotted path in the CommandResult (array indexes and
 * `.length` included, e.g. `data.todos.0.title`) to either an exact JSON value
 * or a matcher: `{ "exists": boolean }` checks presence without fixing the value,
 * `{ "matches": "<regex>" }` a string against a regular expression, `{ "type": "<typeof>" }`
 * the value's JavaScript type, and `{ "lessThan": n }` a number's upper bound.
 *
 * An expected array is compared as JSON, whole.
 *
 * A case may also name the `client` it needs (the confirmation suite runs each kind against its
 * own connection) and a `then` step whose result is checked after the command. A case with
 * `implementedBy` runs only against backends in those languages, as spec/commands.schema.json
 * marks the commands only some languages have so far; one with `notOn` skips the backends it
 * names, for what a backend does not serve by design.
 *
 * The command `tools/list` is not a tool: the runner lists the server's tools and answers with
 * `toolListView` of them, so a case can check the tool list and each command's hints in the
 * lists the backends serve.
 */

interface TestCase {
	name: string;
	description: string;
	setup: Array<{
		command: string;
		input: unknown;
		capture?: string;
		meta?: Record<string, unknown>;
	}>;
	command: string;
	input: unknown;
	meta?: Record<string, unknown>;
	expect: Record<string, unknown>;
	client?: string;
	/** MCP era filter: when set, runs only in that era (`legacy` or `modern`). */
	era?: 'legacy' | 'modern';
	implementedBy?: string[];
	/** Backends that skip the case (`ts`, `py`, `rs`, `cpp`, `umbel`, `umbel-mounted`). */
	notOn?: string[];
	then?: {
		command: string;
		input: unknown;
		meta?: Record<string, unknown>;
		expect: Record<string, unknown>;
	};
}

type ToolResult = { success?: boolean; data?: unknown; error?: { message: string } };
type CallTool = (
	name: string,
	args: unknown,
	meta?: Record<string, unknown>
) => Promise<ToolResult>;

export interface RunnerOptions {
	/** Reset the store before each case (default: `todo-clear` with `all: true`). */
	reset?: (callTool: CallTool) => Promise<ToolResult>;
}

interface TestResult {
	name: string;
	success: boolean;
	error?: string;
	actual?: unknown;
	expected?: unknown;
}

/** A suite's cases from `specPath`, or none, for a client kind and a language. */
export interface CaseFilter {
	client?: string;
	era?: 'legacy' | 'modern';
	language?: string;
	backend?: string;
}

/** The pseudo-command a case names to check the tool list instead of calling a tool. */
export const TOOL_LIST = 'tools/list';

interface ListedTool {
	name: string;
	annotations?: { destructiveHint?: boolean };
	inputSchema?: { properties?: { action?: { enum?: unknown } } };
	_meta?: {
		destructive?: unknown;
		actions?: Array<{ command?: unknown; destructive?: unknown }>;
	};
}

/**
 * A tool list as a case reads it, the same for the lists the backends serve: one tool per command
 * (`individual`, `hybrid`'s first-class tools) and TypeScript's grouped tools with
 * `_meta.actions`. Python's grouped tools, which carry no `_meta.actions`, would read as commands,
 * and a lazy list shows none; no backend serves either by default.
 *
 * - `names`: the tool names, in order;
 * - `actions`: each grouped tool's `action` values, in order;
 * - `commands`: each command the list shows, by name: the `tool` that runs it and whether it is
 *   reported `destructive` (the tool's `_meta.destructive` or `destructiveHint`, or its grouped
 *   action's `destructive`).
 */
export function toolListView(tools: ListedTool[]) {
	const actions: Record<string, unknown> = {};
	const commands: Record<string, { tool: string; destructive: boolean }> = {};
	for (const tool of tools) {
		const grouped = tool._meta?.actions;
		if (Array.isArray(grouped)) {
			actions[tool.name] = tool.inputSchema?.properties?.action?.enum;
			for (const action of grouped) {
				if (typeof action.command === 'string') {
					commands[action.command] = { tool: tool.name, destructive: action.destructive === true };
				}
			}
			continue;
		}
		commands[tool.name] = {
			tool: tool.name,
			destructive: tool._meta?.destructive === true || tool.annotations?.destructiveHint === true,
		};
	}
	return { names: tools.map((tool) => tool.name), actions, commands };
}

/**
 * The cases of `specPath` for `filter`: only those for `client` when it is given, and only those
 * `language` implements (a case without `implementedBy` is every language's).
 */
export async function selectCases(specPath: string, filter: CaseFilter = {}): Promise<TestCase[]> {
	const spec = JSON.parse(await fs.readFile(specPath, 'utf-8'));
	const all: TestCase[] = Array.isArray(spec.tests) ? spec.tests : [];
	if (all.length === 0) {
		throw new Error(`No conformance tests found in ${specPath}`);
	}
	return all.filter(
		(test) =>
			(filter.client === undefined || test.client === filter.client) &&
			(filter.era === undefined || test.era === undefined || test.era === filter.era) &&
			(filter.language === undefined ||
				test.implementedBy === undefined ||
				test.implementedBy.includes(filter.language)) &&
			(filter.backend === undefined || !test.notOn?.includes(filter.backend))
	);
}

export class ConformanceRunner {
	private captured: Record<string, unknown> = {};

	constructor(
		private callTool: CallTool,
		private options: RunnerOptions = {}
	) {}

	/**
	 * Run the cases of `specPath`: only those for `client` when it is given, and only those
	 * `language` implements (a case without `implementedBy` is every language's).
	 */
	async run(specPath: string, filter: CaseFilter = {}): Promise<TestResult[]> {
		const tests = await selectCases(specPath, filter);
		if (tests.length === 0) {
			throw new Error(
				`No case in ${specPath} is for ${[filter.client, filter.language].filter(Boolean).join(' and ')}: this backend does not implement the suite yet`
			);
		}
		const results: TestResult[] = [];

		for (const test of tests) {
			try {
				// 1. Reset state (Clear all)
				const reset = this.options.reset
					? await this.options.reset(this.callTool)
					: await this.callTool('todo-clear', { all: true });
				if (!reset.success) {
					throw new Error(reset.error?.message ?? 'Failed to reset Todo state');
				}
				this.captured = {};

				// 2. Run setup
				for (const step of test.setup) {
					const input = this.resolveVariables(step.input);
					const result = await this.callTool(step.command, input, step.meta);
					if (result.success === false) {
						throw new Error(result.error?.message ?? `Setup command ${step.command} failed`);
					}
					if (step.capture) {
						this.captured[step.capture] = result.data;
					}
				}

				// 3. Run command
				const input = this.resolveVariables(test.input);
				const actual = await this.callTool(test.command, input, test.meta);

				// 4. Validate expectations, then the follow-up state
				const errors = this.validate(actual, test.expect);
				if (test.then) {
					const after = await this.callTool(
						test.then.command,
						this.resolveVariables(test.then.input),
						test.then.meta
					);
					errors.push(
						...this.validate(after, test.then.expect).map(
							(error) => `then ${test.then?.command}: ${error}`
						)
					);
				}

				results.push({
					name: test.name,
					success: errors.length === 0,
					error: errors.join(', '),
					actual,
					expected: test.expect,
				});
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				results.push({
					name: test.name,
					success: false,
					error: message,
				});
			}
		}

		return results;
	}

	private resolveVariables(input: unknown): unknown {
		if (typeof input === 'string' && input.startsWith('$')) {
			const [key = '', ...path] = input.substring(1).split('.');
			if (Object.hasOwn(this.captured, key)) {
				return this.getValue(this.captured[key], path.join('.'));
			}
			return input;
		}

		if (Array.isArray(input)) {
			return input.map((item) => this.resolveVariables(item));
		}

		if (typeof input === 'object' && input !== null) {
			const resolved: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(input)) {
				resolved[k] = this.resolveVariables(v);
			}
			return resolved;
		}

		return input;
	}

	private validate(actual: unknown, expect: Record<string, unknown>): string[] {
		const errors: string[] = [];

		for (const [key, expectedValue] of Object.entries(expect)) {
			const actualValue = this.getValue(actual, key);

			// An object is a matcher (exists, matches, type, lessThan); an array is compared as JSON.
			if (Array.isArray(expectedValue)) {
				if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
					errors.push(
						`Expected ${key} to be ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`
					);
				}
				continue;
			}
			const matched = matcherProblem(key, actualValue, expectedValue);
			if (matched !== undefined) {
				if (matched) errors.push(matched);
				continue;
			}
			if (isExistsMatcher(expectedValue)) {
				const present = actualValue !== undefined && actualValue !== null;
				if (present !== expectedValue.exists) {
					errors.push(
						`Expected ${key} to ${expectedValue.exists ? 'be present' : 'be absent'}, got ${JSON.stringify(actualValue)}`
					);
				}
				continue;
			}

			if (actualValue !== expectedValue) {
				errors.push(
					`Expected ${key} to be ${JSON.stringify(
						expectedValue
					)}, got ${JSON.stringify(actualValue)}`
				);
			}
		}

		return errors;
	}

	private getValue(obj: unknown, path: string): unknown {
		if (path === '') return obj;
		let current = obj;
		for (const part of path.split('.')) {
			if (current === undefined || current === null) return undefined;
			current = (current as Record<string, unknown>)[part];
		}
		return current;
	}
}

/**
 * For a `matches`, `type` or `lessThan` matcher: the problem, or `''` when the value passes.
 * `undefined` when `expected` is not one of these matchers.
 */
function matcherProblem(key: string, actual: unknown, expected: unknown): string | undefined {
	if (typeof expected !== 'object' || expected === null || Array.isArray(expected)) {
		return undefined;
	}
	const entries = Object.entries(expected);
	if (entries.length !== 1) return undefined;
	const [kind, operand] = entries[0] as [string, unknown];
	const got = JSON.stringify(actual);
	if (kind === 'matches' && typeof operand === 'string') {
		return typeof actual === 'string' && new RegExp(operand).test(actual)
			? ''
			: `Expected ${key} to match /${operand}/, got ${got}`;
	}
	if (kind === 'type' && typeof operand === 'string') {
		return typeof actual === operand && actual !== null
			? ''
			: `Expected ${key} to be a ${operand}, got ${got}`;
	}
	if (kind === 'lessThan' && typeof operand === 'number') {
		return typeof actual === 'number' && actual < operand
			? ''
			: `Expected ${key} to be less than ${operand}, got ${got}`;
	}
	return undefined;
}

function isExistsMatcher(value: unknown): value is { exists: boolean } {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		Object.keys(value).length === 1 &&
		typeof (value as { exists?: unknown }).exists === 'boolean'
	);
}

/** Keys whose values are command payloads: their own keys and nulls are not checked. */
const FREE_FORM_KEYS = new Set(['data', 'details', 'undoArgs']);

/** Which JSON Schema in `spec/schema/` validates a tool's wire payload. */
export type WireSchemaKind = 'result' | 'batch' | 'pipeline' | 'stream';

const schemaValidators = (() => {
	const validator = new AjvJsonSchemaValidator();
	const load = (name: string) =>
		JSON.parse(
			readFileSync(new URL(`../../../../spec/schema/${name}`, import.meta.url), 'utf8')
		) as Parameters<AjvJsonSchemaValidator['getValidator']>[0];
	const errorSchema = load('error.json');
	const resultSchema = load('result.json');
	const batchSchema = load('batch.json');
	const pipelineSchema = load('pipeline.json');
	const streamSchema = load('stream.json');
	validator.getValidator(errorSchema);
	const compiled: Record<WireSchemaKind, ReturnType<AjvJsonSchemaValidator['getValidator']>> = {
		result: validator.getValidator(resultSchema),
		batch: validator.getValidator(batchSchema),
		pipeline: validator.getValidator(pipelineSchema),
		stream: validator.getValidator(streamSchema),
	};
	return (kind: WireSchemaKind, value: unknown): string | undefined => {
		const outcome = compiled[kind](value);
		return outcome.valid ? undefined : (outcome.errorMessage ?? `invalid ${kind}`);
	};
})();

/** Map an MCP tool name to the contract schema its wire payload must satisfy. */
export function wireSchemaForTool(toolName: string): WireSchemaKind {
	if (toolName === 'afd-batch') return 'batch';
	if (toolName === 'afd-pipe') return 'pipeline';
	return 'result';
}

/** Validate a single StreamChunk against `spec/schema/stream.json`. */
export function streamChunkProblems(chunk: unknown): string[] {
	const err = schemaValidators('stream', chunk);
	return err ? [`schema (spec/schema/stream.json): ${err}`] : [];
}

/**
 * Check a tool result against the cross-language wire format (`spec/wire/README.md`) and JSON
 * Schema (`spec/schema/{result,batch,pipeline}.json`): `isError` matches `!success`, envelope keys
 * are camelCase, unset fields are omitted rather than `null`, and the payload validates against its
 * contract schema.
 */
export function wireProblems(
	body: unknown,
	isError: boolean,
	schemaKind: WireSchemaKind = 'result'
): string[] {
	const problems: string[] = [];
	if (schemaKind !== 'pipeline' && typeof body === 'object' && body !== null && 'success' in body) {
		const { success } = body as { success: unknown };
		if (typeof success === 'boolean' && isError === success) {
			problems.push(`isError is ${isError} for a result with success: ${success}`);
		}
	}

	const schemaFile = `spec/schema/${schemaKind}.json`;
	const schemaError = schemaValidators(schemaKind, body);
	if (schemaError) {
		problems.push(`schema (${schemaFile}): ${schemaError}`);
	}

	const visit = (value: unknown, path: string): void => {
		if (Array.isArray(value)) {
			for (const [index, item] of value.entries()) visit(item, `${path}.${index}`);
			return;
		}
		if (typeof value !== 'object' || value === null) return;
		for (const [key, item] of Object.entries(value)) {
			const keyPath = path ? `${path}.${key}` : key;
			if (key.includes('_')) problems.push(`${keyPath} is not camelCase`);
			if (item === null) problems.push(`${keyPath} is null (unset fields must be omitted)`);
			if (!FREE_FORM_KEYS.has(key)) visit(item, keyPath);
		}
	};
	visit(body, '');
	return problems;
}
