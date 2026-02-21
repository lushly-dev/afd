import { describe, expect, it } from 'vitest';
import { StatusType } from '../src/css-variables.js';
import { escapeHtml, styledSpan } from '../src/utils.js';
import { WebAdapter } from '../src/web-adapter.js';

describe('escapeHtml', () => {
	it('escapes HTML special characters', () => {
		expect(escapeHtml('<script>alert("xss")</script>')).toBe(
			'&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
		);
	});

	it('escapes ampersands', () => {
		expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
	});

	it('handles non-string input', () => {
		expect(escapeHtml(123)).toBe('123');
		expect(escapeHtml(null)).toBe('null');
	});
});

describe('styledSpan', () => {
	it('creates span with color from CSS variable', () => {
		const result = styledSpan('hello', StatusType.SUCCESS);
		expect(result).toContain('var(--afd-success');
		expect(result).toContain('hello');
	});

	it('adds bold style when requested', () => {
		const result = styledSpan('bold text', StatusType.NEUTRAL, true);
		expect(result).toContain('font-weight: bold');
	});
});

describe('WebAdapter', () => {
	describe('renderPackageResults', () => {
		it('renders package results with colors', () => {
			const data = {
				packages: [
					{ name: 'core', passed: true },
					{ name: 'cli', passed: false, stderr: 'error message' },
				],
				total: 2,
				passed: 1,
				failed: 1,
				success: false,
			};

			const result = WebAdapter.renderPackageResults(data);

			// Note: > is escaped to &gt; by escapeHtml
			expect(result).toContain('&gt; core');
			expect(result).toContain('[PASS]');
			expect(result).toContain('&gt; cli');
			expect(result).toContain('[FAIL]');
			expect(result).toContain('1 passed');
			expect(result).toContain('1 failed');
		});

		it('handles empty packages', () => {
			const result = WebAdapter.renderPackageResults({
				packages: [],
				total: 0,
				passed: 0,
				failed: 0,
				success: true,
			});

			expect(result).toContain('Processing 0 package(s)');
		});

		it('handles missing data gracefully', () => {
			const result = WebAdapter.renderPackageResults(
				null as unknown as Parameters<typeof WebAdapter.renderPackageResults>[0]
			);
			expect(result).toBe('<pre>No results</pre>');
		});

		it('respects maxOutputLength option', () => {
			const data = {
				packages: [{ name: 'test', passed: false, stderr: 'a'.repeat(1000) }],
				total: 1,
				passed: 0,
				failed: 1,
				success: false,
			};

			const result = WebAdapter.renderPackageResults(data, { maxOutputLength: 50 });
			expect(result).toContain('...');
		});
	});

	describe('renderError', () => {
		it('renders error with red color', () => {
			const result = WebAdapter.renderError('Something went wrong');
			expect(result).toContain('Error: Something went wrong');
			expect(result).toContain('--afd-error');
		});
	});

	describe('renderResult', () => {
		it('auto-detects package results', () => {
			const result = WebAdapter.renderResult({
				success: true,
				data: {
					packages: [{ name: 'foo', passed: true }],
					total: 1,
					passed: 1,
					failed: 0,
				},
			});

			expect(result).toContain('[PASS]');
		});

		it('renders error for failed results', () => {
			const result = WebAdapter.renderResult({
				success: false,
				error: { message: 'Failed to connect' },
			});

			expect(result).toContain('Error: Failed to connect');
		});
	});

	describe('renderCommandError', () => {
		it('renders error code and message', () => {
			const result = WebAdapter.renderCommandError({
				code: 'NOT_FOUND',
				message: 'Todo not found',
			});

			expect(result).toContain('[NOT_FOUND]');
			expect(result).toContain('Todo not found');
			expect(result).toContain('--afd-error');
		});

		it('renders suggestion when provided', () => {
			const result = WebAdapter.renderCommandError({
				code: 'NOT_FOUND',
				message: 'Todo not found',
				suggestion: 'Check the ID and try again',
			});

			expect(result).toContain('Suggestion:');
			expect(result).toContain('Check the ID and try again');
			expect(result).toContain('--afd-info');
		});

		it('renders details when provided', () => {
			const result = WebAdapter.renderCommandError({
				code: 'VALIDATION_ERROR',
				message: 'Invalid input',
				details: { field: 'title' },
			});

			expect(result).toContain('Details:');
			expect(result).toContain('title');
		});

		it('escapes HTML in error messages', () => {
			const result = WebAdapter.renderCommandError({
				code: 'XSS',
				message: '<script>alert("xss")</script>',
			});

			expect(result).not.toContain('<script>');
			expect(result).toContain('&lt;script&gt;');
		});
	});

	describe('renderConfidence', () => {
		it('renders high confidence in green', () => {
			const result = WebAdapter.renderConfidence(0.95);

			expect(result).toContain('95%');
			expect(result).toContain('--afd-success');
		});

		it('renders medium confidence in yellow', () => {
			const result = WebAdapter.renderConfidence(0.6);

			expect(result).toContain('60%');
			expect(result).toContain('--afd-warning');
		});

		it('renders low confidence in red', () => {
			const result = WebAdapter.renderConfidence(0.3);

			expect(result).toContain('30%');
			expect(result).toContain('--afd-error');
		});

		it('renders reasoning when provided', () => {
			const result = WebAdapter.renderConfidence(0.85, 'Cache hit, data is fresh');

			expect(result).toContain('85%');
			expect(result).toContain('Cache hit, data is fresh');
		});

		it('renders progress bar characters', () => {
			const result = WebAdapter.renderConfidence(0.5);

			// Should contain both filled and empty bar chars
			expect(result).toContain('\u2588');
			expect(result).toContain('\u2591');
		});
	});

	describe('renderWarnings', () => {
		it('renders warning list', () => {
			const result = WebAdapter.renderWarnings([
				{ message: 'Rate limit approaching' },
				{ code: 'STALE', message: 'Data may be outdated' },
			]);

			expect(result).toContain('2 warning(s)');
			expect(result).toContain('Rate limit approaching');
			expect(result).toContain('[STALE]');
			expect(result).toContain('Data may be outdated');
			expect(result).toContain('--afd-warning');
		});

		it('returns empty string for no warnings', () => {
			const result = WebAdapter.renderWarnings([]);
			expect(result).toBe('');
		});
	});

	describe('renderPipelineSteps', () => {
		it('renders successful pipeline', () => {
			const result = WebAdapter.renderPipelineSteps([
				{ index: 0, command: 'user-get', status: 'success', executionTimeMs: 1.5 },
				{
					index: 1,
					command: 'order-list',
					alias: 'orders',
					status: 'success',
					executionTimeMs: 3.2,
				},
			]);

			expect(result).toContain('Pipeline: 2 steps');
			expect(result).toContain('user-get');
			expect(result).toContain('order-list');
			expect(result).toContain('(orders)');
			expect(result).toContain('1.5ms');
			expect(result).toContain('3.2ms');
			expect(result).toContain('2 passed');
		});

		it('renders failed step with error', () => {
			const result = WebAdapter.renderPipelineSteps([
				{ index: 0, command: 'user-get', status: 'success', executionTimeMs: 1.0 },
				{
					index: 1,
					command: 'order-list',
					status: 'failure',
					error: { code: 'NOT_FOUND', message: 'User not found' },
				},
				{ index: 2, command: 'order-total', status: 'skipped' },
			]);

			expect(result).toContain('1 passed');
			expect(result).toContain('1 failed');
			expect(result).toContain('1 skipped');
			expect(result).toContain('User not found');
		});

		it('renders empty pipeline', () => {
			const result = WebAdapter.renderPipelineSteps([]);
			expect(result).toBe('<pre>No pipeline steps</pre>');
		});
	});

	describe('renderCommandResult', () => {
		it('renders full successful result with metadata', () => {
			const result = WebAdapter.renderCommandResult({
				success: true,
				data: { id: '123', title: 'Test' },
				confidence: 0.92,
				reasoning: 'Fresh data from database',
				warnings: [{ message: 'Rate limit at 80%' }],
			});

			expect(result).toContain('123');
			expect(result).toContain('92%');
			expect(result).toContain('Fresh data from database');
			expect(result).toContain('Rate limit at 80%');
		});

		it('renders failed result with error', () => {
			const result = WebAdapter.renderCommandResult({
				success: false,
				error: {
					code: 'NOT_FOUND',
					message: 'Resource not found',
					suggestion: 'Check the ID',
				},
			});

			expect(result).toContain('[NOT_FOUND]');
			expect(result).toContain('Resource not found');
			expect(result).toContain('Check the ID');
		});

		it('renders minimal result', () => {
			const result = WebAdapter.renderCommandResult({
				success: true,
				data: 'hello',
			});

			expect(result).toContain('hello');
		});
	});
});
