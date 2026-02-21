/**
 * Types for AFD adapters.
 */

/**
 * Result for a single package (lint/test/build).
 */
export interface PackageResult {
	name: string;
	passed: boolean;
	stdout?: string;
	stderr?: string;
}

/**
 * Aggregated results for multiple packages.
 */
export interface PackageResults {
	packages: PackageResult[];
	total: number;
	passed: number;
	failed: number;
	success: boolean;
}

/**
 * Options for rendering.
 */
export interface RenderOptions {
	/**
	 * Whether to show output for failed packages.
	 * @default true
	 */
	showFailureOutput?: boolean;

	/**
	 * Maximum length of output to display per package.
	 * @default undefined (no limit)
	 */
	maxOutputLength?: number;
}

/**
 * A CommandError with optional suggestion for recovery.
 */
export interface CommandErrorInput {
	code: string;
	message: string;
	suggestion?: string;
	details?: unknown;
}

/**
 * A warning from a command result.
 */
export interface WarningInput {
	code?: string;
	message: string;
}

/**
 * A pipeline step result for rendering progress.
 */
export interface PipelineStepInput {
	index: number;
	command: string;
	alias?: string;
	status: 'success' | 'failure' | 'skipped';
	executionTimeMs?: number;
	error?: { code?: string; message?: string };
}

/**
 * Full CommandResult shape for the adapter to render.
 */
export interface CommandResultInput {
	success: boolean;
	data?: unknown;
	error?: CommandErrorInput;
	confidence?: number;
	reasoning?: string;
	warnings?: WarningInput[];
	sources?: Array<{ label: string; url?: string }>;
	alternatives?: Array<{ command: string; description: string }>;
}
