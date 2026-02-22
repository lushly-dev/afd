/**
 * @fileoverview Token-based cosine similarity for command description analysis.
 *
 * Lightweight, dependency-free approach using term-frequency vectors.
 * Sufficient for short descriptions (1-2 sentences) without embedding models.
 */

import type { SimilarityMatrix, SimilarityOptions, SimilarityPair } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// STOP WORDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Common English stop words filtered from similarity comparisons.
 */
export const STOP_WORDS = new Set([
	'a',
	'an',
	'the',
	'is',
	'are',
	'was',
	'were',
	'be',
	'been',
	'being',
	'have',
	'has',
	'had',
	'do',
	'does',
	'did',
	'will',
	'would',
	'could',
	'should',
	'may',
	'might',
	'shall',
	'can',
	'to',
	'of',
	'in',
	'for',
	'on',
	'with',
	'at',
	'by',
	'from',
	'as',
	'into',
	'through',
	'during',
	'before',
	'after',
	'above',
	'below',
	'between',
	'and',
	'but',
	'or',
	'not',
	'no',
	'nor',
	'so',
	'yet',
	'both',
	'either',
	'neither',
	'each',
	'every',
	'all',
	'any',
	'few',
	'more',
	'most',
	'other',
	'some',
	'such',
	'than',
	'too',
	'very',
	'this',
	'that',
	'these',
	'those',
	'it',
	'its',
]);

// ═══════════════════════════════════════════════════════════════════════════════
// TOKENIZER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tokenize text into words, removing non-alphanumeric characters.
 */
export function tokenize(text: string, caseInsensitive: boolean): string[] {
	const normalized = caseInsensitive ? text.toLowerCase() : text;
	return normalized
		.replace(/[^a-z0-9\s]/gi, ' ')
		.split(/\s+/)
		.filter((t) => t.length > 0);
}

/**
 * Build a term frequency map from tokens.
 */
export function buildTermFrequency(tokens: string[]): Map<string, number> {
	const tf = new Map<string, number>();
	for (const token of tokens) {
		tf.set(token, (tf.get(token) ?? 0) + 1);
	}
	return tf;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COSINE SIMILARITY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute cosine similarity between two strings using term-frequency vectors.
 *
 * @returns similarity score between 0 (unrelated) and 1 (identical)
 */
export function cosineSimilarity(a: string, b: string, options: SimilarityOptions = {}): number {
	const { removeStopWords = true, caseInsensitive = true } = options;

	let tokensA = tokenize(a, caseInsensitive);
	let tokensB = tokenize(b, caseInsensitive);

	if (removeStopWords) {
		const stopWords = new Set(STOP_WORDS);
		if (options.additionalStopWords) {
			for (const w of options.additionalStopWords) {
				stopWords.add(w.toLowerCase());
			}
		}
		tokensA = tokensA.filter((t) => !stopWords.has(t));
		tokensB = tokensB.filter((t) => !stopWords.has(t));
	}

	const tfA = buildTermFrequency(tokensA);
	const tfB = buildTermFrequency(tokensB);

	const allTerms = new Set([...tfA.keys(), ...tfB.keys()]);

	let dotProduct = 0;
	let magnitudeA = 0;
	let magnitudeB = 0;

	for (const term of allTerms) {
		const valA = tfA.get(term) ?? 0;
		const valB = tfB.get(term) ?? 0;
		dotProduct += valA * valB;
		magnitudeA += valA * valA;
		magnitudeB += valB * valB;
	}

	const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
	return magnitude === 0 ? 0 : dotProduct / magnitude;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMILARITY MATRIX
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute pairwise description similarity for a command set.
 */
export function buildSimilarityMatrix(
	commands: Array<{ name: string; description: string }>,
	options?: SimilarityOptions
): SimilarityMatrix {
	const pairs: SimilarityPair[] = [];
	const scores = new Map<string, number>();

	for (let i = 0; i < commands.length; i++) {
		for (let j = i + 1; j < commands.length; j++) {
			const cmdA = commands[i];
			const cmdB = commands[j];
			if (!cmdA || !cmdB) continue;
			const score = cosineSimilarity(cmdA.description, cmdB.description, options);

			pairs.push({
				commandA: cmdA.name,
				commandB: cmdB.name,
				score,
			});

			const key = [cmdA.name, cmdB.name].sort().join('\0');
			scores.set(key, score);
		}
	}

	pairs.sort((a, b) => b.score - a.score);

	return {
		pairs,
		get(commandA: string, commandB: string): number {
			const key = [commandA, commandB].sort().join('\0');
			return scores.get(key) ?? 0;
		},
	};
}
