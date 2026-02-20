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
