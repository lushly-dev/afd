/**
 * @fileoverview Scales regression tests (#2195, #2198):
 * - constraints.set ramp handler validation (ramp, repeatThreshold >= 2, warnUneven.maxRatioSpread > 1)
 * - constraints.validate onlyViolating & multi-violation severities
 * - analyze.violations multi-node ramp errors + advisory warnings
 * - changes.impact reason on add/override, reason-only diffViolations, and error+warning diff
 * - import.json / import.tree reason: null default, $extensions reason, and legacy sentinel handling
 * - interface.check leaked private-prefix and global-tier detection
 */

import { LEGACY_IMPORT_REASON, createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { interfaceCheckCommand } from '../analyze/interface.js';
import { compareIssues, recordCheckSnapshot } from '../analyze/snapshot.js';
import { analyzeViolationsCommand } from '../analyze/violations.js';
import { changesImpactCommand } from '../changes/impact.js';
import { importJsonCommand } from '../import/json.js';
import { importTreeCommand } from '../import/tree.js';
import { nodeCreateCommand } from '../node/create.js';
import { type CommandContext, CommandRegistry } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { tokenOverrideCommand } from '../token/override.js';
import { tokensResolveCommand } from '../token/resolve.js';
import { setCommand as constraintsSetCommand } from './set.js';
import { validateCommand as constraintsValidateCommand } from './validate.js';

describe('Scales Phase 1 command regressions', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'scales-p1' };
		await nodeCreateCommand.handler(
			{ id: 'studio', name: 'studio', type: 'product', parentId: null, owner: 'design-sys' },
			context,
		);
		await nodeCreateCommand.handler(
			{ id: 'studio/light', name: 'studio/light', type: 'theme', parentId: 'studio', owner: 'web' },
			context,
		);
		await nodeCreateCommand.handler(
			{
				id: 'studio/dark',
				name: 'studio/dark',
				type: 'theme',
				parentId: 'studio',
				owner: 'web-dark',
			},
			context,
		);

		for (const [tokenId, value] of [
			['ref.space.4', '4px'],
			['ref.space.6', '6px'],
			['ref.space.8', '8px'],
		]) {
			await tokenAddCommand.handler(
				{ nodeId: 'studio', tokenId, value, metadata: { tier: 'global', category: 'spacing' } },
				context,
			);
		}

		await constraintsSetCommand.handler(
			{
				nodeId: 'studio',
				constraints: [
					{
						id: 'space-ramp',
						name: 'Spacing ramp',
						applyTo: 'space.*',
						severity: 'error',
						config: {
							type: 'ramp',
							ramp: 'ref.space.*',
							requireOffRampReason: true,
							repeatThreshold: 2,
						},
					},
				],
			},
			context,
		);
	});

	describe('constraints.set handler validation for type: "ramp"', () => {
		it('rejects empty ramp glob, repeatThreshold < 2, and warnUneven.maxRatioSpread <= 1 with field-specific suggestions', async () => {
			const reg = new CommandRegistry();
			reg.register(constraintsSetCommand);

			const emptyRamp = await reg.execute(
				'constraints.set',
				{
					nodeId: 'studio',
					merge: true,
					constraints: [
						{
							id: 'empty-ramp',
							name: 'Empty ramp',
							applyTo: 'space.*',
							severity: 'error',
							config: { type: 'ramp', ramp: '   ' },
						},
					],
				},
				context,
			);
			expect(emptyRamp.success).toBe(false);
			expect(emptyRamp.error?.code).toBe('VALIDATION_ERROR');
			expect(emptyRamp.error?.suggestion).toContain('ramp');

			const lowThreshold = await reg.execute(
				'constraints.set',
				{
					nodeId: 'studio',
					merge: true,
					constraints: [
						{
							id: 'bad-threshold',
							name: 'Bad threshold',
							applyTo: 'space.*',
							severity: 'error',
							config: { type: 'ramp', ramp: 'ref.space.*', repeatThreshold: 1 },
						},
					],
				},
				context,
			);
			expect(lowThreshold.success).toBe(false);
			expect(lowThreshold.error?.code).toBe('VALIDATION_ERROR');
			expect(lowThreshold.error?.suggestion).toContain('repeatThreshold');

			for (const badSpread of [1, 0, -0.5]) {
				const badUneven = await reg.execute(
					'constraints.set',
					{
						nodeId: 'studio',
						merge: true,
						constraints: [
							{
								id: 'bad-uneven',
								name: 'Bad uneven spread',
								applyTo: 'space.*',
								severity: 'error',
								config: {
									type: 'ramp',
									ramp: 'ref.space.*',
									warnUneven: { maxRatioSpread: badSpread },
								},
							},
						],
					},
					context,
				);
				expect(badUneven.success).toBe(false);
				expect(badUneven.error?.code).toBe('VALIDATION_ERROR');
				expect(badUneven.error?.suggestion).toContain('maxRatioSpread');
			}
		});
	});

	describe('constraints.validate onlyViolating & multi-node analyze.violations', () => {
		it('filters passing tokens with onlyViolating and reports multi-node ramp errors + warnings', async () => {
			await tokenAddCommand.handler(
				{
					nodeId: 'studio',
					tokenId: 'space.inline.group',
					value: { ref: 'ref.space.8' },
					metadata: { tier: 'semantic', category: 'spacing' },
				},
				context,
			);
			await tokenAddCommand.handler(
				{
					nodeId: 'studio',
					tokenId: 'space.inline.badge',
					value: '5px',
					metadata: { tier: 'semantic', category: 'spacing' },
				},
				context,
			);
			await tokenAddCommand.handler(
				{
					nodeId: 'studio/dark',
					tokenId: 'space.inline.chip',
					value: '5px',
					reason: 'Dark chip icon alignment',
					metadata: { tier: 'semantic', category: 'spacing' },
				},
				context,
			);

			const onlyViolating = await constraintsValidateCommand.handler(
				{ nodeId: 'studio/dark', onlyViolating: true },
				context,
			);
			expect(onlyViolating.success).toBe(true);
			expect(onlyViolating.data?.results.map((r) => r.tokenId).sort()).toEqual([
				'space.inline.badge',
				'space.inline.chip',
			]);
			expect(onlyViolating.data?.summary).toMatchObject({
				totalTokens: 6,
				validTokens: 5,
				errors: 1,
				warnings: 2,
			});

			const multi = await analyzeViolationsCommand.handler({ rootId: 'studio' }, context);
			expect(multi.success).toBe(true);
			expect(multi.data?.summary).toMatchObject({
				errors: 3, // space.inline.badge unreasoned on studio, studio/light, studio/dark
				warnings: 2, // space.inline.badge + space.inline.chip repeated on studio/dark
			});
			expect(multi.data?.violations.some((v) => v.code === 'ramp:unreasoned')).toBe(true);
			expect(multi.data?.violations.some((v) => v.code === 'ramp:repeat')).toBe(true);
		});

		it('returns a recovery suggestion when validating a soft-deleted node', async () => {
			await db.deleteNode('studio/dark');
			const deleted = await constraintsValidateCommand.handler({ nodeId: 'studio/dark' }, context);
			expect(deleted.success).toBe(false);
			expect(deleted.error?.code).toBe('NODE_NOT_FOUND');
			expect(deleted.error?.suggestion).toContain('node.list');
		});
	});

	describe('changes.impact reason support & violation diffing', () => {
		it('runs diffViolations on reason-only override and separates error vs warning by sub-check code', async () => {
			await tokenAddCommand.handler(
				{ nodeId: 'studio', tokenId: 'space.inline.badge', value: '5px' },
				context,
			);
			await tokenAddCommand.handler(
				{
					nodeId: 'studio',
					tokenId: 'space.inline.chip',
					value: '5px',
					reason: 'Matches chip icon box',
				},
				context,
			);

			// Reason-only override: value stays '5px', adds reason -> resolves ONLY ramp:unreasoned (error),
			// while ramp:repeat (warning) remains unresolved.
			const impact = await changesImpactCommand.handler(
				{
					nodeId: 'studio',
					changes: [
						{
							type: 'override',
							tokenId: 'space.inline.badge',
							value: '5px',
							reason: 'Optical badge gap',
						},
					],
				},
				context,
			);
			expect(impact.success).toBe(true);
			expect(impact.data?.apply[0]).toMatchObject({
				command: 'token.override',
				input: {
					nodeId: 'studio',
					tokenId: 'space.inline.badge',
					value: '5px',
					reason: 'Optical badge gap',
				},
			});
			expect(impact.data?.apply[0]?.cli).toContain("--reason 'Optical badge gap'");

			// All 3 nodes (studio, studio/light, studio/dark) had ramp:unreasoned resolved and 0 introduced
			expect(impact.data?.summary.violationsIntroduced).toBe(0);
			expect(impact.data?.summary.violationsResolved).toBe(3);
			for (const node of impact.data?.nodes ?? []) {
				expect(node.violations.resolved.map((v) => [v.tokenId, v.code, v.severity])).toEqual([
					['space.inline.badge', 'ramp:unreasoned', 'error'],
				]);
				expect(node.violations.introduced).toEqual([]);
			}

			// Previewing an add with reason also preserves reason in apply input and CLI
			const addImpact = await changesImpactCommand.handler(
				{
					nodeId: 'studio',
					changes: [
						{
							type: 'add',
							tokenId: 'space.inline.pill',
							value: '7px',
							reason: 'Pill icon gap',
						},
					],
				},
				context,
			);
			expect(addImpact.success).toBe(true);
			expect(addImpact.data?.apply[0]?.input).toMatchObject({ reason: 'Pill icon gap' });
			expect(addImpact.data?.apply[0]?.cli).toContain("--reason 'Pill icon gap'");
			expect(addImpact.data?.summary.violationsIntroduced).toBe(0);
		});

		it('runs diffViolations on a same-value reset that changes resolved reason', async () => {
			await tokenAddCommand.handler(
				{ nodeId: 'studio', tokenId: 'space.inline.badge', value: '5px' },
				context,
			);
			await tokenOverrideCommand.handler(
				{
					nodeId: 'studio/light',
					tokenId: 'space.inline.badge',
					value: '5px',
					reason: 'Light theme optical gap',
				},
				context,
			);

			// Resetting studio/light back to studio keeps '5px' but restores studio's missing reason
			const impact = await changesImpactCommand.handler(
				{
					nodeId: 'studio/light',
					changes: [{ type: 'reset', tokenId: 'space.inline.badge' }],
				},
				context,
			);
			expect(impact.success).toBe(true);
			expect(impact.data?.summary.violationsIntroduced).toBe(1);
			expect(
				impact.data?.nodes[0]?.violations.introduced.map((v) => [v.tokenId, v.code, v.severity]),
			).toEqual([['space.inline.badge', 'ramp:unreasoned', 'error']]);
		});
	});

	describe('analyze.snapshot multi-violation code keying', () => {
		it('records fixed ramp:unreasoned when ramp:repeat remains open and stays compatible with legacy snapshots', async () => {
			await tokenAddCommand.handler(
				{ nodeId: 'studio', tokenId: 'space.inline.badge', value: '5px' },
				context,
			);
			await tokenAddCommand.handler(
				{
					nodeId: 'studio',
					tokenId: 'space.inline.chip',
					value: '5px',
					reason: 'Chip optical alignment',
				},
				context,
			);

			const first = await recordCheckSnapshot(context, 'studio/light', '2026-11-22T12:00:00.000Z');
			expect(first.success).toBe(true);
			expect(first.data?.snapshot.counts).toEqual({ total: 3, error: 1, warning: 2, info: 0 });

			await tokenOverrideCommand.handler(
				{
					nodeId: 'studio',
					tokenId: 'space.inline.badge',
					value: '5px',
					reason: 'Badge optical alignment',
				},
				context,
			);
			const second = await recordCheckSnapshot(context, 'studio/light', '2026-11-23T12:00:00.000Z');
			expect(second.success).toBe(true);
			expect(second.data?.snapshot.counts).toEqual({ total: 2, error: 0, warning: 2, info: 0 });
			expect(second.data?.change).toMatchObject({ introduced: 0, fixed: 1 });

			// Older snapshots without `code` still compare equal to matching code-less issues
			expect(
				compareIssues(
					[
						{
							nodeId: 'studio',
							tokenId: 'color.text',
							constraintId: 'contrast',
							severity: 'error',
						},
					],
					[
						{
							nodeId: 'studio',
							tokenId: 'color.text',
							constraintId: 'contrast',
							severity: 'error',
						},
					],
				),
			).toEqual({ introduced: 0, fixed: 0 });
		});
	});

	describe('import.json & import.tree reason hygiene', () => {
		it('writes reason: null by default and reads $extensions["dev.lushly.violet"].reason', async () => {
			const json = JSON.stringify({
				space: {
					$type: 'dimension',
					unreasoned: { $value: '5px' },
					justified: {
						$value: '7px',
						$extensions: {
							'dev.lushly.violet': {
								category: 'spacing',
								reason: 'Matches compact toolbar border inset',
							},
						},
					},
				},
			});

			const imported = await importJsonCommand.handler(
				{ targetNode: 'studio', content: json },
				context,
			);
			expect(imported.success).toBe(true);

			const ops = await db.getOperations('studio');
			const unreasonedOp = ops.find((op) => op.tokenId === 'space.unreasoned');
			const justifiedOp = ops.find((op) => op.tokenId === 'space.justified');
			expect(unreasonedOp?.reason).toBeNull();
			expect(justifiedOp?.reason).toBe('Matches compact toolbar border inset');

			const validation = await constraintsValidateCommand.handler(
				{ nodeId: 'studio/light', filter: 'space.*', onlyViolating: true },
				context,
			);
			expect(validation.data?.results.map((r) => r.tokenId)).toEqual(['space.unreasoned']);
			expect(validation.data?.results[0]?.violations[0]?.code).toBe('ramp:unreasoned');
		});

		it('inherits reason: null default and extension reason in import.tree', async () => {
			const fresh: CommandContext = { db: createMemoryDatabase(), actor: 'test' };
			const result = await importTreeCommand.handler(
				{
					files: [
						{
							name: 'base.tokens.json',
							content: JSON.stringify({
								space: {
									$type: 'dimension',
									plain: { $value: '5px' },
									noted: {
										$value: '7px',
										$extensions: { 'dev.lushly.violet': { reason: 'Documented tree off-ramp' } },
									},
								},
							}),
						},
					],
				},
				fresh,
			);
			expect(result.success).toBe(true);
			const resolved = await tokensResolveCommand.handler({ nodeId: 'base' }, fresh);
			const byId = new Map(resolved.data?.tokens.map((t) => [t.id, t]));
			expect(byId.get('space.plain')?.reason).toBeUndefined();
			expect(byId.get('space.noted')?.reason).toBe('Documented tree off-ramp');
		});

		it('reads $extensions["dev.lushly.violet"].reason on Style Dictionary leaves too', async () => {
			const sdJson = JSON.stringify({
				space: {
					legacy: {
						value: '5px',
						$extensions: { 'dev.lushly.violet': { reason: 'Legacy SD leaf justification' } },
					},
				},
			});
			const imported = await importJsonCommand.handler(
				{ targetNode: 'studio', content: sdJson },
				context,
			);
			expect(imported.success).toBe(true);
			const resolved = await tokensResolveCommand.handler(
				{ nodeId: 'studio/light', filter: 'space.legacy' },
				context,
			);
			expect(resolved.data?.tokens[0]?.reason).toBe('Legacy SD leaf justification');
			const validation = await constraintsValidateCommand.handler(
				{ nodeId: 'studio/light', filter: 'space.legacy', onlyViolating: true },
				context,
			);
			expect(validation.data?.valid).toBe(true);
		});

		it('treats historical "Imported from JSON" sentinel as unreasoned in ramp validation', async () => {
			await db.appendOperation({
				id: 'legacy-op',
				nodeId: 'studio',
				type: 'add',
				tokenId: 'space.historical',
				value: JSON.stringify('5px'),
				metadata: JSON.stringify({ tier: 'semantic', category: 'spacing' }),
				fromNode: null,
				asTokenId: null,
				toAncestor: null,
				reason: LEGACY_IMPORT_REASON,
				author: 'import',
				createdAt: '2026-01-01T00:00:00.000Z',
			});

			const validation = await constraintsValidateCommand.handler(
				{ nodeId: 'studio/light', filter: 'space.historical', onlyViolating: true },
				context,
			);
			expect(validation.data?.valid).toBe(false);
			expect(validation.data?.results[0]?.violations[0]?.code).toBe('ramp:unreasoned');
		});
	});

	describe('interface.check leak detection', () => {
		it('flags private-prefix (with precedence over global-tier) and global-tier leaks, sorted and deduped', async () => {
			await tokenAddCommand.handler(
				{
					nodeId: 'studio',
					tokenId: 'space.inline.group',
					value: { ref: 'ref.space.8' },
					metadata: { tier: 'semantic', category: 'spacing' },
				},
				context,
			);
			await tokenAddCommand.handler(
				{
					nodeId: 'studio',
					tokenId: 'raw.unit.base',
					value: '4px',
					metadata: { tier: 'global', category: 'spacing' },
				},
				context,
			);
			await tokenOverrideCommand.handler(
				{ nodeId: 'studio/dark', tokenId: 'space.inline.group', value: { ref: 'ref.space.6' } },
				context,
			);

			const checked = await interfaceCheckCommand.handler(
				{
					nodes: ['studio/light', 'studio/dark'],
					interface: {
						contractVersion: 3,
						package: '@example/components',
						tokens: {
							'space.inline.group': { property: '--space-inline-group', type: 'dimension' },
							'ref.space.8': { property: '--ref-space-8', type: 'dimension' },
							'raw.unit.base': { property: '--raw-unit-base', type: 'dimension' },
						},
					},
				},
				context,
			);

			expect(checked.success).toBe(true);
			expect(checked.data?.complete).toBe(false);
			expect(checked.data?.missing).toEqual([]);
			expect(checked.data?.invalid).toEqual([]);
			expect(checked.data?.leaked).toEqual([
				{ token: 'raw.unit.base', reason: 'global-tier' },
				{ token: 'ref.space.8', reason: 'private-prefix' },
			]);
		});
	});
});
