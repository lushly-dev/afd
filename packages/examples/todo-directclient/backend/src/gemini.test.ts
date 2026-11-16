/** @fileoverview The Gemini adapter: declarations from the MCP schemas, and contents round trips. */

import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { categorizeError, GeminiModel, toContents, toFunctionDeclaration } from './gemini.js';

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

describe('GeminiModel.respond', () => {
	const request = {
		system: 'Be brief.',
		messages: [{ role: 'user' as const, text: 'What is left?' }],
		tools: [{ name: 'todo-list', description: 'List todos', parameters: { type: 'object' } }],
	};

	function model(reply: unknown, seen: GenerateContentParameters[] = []) {
		return new GeminiModel({
			apiKey: 'unused-in-tests',
			maxRetries: 0,
			generateContent: async (params) => {
				seen.push(params);
				return reply as GenerateContentResponse;
			},
		});
	}

	it('reads the text and calls, leaving thoughts out and keeping call ids', async () => {
		const parts = [
			{ text: 'Planning the call', thought: true },
			{ functionCall: { id: 'fc-1', name: 'todo-list', args: { completed: false } } },
			{ text: 'Checking.' },
		];
		const seen: GenerateContentParameters[] = [];
		const cancel = new AbortController();
		const reply = await model({ candidates: [{ content: { parts } }] }, seen).respond({
			...request,
			signal: cancel.signal,
		});

		expect(reply).toEqual({
			text: 'Checking.',
			calls: [{ id: 'fc-1', name: 'todo-list', args: { completed: false } }],
			raw: parts,
		});
		expect(seen[0]?.config).toMatchObject({
			systemInstruction: 'Be brief.',
			abortSignal: cancel.signal,
			tools: [{ functionDeclarations: [{ name: 'todo-list' }] }],
		});
	});

	it('says why when Gemini gives no answer, rather than reporting success', async () => {
		await expect(
			model({ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }).respond(request)
		).rejects.toThrow('Gemini gave no answer (SAFETY)');
	});
});
