/**
 * Tests for YAML scenario parser
 */

import { describe, it, expect } from 'vitest';
import { parseScenarioString } from '../parsers/yaml.js';

describe('YAML Parser', () => {
	describe('parseScenarioString', () => {
		it('should parse a valid minimal scenario', () => {
			const yaml = `
name: Test Scenario
description: A test scenario
job: test-job
tags: [smoke]
steps:
  - command: test.command
    expect:
      success: true
`;
			const result = parseScenarioString(yaml);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.scenario.name).toBe('Test Scenario');
				expect(result.scenario.description).toBe('A test scenario');
				expect(result.scenario.job).toBe('test-job');
				expect(result.scenario.tags).toEqual(['smoke']);
				expect(result.scenario.steps).toHaveLength(1);
				const step = result.scenario.steps.at(0)!;
				expect(step.command).toBe('test.command');
				expect(step.expect.success).toBe(true);
			}
		});

		it('should parse a scenario with full step details', () => {
			const yaml = `
name: Full Step Test
description: Testing full step configuration
job: full-step
tags: []
steps:
  - command: todo.create
    description: Create a todo
    input:
      title: Buy groceries
      priority: high
    expect:
      success: true
      data:
        title: Buy groceries
        completed: false
    continueOnFailure: true
`;
			const result = parseScenarioString(yaml);

			expect(result.success).toBe(true);
			if (result.success) {
				const step = result.scenario.steps.at(0)!;
				expect(step.command).toBe('todo.create');
				expect(step.description).toBe('Create a todo');
				expect(step.input).toEqual({ title: 'Buy groceries', priority: 'high' });
				expect(step.expect.success).toBe(true);
				expect(step.expect.data).toEqual({
					title: 'Buy groceries',
					completed: false,
				});
				expect(step.continueOnFailure).toBe(true);
			}
		});

		it('should parse expectation with error details', () => {
			const yaml = `
name: Error Test
description: Test error expectations
job: error-test
tags: []
steps:
  - command: todo.get
    input:
      id: nonexistent
    expect:
      success: false
      error:
        code: NOT_FOUND
        message: Todo not found
`;
			const result = parseScenarioString(yaml);

			expect(result.success).toBe(true);
			if (result.success) {
				const step = result.scenario.steps.at(0)!;
				expect(step.expect.success).toBe(false);
				expect(step.expect.error).toEqual({
					code: 'NOT_FOUND',
					message: 'Todo not found',
				});
			}
		});

		it('should fail on missing name', () => {
			const yaml = `
description: No name
job: test
tags: []
steps:
  - command: test
    expect:
      success: true
`;
			const result = parseScenarioString(yaml);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('name');
			}
		});

		it('should fail on missing description', () => {
			const yaml = `
name: Test
job: test
tags: []
steps:
  - command: test
    expect:
      success: true
`;
			const result = parseScenarioString(yaml);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('description');
			}
		});

		it('should fail on missing job', () => {
			const yaml = `
name: Test
description: Test desc
tags: []
steps:
  - command: test
    expect:
      success: true
`;
			const result = parseScenarioString(yaml);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('job');
			}
		});

		it('should fail on empty steps', () => {
			const yaml = `
name: Test
description: Test desc
job: test
tags: []
steps: []
`;
			const result = parseScenarioString(yaml);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('step');
			}
		});

		it('should fail on step missing expect', () => {
			const yaml = `
name: Test
description: Test desc
job: test
tags: []
steps:
  - command: test.command
`;
			const result = parseScenarioString(yaml);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('expect');
			}
		});

		it('should fail on invalid YAML', () => {
			const yaml = `
name: Test
  description: Bad indent
`;
			const result = parseScenarioString(yaml);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('YAML');
			}
		});

		it('should parse fixture configuration', () => {
			const yaml = `
name: Fixture Test
description: Test fixture parsing
job: fixture
tags: []
fixture:
  file: ./fixtures/initial.json
  base: empty
  overrides:
    count: 5
steps:
  - command: test
    expect:
      success: true
`;
			const result = parseScenarioString(yaml);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.scenario.fixture).toBeDefined();
				expect(result.scenario.fixture?.file).toBe('./fixtures/initial.json');
				expect(result.scenario.fixture?.base).toBe('empty');
				expect(result.scenario.fixture?.overrides).toEqual({ count: 5 });
			}
		});

		it('should parse verification configuration', () => {
			const yaml = `
name: Verify Test
description: Test verification parsing
job: verify
tags: []
steps:
  - command: test
    expect:
      success: true
verify:
  snapshot: ./snapshots/expected.json
  assertions:
    - All todos completed
    - No errors in log
  custom: ./verify.js
`;
			const result = parseScenarioString(yaml);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.scenario.verify).toBeDefined();
				expect(result.scenario.verify?.snapshot).toBe('./snapshots/expected.json');
				expect(result.scenario.verify?.assertions).toEqual([
					'All todos completed',
					'No errors in log',
				]);
				expect(result.scenario.verify?.custom).toBe('./verify.js');
			}
		});

		it('should handle optional fields gracefully', () => {
			const yaml = `
name: Minimal
description: Minimal scenario
job: minimal
tags: []
steps:
  - command: test.cmd
    expect:
      success: true
`;
			const result = parseScenarioString(yaml);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.scenario.version).toBeUndefined();
				expect(result.scenario.fixture).toBeUndefined();
				expect(result.scenario.verify).toBeUndefined();
				expect(result.scenario.isolation).toBeUndefined();
				expect(result.scenario.dependsOn).toBeUndefined();
				expect(result.scenario.timeout).toBeUndefined();
			}
		});
	});
});
