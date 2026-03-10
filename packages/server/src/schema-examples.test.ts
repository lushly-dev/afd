/**
 * @fileoverview Tests for schema examples feature
 *
 * Tests verify:
 * - Examples pass through defineCommand to ZodCommandDefinition
 * - Examples appear in toCommandDefinition() output
 * - Invalid examples throw at define-time
 * - Examples are type-safe (compile-time, not tested here)
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from './schema.js';

// ═══════════════════════════════════════════════════════════════════════════════
// defineCommand with examples
// ═══════════════════════════════════════════════════════════════════════════════

describe('defineCommand examples', () => {
	it('stores examples on ZodCommandDefinition', () => {
		const cmd = defineCommand({
			name: 'todo-create',
			description: 'Creates a new todo item',
			input: z.object({
				title: z.string(),
				priority: z.enum(['low', 'medium', 'high']).optional(),
			}),
			examples: [
				{ title: 'Simple todo', input: { title: 'Buy milk' } },
				{ title: 'With priority', input: { title: 'Fix bug', priority: 'high' } },
			],
			handler: async (input) => ({ success: true, data: input }),
		});

		expect(cmd.examples).toHaveLength(2);
		expect(cmd.examples?.[0]?.title).toBe('Simple todo');
		expect(cmd.examples?.[0]?.input).toEqual({ title: 'Buy milk' });
		expect(cmd.examples?.[1]?.input).toEqual({ title: 'Fix bug', priority: 'high' });
	});

	it('passes examples through toCommandDefinition()', () => {
		const cmd = defineCommand({
			name: 'todo-list',
			description: 'Lists all todo items',
			input: z.object({
				filter: z.enum(['all', 'active', 'done']).optional(),
			}),
			examples: [
				{ title: 'List all', input: {} },
				{ title: 'Active only', input: { filter: 'active' } },
			],
			handler: async () => ({ success: true, data: [] }),
		});

		const def = cmd.toCommandDefinition();
		expect(def.examples).toHaveLength(2);
		expect(def.examples?.[0]?.title).toBe('List all');
		expect(def.examples?.[1]?.input).toEqual({ filter: 'active' });
	});

	it('allows commands without examples', () => {
		const cmd = defineCommand({
			name: 'todo-delete',
			description: 'Deletes a todo item',
			input: z.object({ id: z.string() }),
			handler: async () => ({ success: true, data: null }),
		});

		expect(cmd.examples).toBeUndefined();
		expect(cmd.toCommandDefinition().examples).toBeUndefined();
	});

	it('throws for invalid example input at define-time', () => {
		expect(() =>
			defineCommand({
				name: 'todo-create',
				description: 'Creates a new todo item',
				input: z.object({
					title: z.string(),
					priority: z.enum(['low', 'medium', 'high']),
				}),
				examples: [
					{
						title: 'Invalid priority',
						// @ts-expect-error — intentionally invalid for runtime test
						input: { title: 'Test', priority: 'urgent' },
					},
				],
				handler: async (input) => ({ success: true, data: input }),
			})
		).toThrow(/Example "Invalid priority" for command "todo-create" fails schema validation/);
	});

	it('throws with specific field errors for invalid examples', () => {
		expect(() =>
			defineCommand({
				name: 'user-create',
				description: 'Creates a user account',
				input: z.object({
					email: z.string().email(),
					age: z.number().min(0),
				}),
				examples: [
					{
						title: 'Bad email',
						input: { email: 'not-an-email', age: 5 },
					},
				],
				handler: async (input) => ({ success: true, data: input }),
			})
		).toThrow(/email/);
	});

	it('validates all examples, not just the first', () => {
		expect(() =>
			defineCommand({
				name: 'todo-create',
				description: 'Creates a new todo item',
				input: z.object({ title: z.string().min(1) }),
				examples: [
					{ title: 'Valid', input: { title: 'Buy milk' } },
					{ title: 'Empty title', input: { title: '' } },
				],
				handler: async (input) => ({ success: true, data: input }),
			})
		).toThrow(/Example "Empty title"/);
	});

	it('accepts examples for discriminated union schemas', () => {
		const cmd = defineCommand({
			name: 'auth-sign-in',
			description: 'Authenticates with credentials or OAuth provider',
			input: z.discriminatedUnion('method', [
				z.object({
					method: z.literal('credentials'),
					email: z.string().email(),
					password: z.string(),
				}),
				z.object({
					method: z.literal('oauth'),
					provider: z.enum(['google', 'github']),
				}),
			]),
			examples: [
				{
					title: 'Email/password',
					input: { method: 'credentials', email: 'user@example.com', password: 'secret' },
				},
				{
					title: 'Google OAuth',
					input: { method: 'oauth', provider: 'google' },
				},
			],
			handler: async (input) => ({ success: true, data: input }),
		});

		expect(cmd.examples).toHaveLength(2);
	});
});
