/**
 * @fileoverview todo-search command
 *
 * Full-text search across todos and lists.
 * Provides search highlighting, relevance scoring, and search suggestions.
 */

import type { Alternative } from '@lushly-dev/afd-core';
import { defineCommand, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { store } from '../store/index.js';
import type { List, Priority, Todo } from '../types.js';

const PRIORITY_MAP: Record<'low' | 'medium' | 'high', Priority> = {
	low: 1,
	medium: 2,
	high: 3,
};

const inputSchema = z.object({
	query: z.string().min(1).describe('Search query text'),
	scope: z
		.enum(['all', 'todos', 'lists'])
		.default('all')
		.describe('Search scope: all, todos only, or lists only'),
	completed: z.boolean().optional().describe('Filter todos by completion status'),
	priority: z.enum(['low', 'medium', 'high']).optional().describe('Filter todos by priority'),
	sortBy: z
		.enum(['relevance', 'createdAt', 'updatedAt', 'title'])
		.default('relevance')
		.describe('Sort results by field'),
	sortOrder: z.enum(['asc', 'desc']).default('desc'),
	limit: z.number().int().min(1).max(100).default(20),
	offset: z.number().int().min(0).default(0),
});

/**
 * A search match with the matched field highlighted.
 */
interface SearchMatch {
	field: 'title' | 'description' | 'name';
	snippet: string;
}

/**
 * A todo search result with relevance info.
 */
interface TodoSearchResult {
	type: 'todo';
	item: Todo;
	matches: SearchMatch[];
	relevance: number;
}

/**
 * A list search result with relevance info.
 */
interface ListSearchResult {
	type: 'list';
	item: List;
	matches: SearchMatch[];
	relevance: number;
}

type SearchResultItem = TodoSearchResult | ListSearchResult;

export interface SearchResult {
	results: SearchResultItem[];
	query: string;
	totalTodos: number;
	totalLists: number;
	total: number;
	hasMore: boolean;
}

/**
 * Calculate relevance score based on match quality.
 * Higher score = better match.
 */
function calculateRelevance(text: string, query: string, isTitle: boolean): number {
	const lowerText = text.toLowerCase();
	const lowerQuery = query.toLowerCase();

	let score = 0;

	// Exact match gets highest score
	if (lowerText === lowerQuery) {
		score += 100;
	}
	// Starts with query
	else if (lowerText.startsWith(lowerQuery)) {
		score += 75;
	}
	// Word boundary match (query appears at start of a word)
	else if (new RegExp(`\\b${escapeRegex(lowerQuery)}`).test(lowerText)) {
		score += 50;
	}
	// Contains query
	else if (lowerText.includes(lowerQuery)) {
		score += 25;
	}

	// Title matches are more important than description
	if (isTitle) {
		score *= 1.5;
	}

	// Shorter texts with matches are more relevant
	const lengthPenalty = Math.max(0, 1 - text.length / 500);
	score += lengthPenalty * 10;

	return score;
}

/**
 * Escape special regex characters.
 */
function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create a snippet with the match highlighted using ** markers.
 */
function createSnippet(text: string, query: string, maxLength: number = 100): string {
	const lowerText = text.toLowerCase();
	const lowerQuery = query.toLowerCase();
	const matchIndex = lowerText.indexOf(lowerQuery);

	if (matchIndex === -1) {
		return text.slice(0, maxLength) + (text.length > maxLength ? '...' : '');
	}

	// Calculate snippet window around the match
	const matchEnd = matchIndex + query.length;
	const contextSize = Math.floor((maxLength - query.length) / 2);
	let start = Math.max(0, matchIndex - contextSize);
	let end = Math.min(text.length, matchEnd + contextSize);

	// Adjust to not cut words
	if (start > 0) {
		const spaceIndex = text.indexOf(' ', start);
		if (spaceIndex !== -1 && spaceIndex < matchIndex) {
			start = spaceIndex + 1;
		}
	}
	if (end < text.length) {
		const spaceIndex = text.lastIndexOf(' ', end);
		if (spaceIndex !== -1 && spaceIndex > matchEnd) {
			end = spaceIndex;
		}
	}

	// Build snippet with highlighting
	let snippet = '';
	if (start > 0) snippet += '...';
	snippet += text.slice(start, matchIndex);
	snippet += `**${text.slice(matchIndex, matchEnd)}**`;
	snippet += text.slice(matchEnd, end);
	if (end < text.length) snippet += '...';

	return snippet;
}

export const searchTodos = defineCommand<typeof inputSchema, SearchResult>({
	name: 'todo-search',
	description: 'Full-text search across todos and lists',
	category: 'todo',
	tags: ['todo', 'list', 'search', 'read', 'filter'],
	mutation: false,
	version: '1.0.0',
	input: inputSchema,

	async handler(input) {
		const { query, scope, completed, priority, sortBy, sortOrder, limit, offset } = input;
		const numericPriority: Priority | undefined = priority ? PRIORITY_MAP[priority] : undefined;
		const lowerQuery = query.toLowerCase();
		const results: SearchResultItem[] = [];

		// Search todos
		if (scope === 'all' || scope === 'todos') {
			const todos = store.list({ completed, priority: numericPriority });

			for (const todo of todos) {
				const matches: SearchMatch[] = [];
				let relevance = 0;

				// Check title
				if (todo.title.toLowerCase().includes(lowerQuery)) {
					matches.push({
						field: 'title',
						snippet: createSnippet(todo.title, query),
					});
					relevance += calculateRelevance(todo.title, query, true);
				}

				// Check description
				if (todo.description?.toLowerCase().includes(lowerQuery)) {
					matches.push({
						field: 'description',
						snippet: createSnippet(todo.description, query),
					});
					relevance += calculateRelevance(todo.description, query, false);
				}

				if (matches.length > 0) {
					results.push({
						type: 'todo',
						item: todo,
						matches,
						relevance,
					});
				}
			}
		}

		// Search lists
		if (scope === 'all' || scope === 'lists') {
			const lists = store.listLists({});

			for (const list of lists) {
				const matches: SearchMatch[] = [];
				let relevance = 0;

				// Check name
				if (list.name.toLowerCase().includes(lowerQuery)) {
					matches.push({
						field: 'name',
						snippet: createSnippet(list.name, query),
					});
					relevance += calculateRelevance(list.name, query, true);
				}

				// Check description
				if (list.description?.toLowerCase().includes(lowerQuery)) {
					matches.push({
						field: 'description',
						snippet: createSnippet(list.description, query),
					});
					relevance += calculateRelevance(list.description, query, false);
				}

				if (matches.length > 0) {
					results.push({
						type: 'list',
						item: list,
						matches,
						relevance,
					});
				}
			}
		}

		// Sort results
		results.sort((a, b) => {
			let comparison = 0;

			switch (sortBy) {
				case 'relevance':
					comparison = a.relevance - b.relevance;
					break;
				case 'title': {
					const aTitle = a.type === 'todo' ? a.item.title : a.item.name;
					const bTitle = b.type === 'todo' ? b.item.title : b.item.name;
					comparison = aTitle.localeCompare(bTitle);
					break;
				}
				case 'updatedAt':
					comparison = a.item.updatedAt.localeCompare(b.item.updatedAt);
					break;
				default:
					comparison = a.item.createdAt.localeCompare(b.item.createdAt);
			}

			// For relevance, higher is better so default to desc
			return sortOrder === 'asc' ? comparison : -comparison;
		});

		// Count by type before pagination
		const totalTodos = results.filter((r) => r.type === 'todo').length;
		const totalLists = results.filter((r) => r.type === 'list').length;
		const total = results.length;

		// Apply pagination
		const paginatedResults = results.slice(offset, offset + limit);
		const hasMore = offset + paginatedResults.length < total;

		// Build reasoning
		const parts: string[] = [];
		if (totalTodos > 0) {
			parts.push(`${totalTodos} todo${totalTodos === 1 ? '' : 's'}`);
		}
		if (totalLists > 0) {
			parts.push(`${totalLists} list${totalLists === 1 ? '' : 's'}`);
		}

		const reasoning =
			total > 0
				? `Found ${parts.join(' and ')} matching "${query}"`
				: `No results found for "${query}"`;

		// Build alternatives
		const alternatives: Alternative<SearchResult>[] = [];

		// If searching in a specific scope, offer to search all
		if (scope !== 'all' && total === 0) {
			const allScopeResults: SearchResultItem[] = [];

			// Re-search in all scopes
			const allTodos = store.list({ completed, priority: numericPriority });
			for (const todo of allTodos) {
				const matches: SearchMatch[] = [];
				let relevance = 0;

				if (todo.title.toLowerCase().includes(lowerQuery)) {
					matches.push({ field: 'title', snippet: createSnippet(todo.title, query) });
					relevance += calculateRelevance(todo.title, query, true);
				}
				if (todo.description?.toLowerCase().includes(lowerQuery)) {
					matches.push({ field: 'description', snippet: createSnippet(todo.description, query) });
					relevance += calculateRelevance(todo.description, query, false);
				}
				if (matches.length > 0) {
					allScopeResults.push({ type: 'todo', item: todo, matches, relevance });
				}
			}

			const allLists = store.listLists({});
			for (const list of allLists) {
				const matches: SearchMatch[] = [];
				let relevance = 0;

				if (list.name.toLowerCase().includes(lowerQuery)) {
					matches.push({ field: 'name', snippet: createSnippet(list.name, query) });
					relevance += calculateRelevance(list.name, query, true);
				}
				if (list.description?.toLowerCase().includes(lowerQuery)) {
					matches.push({ field: 'description', snippet: createSnippet(list.description, query) });
					relevance += calculateRelevance(list.description, query, false);
				}
				if (matches.length > 0) {
					allScopeResults.push({ type: 'list', item: list, matches, relevance });
				}
			}

			if (allScopeResults.length > 0) {
				allScopeResults.sort((a, b) => b.relevance - a.relevance);
				const allTotalTodos = allScopeResults.filter((r) => r.type === 'todo').length;
				const allTotalLists = allScopeResults.filter((r) => r.type === 'list').length;

				alternatives.push({
					data: {
						results: allScopeResults.slice(0, limit),
						query,
						totalTodos: allTotalTodos,
						totalLists: allTotalLists,
						total: allScopeResults.length,
						hasMore: allScopeResults.length > limit,
					},
					reason: `Search all (found ${allScopeResults.length} results)`,
					confidence: 0.9,
				});
			}
		}

		// If filtering by completed status, offer the opposite
		if (completed !== undefined && scope !== 'lists') {
			const oppositeTodos = store.list({ completed: !completed, priority: numericPriority });
			const oppositeResults: SearchResultItem[] = [];

			for (const todo of oppositeTodos) {
				const matches: SearchMatch[] = [];
				let relevance = 0;

				if (todo.title.toLowerCase().includes(lowerQuery)) {
					matches.push({ field: 'title', snippet: createSnippet(todo.title, query) });
					relevance += calculateRelevance(todo.title, query, true);
				}
				if (todo.description?.toLowerCase().includes(lowerQuery)) {
					matches.push({ field: 'description', snippet: createSnippet(todo.description, query) });
					relevance += calculateRelevance(todo.description, query, false);
				}
				if (matches.length > 0) {
					oppositeResults.push({ type: 'todo', item: todo, matches, relevance });
				}
			}

			if (oppositeResults.length > 0) {
				oppositeResults.sort((a, b) => b.relevance - a.relevance);
				alternatives.push({
					data: {
						results: oppositeResults.slice(0, limit),
						query,
						totalTodos: oppositeResults.length,
						totalLists: 0,
						total: oppositeResults.length,
						hasMore: oppositeResults.length > limit,
					},
					reason: `Search ${completed ? 'pending' : 'completed'} todos (${oppositeResults.length} results)`,
					confidence: 0.8,
				});
			}
		}

		return success(
			{
				results: paginatedResults,
				query,
				totalTodos,
				totalLists,
				total,
				hasMore,
			},
			{
				reasoning,
				confidence: total > 0 ? 1.0 : 0.5,
				alternatives: alternatives.length > 0 ? alternatives : undefined,
			}
		);
	},
});
