/**
 * Shared glob matching for token ids, command names and constraint targets.
 *
 * Every filter in Violet (tokens.resolve, export, constraints applyTo,
 * analyze.compare/deviations, docs.generate) uses this single dialect:
 *
 * - `*`  matches any run of characters, INCLUDING dots, so `color.*` matches
 *   `color.brand.primary` and `*.primary` matches `color.brand.primary`.
 *   `**` is accepted and means exactly the same as `*`.
 * - `?`  matches exactly one character (any character, including a dot).
 * - Everything else is literal. Regex metacharacters such as `( ) [ ] { } + ^ $ | \`
 *   are escaped, so user supplied filters can never throw or change meaning.
 * - The pattern is anchored: it must match the whole string.
 */

const WILDCARD = '[\\s\\S]*';
const ANY_CHAR = '[\\s\\S]';

/** Escape a single character if it is a regex syntax character. */
function escapeRegexChar(char: string): string {
	return /[\\^$.*+?()[\]{}|/]/.test(char) ? `\\${char}` : char;
}

/**
 * Convert a glob pattern to an anchored RegExp.
 * Never throws for any string input.
 */
export function globToRegExp(pattern: string): RegExp {
	let source = '';
	for (const char of pattern) {
		if (char === '*') {
			// Collapse runs of `*` (including `**`) into one wildcard
			if (!source.endsWith(WILDCARD)) {
				source += WILDCARD;
			}
		} else if (char === '?') {
			source += ANY_CHAR;
		} else {
			source += escapeRegexChar(char);
		}
	}
	return new RegExp(`^${source}$`, 'u');
}

/** Test whether `value` matches the glob `pattern` (see module docs for semantics). */
export function matchesGlob(value: string, pattern: string): boolean {
	return globToRegExp(pattern).test(value);
}
