/**
 * @fileoverview String similarity utilities for fuzzy matching.
 *
 * Extracted from DirectClient for reuse in lazy-loading discovery tools.
 */

/**
 * Calculate similarity between two strings using Levenshtein distance.
 * Returns a value between 0 (completely different) and 1 (identical).
 */
export function calculateSimilarity(a: string, b: string): number {
	const aLower = a.toLowerCase();
	const bLower = b.toLowerCase();

	if (aLower === bLower) return 1;

	const matrix: number[][] = [];

	for (let i = 0; i <= aLower.length; i++) {
		matrix[i] = [i];
	}

	const firstRow = matrix[0];
	if (!firstRow) return 0;
	for (let j = 0; j <= bLower.length; j++) {
		firstRow[j] = j;
	}

	for (let i = 1; i <= aLower.length; i++) {
		const currentRow = matrix[i];
		const prevRow = matrix[i - 1];
		if (!currentRow || !prevRow) continue;
		for (let j = 1; j <= bLower.length; j++) {
			const cost = aLower[i - 1] === bLower[j - 1] ? 0 : 1;
			const deletion = prevRow[j] ?? 0;
			const insertion = currentRow[j - 1] ?? 0;
			const substitution = prevRow[j - 1] ?? 0;
			currentRow[j] = Math.min(deletion + 1, insertion + 1, substitution + cost);
		}
	}

	const maxLen = Math.max(aLower.length, bLower.length);
	const distance = matrix[aLower.length]?.[bLower.length] ?? maxLen;
	return maxLen === 0 ? 1 : 1 - distance / maxLen;
}

/**
 * Find similar tool/command names for suggestions.
 * Returns tools with similarity >= 0.4, sorted by similarity.
 */
export function findSimilarTools(
	requestedTool: string,
	availableTools: string[],
	maxSuggestions = 3
): string[] {
	return availableTools
		.map((tool) => ({ tool, similarity: calculateSimilarity(requestedTool, tool) }))
		.filter((item) => item.similarity >= 0.4)
		.sort((a, b) => b.similarity - a.similarity)
		.slice(0, maxSuggestions)
		.map((item) => item.tool);
}
