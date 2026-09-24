/**
 * scenario-list, scenario-create, scenario-coverage and scenario-suggest:
 * parameters that used to be ignored, templates that must parse, and
 * heuristic suggestions with kebab-case names.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { failure, success } from '@lushly-dev/afd-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	generateAgentHints,
	generateCoverageHints,
	generateTestReportHints,
} from '../mcp/hints.js';
import { parseScenarioString } from '../parsers/yaml.js';
import { calculateSummary, type ScenarioResult } from '../types/report.js';
import { scenarioCoverage } from './coverage.js';
import { scenarioCreate } from './create.js';
import { listTemplates } from './create-templates.js';
import { scenarioList } from './list.js';
import { scenarioSuggest } from './suggest.js';

const SCENARIO = (job: string, commands: string[], extra = '') => `name: ${job}
description: Scenario ${job}
job: ${job}
tags: [smoke]
steps:
${commands
	.map(
		(command) => `  - command: ${command}
    expect:
      success: ${command.endsWith('-missing') ? 'false' : 'true'}
${command.endsWith('-missing') ? '      error: { code: NOT_FOUND }\n' : ''}`
	)
	.join('')}${extra}`;

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'afd-commands-'));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe('scenario-list parameters', () => {
	beforeEach(async () => {
		await writeFile(join(dir, 'a.scenario.yaml'), SCENARIO('a-job', ['todo-create']));
		await mkdir(join(dir, 'nested'));
		await writeFile(join(dir, 'nested', 'b.scenario.yaml'), SCENARIO('b-job', ['todo-list']));
		await writeFile(join(dir, 'c.flow.yml'), SCENARIO('c-job', ['todo-get']));
		await writeFile(join(dir, 'broken.scenario.yaml'), 'name: [unclosed');
	});

	it('reports unparseable files in parseErrors and warnings', async () => {
		const result = await scenarioList({ directory: dir });

		expect(result.data?.total).toBe(2);
		expect(result.data?.parseErrors).toEqual([
			{
				path: join(dir, 'broken.scenario.yaml'),
				error: expect.stringContaining('YAML parse error'),
			},
		]);
		expect(result.warnings?.[0]?.code).toBe('PARSE_ERROR');
		expect(result.reasoning).toContain('1 file(s) could not be parsed');
	});

	it('honours recursive and pattern', async () => {
		const flat = await scenarioList({ directory: dir, recursive: false });
		const yml = await scenarioList({ directory: dir, pattern: '**/*.flow.yml' });

		expect(flat.data?.scenarios.map((s) => s.job)).toEqual(['a-job']);
		expect(yml.data?.scenarios.map((s) => s.job)).toEqual(['c-job']);
	});

	it('returns formattedOutput in the requested format', async () => {
		const names = await scenarioList({ directory: dir, format: 'names' });
		const json = await scenarioList({ directory: dir, format: 'json' });
		const table = await scenarioList({ directory: dir, format: 'table' });
		const none = await scenarioList({ directory: dir });

		expect(names.data?.formattedOutput).toBe('a-job\nb-job');
		expect(JSON.parse(json.data?.formattedOutput ?? '[]')).toHaveLength(2);
		expect(table.data?.formattedOutput).toContain('Scenario List');
		expect(none.data?.formattedOutput).toBeUndefined();
	});

	it("rejects status filters it cannot honour, and matches every scenario for 'unknown'", async () => {
		const passed = await scenarioList({ directory: dir, status: 'passed' });
		const unknown = await scenarioList({ directory: dir, status: 'unknown' });

		expect(passed.success).toBe(false);
		expect(passed.error?.code).toBe('UNSUPPORTED_FILTER');
		expect(passed.error?.suggestion).toContain('scenario-evaluate');
		expect(unknown.data?.filtered).toBe(2);
	});

	it('explains an empty directory', async () => {
		const empty = await mkdtemp(join(tmpdir(), 'afd-empty-'));
		try {
			const result = await scenarioList({ directory: empty });

			expect(result.data?.total).toBe(0);
			expect(result.reasoning).toContain('No scenario files found');
		} finally {
			await rm(empty, { recursive: true, force: true });
		}
	});
});

describe('scenario-create templates', () => {
	it.each(listTemplates().map((t) => t.name))(
		'writes a %s scenario that parses',
		async (template) => {
			const result = await scenarioCreate({
				name: `todo-${template}`,
				job: 'todo-job',
				directory: dir,
				template: template as 'blank' | 'crud' | 'error-handling' | 'workflow',
				fixture: './fixtures/seed.json',
			});
			const content = await readFile(join(dir, `todo-${template}.scenario.yaml`), 'utf-8');
			const parsed = parseScenarioString(content);

			expect(result.success).toBe(true);
			expect(parsed.success).toBe(true);
			if (parsed.success) {
				for (const step of parsed.scenario.steps) {
					expect(step.command).toMatch(/^[a-z][a-z0-9]*-[a-z][a-z0-9-]*$/);
				}
			}
		}
	);

	it('refuses to write a scenario the parser would reject', async () => {
		const result = await scenarioCreate({
			name: 'contradictory',
			job: 'job',
			directory: dir,
			steps: [
				{ description: 'x', command: 'item-get', expectData: { id: 1 }, expectError: 'NOT_FOUND' },
			],
		});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('INVALID_SCENARIO');
		expect(result.error?.message).toContain("'data' assertions are only checked");
	});

	it('strips every kind of line break from the header comment', async () => {
		await scenarioCreate({ name: 'breaks', job: 'a\rb c\u0085d', directory: dir });

		const [firstLine, secondLine] = (
			await readFile(join(dir, 'breaks.scenario.yaml'), 'utf-8')
		).split('\n');

		expect(firstLine).toBe('# JTBD Scenario: a b c d');
		expect(secondLine).toBe('# Generated by @lushly-dev/afd-testing');
	});

	it('reports write failures with a suggestion', async () => {
		await writeFile(join(dir, 'file'), 'not a directory');

		const result = await scenarioCreate({ name: 'x', job: 'job', directory: join(dir, 'file') });

		expect(result.error?.code).toBe('CREATE_ERROR');
		expect(result.error?.suggestion).toBeDefined();
	});
});

