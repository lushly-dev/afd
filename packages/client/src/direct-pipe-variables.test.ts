/**
 * DirectClient.pipe conformance with spec/pipeline-variables.md. The caller's call context
 * must never be reachable through `$input` or any other reference.
 */
import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDirectClient, type DirectClient, type DirectRegistry } from './direct.js';

interface Call {
	name: string;
	input: unknown;
	context?: CommandContext;
}

class RecordingRegistry implements DirectRegistry {
	readonly calls: Call[] = [];

	async execute<T>(
		name: string,
		input?: unknown,
		context?: CommandContext
	): Promise<CommandResult<T>> {
		this.calls.push({ name, input, context });
		let data: unknown = input;
		if (name === 'user-get') data = { id: 'u-1', tier: 'premium', tags: ['a'] };
		if (name === 'mutate' && typeof input === 'object' && input !== null && 'user' in input) {
			const { user } = input;
			if (typeof user === 'object' && user !== null) Object.assign(user, { tier: 'mutated' });
		}
		return { success: true, data: data as T };
	}

	listCommandNames(): string[] {
		return ['user-get', 'echo', 'mutate'];
	}

	listCommands(): Array<{ name: string; description: string }> {
		return this.listCommandNames().map((name) => ({ name, description: name }));
	}

	hasCommand(name: string): boolean {
		return this.listCommandNames().includes(name);
	}
}

function nested(levels: number): Record<string, unknown> {
	let value: Record<string, unknown> = { leaf: '$prev' };
	for (let level = 1; level < levels; level++) value = { next: value };
	return value;
}

describe('DirectClient.pipe variable references', () => {
	let registry: RecordingRegistry;
	let client: DirectClient;

	beforeEach(() => {
		registry = new RecordingRegistry();
		client = createDirectClient(registry);
	});

	it('resolves $input to the request input', async () => {
		const result = await client.pipe({
			input: { userId: 'u-9', ids: [1, 2] },
			steps: [{ command: 'echo', input: { id: '$input.userId', second: '$input.ids[1]' } }],
		});
		expect(result.data).toEqual({ id: 'u-9', second: 2 });
	});

	it('does not expose the caller context through $input', async () => {
		const result = await client.pipe(
			[
				{
					command: 'echo',
					input: { all: '$input', token: '$input.token', trace: '$input.traceId' },
				},
			],
			{ traceId: 'trace-1', token: 'secret-token' }
		);
		expect(result.data).toEqual({});
		expect(registry.calls[0]?.input).toEqual({});
		// The context still reaches the command itself.
		expect(registry.calls[0]?.context).toMatchObject({ token: 'secret-token' });
	});

	it('passes literals through and unescapes $$', async () => {
		const result = await client.pipe([
			{ command: 'echo', input: { price: '$9.99', home: '$HOME', escaped: '$$prev', text: 'x' } },
		]);
		expect(result.data).toEqual({ price: '$9.99', home: '$HOME', escaped: '$prev', text: 'x' });
	});

	it('never follows prototype or __-prefixed paths', async () => {
		const result = await client.pipe([
			{ command: 'user-get', as: 'user' },
			{
				command: 'echo',
				input: {
					fn: '$prev.constructor.constructor',
					proto: '$steps.user.__proto__',
					cls: '$prev.__class__',
					length: '$prev.tags.length',
					tier: '$prev.tier',
				},
			},
		]);
		expect(result.data).toEqual({ tier: 'premium' });
	});

	it('omits unresolved references and uses null in arrays', async () => {
		const result = await client.pipe([
			{ command: 'user-get', as: 'user' },
			{
				command: 'echo',
				input: {
					alias: '$steps.nope',
					outOfBounds: '$steps.user.tags[5]',
					list: ['$steps.nope', '$steps.user.tags[0]', '$steps[9]'],
				},
			},
		]);
		expect(result.data).toEqual({ list: [null, 'a', null] });
	});

	it('rejects 65-level nesting with VALIDATION_ERROR before running any command', async () => {
		const result = await client.pipe([
			{ command: 'user-get' },
			{ command: 'echo', input: nested(65) },
		]);
		expect(registry.calls).toHaveLength(0);
		expect(result.steps[0]?.error?.code).toBe('VALIDATION_ERROR');
	});

	it('skips a step whose when condition reads an unresolved path', async () => {
		const result = await client.pipe([
			{ command: 'user-get' },
			{ command: 'echo', when: { $exists: '$prev.missing.path' } },
			{ command: 'echo', when: { $eq: ['$steps.nope', 'premium'] } },
		]);
		expect(result.steps.map((step) => step.status)).toEqual(['success', 'skipped', 'skipped']);
	});

	it('does not share step data by reference between steps', async () => {
		const result = await client.pipe([
			{ command: 'user-get', as: 'source' },
			{ command: 'mutate', input: { user: '$prev' } },
			{ command: 'echo', input: { user: '$steps.source' } },
		]);
		expect(result.steps[0]?.data).toEqual({ id: 'u-1', tier: 'premium', tags: ['a'] });
		expect(result.steps[1]?.data).toEqual({ user: { id: 'u-1', tier: 'mutated', tags: ['a'] } });
		expect(result.steps[2]?.data).toEqual({ user: { id: 'u-1', tier: 'premium', tags: ['a'] } });
	});
});
