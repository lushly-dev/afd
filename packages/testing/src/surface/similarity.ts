/**
 * @fileoverview Token-based cosine similarity for command description analysis.
 *
 * Lightweight, dependency-free approach using term-frequency vectors.
 * Sufficient for short descriptions (1-2 sentences) without embedding models.
 */

import { forEachSharedTermPair } from './shared-terms.js';
import type { SimilarityMatrix, SimilarityOptions, SimilarityPair } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// STOP WORDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Common English stop words filtered from similarity comparisons.
 */
const STOP_WORDS = new Set([
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
// TERM-FREQUENCY VECTORS
// ═══════════════════════════════════════════════════════════════════════════════

/** A term-frequency vector with its precomputed Euclidean norm. */
interface TermVector {
	terms: Map<string, number>;
	norm: number;
}

/**
 * Tokenize text into words, removing non-alphanumeric characters.
 */
function tokenize(text: string, caseInsensitive: boolean): string[] {
	const normalized = caseInsensitive ? text.toLowerCase() : text;
	return normalized
		.replace(/[^a-z0-9\s]/gi, ' ')
		.split(/\s+/)
		.filter((t) => t.length > 0);
}

function stopWordSet(options: SimilarityOptions): Set<string> | undefined {
	if (options.removeStopWords === false) {
		return undefined;
	}
	const stopWords = new Set(STOP_WORDS);
	for (const word of options.additionalStopWords ?? []) {
		stopWords.add(word.toLowerCase());
	}
	return stopWords;
}

function toVector(
	text: string,
	stopWords: Set<string> | undefined,
	caseInsensitive: boolean
): TermVector {
	const terms = new Map<string, number>();
	for (const token of tokenize(text, caseInsensitive)) {
		if (!stopWords?.has(token)) {
			terms.set(token, (terms.get(token) ?? 0) + 1);
		}
	}
	let sumOfSquares = 0;
	for (const count of terms.values()) {
		sumOfSquares += count * count;
	}
	return { terms, norm: Math.sqrt(sumOfSquares) };
}

function cosine(a: TermVector, b: TermVector, dotProduct?: number): number {
	const magnitude = a.norm * b.norm;
	if (magnitude === 0) {
		return 0;
	}
	let dot = dotProduct ?? 0;
	if (dotProduct === undefined) {
		const [small, large] = a.terms.size <= b.terms.size ? [a, b] : [b, a];
		for (const [term, count] of small.terms) {
			dot += count * (large.terms.get(term) ?? 0);
		}
	}
	return dot / magnitude;
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
	const stopWords = stopWordSet(options);
	const caseInsensitive = options.caseInsensitive ?? true;
	return cosine(toVector(a, stopWords, caseInsensitive), toVector(b, stopWords, caseInsensitive));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMILARITY MATRIX
// ═══════════════════════════════════════════════════════════════════════════════

function pairKey(commandA: string, commandB: string): string {
	return commandA < commandB ? `${commandA}\0${commandB}` : `${commandB}\0${commandA}`;
}

/**
 * Score every pair (used when no positive threshold prunes the pairs).
 */
function allPairs(
	vectors: TermVector[],
	visit: (i: number, j: number, score: number) => void
): void {
	for (let i = 0; i < vectors.length; i++) {
		for (let j = i + 1; j < vectors.length; j++) {
			const a = vectors[i];
			const b = vectors[j];
			if (a && b) visit(i, j, cosine(a, b));
		}
	}
}

/**
 * Compute pairwise description similarity for a command set.
 *
 * Each description is tokenized once. With `options.threshold` above 0, only
 * pairs scoring at or above it are kept in `pairs` and only pairs sharing a
 * term are scored, so large command sets stay fast; `get()` still scores any
 * pair on demand.
 */
export function buildSimilarityMatrix(
	commands: Array<{ name: string; description: string }>,
	options: SimilarityOptions = {}
): SimilarityMatrix {
	const stopWords = stopWordSet(options);
	const caseInsensitive = options.caseInsensitive ?? true;
	const vectors = commands.map((cmd) => toVector(cmd.description, stopWords, caseInsensitive));
	const indexByName = new Map(commands.map((cmd, index) => [cmd.name, index]));
	const threshold = options.threshold;

	const pairs: SimilarityPair[] = [];
	const scores = new Map<string, number>();
	const visit = (i: number, j: number, score: number) => {
		const cmdA = commands[i];
		const cmdB = commands[j];
		if (!cmdA || !cmdB || (threshold !== undefined && score < threshold)) return;
		pairs.push({ commandA: cmdA.name, commandB: cmdB.name, score });
		scores.set(pairKey(cmdA.name, cmdB.name), score);
	};

	if (threshold !== undefined && threshold > 0) {
		// Pairs sharing no term score 0, below any positive threshold
		forEachSharedTermPair(
			vectors.map((vector) => vector.terms),
			(i, j, dot) => {
				const a = vectors[i];
				const b = vectors[j];
				if (a && b) visit(i, j, cosine(a, b, dot));
			}
		);
	} else {
		allPairs(vectors, visit);
	}

	pairs.sort((a, b) => b.score - a.score);

	return {
		pairs,
		get(commandA: string, commandB: string): number {
			const stored = scores.get(pairKey(commandA, commandB));
			if (stored !== undefined) return stored;
			const a = vectors[indexByName.get(commandA) ?? -1];
			const b = vectors[indexByName.get(commandB) ?? -1];
			return a && b ? cosine(a, b) : 0;
		},
	};
}
