/**
 * WebAdapter - Renders CommandResult to HTML with CSS variable theming.
 */

import { StatusType, type StatusTypeValue } from './css-variables.js';
import type {
	CommandErrorInput,
	CommandResultInput,
	PackageResults,
	PipelineStepInput,
	RenderOptions,
	WarningInput,
} from './types.js';
import { escapeHtml, styledSpan } from './utils.js';

/**
 * The span writer for one render, bound to its `styling`.
 */
function spanWriter(options: RenderOptions) {
	return (text: string, status: StatusTypeValue, bold = false): string =>
		styledSpan(text, status, bold, options.styling);
}

/**
 * WebAdapter transforms AFD CommandResult data into styled HTML.
 *
 * Uses CSS custom properties for theming:
 *   --afd-success, --afd-error, --afd-warning, --afd-info, --afd-muted
 *
 * Every method takes `RenderOptions`. With `styling: 'classes'` the output has no `style`
 * attribute, for a Content-Security-Policy of `style-src 'self'`.
 */
export const WebAdapter = {
	/**
	 * Render package results (lint/test/build) as HTML.
	 */
	renderPackageResults(data: PackageResults, options: RenderOptions = {}): string {
		const { showFailureOutput = true, maxOutputLength } = options;
		const span = spanWriter(options);

		if (!data || !Array.isArray(data.packages)) {
			return '<pre>No results</pre>';
		}

		const lines: string[] = [];
		const total = data.total || data.packages.length;
		const passed = data.passed || 0;
		const failed = data.failed || 0;

		// Header
		lines.push(span(`Processing ${total} package(s)...`, StatusType.NEUTRAL, true));
		lines.push('');

		// Package results
		for (const pkg of data.packages) {
			const name = pkg.name || 'unknown';
			const pkgPassed = pkg.passed;

			// Package name in info color (blue)
			lines.push(span(`> ${name}`, StatusType.INFO));

			// Status indicator
			if (pkgPassed) {
				lines.push(span('  [PASS]', StatusType.SUCCESS));
			} else {
				lines.push(span('  [FAIL]', StatusType.FAILURE));
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
					lines.push(span(output, StatusType.MUTED));
				}
			}

			lines.push('');
		}

		// Summary
		const summaryParts = [span('Results: ', StatusType.NEUTRAL, true)];
		if (passed > 0) {
			summaryParts.push(span(`${passed} passed`, StatusType.SUCCESS));
		}
		if (failed > 0) {
			if (passed > 0) summaryParts.push(', ');
			summaryParts.push(span(`${failed} failed`, StatusType.FAILURE));
		}
		lines.push(summaryParts.join(''));

		return `<pre>${lines.join('<br>')}</pre>`;
	},

	/**
	 * Render an error message.
	 */
	renderError(message: string, options: RenderOptions = {}): string {
		const span = spanWriter(options);
		return `<pre>${span(`Error: ${message}`, StatusType.FAILURE)}</pre>`;
	},

	/**
	 * Render a success message.
	 */
	renderSuccess(message: string, options: RenderOptions = {}): string {
		const span = spanWriter(options);
		return `<pre>${span(message, StatusType.SUCCESS)}</pre>`;
	},

	/**
	 * Render a warning message.
	 */
	renderWarning(message: string, options: RenderOptions = {}): string {
		const span = spanWriter(options);
		return `<pre>${span(`Warning: ${message}`, StatusType.WARNING)}</pre>`;
	},

	/**
	 * Render a generic result with auto-detection.
	 */
	renderResult(
		result: { success: boolean; data?: unknown; error?: unknown },
		options: RenderOptions = {}
	): string {
		if (result.success === false && result.error) {
			const errorMsg =
				typeof result.error === 'object' && result.error !== null
					? (result.error as { message?: string }).message || String(result.error)
					: String(result.error);
			return this.renderError(errorMsg, options);
		}

		const data = result.data as PackageResults | undefined;

		// Check if it's package results
		if (data?.packages && Array.isArray(data.packages)) {
			return this.renderPackageResults(data, options);
		}

		// Fallback to JSON display
		return `<pre>${escapeHtml(JSON.stringify(result.data, null, 2))}</pre>`;
	},

	/**
	 * Render a CommandError with code, message, and optional suggestion.
	 */
	renderCommandError(error: CommandErrorInput, options: RenderOptions = {}): string {
		const span = spanWriter(options);
		const lines: string[] = [];

		lines.push(span(`[${error.code}] ${error.message}`, StatusType.FAILURE, true));

		if (error.suggestion) {
			lines.push(span(`Suggestion: ${error.suggestion}`, StatusType.INFO));
		}

		if (error.details) {
			lines.push(span(`Details: ${JSON.stringify(error.details)}`, StatusType.MUTED));
		}

		return `<pre>${lines.join('<br>')}</pre>`;
	},

	/**
	 * Render a confidence indicator (0-1 scale). Values outside [0, 1] are clamped and a
	 * non-finite value renders as 0, so a server's bad value cannot throw after the command
	 * already succeeded.
	 */
	renderConfidence(rawConfidence: number, reasoning?: string, options: RenderOptions = {}): string {
		const span = spanWriter(options);
		const confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0;
		const pct = Math.round(confidence * 100);
		const barWidth = 20;
		const filled = Math.round(confidence * barWidth);
		const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled);

		let status: (typeof StatusType)[keyof typeof StatusType];
		if (confidence >= 0.8) {
			status = StatusType.SUCCESS;
		} else if (confidence >= 0.5) {
			status = StatusType.WARNING;
		} else {
			status = StatusType.FAILURE;
		}

		const lines: string[] = [];
		lines.push(`${span(`Confidence: ${pct}%`, status, true)} ${span(bar, status)}`);

		if (reasoning) {
			lines.push(span(reasoning, StatusType.MUTED));
		}

		return `<pre>${lines.join('<br>')}</pre>`;
	},

	/**
	 * Render a list of warnings.
	 */
	renderWarnings(warnings: WarningInput[], options: RenderOptions = {}): string {
		if (warnings.length === 0) return '';

		const span = spanWriter(options);
		const lines: string[] = [];
		lines.push(span(`${warnings.length} warning(s):`, StatusType.WARNING, true));

		for (const warning of warnings) {
			const prefix = warning.code ? `[${warning.code}] ` : '';
			lines.push(span(`  \u26A0 ${prefix}${warning.message}`, StatusType.WARNING));
		}

		return `<pre>${lines.join('<br>')}</pre>`;
	},

	/**
	 * Render pipeline step progress.
	 */
	renderPipelineSteps(steps: PipelineStepInput[], options: RenderOptions = {}): string {
		if (steps.length === 0) return '<pre>No pipeline steps</pre>';

		const span = spanWriter(options);
		const lines: string[] = [];
		const succeeded = steps.filter((s) => s.status === 'success').length;
		const failed = steps.filter((s) => s.status === 'failure').length;
		const skipped = steps.filter((s) => s.status === 'skipped').length;

		lines.push(span(`Pipeline: ${steps.length} steps`, StatusType.NEUTRAL, true));
		lines.push('');

		for (const step of steps) {
			let icon: string;
			let status: (typeof StatusType)[keyof typeof StatusType];

			if (step.status === 'success') {
				icon = '\u2713';
				status = StatusType.SUCCESS;
			} else if (step.status === 'failure') {
				icon = '\u2717';
				status = StatusType.FAILURE;
			} else {
				icon = '\u2014';
				status = StatusType.MUTED;
			}

			const alias = step.alias ? ` (${step.alias})` : '';
			const time =
				step.executionTimeMs !== undefined ? ` ${step.executionTimeMs.toFixed(1)}ms` : '';
			lines.push(span(`  ${icon} ${step.command}${alias}${time}`, status));

			if (step.status === 'failure' && step.error) {
				lines.push(span(`    ${step.error.message ?? 'Unknown error'}`, StatusType.FAILURE));
			}
		}

		lines.push('');
		const summaryParts: string[] = [];
		if (succeeded > 0) summaryParts.push(span(`${succeeded} passed`, StatusType.SUCCESS));
		if (failed > 0) summaryParts.push(span(`${failed} failed`, StatusType.FAILURE));
		if (skipped > 0) summaryParts.push(span(`${skipped} skipped`, StatusType.MUTED));
		lines.push(summaryParts.join(', '));

		return `<pre>${lines.join('<br>')}</pre>`;
	},

	/**
	 * Render a full CommandResult with all metadata sections.
	 */
	renderCommandResult(result: CommandResultInput, options: RenderOptions = {}): string {
		const sections: string[] = [];

		// Error section
		if (!result.success && result.error) {
			sections.push(this.renderCommandError(result.error, options));
		}

		// Success data
		if (result.success && result.data !== undefined) {
			const data = result.data as PackageResults | undefined;
			if (data?.packages && Array.isArray(data.packages)) {
				sections.push(this.renderPackageResults(data, options));
			} else {
				sections.push(`<pre>${escapeHtml(JSON.stringify(result.data, null, 2))}</pre>`);
			}
		}

		// Confidence
		if (result.confidence !== undefined) {
			sections.push(this.renderConfidence(result.confidence, result.reasoning, options));
		}

		// Warnings
		if (result.warnings && result.warnings.length > 0) {
			sections.push(this.renderWarnings(result.warnings, options));
		}

		return sections.join('\n');
	},
};
