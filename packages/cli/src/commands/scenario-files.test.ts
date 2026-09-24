import { parseScenarioString } from '@lushly-dev/afd-testing';
import { describe, expect, it } from 'vitest';
import { SAMPLE_SCENARIO } from './scenario-files.js';

describe('scenario init sample', () => {
	it('parses with the scenario parser that `afd scenario run` uses', () => {
		const result = parseScenarioString(SAMPLE_SCENARIO);
		expect(result.success ? result.scenario.steps.map((step) => step.command) : result).toEqual([
			'todo-create',
			'todo-toggle',
			'todo-list',
		]);
	});
});
