import { describe, expect, it } from 'vitest';
import {
	calculateSimilarity,
	findSimilarTools,
	MAX_SIMILARITY_INPUT_LENGTH,
	truncateName,
} from './similarity.js';

describe('calculateSimilarity', () => {
	it('returns 1 for identical strings', () => {
		expect(calculateSimilarity('hello', 'hello')).toBe(1);
	});
	it('returns 1 for identical strings case-insensitive', () => {
		expect(calculateSimilarity('Hello', 'hello')).toBe(1);
	});
	it('returns 0 for completely different strings', () => {
		expect(calculateSimilarity('abc', 'xyz')).toBeLessThan(0.4);
	});
	it('returns value between 0 and 1 for similar strings', () => {
		const sim = calculateSimilarity('todo-create', 'todo-crate');
		expect(sim).toBeGreaterThan(0.7);
		expect(sim).toBeLessThan(1);
	});
	it('handles empty strings', () => {
		expect(calculateSimilarity('', '')).toBe(1);
		expect(calculateSimilarity('hello', '')).toBe(0);
	});
});

describe('findSimilarTools', () => {
	const tools = ['todo-create', 'todo-list', 'todo-delete', 'user-get', 'user-create'];

	it('finds similar tools for typo', () => {
		const suggestions = findSimilarTools('todo-crate', tools);
		expect(suggestions).toContain('todo-create');
	});
	it('returns empty array when no match above threshold', () => {
		const suggestions = findSimilarTools('zzzzzzz', tools);
		expect(suggestions).toHaveLength(0);
	});
	it('respects maxSuggestions', () => {
		const suggestions = findSimilarTools('todo', tools, 2);
		expect(suggestions.length).toBeLessThanOrEqual(2);
	});
	it('returns results sorted by similarity', () => {
		const suggestions = findSimilarTools('todo-creat', tools);
		expect(suggestions[0]).toBe('todo-create');
	});
});

/** The original full-matrix implementation, kept as an oracle for equivalence tests. */
function referenceSimilarity(a: string, b: string): number {
	const aLower = a.toLowerCase();
	const bLower = b.toLowerCase();
	if (aLower === bLower) return 1;
	const matrix: number[][] = [];
	for (let i = 0; i <= aLower.length; i++) matrix[i] = [i];
	const firstRow = matrix[0] as number[];
	for (let j = 0; j <= bLower.length; j++) firstRow[j] = j;
	for (let i = 1; i <= aLower.length; i++) {
		const currentRow = matrix[i] as number[];
		const prevRow = matrix[i - 1] as number[];
		for (let j = 1; j <= bLower.length; j++) {
			const cost = aLower[i - 1] === bLower[j - 1] ? 0 : 1;
			currentRow[j] = Math.min(
				(prevRow[j] ?? 0) + 1,
				(currentRow[j - 1] ?? 0) + 1,
				(prevRow[j - 1] ?? 0) + cost
			);
		}
	}
	const maxLen = Math.max(aLower.length, bLower.length);
	const distance = matrix[aLower.length]?.[bLower.length] ?? maxLen;
	return maxLen === 0 ? 1 : 1 - distance / maxLen;
}

function referenceFindSimilarTools(requested: string, tools: string[], max = 3): string[] {
	return tools
		.map((tool) => ({ tool, similarity: referenceSimilarity(requested, tool) }))
		.filter((item) => item.similarity >= 0.4)
		.sort((a, b) => b.similarity - a.similarity)
		.slice(0, max)
		.map((item) => item.tool);
}

/** Deterministic pseudo-random generator (mulberry32) so failures are reproducible. */
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe('findSimilarTools input cap', () => {
	it('exports the cap', () => {
		expect(MAX_SIMILARITY_INPUT_LENGTH).toBe(128);
	});

	it('still matches a name at the cap', () => {
		const name = 'a'.repeat(MAX_SIMILARITY_INPUT_LENGTH);
		const nearMiss = `${name.slice(1)}b`;
		expect(findSimilarTools(name, [nearMiss, name])).toEqual([name, nearMiss]);
	});

	it('returns no suggestions for a name over the cap, even an exact match', () => {
		const name = 'a'.repeat(MAX_SIMILARITY_INPUT_LENGTH + 1);
		expect(findSimilarTools(name, [name, 'todo-create'])).toEqual([]);
	});

	it('returns quickly for a 1 MB name', () => {
		const tools = Array.from({ length: 200 }, (_, i) => `domain${i}-action`);
		const start = performance.now();
		expect(findSimilarTools('x'.repeat(1024 * 1024), tools)).toEqual([]);
		expect(performance.now() - start).toBeLessThan(50);
	});
});

