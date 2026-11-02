/** Types for the token-only lint, `lint-tokens.mjs`. */
export const CHROME_PACKAGE: '@lushly-dev/loam-chrome';

export interface LintOptions {
	/** The contract's custom properties, like `--color-surface-page`. */
	properties: ReadonlySet<string>;
	/** Whether `shell.*` tokens may be read: only in `@lushly-dev/loam-chrome`. */
	allowShell: boolean;
	/** Private aliases the package sets through CSSOM from layout state. */
	stateProperties?: readonly string[];
}

export type LintRule =
	| 'raw-color'
	| 'raw-length'
	| 'unknown-property'
	| 'private-alias'
	| 'primitive'
	| 'shell-token';

export interface StylesheetViolation {
	rule: LintRule;
	/** Offset in the stylesheet. */
	index: number;
	message: string;
}

export interface Violation {
	rule: LintRule;
	message: string;
	line: number;
	column: number;
}

export function extractTaggedTemplates(source: string): { css: string; offset: number }[];
export function lintStylesheet(css: string, options: LintOptions): StylesheetViolation[];
export function lintSource(text: string, fileName: string, options: LintOptions): Violation[];
export function contractProperties(contract: {
	tokens?: Record<string, { property: string }>;
}): Set<string>;
export function main(patterns: string[], cwd?: string): number;
