/**
 * WebAdapter - Renders CommandResult to HTML with CSS variable theming.
 */

import { StatusType } from './css-variables.js';
import type { PackageResults, RenderOptions } from './types.js';
import { escapeHtml, styledSpan } from './utils.js';

/**
 * WebAdapter transforms AFD CommandResult data into styled HTML.
 *
 * Uses CSS custom properties for theming:
 *   --afd-success, --afd-error, --afd-warning, --afd-info, --afd-muted
 */
export const WebAdapter = {
	/**
	 * Render package results (lint/test/build) as HTML.
	 */
	renderPackageResults(data: PackageResults, options: RenderOptions = {}): string {
		const { showFailureOutput = true, maxOutputLength } = options;

		if (!data || !Array.isArray(data.packages)) {
			return '<pre>No results</pre>';
		}

		const lines: string[] = [];
		const total = data.total || data.packages.length;
		const passed = data.passed || 0;
		const failed = data.failed || 0;

		// Header
		lines.push(styledSpan(`Processing ${total} package(s)...`, StatusType.NEUTRAL, true));
		lines.push('');

		// Package results
		for (const pkg of data.packages) {
			const name = pkg.name || 'unknown';
			const pkgPassed = pkg.passed;

			// Package name in info color (blue)
			lines.push(styledSpan(`> ${name}`, StatusType.INFO));

			// Status indicator
			if (pkgPassed) {
				lines.push(styledSpan('  [PASS]', StatusType.SUCCESS));
			} else {
				lines.push(styledSpan('  [FAIL]', StatusType.FAILURE));
			}

			// Show output for failed packages
			if (!pkgPassed && showFailureOutput) {
				const stdout = pkg.stdout || '';
				const stderr = pkg.stderr || '';
				let output = (stdout + stderr).trim();

				if (maxOutputLength && output.length > maxOutputLength) {
					output = `${output.slice(0, maxOutputLength)}...`;
				}

				if (output) {
					lines.push(styledSpan(output, StatusType.MUTED));
				}
			}

			lines.push('');
		}

		// Summary
		const summaryParts = [styledSpan('Results: ', StatusType.NEUTRAL, true)];
		if (passed > 0) {
			summaryParts.push(styledSpan(`${passed} passed`, StatusType.SUCCESS));
		}
		if (failed > 0) {
			if (passed > 0) summaryParts.push(', ');
			summaryParts.push(styledSpan(`${failed} failed`, StatusType.FAILURE));
		}
		lines.push(summaryParts.join(''));

		return `<pre>${lines.join('<br>')}</pre>`;
	},

	/**
	 * Render an error message.
	 */
	renderError(message: string): string {
		return `<pre>${styledSpan(`Error: ${message}`, StatusType.FAILURE)}</pre>`;
	},

	/**
	 * Render a success message.
	 */
	renderSuccess(message: string): string {
		return `<pre>${styledSpan(message, StatusType.SUCCESS)}</pre>`;
	},

	/**
	 * Render a warning message.
	 */
	renderWarning(message: string): string {
		return `<pre>${styledSpan(`Warning: ${message}`, StatusType.WARNING)}</pre>`;
	},

	/**
	 * Render a generic result with auto-detection.
	 */
	renderResult(result: { success: boolean; data?: unknown; error?: unknown }): string {
		if (result.success === false && result.error) {
			const errorMsg =
				typeof result.error === 'object' && result.error !== null
					? (result.error as { message?: string }).message || String(result.error)
					: String(result.error);
			return this.renderError(errorMsg);
		}

		const data = result.data as PackageResults | undefined;

		// Check if it's package results
		if (data?.packages && Array.isArray(data.packages)) {
			return this.renderPackageResults(data);
		}

		// Fallback to JSON display
		return `<pre>${escapeHtml(JSON.stringify(result.data, null, 2))}</pre>`;
	},
};
