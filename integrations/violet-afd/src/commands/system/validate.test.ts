/**
 * @fileoverview Tests for validate command
 *
 * Tests the system validation command definition and parsing functions.
 * The actual exec calls are tested via integration tests since mocking
 * promisified child_process is complex.
 */

import { describe, expect, it } from 'vitest';
import { systemValidateCommand } from './validate.js';

describe('validate command', () => {
	describe('command definition', () => {
		it('has correct name and category', () => {
			expect(systemValidateCommand.name).toBe('validate');
			expect(systemValidateCommand.category).toBe('system');
		});

		it('has description', () => {
			expect(systemValidateCommand.description).toBe(
				'Run test suite and optionally collect coverage',
			);
		});

		it('has examples', () => {
			expect(systemValidateCommand.examples).toBeDefined();
			expect(systemValidateCommand.examples?.length).toBeGreaterThan(0);
		});

		it('has input schema with coverage option', () => {
			const schema = systemValidateCommand.inputSchema;
			expect(schema).toBeDefined();

			// Verify the schema can parse input with coverage
			const result = schema.safeParse({ coverage: true });
			expect(result.success).toBe(true);
		});

		it('has input schema with filter option', () => {
			const schema = systemValidateCommand.inputSchema;

			const result = schema.safeParse({ filter: 'node.*' });
			expect(result.success).toBe(true);
		});

		it('has input schema with bail option', () => {
			const schema = systemValidateCommand.inputSchema;

			const result = schema.safeParse({ bail: true });
			expect(result.success).toBe(true);
		});

		it('has input schema with defaults', () => {
			const schema = systemValidateCommand.inputSchema;

			// Empty input should work with defaults
			const result = schema.safeParse({});
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.coverage).toBe(false);
				expect(result.data.bail).toBe(false);
			}
		});

		it('has output schema with required fields', () => {
			const schema = systemValidateCommand.outputSchema;
			expect(schema).toBeDefined();

			// Verify the schema can parse valid output
			const result = schema.safeParse({
				passed: true,
				testResults: {
					total: 100,
					passed: 100,
					failed: 0,
					skipped: 0,
					duration: 1000,
				},
			});
			expect(result.success).toBe(true);
		});

		it('has output schema with optional coverage', () => {
			const schema = systemValidateCommand.outputSchema;

			const result = schema.safeParse({
				passed: true,
				testResults: {
					total: 100,
					passed: 100,
					failed: 0,
					skipped: 0,
					duration: 1000,
				},
				coverage: {
					statements: 85.5,
					branches: 80.2,
					functions: 90.1,
					lines: 84.3,
				},
			});
			expect(result.success).toBe(true);
		});

		it('has output schema with optional failures', () => {
			const schema = systemValidateCommand.outputSchema;

			const result = schema.safeParse({
				passed: false,
				testResults: {
					total: 100,
					passed: 99,
					failed: 1,
					skipped: 0,
					duration: 1000,
				},
				failures: [
					{
						file: 'test.ts',
						test: 'should work',
						error: 'Expected true but got false',
					},
				],
			});
			expect(result.success).toBe(true);
		});
	});

	describe('example inputs', () => {
		it('all examples have valid input', () => {
			const examples = systemValidateCommand.examples || [];

			for (const example of examples) {
				const result = systemValidateCommand.inputSchema.safeParse(example.input);
				expect(result.success).toBe(true);
			}
		});

		it('has example for running all tests', () => {
			const examples = systemValidateCommand.examples || [];
			const runAll = examples.find((e) => e.description?.includes('all tests'));
			expect(runAll).toBeDefined();
		});

		it('has example for coverage', () => {
			const examples = systemValidateCommand.examples || [];
			const coverage = examples.find((e) => e.description?.includes('coverage'));
			expect(coverage).toBeDefined();
			expect(coverage?.input.coverage).toBe(true);
		});
	});
});
