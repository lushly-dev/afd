import { describe, expect, it } from 'vitest';
import {
	calculateSummary,
	createEmptySummary,
	createStepError,
	isScenarioResult,
	isStepResult,
	type ScenarioResult,
} from './report.js';
import { isScenario } from './scenario.js';

function scenario(outcome: ScenarioResult['outcome']): ScenarioResult {
	return {
		scenarioPath: 'scenario.yaml',
		jobName: 'sample-job',
		outcome,
		durationMs: 5,
		stepResults: [
			{
				stepId: 'step-1',
				command: 'sample-run',
				outcome: outcome === 'pass' ? 'pass' : 'fail',
				durationMs: 5,
				assertions: [],
			},
		],
		passedSteps: outcome === 'pass' ? 1 : 0,
		failedSteps: outcome === 'pass' ? 0 : 1,
		skippedSteps: 0,
		startedAt: new Date(0),
		completedAt: new Date(5),
	};
}

describe('report helpers', () => {
	it('creates a zeroed summary and aggregates every scenario outcome', () => {
		expect(createEmptySummary()).toEqual({
			totalScenarios: 0,
			passedScenarios: 0,
			failedScenarios: 0,
			errorScenarios: 0,
			skippedScenarios: 0,
			totalSteps: 0,
			passedSteps: 0,
			failedSteps: 0,
			skippedSteps: 0,
			passRate: 0,
		});

		const summary = calculateSummary([
			scenario('pass'),
			scenario('fail'),
			scenario('partial'),
			scenario('error'),
			scenario('skip'),
		]);

		expect(summary).toMatchObject({
			totalScenarios: 5,
			passedScenarios: 1,
			failedScenarios: 2,
			errorScenarios: 1,
			skippedScenarios: 1,
			totalSteps: 5,
			passRate: 0.2,
		});
	});

	it('creates step errors with diagnostic details', () => {
		const cause = new Error('socket closed');

		expect(createStepError('command_failed', 'Call failed', { cause, path: 'data.id' })).toEqual({
			type: 'command_failed',
			message: 'Call failed',
			cause,
			path: 'data.id',
		});
	});

	it('recognizes valid step and scenario results', () => {
		const result = scenario('pass');

		expect(isStepResult(result.stepResults[0])).toBe(true);
		expect(isScenarioResult(result)).toBe(true);
		expect(isScenarioResult(scenario('skip'))).toBe(true);
	});

	it.each([
		null,
		'step',
		{},
		{ stepId: 1, command: 'run', outcome: 'pass', durationMs: 1, assertions: [] },
		{ stepId: '1', command: 2, outcome: 'pass', durationMs: 1, assertions: [] },
		{ stepId: '1', command: 'run', outcome: 'unknown', durationMs: 1, assertions: [] },
		{ stepId: '1', command: 'run', outcome: 'pass', durationMs: 'fast', assertions: [] },
		{ stepId: '1', command: 'run', outcome: 'pass', durationMs: 1, assertions: {} },
	])('rejects malformed step results', (value) => {
		expect(isStepResult(value)).toBe(false);
	});

	it.each([
		undefined,
		'scenario',
		{},
		{ scenarioPath: 1, jobName: 'job', outcome: 'pass', durationMs: 1, stepResults: [] },
		{ scenarioPath: 'a', jobName: 1, outcome: 'pass', durationMs: 1, stepResults: [] },
		{ scenarioPath: 'a', jobName: 'job', outcome: 'unknown', durationMs: 1, stepResults: [] },
		{ scenarioPath: 'a', jobName: 'job', outcome: 'pass', durationMs: 'fast', stepResults: [] },
		{ scenarioPath: 'a', jobName: 'job', outcome: 'pass', durationMs: 1, stepResults: {} },
	])('rejects malformed scenario results', (value) => {
		expect(isScenarioResult(value)).toBe(false);
	});

	it('recognizes scenario objects', () => {
		expect(isScenario({ name: 'n', description: 'd', job: 'j', tags: [], steps: [] })).toBe(true);
		expect(isScenario({ name: 'n', description: 'd', job: 'j', tags: 'x', steps: [] })).toBe(false);
		expect(isScenario(null)).toBe(false);
	});
});
