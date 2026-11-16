/** @fileoverview The Gemini adapter: declarations from the MCP schemas, and contents round trips. */

import { describe, expect, it } from 'vitest';
import { categorizeError, toContents, toFunctionDeclaration } from './gemini.js';

describe('toFunctionDeclaration', () => {
	it('passes the command schema through as JSON Schema, without $schema', () => {
		const parameters = {
			$schema: 'http://json-schema.org/draft-07/schema#',
			type: 'object',
			properties: { title: { type: 'string', minLength: 1 } },
			required: ['title'],
		};
		expect(
			toFunctionDeclaration({ name: 'todo-create', description: 'Create a todo', parameters })
		).toEqual({
			name: 'todo-create',
			description: 'Create a todo',
			parametersJsonSchema: {
				type: 'object',
				properties: { title: { type: 'string', minLength: 1 } },
				required: ['title'],
			},
		});
	});
});

describe('toContents', () => {
	it("sends a model turn's own parts back unchanged, thought signatures included", () => {
		const raw = [
			{ functionCall: { name: 'todo-list', args: {} }, thoughtSignature: 'c2lnbmF0dXJl' },
		];
		const contents = toContents([
			{ role: 'user', text: 'What is left?' },
			{ role: 'model', reply: { calls: [{ name: 'todo-list', args: {} }], raw } },
			{ role: 'tool', results: [{ name: 'todo-list', result: { success: true } }] },
		]);
		expect(contents).toEqual([
			{ role: 'user', parts: [{ text: 'What is left?' }] },
			{ role: 'model', parts: raw },
			{
				role: 'user',
				parts: [{ functionResponse: { name: 'todo-list', response: { success: true } } }],
			},
		]);
	});
});

describe('categorizeError', () => {
	it('gives the person a plain message, never the provider error', () => {
		const error = categorizeError(new Error('429 Resource exhausted for key AIza-secret'));
		expect(error.category).toBe('rate_limit');
		expect(error.retryable).toBe(true);
		expect(error.message).not.toContain('AIza');
		expect(categorizeError(new Error('boom')).retryable).toBe(false);
	});
});
