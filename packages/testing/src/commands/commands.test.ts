/**
 * Tests for Phase 2 scenario commands
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { failure, success } from '@lushly-dev/afd-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scenarioCoverage } from '../commands/coverage.js';
import { listTemplates, scenarioCreate } from '../commands/create.js';
import {
	formatJunit,
	formatMarkdown,
	formatTerminal,
	scenarioEvaluate,
} from '../commands/evaluate.js';
import { scenarioList } from '../commands/list.js';
import type { CommandHandler } from '../runner/executor.js';

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_DIR = path.join(__dirname, '__test_scenarios__');

const SAMPLE_SCENARIOS = {
	'create-todo.scenario.yaml': `
name: Create Todo
description: Test creating a new todo item
job: todo-management
tags: [smoke, crud]
steps:
  - command: todo.create
    input: { title: "Buy groceries" }
    expect:
      success: true
      data: { title: "Buy groceries" }
`,
	'list-todos.scenario.yaml': `
name: List Todos
description: Test listing todo items
job: todo-management
tags: [smoke]
steps:
  - command: todo.list
    expect:
      success: true
`,
	'error-handling.scenario.yaml': `
name: Error Handling
description: Test error cases
job: error-tests
tags: [error, negative]
steps:
  - command: todo.get
    input: { id: "non-existent" }
    expect:
      success: false
      error: { code: "NOT_FOUND" }
`,
};

// Mock command handler
const mockHandler: CommandHandler = async (command, input) => {
	switch (command) {
		case 'todo.create':
			return success({ id: '1', title: (input as Record<string, unknown>).title });
		case 'todo.list':
			return success({ items: [] });
		case 'todo.get':
			if ((input as Record<string, unknown>).id === 'non-existent') {
				return failure({ code: 'NOT_FOUND', message: 'Todo not found' });
			}
			return success({ id: (input as Record<string, unknown>).id, title: 'Test' });
		default:
			return failure({ code: 'UNKNOWN_COMMAND', message: `Unknown: ${command}` });
	}
};

// ============================================================================
// Setup/Teardown
// ============================================================================

function setupTestScenarios() {
	if (!fs.existsSync(TEST_DIR)) {
		fs.mkdirSync(TEST_DIR, { recursive: true });
	}

	for (const [filename, content] of Object.entries(SAMPLE_SCENARIOS)) {
		fs.writeFileSync(path.join(TEST_DIR, filename), content.trim());
	}
}

function cleanupTestScenarios() {
	if (fs.existsSync(TEST_DIR)) {
		fs.rmSync(TEST_DIR, { recursive: true, force: true });
	}
}

// ============================================================================
// scenario.list tests
// ============================================================================

describe('scenario.list', () => {
	beforeEach(() => {
		setupTestScenarios();
	});

	afterEach(() => {
		cleanupTestScenarios();
	});

	it('lists all scenarios in directory', async () => {
		const result = await scenarioList({ directory: TEST_DIR });

		expect(result.success).toBe(true);
		expect(result.data?.total).toBe(3);
		expect(result.data?.scenarios).toHaveLength(3);
	});

	it('filters by job', async () => {
		const result = await scenarioList({
			directory: TEST_DIR,
			job: 'todo-management',
		});

		expect(result.success).toBe(true);
		expect(result.data?.filtered).toBe(2);
		expect(result.data?.scenarios.every((s) => s.job === 'todo-management')).toBe(true);
	});

	it('filters by tags', async () => {
		const result = await scenarioList({
			directory: TEST_DIR,
			tags: ['error'],
		});

		expect(result.success).toBe(true);
		expect(result.data?.filtered).toBe(1);
		expect(result.data?.scenarios[0]?.tags).toContain('error');
	});

	it('returns empty when no scenarios match', async () => {
		const result = await scenarioList({
			directory: TEST_DIR,
			job: 'non-existent',
		});

		expect(result.success).toBe(true);
		expect(result.data?.filtered).toBe(0);
		expect(result.data?.scenarios).toHaveLength(0);
	});
});

// ============================================================================
// scenario.evaluate tests
// ============================================================================

describe('scenario.evaluate', () => {
	beforeEach(() => {
		setupTestScenarios();
	});

	afterEach(() => {
		cleanupTestScenarios();
	});

	it('evaluates all scenarios', async () => {
		const result = await scenarioEvaluate({
			handler: mockHandler,
			directory: TEST_DIR,
		});

		expect(result.success).toBe(true);
		expect(result.data?.report.summary.totalScenarios).toBe(3);
		expect(result.data?.exitCode).toBe(0);
	});

	it('evaluates specific scenarios', async () => {
		const result = await scenarioEvaluate({
			handler: mockHandler,
			scenarios: [path.join(TEST_DIR, 'create-todo.scenario.yaml')],
		});

		expect(result.success).toBe(true);
		expect(result.data?.report.summary.totalScenarios).toBe(1);
	});

	it('returns exit code 1 on failures', async () => {
		const failingHandler: CommandHandler = async () =>
			failure({ code: 'ERROR', message: 'Always fails' });

		const result = await scenarioEvaluate({
			handler: failingHandler,
			scenarios: [path.join(TEST_DIR, 'create-todo.scenario.yaml')],
		});

		expect(result.success).toBe(true);
		expect(result.data?.exitCode).toBe(1);
	});

	it('formats output as JSON', async () => {
		const result = await scenarioEvaluate({
			handler: mockHandler,
			scenarios: [path.join(TEST_DIR, 'create-todo.scenario.yaml')],
			format: 'json',
		});

		expect(result.success).toBe(true);
		expect(result.data?.formattedOutput).toBeDefined();
		const parsed = JSON.parse(result.data?.formattedOutput!);
		expect(parsed.summary).toBeDefined();
	});
});

// ============================================================================
// Output formatters tests
// ============================================================================

describe('formatters', () => {
	const mockReport = {
		title: 'Test Report',
		durationMs: 100,
		generatedAt: new Date('2025-01-01'),
		scenarios: [
			{
				scenarioPath: '/test/create.scenario.yaml',
				jobName: 'test-job',
				outcome: 'pass' as const,
				durationMs: 50,
				stepResults: [],
				passedSteps: 1,
				failedSteps: 0,
				skippedSteps: 0,
				startedAt: new Date(),
				completedAt: new Date(),
			},
		],
		summary: {
			totalScenarios: 1,
			passedScenarios: 1,
			failedScenarios: 0,
			errorScenarios: 0,
			totalSteps: 1,
			passedSteps: 1,
			failedSteps: 0,
			skippedSteps: 0,
			passRate: 1,
		},
	};

	it('formats terminal output', () => {
		const output = formatTerminal(mockReport);

		expect(output).toContain('JTBD Scenario Results');
		expect(output).toContain('test-job');
		expect(output).toContain('1 passed');
	});

	it('formats JUnit XML output', () => {
		const output = formatJunit(mockReport);

		expect(output).toContain('<?xml version="1.0"');
		expect(output).toContain('<testsuites');
		expect(output).toContain('tests="1"');
	});

	it('formats Markdown output', () => {
		const output = formatMarkdown(mockReport);

		expect(output).toContain('# JTBD Scenario Results');
		expect(output).toContain('| ✅ Passed | 1 |');
	});
});

// ============================================================================
// scenario.coverage tests
// ============================================================================

describe('scenario.coverage', () => {
	beforeEach(() => {
		setupTestScenarios();
	});

	afterEach(() => {
		cleanupTestScenarios();
	});

	it('calculates command coverage', async () => {
		const result = await scenarioCoverage({ directory: TEST_DIR });

		expect(result.success).toBe(true);
		expect(result.data?.summary.commands.tested).toBeGreaterThan(0);
		expect(result.data?.commandCoverage.length).toBeGreaterThan(0);
	});

	it('tracks job coverage', async () => {
		const result = await scenarioCoverage({ directory: TEST_DIR });

		expect(result.success).toBe(true);
		expect(result.data?.summary.jobs.count).toBe(2); // todo-management and error-tests
		expect(result.data?.jobCoverage.length).toBe(2);
	});

	it('identifies untested commands', async () => {
		const result = await scenarioCoverage({
			directory: TEST_DIR,
			knownCommands: ['todo.create', 'todo.list', 'todo.delete', 'todo.update'],
		});

		expect(result.success).toBe(true);
		expect(result.data?.summary.commands.untested).toContain('todo.delete');
		expect(result.data?.summary.commands.untested).toContain('todo.update');
	});

	it('reports error code coverage', async () => {
		const result = await scenarioCoverage({ directory: TEST_DIR });

		expect(result.success).toBe(true);
		expect(result.data?.errorCoverage.length).toBeGreaterThan(0);
		expect(result.data?.errorCoverage.some((e) => e.errorCode === 'NOT_FOUND')).toBe(true);
	});
});

// ============================================================================
// scenario.create tests
// ============================================================================

describe('scenario.create', () => {
	const OUTPUT_DIR = path.join(__dirname, '__test_output__');

	beforeEach(() => {
		if (!fs.existsSync(OUTPUT_DIR)) {
			fs.mkdirSync(OUTPUT_DIR, { recursive: true });
		}
	});

	afterEach(() => {
		if (fs.existsSync(OUTPUT_DIR)) {
			fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
		}
	});

	it('creates blank scenario', async () => {
		const result = await scenarioCreate({
			name: 'test-scenario',
			job: 'test-job',
			description: 'Test description',
			directory: OUTPUT_DIR,
		});

		expect(result.success).toBe(true);
		expect(result.data?.path).toContain('test-scenario.scenario.yaml');
		expect(fs.existsSync(result.data?.path)).toBe(true);
	});

	it('creates CRUD template', async () => {
		const result = await scenarioCreate({
			name: 'todo-crud',
			job: 'Manage todo items',
			directory: OUTPUT_DIR,
			template: 'crud',
		});

		expect(result.success).toBe(true);
		expect(result.data?.scenario.steps.length).toBe(5);

		const content = fs.readFileSync(result.data?.path, 'utf-8');
		expect(content).toContain('todo.create');
		expect(content).toContain('todo.update');
		expect(content).toContain('todo.delete');
	});

	it('creates error-handling template', async () => {
		const result = await scenarioCreate({
			name: 'todo-errors',
			job: 'Test error handling',
			directory: OUTPUT_DIR,
			template: 'error-handling',
		});

		expect(result.success).toBe(true);
		expect(result.data?.scenario.steps.every((s) => s.expect.success === false)).toBe(true);
	});

	it('prevents overwrite without flag', async () => {
		await scenarioCreate({
			name: 'existing',
			job: 'test',
			directory: OUTPUT_DIR,
		});

		const result = await scenarioCreate({
			name: 'existing',
			job: 'test',
			directory: OUTPUT_DIR,
			overwrite: false,
		});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('FILE_EXISTS');
	});

	it('allows overwrite with flag', async () => {
		await scenarioCreate({
			name: 'existing',
			job: 'test',
			directory: OUTPUT_DIR,
		});

		const result = await scenarioCreate({
			name: 'existing',
			job: 'updated-job',
			directory: OUTPUT_DIR,
			overwrite: true,
		});

		expect(result.success).toBe(true);
		expect(result.data?.overwritten).toBe(true);
		expect(result.data?.scenario.job).toBe('updated-job');
	});
});

// ============================================================================
// listTemplates tests
// ============================================================================

describe('listTemplates', () => {
	it('returns available templates', () => {
		const templates = listTemplates();

		expect(templates).toHaveLength(4);
		expect(templates.map((t) => t.name)).toContain('blank');
		expect(templates.map((t) => t.name)).toContain('crud');
		expect(templates.map((t) => t.name)).toContain('error-handling');
		expect(templates.map((t) => t.name)).toContain('workflow');
	});
});
