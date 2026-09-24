/**
 * Tests for YAML scenario parser
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioFile, parseScenarioString } from '../parsers/yaml.js';

const HEADER = `
name: Strict
description: Strict parsing
job: strict
`;

function withStep(expect: string, extra = ''): string {
	return `${HEADER}${extra}steps:
  - command: thing-get
    expect:
${expect}
`;
}

function parseError(yaml: string): string {
	const result = parseScenarioString(yaml);
	if (result.success) throw new Error('Expected a parse error');
	return result.error;
}

describe('YAML Parser', () => {
	describe('parseScenarioString', () => {
		it('should parse a valid minimal scenario', () => {
			const yaml = `
name: Test Scenario
description: A test scenario
job: test-job
tags: [smoke]
steps:
  - command: test-command
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
				const step = result.scenario.steps.at(0);
				if (!step) throw new Error('Expected step');
				expect(step.command).toBe('test-command');
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
  - command: todo-create
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
				const step = result.scenario.steps.at(0);
				if (!step) throw new Error('Expected step');
				expect(step.command).toBe('todo-create');
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
  - command: todo-get
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
				const step = result.scenario.steps.at(0);
				if (!step) throw new Error('Expected step');
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
  - command: test-command
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

		it('should handle optional fields gracefully', () => {
			const yaml = `
name: Minimal
description: Minimal scenario
job: minimal
tags: []
steps:
  - command: test-cmd
    expect:
      success: true
`;
			const result = parseScenarioString(yaml);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.scenario.version).toBeUndefined();
				expect(result.scenario.fixture).toBeUndefined();
				expect(result.scenario.timeout).toBeUndefined();
				expect(result.scenario.sourcePath).toBeUndefined();
			}
		});
	});

	describe('unimplemented fields', () => {
		it.each([
			['verify', 'verify:\n  assertions: [All todos completed]\n', "'verify' is not supported"],
			['isolation', 'isolation: chained\n', "'isolation' is not supported"],
			['dependsOn', 'dependsOn: [other-job]\n', "'dependsOn' is not supported"],
		])('rejects %s instead of silently ignoring it', (_field, extra, message) => {
			expect(parseError(withStep('      success: true', extra))).toContain(message);
		});

		it('parses a scenario-level timeout', () => {
			const result = parseScenarioString(withStep('      success: true', 'timeout: 250\n'));

			expect(result.success && result.scenario.timeout).toBe(250);
		});

		it.each(['0', '-5', 'soon'])('rejects timeout %s', (value) => {
			expect(parseError(withStep('      success: true', `timeout: ${value}\n`))).toContain(
				"'timeout' must be a positive number"
			);
		});
	});

	describe('strict fields', () => {
		it('rejects unknown top-level, step, expect and fixture fields', () => {
			expect(parseError(withStep('      success: true', 'fixtures: { file: x.json }\n'))).toContain(
				"Unknown field 'fixtures' in scenario"
			);
			expect(
				parseError(
					`${HEADER}steps:\n  - command: a-b\n    inputs: {}\n    expect: { success: true }\n`
				)
			).toContain("Unknown field 'inputs' in step 1");
			expect(parseError(withStep('      success: true\n      date: { id: 1 }'))).toContain(
				"Unknown field 'date' in step 1 'expect'"
			);
			expect(
				parseError(withStep('      success: false\n      error: { cod: NOT_FOUND }'))
			).toContain("Unknown field 'cod'");
			expect(
				parseError(withStep('      success: true', 'fixture: { file: a.json, bse: b.json }\n'))
			).toContain("Unknown field 'bse' in fixture");
		});

		it('rejects wrongly typed optional fields instead of dropping them', () => {
			expect(parseError(withStep('      success: true', 'tags: smoke\n'))).toContain(
				"'tags' must be a list of strings"
			);
			expect(
				parseError(
					`${HEADER}steps:\n  - command: a-b\n    input: abc\n    expect: { success: true }\n`
				)
			).toContain("'input' must be an object");
			expect(
				parseError(
					`${HEADER}steps:\n  - command: a-b\n    continueOnFailure: yes please\n    expect: { success: true }\n`
				)
			).toContain("'continueOnFailure' must be true or false");
			expect(parseError(withStep('      success: true\n      confidence: 2'))).toContain(
				'between 0 and 1'
			);
		});

		it('rejects data assertions on an expected failure and error assertions on a success', () => {
			expect(parseError(withStep('      success: false\n      data: { id: 1 }'))).toContain(
				"'data' assertions are only checked when 'success' is true"
			);
			expect(parseError(withStep('      success: true\n      error: { code: X }'))).toContain(
				"'error' assertions are only checked when 'success' is false"
			);
		});

		it('rejects matcher objects that mix in other keys', () => {
			const error = parseError(
				withStep('      success: true\n      data:\n        user: { exists: true, name: Bob }')
			);

			expect(error).toContain('Invalid assertion at data.user');
			expect(error).toContain("'name'");
		});

		it('rejects a typo next to a real matcher', () => {
			expect(
				parseError(
					withStep(
						"      success: true\n      data:\n        name: { matches: '^A', matchs: '^B' }"
					)
				)
			).toContain("'matchs'");
		});

		it('rejects matcher values of the wrong type', () => {
			expect(
				parseError(
					withStep('      success: true\n      data:\n        items: { length: { gte: 1 } }')
				)
			).toContain("'length' expects a non-negative integer");
			expect(
				parseError(withStep("      success: true\n      data:\n        name: { matches: '(' }"))
			).toContain('not a valid regular expression');
		});
	});

	describe('YAML syntax errors', () => {
		it('reports the line without echoing the source', () => {
			const result = parseScenarioString(
				'name: secret-value-123\nsteps:\n  - command: x\n  bad: [unclosed\npassword: hunter2 : x'
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toMatch(/^YAML parse error at line \d+:/);
				expect(result.line).toBeGreaterThan(0);
				expect(result.error).not.toContain('secret-value-123');
				expect(result.error).not.toContain('hunter2');
				expect(result.error).not.toContain('\n');
			}
		});
	});

	describe('parseScenarioFile', () => {
		it('records the absolute source path of the scenario', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'afd-yaml-'));
			try {
				const file = join(dir, 'a.scenario.yaml');
				await writeFile(file, withStep('      success: true'));

				const result = await parseScenarioFile(file);

				expect(result.success && result.scenario.sourcePath).toBe(file);
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		});

		it('reports unreadable files', async () => {
			const result = await parseScenarioFile(join(tmpdir(), 'afd-missing', 'none.scenario.yaml'));

			expect(result.success).toBe(false);
			if (!result.success) expect(result.error).toContain('Failed to read file');
		});
	});
});
