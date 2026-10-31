/**
 * @fileoverview Unit tests for constraints commands
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
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
