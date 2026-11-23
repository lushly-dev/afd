/**
 * @fileoverview Unit tests for the Violet JTBD scenario fixture adapter (`app: 'violet'`).
 */

import {
	type CommandResult,
	applyFixture,
	getAdapter,
	registerAdapter,
} from '@lushly-dev/afd-testing';
import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeCore, registry } from '../src/index.js';
import { createVioletAdapter, violetAdapter } from './violet-adapter.js';

describe('violet scenario fixture adapter', () => {
	beforeAll(() => {
		initializeCore();
		if (!getAdapter('violet')) {
			registerAdapter(violetAdapter);
		}
	});

	it('registers under app name "violet" and exposes command/error metadata', () => {
		expect(getAdapter('violet')?.name).toBe('violet');
		expect(violetAdapter.commands.list()).toContain('constraints.validate');
		expect(violetAdapter.errors.list()).toContain('TOKEN_REFERENCE_NOT_FOUND');
		expect(violetAdapter.commands.getDescription?.('token.add')).toBeTruthy();
	});

	it('validates fixture payloads and reports schema errors', async () => {
		const valid = await violetAdapter.fixture.validate?.({
			app: 'violet',
			nodes: [{ id: 'root', type: 'product', parentId: null }],
			tokens: {
				root: {
					'ref.space.8': { value: '8px', tier: 'global' },
				},
			},
			constraints: {},
		});
		expect(valid).toEqual({ valid: true });

		const invalid = await violetAdapter.fixture.validate?.({
			app: 'other-app',
			nodes: [{ id: '' }],
		});
		expect(invalid?.valid).toBe(false);
		expect(invalid?.errors?.length).toBeGreaterThan(0);
	});

	it('seeds nodes, tokens (add on root, override on descendants), and constraints', async () => {
		const db = createMemoryDatabase();
		const handler = (command: string, input?: Record<string, unknown>) =>
			registry.execute(command, input ?? {}, { db, actor: 'fixture-test' }) as Promise<
				CommandResult<unknown>
			>;

		const applied = await applyFixture(
			{
				app: 'violet',
				nodes: [
					{ id: 'studio', type: 'product', parentId: null },
					{ id: 'studio/compact', type: 'custom', parentId: 'studio' },
				],
				tokens: {
					studio: {
						'ref.space.4': { value: '4px', tier: 'global' },
						'ref.space.8': { value: '8px', tier: 'global' },
						'space.inline.group': { value: { ref: 'ref.space.8' }, tier: 'semantic' },
					},
					'studio/compact': {
						'space.inline.group': {
							value: { ref: 'ref.space.4' },
							reason: 'Tighter compact rhythm',
						},
					},
				},
				constraints: {
					studio: [
						{
							id: 'space-ramp',
							name: 'Spacing ramp',
							applyTo: 'space.*',
							severity: 'error',
							config: { type: 'ramp', ramp: 'ref.space.*' },
						},
					],
				},
			},
			handler,
		);

		expect(applied.success).toBe(true);
		expect(applied.appliedCommands.map((c) => c.command)).toEqual([
			'node.create',
			'node.create',
			'token.add',
			'token.add',
			'token.add',
			'token.override',
			'constraints.set',
		]);

		const resolved = await registry.execute(
			'tokens.resolve',
			{ nodeId: 'studio/compact', filter: 'space.inline.group' },
			{ db },
		);
		expect(resolved.success).toBe(true);
		const data = resolved.data as {
			tokens: Array<{ resolvedValue: string; aliasOf?: string; reason?: string }>;
		};
		expect(data.tokens[0]).toMatchObject({
			resolvedValue: '4px',
			aliasOf: 'ref.space.4',
			reason: 'Tighter compact rhythm',
		});
	});

	it('seeds tokens in parent-first node order even when child token keys precede parent keys', async () => {
		const db = createMemoryDatabase();
		const handler = (command: string, input?: Record<string, unknown>) =>
			registry.execute(command, input ?? {}, { db, actor: 'fixture-test' }) as Promise<
				CommandResult<unknown>
			>;

		const applied = await applyFixture(
			{
				app: 'violet',
				nodes: [
					{ id: 'studio', type: 'product', parentId: null },
					{ id: 'studio/compact', type: 'custom', parentId: 'studio' },
				],
				tokens: {
					'studio/compact': {
						'space.inline.group': { value: '6px', reason: 'Compact spacing' },
					},
					studio: {
						'space.inline.group': { value: '8px', tier: 'semantic' },
					},
				},
			},
			handler,
		);

		expect(applied.success).toBe(true);
		expect(applied.appliedCommands.map((c) => [c.command, c.input?.nodeId])).toEqual([
			['node.create', undefined],
			['node.create', undefined],
			['token.add', 'studio'],
			['token.override', 'studio/compact'],
		]);
		const resolved = await registry.execute(
			'tokens.resolve',
			{ nodeId: 'studio/compact', filter: 'space.inline.group' },
			{ db },
		);
		const data = resolved.data as { tokens: Array<{ resolvedValue: string; reason?: string }> };
		expect(data.tokens[0]).toMatchObject({ resolvedValue: '6px', reason: 'Compact spacing' });
	});

	it('fails fixture application cleanly when a fixture command fails', async () => {
		const db = createMemoryDatabase();
		const handler = (command: string, input?: Record<string, unknown>) =>
			registry.execute(command, input ?? {}, { db, actor: 'fixture-test' }) as Promise<
				CommandResult<unknown>
			>;

		const applied = await applyFixture(
			{
				app: 'violet',
				nodes: [{ id: 'child', parentId: 'missing-parent' }],
			},
			handler,
		);

		expect(applied.success).toBe(false);
		expect(applied.error).toContain('node.create');
	});

	it('invokes custom onReset hook when provided', async () => {
		const onReset = vi.fn();
		const adapter = createVioletAdapter({ onReset });
		await adapter.fixture.reset({ cli: 'violet' });
		expect(onReset).toHaveBeenCalledTimes(1);
	});
});