describe('scenario-coverage', () => {
	it('computes coverage only over known commands and counts error codes once', async () => {
		await writeFile(
			join(dir, 'a.scenario.yaml'),
			SCENARIO('a-job', ['todo-create', 'todo-get-missing', 'other-command'])
		);

		const result = await scenarioCoverage({
			directory: dir,
			knownCommands: ['todo-create', 'todo-list'],
			knownErrors: ['NOT_FOUND', 'VALIDATION_ERROR'],
		});

		expect(result.data?.summary.commands.coverage).toBe(50);
		expect(result.data?.summary.errors.coverage).toBe(50);
		expect(result.data?.errorCoverage).toEqual([
			{ errorCode: 'NOT_FOUND', scenarioCount: 1, testedIn: [join(dir, 'a.scenario.yaml')] },
		]);
	});

	it('warns about unparseable scenarios instead of skipping them silently', async () => {
		await writeFile(join(dir, 'broken.scenario.yaml'), 'name: [unclosed');
		await writeFile(join(dir, 'explicit.scenario.yaml'), 'isolation: fresh');

		const listed = await scenarioCoverage({ directory: dir });
		const explicit = await scenarioCoverage({ scenarios: [join(dir, 'explicit.scenario.yaml')] });

		expect(listed.warnings?.map((w) => w.code)).toEqual(['PARSE_ERROR', 'PARSE_ERROR']);
		expect(explicit.warnings?.[0]?.message).toContain("'isolation' is not supported");
	});

	it('writes the formatted report to output', async () => {
		await writeFile(join(dir, 'a.scenario.yaml'), SCENARIO('a-job', ['todo-create']));
		const output = join(dir, 'coverage.json');

		const result = await scenarioCoverage({ directory: dir, format: 'json', output });

		expect(await readFile(output, 'utf-8')).toBe(result.data?.formattedOutput);
	});
});

describe('scenario-suggest heuristics', () => {
	it('suggests scenarios for known commands that no scenario uses', async () => {
		await writeFile(join(dir, 'a.scenario.yaml'), SCENARIO('a-job', ['todo-create']));

		const result = await scenarioSuggest({
			context: 'uncovered',
			directory: dir,
			knownCommands: ['todo-create', 'todo-delete'],
		});

		const untested = result.data?.suggestions.find((s) => s.name === 'test-todo-delete');
		expect(untested).toMatchObject({
			priority: 'high',
			commands: ['todo-delete'],
			job: 'Delete todo',
		});
		expect(result.data?.suggestions.some((s) => s.name === 'todo-create-additional')).toBe(true);
	});

	it('uses kebab-case names for files, failures and skeletons', async () => {
		await writeFile(
			join(dir, 'failing.scenario.yaml'),
			SCENARIO('test-todo-update', ['todo-update']).replace('tags: [smoke]', 'tags: [flaky]')
		);

		const changed = await scenarioSuggest({
			context: 'changed-files',
			files: ['src/commands/todo/create-batch.ts', 'src/commands/todo.ts', 'src/todo-handler.ts'],
			directory: dir,
		});
		const failed = await scenarioSuggest({ context: 'failed', directory: dir });
		const natural = await scenarioSuggest({
			context: 'natural',
			query: 'todo create flows',
			knownCommands: ['todo-create'],
			includeSkeleton: true,
		});

		expect(changed.data?.suggestions.flatMap((s) => s.commands ?? [])).toEqual([
			'todo-create-batch',
			'todo-*',
			'todo-*',
		]);
		expect(failed.data?.suggestions.some((s) => s.commands?.includes('todo-update'))).toBe(true);
		const skeletonCommands = natural.data?.suggestions.flatMap(
			(s) => s.skeleton?.steps?.map((step) => step.command) ?? []
		);
		expect(skeletonCommands).toContain('todo-create');
		expect(skeletonCommands?.every((c) => !c.includes('.'))).toBe(true);
	});
});

describe('agent hints', () => {
	function report(outcome: ScenarioResult['outcome']) {
		const scenarios: ScenarioResult[] = [
			{
				scenarioPath: 'a',
				jobName: 'a',
				outcome,
				durationMs: 1,
				stepResults: [],
				passedSteps: 0,
				failedSteps: 1,
				skippedSteps: 0,
				startedAt: new Date(),
				completedAt: new Date(),
			},
		];
		return {
			title: 't',
			durationMs: 1,
			scenarios,
			summary: calculateSummary(scenarios),
			generatedAt: new Date(),
		};
	}

	it('lists only tool names in relatedCommands', () => {
		const related = [
			generateAgentHints('scenario-evaluate', failure({ code: 'X', message: 'x' })).relatedCommands,
			generateAgentHints('scenario-list', success({})).relatedCommands,
			generateTestReportHints(report('partial')).relatedCommands,
			generateCoverageHints([], ['todo-create'], 0).relatedCommands,
		].flat();

		expect(related.length).toBeGreaterThan(0);
		for (const name of related) {
			expect(name).toMatch(/^scenario-[a-z]+$/);
		}
	});
});
