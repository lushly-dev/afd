import { describe, expect, it } from 'vitest';
import { calculateSimilarity, findSimilarTools } from './similarity.js';

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
