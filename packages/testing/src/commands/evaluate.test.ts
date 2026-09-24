/**
 * scenario-evaluate: timeouts cancel scenarios, failFast reports skipped
 * scenarios, and unparseable files are errors rather than silent skips.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CommandResult, failure, success } from '@lushly-dev/afd-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandHandler } from '../runner/executor.js';
import { scenarioCreate } from './create.js';
import { scenarioEvaluate } from './evaluate.js';
import { formatJunit, formatMarkdown, formatTerminal } from './evaluate-format.js';

function scenarioYaml(job: string, command: string, extra = ''): string {
	return `name: ${job}
description: Scenario ${job}
job: ${job}
tags: [unit]
${extra}steps:
  - command: ${command}
    expect:
      success: true
  - command: after-${command}
    expect:
      success: true
`;
}

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'afd-evaluate-'));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

async function write(name: string, content: string): Promise<string> {
	const file = join(dir, name);
	await writeFile(file, content);
	return file;
}

describe('scenario timeout', () => {
	it('cancels the timed-out scenario, records the message and clears the timer', async () => {
		const calls: string[] = [];
		const handler: CommandHandler = async (command) => {
			calls.push(command);
			if (command === 'slow') await new Promise((resolve) => setTimeout(resolve, 150));
			return success({});
		};
		const file = await write('slow.scenario.yaml', scenarioYaml('slow-job', 'slow'));

		const result = await scenarioEvaluate({ handler, scenarios: [file], timeout: 20 });
		await new Promise((resolve) => setTimeout(resolve, 200));

		const scenario = result.data?.report.scenarios[0];
		expect(scenario?.outcome).toBe('error');
		expect(scenario?.error).toEqual({ type: 'timeout', message: 'Scenario timed out after 20ms' });
		// The step after the timed-out one never ran, even after the slow step finished
		expect(calls).toEqual(['slow']);
		expect(result.data?.exitCode).toBe(1);
	});

	it('clears the timer when the scenario finishes in time', async () => {
		const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
		const file = await write('fast.scenario.yaml', scenarioYaml('fast-job', 'fast'));

		const result = await scenarioEvaluate({
			handler: async () => success({}),
			scenarios: [file],
			timeout: 60_000,
		});

		expect(result.data?.report.scenarios[0]?.outcome).toBe('pass');
		expect(clearSpy).toHaveBeenCalled();
		clearSpy.mockRestore();
	});
});

describe('failFast', () => {
	it('reports scenarios after the first failure as skipped, with their steps', async () => {
		const handler: CommandHandler = async (command) =>
			command === 'broken' ? failure({ code: 'BROKEN', message: 'broken' }) : success({});
		const files = [
			await write('a.scenario.yaml', scenarioYaml('a-job', 'works')),
			await write('b.scenario.yaml', scenarioYaml('b-job', 'broken')),
			await write('c.scenario.yaml', scenarioYaml('c-job', 'works')),
			await write('d.scenario.yaml', scenarioYaml('d-job', 'works')),
		];

		const result = await scenarioEvaluate({ handler, scenarios: files, failFast: true });
		const report = result.data?.report;

		expect(report?.scenarios.map((s) => s.outcome)).toEqual(['pass', 'fail', 'skip', 'skip']);
		expect(report?.scenarios[2]?.stepResults.map((s) => s.outcome)).toEqual(['skip', 'skip']);
		expect(report?.scenarios[2]?.stepResults[0]?.skippedReason).toContain('failFast');
		expect(report?.summary).toMatchObject({
			totalScenarios: 4,
			passedScenarios: 1,
			failedScenarios: 1,
			skippedScenarios: 2,
			skippedSteps: 5,
		});
		expect(result.reasoning).toContain('2 skipped');
		expect(result.data?.exitCode).toBe(1);
	});

	it('keeps order and skips unstarted scenarios with concurrency', async () => {
		const handler: CommandHandler = async (command) => {
			await new Promise((resolve) => setTimeout(resolve, command === 'broken' ? 1 : 30));
			return command === 'broken' ? failure({ code: 'BROKEN', message: 'broken' }) : success({});
		};
		const files = [
			await write('a.scenario.yaml', scenarioYaml('a-job', 'broken')),
			await write('b.scenario.yaml', scenarioYaml('b-job', 'works')),
			await write('c.scenario.yaml', scenarioYaml('c-job', 'works')),
			await write('d.scenario.yaml', scenarioYaml('d-job', 'works')),
		];

		const result = await scenarioEvaluate({
			handler,
			scenarios: files,
			failFast: true,
			concurrency: 2,
		});

		expect(result.data?.report.scenarios.map((s) => [s.jobName, s.outcome])).toEqual([
			['a-job', 'fail'],
			['b-job', 'pass'],
			['c-job', 'skip'],
			['d-job', 'skip'],
		]);
	});

	it('renders skipped and errored scenarios in every format', async () => {
		const handler: CommandHandler = async (command) =>
			command === 'broken' ? failure({ code: 'BROKEN', message: 'broken' }) : success({});
		const files = [
			await write('a.scenario.yaml', scenarioYaml('a-job', 'broken')),
			await write('b.scenario.yaml', scenarioYaml('b-job', 'works')),
			await write('c.scenario.yaml', 'name: [unclosed'),
		];

		const result = await scenarioEvaluate({ handler, scenarios: files });
		const failFastResult = await scenarioEvaluate({ handler, scenarios: files, failFast: true });
		const report = failFastResult.data?.report;
		if (!report || !result.data) throw new Error('Expected reports');

		expect(formatJunit(report)).toContain('<skipped/>');
		expect(formatJunit(result.data.report)).toContain('<error message="YAML parse error');
		expect(formatJunit(result.data.report)).toContain('failures="1" errors="1" skipped="0"');
		expect(formatTerminal(report)).toContain('2 skipped');
		expect(formatTerminal(result.data.report)).toContain('parse_error: YAML parse error');
		expect(formatMarkdown(report)).toContain('| ⏭️ Skipped | 2 |');
		expect(formatMarkdown(result.data.report)).toContain('- **Failed Step**: parse_error');
	});
});

describe('unparseable scenarios', () => {
	it('reports unparseable files in directory mode as error scenarios with a non-zero exit', async () => {
		await write('good.scenario.yaml', scenarioYaml('good-job', 'works'));
		await write('bad.scenario.yaml', 'name: Missing steps\ndescription: x\njob: bad\n');

		const result = await scenarioEvaluate({ handler: async () => success({}), directory: dir });
		const scenarios = result.data?.report.scenarios ?? [];

		expect(scenarios.map((s) => s.outcome)).toEqual(['error', 'pass']);
		expect(scenarios[0]?.scenarioPath).toContain('bad.scenario.yaml');
		expect(scenarios[0]?.error).toEqual({
			type: 'parse_error',
			message: 'Scenario must have at least one step',
		});
		expect(result.data?.report.summary.errorScenarios).toBe(1);
		expect(result.data?.exitCode).toBe(1);
	});

	it('exits non-zero when every scenario in the directory is unparseable', async () => {
		await write('bad.scenario.yaml', 'verify: {}\nname: x');

		const result = await scenarioEvaluate({ handler: async () => success({}), directory: dir });

		expect(result.data?.exitCode).toBe(1);
		expect(result.reasoning).not.toBe('No scenarios to run');
	});

	it('reports unparseable explicit scenario files the same way', async () => {
		const result = await scenarioEvaluate({
			handler: async () => success({}),
			scenarios: [join(dir, 'missing.scenario.yaml')],
		});

		expect(result.data?.report.scenarios[0]?.error?.type).toBe('parse_error');
		expect(result.data?.report.scenarios[0]?.error?.message).toContain('Failed to read file');
		expect(result.data?.exitCode).toBe(1);
	});

	it('runs the default scenario-create template, which now parses', async () => {
		const created = await scenarioCreate({ name: 'new-scenario', job: 'new-job', directory: dir });
		const handler = vi.fn(
			async (): Promise<CommandResult<unknown>> =>
				failure({ code: 'COMMAND_NOT_FOUND', message: 'Replace the placeholder command' })
		);

		const result = await scenarioEvaluate({ handler, directory: dir });

		expect(created.success).toBe(true);
		expect(result.data?.report.scenarios.map((s) => s.outcome)).toEqual(['fail']);
		expect(handler).toHaveBeenCalledWith('domain-action', undefined, expect.anything());
	});

	it('returns exit code 0 with no scenario files', async () => {
		const result = await scenarioEvaluate({ handler: async () => success({}), directory: dir });

		expect(result.data?.exitCode).toBe(0);
		expect(result.reasoning).toBe('No scenarios to run');
	});
});

describe('input checks and output', () => {
	it.each([0, -1, 1.5, Number.NaN])('rejects concurrency %s', async (concurrency) => {
		const result = await scenarioEvaluate({ handler: async () => success({}), concurrency });

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('INVALID_INPUT');
		expect(result.error?.suggestion).toBeDefined();
	});

	it('rejects a non-positive timeout', async () => {
		const result = await scenarioEvaluate({ handler: async () => success({}), timeout: -5 });

		expect(result.error?.code).toBe('INVALID_INPUT');
	});

	it('writes the formatted report to the output path', async () => {
		const file = await write('a.scenario.yaml', scenarioYaml('a-job', 'works'));
		const output = join(dir, 'report.xml');

		const result = await scenarioEvaluate({
			handler: async () => success({}),
			scenarios: [file],
			format: 'junit',
			output,
		});

		expect(await readFile(output, 'utf-8')).toBe(result.data?.formattedOutput);
	});

	it('reports a failure when the output cannot be written', async () => {
		const file = await write('a.scenario.yaml', scenarioYaml('a-job', 'works'));

		const result = await scenarioEvaluate({
			handler: async () => success({}),
			scenarios: [file],
			output: join(dir, 'missing-dir', 'report.json'),
		});

		expect(result.error?.code).toBe('EVALUATE_ERROR');
		expect(result.error?.suggestion).toBeDefined();
	});

	it('returns an empty report when the filters match nothing', async () => {
		const result = await scenarioEvaluate({
			handler: async () => success({}),
			directory: dir,
			job: 'x',
			tags: ['y'],
		});

		expect(result.success).toBe(true);
		expect(result.data?.report.scenarios).toEqual([]);
	});
});
