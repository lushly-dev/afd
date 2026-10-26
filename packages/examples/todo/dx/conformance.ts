import fs from 'node:fs/promises';

/**
 * Conformance Test Runner
 *
 * This script runs the shared test-cases.json against a target MCP server.
 * It ensures that all backends (TS, Python, etc.) behave identically.
 *
 * Each `expect` entry maps a dotted path in the CommandResult (array indexes and
 * `.length` included, e.g. `data.todos.0.title`) to either an exact JSON value
 * or `{ "exists": boolean }`, which checks presence without fixing the value.
 *
 * A case may also name the `client` it needs (the confirmation suite runs each kind against its
 * own connection) and a `then` step whose result is checked after the command.
 */

interface TestCase {
	name: string;
	description: string;
	setup: Array<{ command: string; input: unknown; capture?: string }>;
	command: string;
	input: unknown;
	expect: Record<string, unknown>;
	client?: string;
	then?: { command: string; input: unknown; expect: Record<string, unknown> };
}

type ToolResult = { success: boolean; data?: unknown; error?: { message: string } };

export interface RunnerOptions {
	/** Reset the store before each case (default: `todo-clear` with `all: true`). */
	reset?: (callTool: (name: string, args: unknown) => Promise<ToolResult>) => Promise<ToolResult>;
}

interface TestResult {
	name: string;
	success: boolean;
	error?: string;
	actual?: unknown;
	expected?: unknown;
}

export class ConformanceRunner {
	private captured: Record<string, unknown> = {};

	constructor(
		private callTool: (name: string, args: unknown) => Promise<ToolResult>,
		private options: RunnerOptions = {}
	) {}

	/** Run the cases of `specPath`, only those for `client` when it is given. */
	async run(specPath: string, filter: { client?: string } = {}): Promise<TestResult[]> {
		const spec = JSON.parse(await fs.readFile(specPath, 'utf-8'));
		const all: TestCase[] = Array.isArray(spec.tests) ? spec.tests : [];
		const tests =
			filter.client === undefined ? all : all.filter((test) => test.client === filter.client);
		if (tests.length === 0) {
			throw new Error(`No conformance tests found in ${specPath}`);
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
					const result = await this.callTool(step.command, input);
					if (!result.success) {
						throw new Error(result.error?.message ?? `Setup command ${step.command} failed`);
					}
					if (step.capture) {
						this.captured[step.capture] = result.data;
					}
				}

				// 3. Run command
				const input = this.resolveVariables(test.input);
				const actual = await this.callTool(test.command, input);

				// 4. Validate expectations, then the follow-up state
				const errors = this.validate(actual, test.expect);
				if (test.then) {
					const after = await this.callTool(
						test.then.command,
						this.resolveVariables(test.then.input)
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
			return this.getValue(this.captured[key], path.join('.'));
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

			// Object expectations were compared by reference and could never pass;
			// the only object form is the { exists } matcher.
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

/**
 * Check a tool result against the cross-language wire format (spec/wire/README.md):
 * `isError` matches `!success`, envelope keys are camelCase, and unset fields are
 * omitted rather than `null`.
 */
export function wireProblems(body: unknown, isError: boolean): string[] {
	const problems: string[] = [];
	if (typeof body === 'object' && body !== null && 'success' in body) {
		const { success } = body as { success: unknown };
		if (typeof success === 'boolean' && isError === success) {
			problems.push(`isError is ${isError} for a result with success: ${success}`);
		}
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
