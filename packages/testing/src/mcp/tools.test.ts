/**
 * Testing MCP tools: path containment, schema/implementation agreement and
 * input validation.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { failure, success } from '@lushly-dev/afd-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseScenarioString } from '../parsers/yaml.js';
import { generateTools } from './tool-schemas.js';
import { createToolRegistry, executeTool, type ToolExecutionContext } from './tools.js';

const SCENARIO = (job: string, command = 'item-create') => `name: ${job}
description: Scenario ${job}
job: ${job}
tags: [smoke]
steps:
  - command: ${command}
    expect:
      success: true
`;

let root: string;
let outside: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'afd-tools-root-'));
	outside = await mkdtemp(join(tmpdir(), 'afd-tools-outside-'));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
	await rm(outside, { recursive: true, force: true });
});

function registry(
	commandHandler: ToolExecutionContext['commandHandler'] = vi.fn(async () => success({}))
) {
	return createToolRegistry({ cwd: root, commandHandler });
}

describe('path containment', () => {
	it.each([
		['../escaped/evil', 'must not contain path separators'],
		['sub\\evil', 'must not contain path separators'],
		['..', "must not be '.' or '..'"],
		['bad\nname', 'must not contain control characters'],
	])('scenario-create rejects name %j', async (name, message) => {
		const result = await executeTool(registry(), 'scenario-create', { name, job: 'job' });

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('INVALID_NAME');
		expect(result.error?.message).toContain(message);
		expect(existsSync(join(root, '..', 'escaped'))).toBe(false);
	});

	it('scenario-create rejects a filename with separators', async () => {
		const result = await executeTool(registry(), 'scenario-create', {
			name: 'ok',
			job: 'job',
			filename: '../../evil',
		});

		expect(result.error?.code).toBe('INVALID_NAME');
	});

	it.each([
		['a parent directory', () => '../escaped'],
		['an absolute path', () => outside],
	])(
		'scenario-create rejects a directory outside the working directory (%s)',
		async (_label, dir) => {
			const result = await executeTool(registry(), 'scenario-create', {
				name: 'evil',
				job: 'job',
				directory: dir(),
			});

			expect(result.error?.code).toBe('PATH_OUTSIDE_WORKSPACE');
			expect(result.error?.suggestion).toBeDefined();
			expect(existsSync(join(outside, 'evil.scenario.yaml'))).toBe(false);
		}
	);

	it('scenario-create rejects a directory reached through a symlink that leaves the root', async () => {
		await symlink(outside, join(root, 'link'), 'dir');

		const result = await executeTool(registry(), 'scenario-create', {
			name: 'evil',
			job: 'job',
			directory: 'link/nested',
		});

		expect(result.error?.code).toBe('PATH_OUTSIDE_WORKSPACE');
		expect(existsSync(join(outside, 'nested'))).toBe(false);
	});

	it('scenario-create writes inside the working directory', async () => {
		const result = await executeTool(registry(), 'scenario-create', {
			name: 'inside',
			job: 'job',
			directory: 'scenarios',
		});

		expect(result.success).toBe(true);
		expect(existsSync(join(root, 'scenarios', 'inside.scenario.yaml'))).toBe(true);
	});

	it('scenario-evaluate refuses to write output outside the working directory', async () => {
		await writeFile(join(root, 'a.scenario.yaml'), SCENARIO('a-job'));
		const target = join(outside, 'overwritten.txt');
		await writeFile(target, 'original');

		for (const output of [target, `../${basename(outside)}/overwritten.txt`]) {
			const result = await executeTool(registry(), 'scenario-evaluate', { output });
			expect(result.error?.code).toBe('PATH_OUTSIDE_WORKSPACE');
		}
		expect(await readFile(target, 'utf-8')).toBe('original');
	});

	it('scenario-evaluate refuses scenario files and directories outside the working directory', async () => {
		await writeFile(join(outside, 'x.scenario.yaml'), SCENARIO('x-job'));
		const handler = vi.fn(async () => success({}));

		const byFile = await executeTool(registry(handler), 'scenario-evaluate', {
			scenarios: [join(outside, 'x.scenario.yaml')],
		});
		const byDirectory = await executeTool(registry(handler), 'scenario-evaluate', {
			directory: outside,
		});

		expect(byFile.error?.code).toBe('PATH_OUTSIDE_WORKSPACE');
		expect(byDirectory.error?.code).toBe('PATH_OUTSIDE_WORKSPACE');
		expect(handler).not.toHaveBeenCalled();
	});

	it('scenario-evaluate refuses fixtures outside the working directory without echoing them', async () => {
		await writeFile(join(outside, 'secret.json'), 'TOP-SECRET-TOKEN');
		await writeFile(
			join(root, 'a.scenario.yaml'),
			`${SCENARIO('a-job')}fixture:\n  file: ${join(outside, 'secret.json')}\n`
		);
		const handler = vi.fn(async () => success({}));

		const result = await executeTool<{
			report: { scenarios: Array<{ error?: { message: string } }> };
		}>(registry(handler), 'scenario-evaluate', {});

		const message = result.data?.report.scenarios[0]?.error?.message ?? '';
		expect(message).toContain('outside the allowed directory');
		expect(JSON.stringify(result)).not.toContain('TOP-SECRET-TOKEN');
		expect(handler).not.toHaveBeenCalled();
	});

	it('does not echo the contents of a file that fails to parse as YAML', async () => {
		await writeFile(
			join(root, 'leak.scenario.yaml'),
			'password: hunter2\napi_key: sk-live-123\n  bad: [indent'
		);

		const result = await executeTool(registry(), 'scenario-list', {});

		expect(result.success).toBe(true);
		const serialized = JSON.stringify(result);
		expect(serialized).toContain('YAML parse error at line');
		expect(serialized).not.toContain('hunter2');
		expect(serialized).not.toContain('sk-live-123');
	});

	it('scenario-list and scenario-suggest reject directories outside the working directory', async () => {
		const list = await executeTool(registry(), 'scenario-list', { directory: '..' });
		const suggest = await executeTool(registry(), 'scenario-suggest', {
			context: 'failed',
			directory: outside,
		});

		expect(list.error?.code).toBe('PATH_OUTSIDE_WORKSPACE');
		expect(suggest.error?.code).toBe('PATH_OUTSIDE_WORKSPACE');
	});

	it('scenario-coverage writes output only inside the working directory', async () => {
		await writeFile(join(root, 'a.scenario.yaml'), SCENARIO('a-job'));

		const inside = await executeTool(registry(), 'scenario-coverage', {
			knownCommands: ['item-create', 'item-delete'],
			format: 'markdown',
			output: 'coverage.md',
		});
		const escaped = await executeTool(registry(), 'scenario-coverage', {
			output: join(outside, 'coverage.md'),
		});

		expect(inside.success).toBe(true);
		expect(await readFile(join(root, 'coverage.md'), 'utf-8')).toContain('item-delete');
		expect(escaped.error?.code).toBe('PATH_OUTSIDE_WORKSPACE');
		expect(existsSync(join(outside, 'coverage.md'))).toBe(false);
	});

	it('keeps a newline in the job out of the YAML structure', async () => {
		const job = 'innocent\nsteps:\n  - command: evil-command\n    expect: { success: true }';

		const result = await executeTool<{ path: string }>(registry(), 'scenario-create', {
			name: 'injected',
			job,
		});
		const content = await readFile(join(root, 'injected.scenario.yaml'), 'utf-8');
		const parsed = parseScenarioString(content);

		expect(result.success).toBe(true);
		expect(content.split('\n')[0]).toBe(
			'# JTBD Scenario: innocent steps:   - command: evil-command     expect: { success: true }'
		);
		expect(parsed.success && parsed.scenario.steps.map((s) => s.command)).toEqual([
			'domain-action',
		]);
		expect(parsed.success && parsed.scenario.job).toBe(job);
	});
});

describe('schemas agree with the implementations', () => {
	it('lists exactly the implemented parameters for each tool', () => {
		const properties = Object.fromEntries(
			generateTools().map((tool) => [tool.name, Object.keys(tool.inputSchema.properties).sort()])
		);

		expect(properties).toEqual({
			'scenario-list': ['directory', 'job', 'recursive', 'search', 'sortBy', 'sortOrder', 'tags'],
			'scenario-evaluate': [
				'concurrency',
				'directory',
				'failFast',
				'format',
				'job',
				'output',
				'scenarios',
				'stopOnFailure',
				'tags',
				'timeout',
			],
			'scenario-coverage': [
				'directory',
				'format',
				'job',
				'knownCommands',
				'knownErrors',
				'output',
				'scenarios',
				'tags',
			],
			'scenario-create': [
				'commands',
				'description',
				'directory',
				'filename',
				'fixture',
				'job',
				'name',
				'overwrite',
				'tags',
				'template',
			],
			'scenario-suggest': [
				'command',
				'context',
				'directory',
				'files',
				'includeSkeleton',
				'knownCommands',
				'limit',
				'query',
			],
		});
		for (const tool of generateTools()) {
			expect(tool.inputSchema.additionalProperties).toBe(false);
		}
	});

	it.each(['failFast', 'stopOnFailure'])('scenario-evaluate honours %s', async (flag) => {
		await writeFile(join(root, 'a.scenario.yaml'), SCENARIO('a-job', 'broken'));
		await writeFile(join(root, 'b.scenario.yaml'), SCENARIO('b-job'));
		const handler = vi.fn(async (command: string) =>
			command === 'broken' ? failure({ code: 'BROKEN', message: 'broken' }) : success({})
		);

		const result = await executeTool<{ report: { scenarios: Array<{ outcome: string }> } }>(
			registry(handler),
			'scenario-evaluate',
			{ [flag]: true }
		);

		expect(result.data?.report.scenarios.map((s) => s.outcome)).toEqual(['fail', 'skip']);
	});

	it('scenario-evaluate defaults to json output, as documented', async () => {
		await writeFile(join(root, 'a.scenario.yaml'), SCENARIO('a-job'));

		const result = await executeTool<{ formattedOutput: string }>(
			registry(),
			'scenario-evaluate',
			{}
		);

		expect(JSON.parse(result.data?.formattedOutput ?? '')).toMatchObject({
			summary: { passedScenarios: 1 },
		});
	});

	it('scenario-evaluate passes timeout and concurrency through', async () => {
		await writeFile(join(root, 'a.scenario.yaml'), SCENARIO('a-job', 'slow'));
		const handler = vi.fn(async () => {
			await new Promise((resolve) => setTimeout(resolve, 100));
			return success({});
		});

		const result = await executeTool<{
			report: { scenarios: Array<{ error?: { type: string } }> };
		}>(registry(handler), 'scenario-evaluate', { timeout: 10, concurrency: 2 });

		expect(result.data?.report.scenarios[0]?.error?.type).toBe('timeout');
	});

	it('scenario-create uses the implemented template names and defaults to blank', async () => {
		const bad = await executeTool(registry(), 'scenario-create', {
			name: 'a',
			job: 'job',
			template: 'basic',
		});
		const errorTemplate = await executeTool<{ scenario: { steps: unknown[] } }>(
			registry(),
			'scenario-create',
			{ name: 'b', job: 'job', template: 'error-handling', commands: undefined }
		);
		const blank = await executeTool<{ scenario: { steps: Array<{ command: string }> } }>(
			registry(),
			'scenario-create',
			{ name: 'c', job: 'job' }
		);
		const fromCommands = await executeTool<{ scenario: { steps: Array<{ command: string }> } }>(
			registry(),
			'scenario-create',
			{ name: 'd', job: 'job', commands: ['todo-create', 'todo-list'] }
		);

		expect(bad.error?.code).toBe('VALIDATION_ERROR');
		expect(bad.error?.message).toContain('"blank", "crud", "error-handling", "workflow"');
		expect(errorTemplate.data?.scenario.steps).toHaveLength(3);
		expect(blank.data?.scenario.steps.map((s) => s.command)).toEqual(['domain-action']);
		expect(fromCommands.data?.scenario.steps.map((s) => s.command)).toEqual([
			'todo-create',
			'todo-list',
		]);
	});

	it('scenario-list honours recursive', async () => {
		await writeFile(join(root, 'top.scenario.yaml'), SCENARIO('top-job'));
		await mkdir(join(root, 'nested'));
		await writeFile(join(root, 'nested', 'deep.scenario.yaml'), SCENARIO('deep-job'));

		const all = await executeTool<{ scenarios: Array<{ job: string }> }>(
			registry(),
			'scenario-list',
			{}
		);
		const topOnly = await executeTool<{ scenarios: Array<{ job: string }> }>(
			registry(),
			'scenario-list',
			{ recursive: false, sortBy: 'job', sortOrder: 'desc', search: 'job' }
		);

		expect(all.data?.scenarios.map((s) => s.job).sort()).toEqual(['deep-job', 'top-job']);
		expect(topOnly.data?.scenarios.map((s) => s.job)).toEqual(['top-job']);
	});

	it('scenario-suggest is described as heuristic, not AI-powered', () => {
		const suggest = generateTools().find((tool) => tool.name === 'scenario-suggest');

		expect(suggest?.description).toContain('heuristic');
		expect(suggest?.description).not.toMatch(/AI-powered/i);
	});
});

describe('input validation', () => {
	it.each([
		['scenario-evaluate', { concurrency: '2' }, "'concurrency' must be an integer"],
		['scenario-evaluate', { concurrency: 0 }, "'concurrency' must be at least 1"],
		['scenario-evaluate', { verbose: true }, "Unknown field 'verbose'"],
		['scenario-evaluate', { format: 'xml' }, "'format' must be one of"],
		['scenario-list', { tags: 'smoke' }, "'tags' must be an array"],
		['scenario-list', { tags: ['ok', 1] }, "'tags[1]' must be a string"],
		['scenario-list', { recursive: 'yes' }, "'recursive' must be true or false"],
		['scenario-suggest', { context: 'uncovered', limit: 2.5 }, "'limit' must be an integer"],
		['scenario-create', { name: 5, job: 'job' }, "'name' must be a string"],
		['scenario-list', [], 'Input must be an object'],
	])('%s rejects %j', async (tool, input, message) => {
		const handler = vi.fn(async () => success({}));

		const result = await executeTool(registry(handler), tool, input);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toContain(message);
		expect(handler).not.toHaveBeenCalled();
	});

	it('treats missing arguments as an empty object', async () => {
		const result = await executeTool(registry(), 'scenario-list', undefined);

		expect(result.success).toBe(true);
	});
});
