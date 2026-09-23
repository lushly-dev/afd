/**
 * @fileoverview String similarity utilities for fuzzy matching.
 *
 * Extracted from DirectClient for reuse in lazy-loading discovery tools.
 */

/**
 * Longest requested name (in UTF-16 code units) that `findSimilarTools` will
 * fuzzy-match. Longer names get no suggestions: Levenshtein costs
 * O(requested × candidate) per command, and the requested name is untrusted.
 * Also the default length for {@link truncateName}.
 */
export const MAX_SIMILARITY_INPUT_LENGTH = 128;

/** Minimum similarity for a name to be suggested. */
const MIN_SUGGESTION_SIMILARITY = 0.4;

/**
 * Levenshtein distance computed with two rolling rows, so memory is
 * O(min(a, b)) instead of a full O(a × b) matrix.
 */
function levenshteinDistance(a: string, b: string): number {
	// Keep the shorter string on the inner loop so the rows stay small.
	const [outer, inner] = a.length >= b.length ? [a, b] : [b, a];
	let previous = new Array<number>(inner.length + 1);
	let current = new Array<number>(inner.length + 1);
	for (let j = 0; j <= inner.length; j++) previous[j] = j;

	for (let i = 1; i <= outer.length; i++) {
		current[0] = i;
		const outerCode = outer.charCodeAt(i - 1);
		for (let j = 1; j <= inner.length; j++) {
			const cost = outerCode === inner.charCodeAt(j - 1) ? 0 : 1;
			const deletion = (previous[j] ?? 0) + 1;
			const insertion = (current[j - 1] ?? 0) + 1;
			const substitution = (previous[j - 1] ?? 0) + cost;
			current[j] = Math.min(deletion, insertion, substitution);
		}
		[previous, current] = [current, previous];
	}

	return previous[inner.length] ?? outer.length;
}

/** Similarity of two already-lowercased strings. */
function lowercaseSimilarity(a: string, b: string): number {
	if (a === b) return 1;
	const maxLen = Math.max(a.length, b.length);
	return 1 - levenshteinDistance(a, b) / maxLen;
}

/**
 * Calculate similarity between two strings using Levenshtein distance.
 * Returns a value between 0 (completely different) and 1 (identical).
 */
export function calculateSimilarity(a: string, b: string): number {
	return lowercaseSimilarity(a.toLowerCase(), b.toLowerCase());
}

/**
 * Find similar tool/command names for suggestions.
 * Returns tools with similarity >= 0.4, sorted by similarity.
 *
 * Returns no suggestions when `requestedTool` is longer than
 * {@link MAX_SIMILARITY_INPUT_LENGTH}.
 */
export function findSimilarTools(
	requestedTool: string,
	availableTools: string[],
	maxSuggestions = 3
): string[] {
	if (requestedTool.length > MAX_SIMILARITY_INPUT_LENGTH) return [];

	const requested = requestedTool.toLowerCase();
	const matches: Array<{ tool: string; similarity: number }> = [];
	for (const tool of availableTools) {
		const candidate = tool.toLowerCase();
		// Length pre-filter. similarity = 1 - distance / maxLen, and
		// distance >= |requested.length - candidate.length| because each insertion or
		// deletion changes the length by one and a substitution does not change it.
		// So no candidate can score above 1 - lengthDiff / maxLen. When that bound is
		// under the threshold, skip the O(requested × candidate) distance. The bound
		// uses the same floating-point expression as the score, so it never drops a
		// candidate the full computation would keep.
		const maxLen = Math.max(requested.length, candidate.length);
		const lengthDiff = Math.abs(requested.length - candidate.length);
		if (maxLen > 0 && 1 - lengthDiff / maxLen < MIN_SUGGESTION_SIMILARITY) continue;

		const similarity = lowercaseSimilarity(requested, candidate);
		if (similarity >= MIN_SUGGESTION_SIMILARITY) matches.push({ tool, similarity });
	}

	return matches
		.sort((a, b) => b.similarity - a.similarity)
		.slice(0, maxSuggestions)
		.map((item) => item.tool);
}

/**
 * Shorten an untrusted name before echoing it in an error message.
 * Names longer than `maxLength` are cut to `maxLength` code units plus `…`.
 */
export function truncateName(name: string, maxLength = MAX_SIMILARITY_INPUT_LENGTH): string {
	if (name.length <= maxLength) return name;
	// Do not leave half of a surrogate pair at the cut.
	const lastCode = name.charCodeAt(maxLength - 1);
	const end = lastCode >= 0xd800 && lastCode <= 0xdbff ? maxLength - 1 : maxLength;
	return `${name.slice(0, end)}…`;
}
