/**
 * @fileoverview Unit tests for constraints commands
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditListCommand } from '../audit/list.js';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { tokenOverrideCommand } from '../token/override.js';
import { listCommand as constraintsListCommand } from './list.js';
import { setCommand as constraintsSetCommand } from './set.js';
import { validateCommand as constraintsValidateCommand } from './validate.js';

describe('constraints commands', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		// Set up test hierarchy: global -> xbox -> xbox-web
		await nodeCreateCommand.handler({ name: 'global', type: 'root', parentId: null }, context);
		await nodeCreateCommand.handler({ name: 'xbox', type: 'product', parentId: 'global' }, context);
		await nodeCreateCommand.handler(
			{ name: 'xbox-web', type: 'platform', parentId: 'xbox' },
			context,
		);

		// Add base tokens at global
		await tokenAddCommand.handler(
			{ nodeId: 'global', tokenId: 'color.primary', value: '#0078D4' },
			context,
		);
		await tokenAddCommand.handler(
			{ nodeId: 'global', tokenId: 'color.secondary', value: '#106EBE' },
			context,
		);
		await tokenAddCommand.handler(
			{ nodeId: 'global', tokenId: 'spacing.base', value: '8' },
			context,
		);
		await tokenAddCommand.handler(
			{ nodeId: 'global', tokenId: 'font.size.body', value: '16' },
			context,
		);

		// Override at xbox level
		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.primary', value: '#107C10' },
			context,
		);
	});

	describe('constraints.set', () => {
		it('should set a constraint on a node', async () => {
			const result = await constraintsSetCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{
							id: 'brand-colors',
							name: 'Brand Colors',
							config: {
								type: 'enum',
								values: ['#0078D4', '#106EBE', '#107C10'],
							},
							severity: 'error',
							applyTo: 'color.*',
						},
					],
				},
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.constraintsSet).toBe(1);
			expect(result.data?.totalConstraints).toBe(1);
		});

		it('should merge constraints when merge flag is true', async () => {
			// Set initial constraint
			await constraintsSetCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{
							id: 'brand-colors',
							name: 'Brand Colors',
							config: { type: 'enum', values: ['#0078D4'] },
							severity: 'error',
							applyTo: 'color.*',
						},
					],
				},
				context,
			);

			// Merge with new constraint
			const result = await constraintsSetCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{
							id: 'spacing-grid',
							name: 'Spacing Grid',
							config: { type: 'scale', base: 8 },
							severity: 'warning',
							applyTo: 'spacing.*',
						},
					],
					merge: true,
				},
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.constraintsSet).toBe(1);
			expect(result.data?.totalConstraints).toBe(2); // Both constraints exist
		});

		it('should replace constraints when merge flag is false', async () => {
			// Set initial constraint
			await constraintsSetCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{
							id: 'brand-colors',
							name: 'Brand Colors',
							config: { type: 'enum', values: ['#0078D4'] },
							severity: 'error',
							applyTo: 'color.*',
						},
					],
				},
				context,
			);

			// Replace with new constraint (merge: false is default)
			const result = await constraintsSetCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{
							id: 'spacing-grid',
							name: 'Spacing Grid',
							config: { type: 'scale', base: 8 },
							severity: 'warning',
							applyTo: 'spacing.*',
						},
					],
					merge: false,
				},
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.constraintsSet).toBe(1);
			expect(result.data?.totalConstraints).toBe(1); // Only new constraint
		});

		it('should fail for non-existent node', async () => {
			const result = await constraintsSetCommand.handler(
				{
					nodeId: 'nonexistent',
					constraints: [
						{
							id: 'test',
							name: 'Test',
							config: { type: 'enum', values: ['test'] },
							severity: 'error',
							applyTo: '*',
						},
					],
				},
				context,
			);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('NODE_NOT_FOUND');
		});

		it('records audit events on replace and merge: true, visible in audit.list (#2329)', async () => {
			const colorRule = {
				id: 'brand-colors',
				name: 'Brand Colors',
				config: { type: 'enum' as const, values: ['#0078D4'] },
				severity: 'error' as const,
				applyTo: 'color.*',
			};
			const spacingRule = {
				id: 'spacing-grid',
				name: 'Spacing Grid',
				config: { type: 'scale' as const, base: 8 },
				severity: 'warning' as const,
				applyTo: 'spacing.*',
			};
			const aliceContext: CommandContext = { ...context, actor: 'alice' };
			const bobContext: CommandContext = { ...context, actor: 'bob' };

			// 1. Replace from empty
			const first = await constraintsSetCommand.handler(
				{ nodeId: 'global', constraints: [colorRule] },
				aliceContext,
			);
			expect(first.success).toBe(true);

			// 2. Merge an additional rule
			const merged = await constraintsSetCommand.handler(
				{ nodeId: 'global', constraints: [spacingRule], merge: true },
				bobContext,
			);
			expect(merged.success).toBe(true);

			// 3. Replace back to empty
			const cleared = await constraintsSetCommand.handler(
				{ nodeId: 'global', constraints: [], merge: false },
				aliceContext,
			);
			expect(cleared.success).toBe(true);

			const audit = await auditListCommand.handler(
				{ nodeId: 'global', eventTypes: ['constraint_set'] },
				context,
			);
			expect(audit.success).toBe(true);
			expect(audit.data?.summary.total).toBe(3);
			expect(audit.data?.summary.byType).toEqual({ constraint_set: 3 });

			// audit.list returns newest first
			const [evClear, evMerge, evFirst] = audit.data?.events ?? [];
			expect(evFirst).toMatchObject({
				eventType: 'constraint_set',
				actor: 'alice',
				targetNode: 'global',
				oldValue: [],
				newValue: [expect.objectContaining({ id: 'brand-colors', enabled: true })],
				metadata: { merge: false, constraintsSet: 1, totalConstraints: 1 },
			});
			expect(evFirst?.targetToken).toBeUndefined();

			expect(evMerge).toMatchObject({
				eventType: 'constraint_set',
				actor: 'bob',
				targetNode: 'global',
				oldValue: [expect.objectContaining({ id: 'brand-colors' })],
				newValue: [
					expect.objectContaining({ id: 'brand-colors' }),
					expect.objectContaining({
						id: 'spacing-grid',
						config: { type: 'scale', base: 8, tolerance: 0 },
					}),
				],
				metadata: { merge: true, constraintsSet: 1, totalConstraints: 2 },
			});

			expect(evClear).toMatchObject({
				eventType: 'constraint_set',
				actor: 'alice',
				targetNode: 'global',
				oldValue: [
					expect.objectContaining({ id: 'brand-colors' }),
					expect.objectContaining({ id: 'spacing-grid' }),
				],
				newValue: [],
				metadata: { merge: false, constraintsSet: 0, totalConstraints: 0 },
			});
		});

		it('does not record an audit event when validation fails (#2329)', async () => {
			const before = await auditListCommand.handler({ eventTypes: ['constraint_set'] }, context);
			expect(before.data?.summary.total).toBe(0);

			// Missing node
			await constraintsSetCommand.handler(
				{
					nodeId: 'missing',
					constraints: [
						{
							id: 'r1',
							name: 'R1',
							config: { type: 'enum', values: ['a'] },
							applyTo: '*',
						},
					],
				},
				context,
			);
			// Duplicate IDs
			await constraintsSetCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{ id: 'dup', name: 'A', config: { type: 'enum', values: ['a'] }, applyTo: '*' },
						{ id: 'dup', name: 'B', config: { type: 'enum', values: ['b'] }, applyTo: '*' },
					],
				},
				context,
			);
			// Catastrophic regex
			await constraintsSetCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{
							id: 'bad-re',
							name: 'Bad',
							config: { type: 'pattern', pattern: '^(a+)+$' },
							applyTo: '*',
						},
					],
				},
				context,
			);

			const after = await auditListCommand.handler({ eventTypes: ['constraint_set'] }, context);
			expect(after.data?.summary.total).toBe(0);
		});

		it('rolls back constraints and returns a failure with suggestion when addAuditEvent throws (#2329)', async () => {
			const initialRule = {
				id: 'initial-rule',
				name: 'Initial rule',
				config: { type: 'enum' as const, values: ['#0078D4'] },
				severity: 'error' as const,
				applyTo: 'color.*',
			};
			expect(
				(
					await constraintsSetCommand.handler(
						{ nodeId: 'global', constraints: [initialRule] },
						context,
					)
				).success,
			).toBe(true);

			const failingDb = new Proxy(db, {
				get(target, key) {
					if (key === 'addAuditEvent') {
						return async () => {
							throw new Error('simulated audit write failure');
						};
					}
					const value = Reflect.get(target, key, target);
					return typeof value === 'function' ? value.bind(target) : value;
				},
			});

			const failed = await constraintsSetCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{
							id: 'replacement-rule',
							name: 'Replacement rule',
							config: { type: 'scale', base: 8 },
							severity: 'warning',
							applyTo: 'spacing.*',
						},
					],
				},
				{ ...context, db: failingDb },
			);
			expect(failed.success).toBe(false);
			expect(failed.error?.code).toBe('INTERNAL_ERROR');
			expect(failed.error?.message).toContain('simulated audit write failure');
			expect(failed.error?.suggestion).toBeTruthy();

			// Previous constraints remain intact and no second constraint_set event was recorded
			expect(await db.getConstraints('global')).toEqual([
				expect.objectContaining({ id: 'initial-rule' }),
			]);
			const audit = await auditListCommand.handler(
				{ nodeId: 'global', eventTypes: ['constraint_set'] },
				context,
			);
			expect(audit.data?.summary.total).toBe(1);
		});

		it('stamps constraint_set audit events deterministically from context now() and random() (#2329)', async () => {
			const runSequence = async () => {
				let tick = Date.UTC(2026, 5, 1, 12, 0, 0);
				let state = 1337;
				const deterministicContext: CommandContext = {
					db: createMemoryDatabase(),
					actor: 'replay-agent',
					now: () => {
						const current = tick;
						tick += 1000;
						return current;
					},
					random: () => {
						state = (state * 48271) % 2147483647;
						return state / 2147483647;
					},
				};
				await nodeCreateCommand.handler(
					{ name: 'root', type: 'root', parentId: null },
					deterministicContext,
				);
				await constraintsSetCommand.handler(
					{
						nodeId: 'root',
						constraints: [
							{
								id: 'c1',
								name: 'Contrast',
								config: { type: 'contrast', against: 'color.bg', min: 4.5 },
								applyTo: 'color.text.*',
							},
						],
					},
					deterministicContext,
				);
				await constraintsSetCommand.handler(
					{
						nodeId: 'root',
						merge: true,
						constraints: [
							{
								id: 'c2',
								name: 'Space ramp',
								config: { type: 'ramp', ramp: 'ref.space.*', repeatThreshold: 2 },
								applyTo: 'space.*',
							},
						],
					},
					deterministicContext,
				);
				const audit = await auditListCommand.handler(
					{ nodeId: 'root', eventTypes: ['constraint_set'] },
					deterministicContext,
				);
				return audit.data?.events ?? [];
			};

			const first = await runSequence();
			const second = await runSequence();
			expect(first).toHaveLength(2);
			expect(second).toEqual(first);
			expect(first[0]?.timestamp).toBe('2026-06-01T12:00:02.000Z');
			expect(first[1]?.timestamp).toBe('2026-06-01T12:00:01.000Z');
		});
	});

	describe('constraints.list', () => {
		beforeEach(async () => {
			// Set constraints at global level
			await constraintsSetCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{
							id: 'brand-colors',
							name: 'Brand Colors',
							config: {
								type: 'enum',
								values: ['#0078D4', '#106EBE', '#107C10'],
							},
							severity: 'error',
							applyTo: 'color.*',
						},
						{
							id: 'spacing-grid',
							name: 'Spacing Grid',
							config: { type: 'scale', base: 8 },
							severity: 'warning',
							applyTo: 'spacing.*',
						},
					],
				},
				context,
			);

			// Set constraints at xbox level
			await constraintsSetCommand.handler(
				{
					nodeId: 'xbox',
					constraints: [
						{
							id: 'xbox-brand',
							name: 'Xbox Brand Colors',
							config: { type: 'enum', values: ['#107C10'] },
							severity: 'error',
							applyTo: 'color.xbox.*',
						},
					],
				},
				context,
			);
		});

		it('should list constraints for a node', async () => {
			const result = await constraintsListCommand.handler({ nodeId: 'global' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.constraints).toHaveLength(2);
			expect(result.data?.constraints.map((c) => c.id)).toContain('brand-colors');
			expect(result.data?.constraints.map((c) => c.id)).toContain('spacing-grid');
		});

		it('should include inherited constraints when flag is true', async () => {
			const result = await constraintsListCommand.handler(
				{ nodeId: 'xbox', includeInherited: true },
				context,
			);

			expect(result.success).toBe(true);
			// Should have xbox-brand + inherited from global
			expect(result.data?.constraints.length).toBeGreaterThanOrEqual(3);
		});

		it('should filter to enabled constraints only', async () => {
			// Add a disabled constraint
			await constraintsSetCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{
							id: 'disabled-rule',
							name: 'Disabled Rule',
							config: { type: 'enum', values: ['test'] },
							severity: 'info',
							applyTo: '*',
							enabled: false,
						},
					],
					merge: true,
				},
				context,
			);

			const result = await constraintsListCommand.handler(
				{ nodeId: 'global', enabledOnly: true },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.constraints.every((c) => c.enabled !== false)).toBe(true);
		});

		it('should fail for non-existent node', async () => {
			const result = await constraintsListCommand.handler({ nodeId: 'nonexistent' }, context);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('NODE_NOT_FOUND');
		});
	});

	describe('constraints.validate', () => {
		beforeEach(async () => {
			// Set up constraints
			await constraintsSetCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{
							id: 'brand-colors',
							name: 'Brand Colors',
							config: {
								type: 'enum',
								values: ['#0078D4', '#106EBE', '#107C10', '#2DA562', '#FFB900'],
							},
							severity: 'error',
							applyTo: 'color.*',
						},
						{
							id: 'spacing-grid',
							name: 'Spacing Grid',
							config: { type: 'scale', base: 8 },
							severity: 'warning',
							applyTo: 'spacing.*',
						},
					],
				},
				context,
			);
		});

		it('should validate tokens against constraints', async () => {
			const result = await constraintsValidateCommand.handler({ nodeId: 'global' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.nodeId).toBe('global');
			expect(result.data?.valid).toBe(true);
			expect(result.data?.summary).toBeDefined();
		});

		it('should detect enum violations', async () => {
			// Add invalid color
			await tokenAddCommand.handler(
				{ nodeId: 'global', tokenId: 'color.error', value: '#FF0000' },
				context,
			);

			const result = await constraintsValidateCommand.handler({ nodeId: 'global' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.valid).toBe(false);
			expect(result.data?.summary.errors).toBeGreaterThan(0);
		});

		it('should detect scale violations', async () => {
			// Add invalid spacing (5 is not multiple of 8)
			await tokenAddCommand.handler(
				{ nodeId: 'global', tokenId: 'spacing.invalid', value: '5' },
				context,
			);

			const result = await constraintsValidateCommand.handler({ nodeId: 'global' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.summary.warnings).toBeGreaterThan(0);
		});

		it('should validate child node with inherited constraints', async () => {
			const result = await constraintsValidateCommand.handler({ nodeId: 'xbox' }, context);

			expect(result.success).toBe(true);
			// Xbox has valid colors, should pass inherited constraints
		});

		it('should filter validation to specific tokens', async () => {
			// Add both valid and invalid tokens
			await tokenAddCommand.handler(
				{ nodeId: 'global', tokenId: 'color.error', value: '#FF0000' },
				context,
			);
			await tokenAddCommand.handler(
				{ nodeId: 'global', tokenId: 'spacing.invalid', value: '5' },
				context,
			);

			// Only check color tokens
			const result = await constraintsValidateCommand.handler(
				{ nodeId: 'global', filter: 'spacing.*' },
				context,
			);

			expect(result.success).toBe(true);
			// Should only report spacing issues
			const results = result.data?.results || [];
			expect(results.every((r) => r.tokenId.startsWith('spacing.'))).toBe(true);
		});
	});

	describe('validator types', () => {
		it('should validate range constraints', async () => {
			await constraintsSetCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{
							id: 'font-size-range',
							name: 'Font Size Range',
							config: { type: 'range', min: 12, max: 48 },
							severity: 'error',
							applyTo: 'font.size.*',
						},
					],
				},
				context,
			);

			const result = await constraintsValidateCommand.handler({ nodeId: 'global' }, context);

			expect(result.success).toBe(true);
			// font.size.body = 16, which is within range
			expect(result.data?.valid).toBe(true);
		});

		it('should detect range violations', async () => {
			await constraintsSetCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{
							id: 'font-size-range',
							name: 'Font Size Range',
							config: { type: 'range', min: 12, max: 14 },
							severity: 'error',
							applyTo: 'font.size.*',
						},
					],
				},
				context,
			);

			const result = await constraintsValidateCommand.handler({ nodeId: 'global' }, context);

			expect(result.success).toBe(true);
			// font.size.body = 16, which is outside range (max 14)
			expect(result.data?.valid).toBe(false);
			expect(result.data?.summary.errors).toBeGreaterThan(0);
		});

		it('should validate pattern constraints', async () => {
			await constraintsSetCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{
							id: 'hex-colors',
							name: 'Hex Colors',
							config: { type: 'pattern', pattern: '^#[0-9A-Fa-f]{6}$' },
							severity: 'error',
							applyTo: 'color.*',
						},
					],
				},
				context,
			);

			const result = await constraintsValidateCommand.handler({ nodeId: 'global' }, context);

			expect(result.success).toBe(true);
			// All colors are valid hex
			expect(result.data?.valid).toBe(true);
		});

		it('should detect pattern violations', async () => {
			await tokenAddCommand.handler(
				{ nodeId: 'global', tokenId: 'color.invalid', value: 'red' },
				context,
			);

			await constraintsSetCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{
							id: 'hex-colors',
							name: 'Hex Colors',
							config: { type: 'pattern', pattern: '^#[0-9A-Fa-f]{6}$' },
							severity: 'error',
							applyTo: 'color.*',
						},
					],
				},
				context,
			);

			const result = await constraintsValidateCommand.handler({ nodeId: 'global' }, context);

			expect(result.success).toBe(true);
			// "red" doesn't match hex pattern
			expect(result.data?.valid).toBe(false);
		});

		it('should validate reference constraints', async () => {
			await constraintsSetCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{
							id: 'primary-exists',
							name: 'Primary Color Must Exist',
							config: { type: 'reference', token: 'color.primary' },
							severity: 'error',
							applyTo: 'color.secondary',
						},
					],
				},
				context,
			);

			const result = await constraintsValidateCommand.handler({ nodeId: 'global' }, context);

			expect(result.success).toBe(true);
			// color.primary exists, so reference is valid
		});
	});
});
