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
});
