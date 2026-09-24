/**
 * Runs scenarios against the real todo example (`packages/examples/todo`):
 * its TypeScript commands, its fixture and its scenario files.
 *
 * Guards against the fixture loader calling commands the app does not have
 * (the old `todo.create` dot names) and still reporting success, which made
 * scenarios fail later, at the wrong step.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type CommandResult, failure } from '@lushly-dev/afd-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { scenarioEvaluate } from '../commands/evaluate.js';
import { parseScenarioFile } from '../parsers/yaml.js';
import { type CommandHandler, InProcessExecutor } from './executor.js';

const TODO_EXAMPLE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples/todo');

/** The parts of the example's Zod command definitions this test uses. */
interface ExampleCommand {
	name: string;
	inputSchema: {
		safeParse(
			input: unknown
		):
			| { success: true; data: unknown }
			| { success: false; error: { issues: Array<{ message: string }> } };
	};
	handler(input: unknown, context: Record<string, unknown>): Promise<CommandResult<unknown>>;
}

let commands: ExampleCommand[] = [];
let calls: string[] = [];

/** Validate input with the command's own schema, then run its handler. */
const handler: CommandHandler = async (name, input) => {
	calls.push(name);
	const command = commands.find((candidate) => candidate.name === name);
	if (!command) {
		return failure({
			code: 'COMMAND_NOT_FOUND',
			message: `Unknown command: ${name}`,
			suggestion: 'Use one of the todo example commands, such as todo-create',
		});
	}
	const parsed = command.inputSchema.safeParse(input ?? {});
	if (!parsed.success) {
		return failure({
			code: 'VALIDATION_ERROR',
			message: parsed.error.issues.map((issue) => issue.message).join('; '),
			suggestion: 'Fix the command input',
		});
	}
	return command.handler(parsed.data, {});
};

beforeAll(async () => {
	// The example picks its store when imported; keep it in memory
	process.env.TODO_STORE_TYPE = 'memory';
	vi.spyOn(console, 'error').mockImplementation(() => {});
	const url = pathToFileURL(join(TODO_EXAMPLE, 'backends/typescript/src/commands/index.ts')).href;
	const example = (await import(url)) as { allCommands: ExampleCommand[] };
	commands = example.allCommands;
});

afterAll(() => {
	vi.restoreAllMocks();
});

beforeEach(async () => {
	await handler('todo-clear', { all: true });
	calls = [];
});

describe('todo example scenarios', () => {
	it('seeds the fixture, resolved next to the scenario file, and passes', async () => {
		const result = await scenarioEvaluate({
			handler,
			scenarios: [join(TODO_EXAMPLE, 'scenarios/filter-by-priority.scenario.yaml')],
		});

		expect(result.data?.report.scenarios[0]?.error).toBeUndefined();
		expect(result.data?.report.scenarios[0]?.outcome).toBe('pass');
		expect(result.data?.exitCode).toBe(0);
		expect(calls.slice(0, 5)).toEqual([
			'todo-clear',
			'todo-create',
			'todo-create',
			'todo-create',
			'todo-create',
		]);
	});

	it('passes every scenario in the example directory', async () => {
		const result = await scenarioEvaluate({
			handler,
			directory: join(TODO_EXAMPLE, 'scenarios'),
		});

		const outcomes = result.data?.report.scenarios.map((s) => [s.jobName, s.outcome, s.error]);
		expect(outcomes).toEqual([
			['basic-operations', 'pass', undefined],
			['create-and-complete', 'pass', undefined],
			['filter-by-priority', 'pass', undefined],
			['todo-lifecycle', 'pass', undefined],
		]);
		expect(result.data?.exitCode).toBe(0);
	});
});

describe('failing fixture commands against the todo example', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'afd-todo-fixture-'));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	async function writeScenario(fixture: unknown): Promise<string> {
		await writeFile(join(dir, 'fixture.json'), JSON.stringify(fixture));
		const file = join(dir, 'seeded.scenario.yaml');
		await writeFile(
			file,
			`name: Seeded stats
description: Stats after seeding
job: seeded-stats
tags: [fixture]
fixture:
  file: ./fixture.json
steps:
  - command: todo-stats
    expect:
      success: true
      data:
        total: 2
`
		);
		return file;
	}

	it('fails the scenario at the fixture step when a fixture command fails', async () => {
		const file = await writeScenario({
			app: 'todo',
			clearFirst: true,
			todos: [{ title: 'Valid todo' }, { title: 'x'.repeat(201) }, { title: 'Never created' }],
		});
		const parsed = await parseScenarioFile(file);
		if (!parsed.success) throw new Error(parsed.error);

		const result = await new InProcessExecutor({ handler }).execute(parsed.scenario);

		expect(result.outcome).toBe('error');
		expect(result.error?.type).toBe('fixture_failed');
		expect(result.error?.message).toBe(
			"Fixture command 'todo-create' failed with VALIDATION_ERROR: Title too long"
		);
		expect(result.stepResults.map((s) => [s.command, s.outcome, s.skippedReason])).toEqual([
			['todo-stats', 'skip', result.error?.message],
		]);
		// Seeding stopped at the failure and no scenario step ran
		expect(calls).toEqual(['todo-clear', 'todo-create', 'todo-create']);
	});

	it('reports a fixture command the app does not have as a fixture failure', async () => {
		const file = await writeScenario({
			app: 'custom',
			setup: [{ command: 'todo.create', input: { title: 'Dot-named command' } }],
		});

		const result = await scenarioEvaluate({ handler, scenarios: [file] });
		const scenario = result.data?.report.scenarios[0];

		expect(result.data?.exitCode).toBe(1);
		expect(scenario?.outcome).toBe('error');
		expect(scenario?.error?.message).toContain(
			"Fixture command 'todo.create' failed with COMMAND_NOT_FOUND"
		);
		expect(calls).not.toContain('todo-stats');
	});
});