describe('findSimilarTools length pre-filter', () => {
	const tools = [
		'todo-create',
		'todo-list',
		'todo-get',
		'todo-update',
		'todo-delete',
		'todo-toggle',
		'user-get',
		'user-create',
		'order-cancel',
		'afd-discover',
		'afd-detail',
		'a',
		'ab',
		'x'.repeat(40),
		'Straße-lesen',
		'İstanbul-get',
	];

	it('skips only candidates whose length difference makes 0.4 unreachable', () => {
		// 'ab' vs 'abcdefgh': distance >= 6, so similarity <= 1 - 6/8 = 0.25.
		expect(findSimilarTools('abcdefgh', ['ab'])).toEqual([]);
		// 'ab' vs 'abcde': distance 3, similarity 1 - 3/5 = 0.4, exactly the threshold, so kept.
		expect(findSimilarTools('ab', ['abcde'])).toEqual(['abcde']);
		expect(findSimilarTools('ab', ['abcde'])).toEqual(referenceFindSimilarTools('ab', ['abcde']));
		// 'ab' vs 'abcdef': distance 4, similarity 1 - 4/6 < 0.4.
		expect(findSimilarTools('ab', ['abcdef'])).toEqual([]);
	});

	it('does not compute the distance for a candidate the length bound rules out', () => {
		// Without the pre-filter this is 128 x 1,000,000 cells, far slower than the budget.
		const start = performance.now();
		expect(findSimilarTools('a'.repeat(128), ['a'.repeat(1_000_000)])).toEqual([]);
		expect(performance.now() - start).toBeLessThan(50);
	});

	it('matches the original full-matrix results on typical inputs', () => {
		const queries = [
			...tools,
			'todo-crate',
			'todo-creat',
			'todo',
			'TODO-LIST',
			'user',
			'zzzzzzz',
			'',
			'afd-detial',
			'order-cancle',
			'istanbul-get',
			'strasse-lesen',
		];
		for (const query of queries) {
			for (const max of [1, 3, 10]) {
				expect(findSimilarTools(query, tools, max)).toEqual(
					referenceFindSimilarTools(query, tools, max)
				);
			}
			for (const tool of tools) {
				expect(calculateSimilarity(query, tool)).toBe(referenceSimilarity(query, tool));
			}
		}
	});

	it('matches the original results on random names up to the cap', () => {
		const random = seededRandom(0x5eed);
		const alphabet = 'abcde-XY';
		const randomName = (maxLength: number) => {
			const length = Math.floor(random() * (maxLength + 1));
			let name = '';
			for (let i = 0; i < length; i++) name += alphabet[Math.floor(random() * alphabet.length)];
			return name;
		};
		const candidates = Array.from({ length: 60 }, () => randomName(24));
		for (let i = 0; i < 300; i++) {
			const query = randomName(i % 10 === 0 ? MAX_SIMILARITY_INPUT_LENGTH : 24);
			expect(findSimilarTools(query, candidates, 5)).toEqual(
				referenceFindSimilarTools(query, candidates, 5)
			);
		}
	});
});

describe('truncateName', () => {
	it('returns short names unchanged', () => {
		expect(truncateName('todo-create')).toBe('todo-create');
		expect(truncateName('a'.repeat(128))).toBe('a'.repeat(128));
	});

	it('cuts long names to 128 characters plus an ellipsis', () => {
		expect(truncateName('a'.repeat(200 * 1024))).toBe(`${'a'.repeat(128)}…`);
	});

	it('does not split a surrogate pair', () => {
		expect(truncateName(`${'a'.repeat(127)}😀tail`)).toBe(`${'a'.repeat(127)}…`);
	});

	it('accepts a custom length', () => {
		expect(truncateName('abcdef', 3)).toBe('abc…');
	});
});
