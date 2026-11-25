/**
 * @fileoverview Core tests for Scales Phase 1: ResolvedToken.reason inheritance,
 * `type: 'ramp'` constraint evaluation, `pattern.target: 'id'`, core `validateConstraints`,
 * and `excludePrefixes` on `resolveTokens` / `exportTokens`.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryDatabase } from '../db/memory.js';
import { exportTokens, resolveTokens, validateConstraints } from '../tokens.js';
import { ConstraintSchema } from '../types/constraint.js';
import { ErrorCodes } from '../types/error-codes.js';
import { NodeSchema } from '../types/node.js';
import type { OperationRecord } from '../types/operation.js';
import { LEGACY_IMPORT_REASON } from './ramp.js';
import { validateValue, validateValues } from './validators.js';

const NOW = '2026-11-23T00:00:00.000Z';

function createStore() {
	const db = createMemoryDatabase();
	let sequence = 0;

	const node = (id: string, parentId: string | null, extra: Record<string, unknown> = {}) =>
		db.createNode(
			NodeSchema.parse({
				id,
				name: id,
				parentId,
				type: parentId ? 'theme' : 'root',
				createdAt: NOW,
				updatedAt: NOW,
				...extra,
			}),
		);

	const op = (
		nodeId: string,
		type: OperationRecord['type'],
		tokenId: string,
		fields: Partial<OperationRecord> = {},
	) => {
		sequence++;
		return db.addOperation({
			id: `op-${sequence}`,
			nodeId,
			sequence,
			type,
			tokenId,
			value: null,
			metadata: null,
			fromNode: null,
			asTokenId: null,
			toAncestor: null,
			reason: null,
			author: 'core-test',
			createdAt: NOW,
			...fields,
		});
	};

	const setConstraints = (nodeId: string, constraints: Array<Record<string, unknown>>) =>
		db.setConstraints(
			nodeId,
			constraints.map((c) => ConstraintSchema.parse(c)),
		);

	return { db, node, op, setConstraints };
}

describe('ResolvedToken.reason propagation', () => {
	it('propagates add/override/reset/copy/include reasons with explicit clearing on unreasoned override', async () => {
		const { db, node, op } = createStore();
		await node('root', null);
		await node('child', 'root');
		await node('grandchild', 'child');
		await node('mixin', null, { type: 'shared' });
		await node('consumer', null, { includes: ['mixin'] });

		// add sets trimmed reason; whitespace-only becomes undefined
		await op('root', 'add', 'space.badge', {
			value: JSON.stringify('5px'),
			reason: '  Optical icon alignment  ',
		});
		await op('root', 'add', 'space.blank', {
			value: JSON.stringify('7px'),
			reason: '   ',
		});

		// child overrides without a reason -> explicitly clears ancestor's prior reason
		await op('child', 'override', 'space.badge', {
			value: JSON.stringify('5px'),
			reason: null,
		});
		// grandchild resets back to root -> restores root's resolved reason
		await op('grandchild', 'reset', 'space.badge', {
			toAncestor: 'root',
		});

		// copy from root propagates source token's reason
		await op('consumer', 'copy', 'space.badge', {
			fromNode: 'root',
			asTokenId: 'space.copied',
		});

		// include from mixin propagates included token's reason
		await op('mixin', 'add', 'space.mixed', {
			value: JSON.stringify('9px'),
			reason: 'Mixin optical gap',
		});

		const rootTokens = new Map((await resolveTokens(db, 'root')).tokens.map((t) => [t.id, t]));
		expect(rootTokens.get('space.badge')?.reason).toBe('Optical icon alignment');
		expect(rootTokens.get('space.blank')?.reason).toBeUndefined();

		const childTokens = new Map((await resolveTokens(db, 'child')).tokens.map((t) => [t.id, t]));
		expect(childTokens.get('space.badge')?.reason).toBeUndefined();

		const grandchildTokens = new Map(
			(await resolveTokens(db, 'grandchild')).tokens.map((t) => [t.id, t]),
		);
		expect(grandchildTokens.get('space.badge')?.reason).toBe('Optical icon alignment');

		const consumerTokens = new Map(
			(await resolveTokens(db, 'consumer')).tokens.map((t) => [t.id, t]),
		);
		expect(consumerTokens.get('space.copied')?.reason).toBe('Optical icon alignment');
		expect(consumerTokens.get('space.mixed')?.reason).toBe('Mixin optical gap');
	});
});

describe('validateConstraints with type: "ramp" and pattern.target: "id"', () => {
	async function setupStudio() {
		const store = createStore();
		const { node, op, setConstraints } = store;
		await node('studio', null);
		await node('studio/light', 'studio');

		for (const [id, value] of [
			['ref.space.4', '4px'],
			['ref.space.6', '6px'],
			['ref.space.8', '8px'],
			['ref.space.12', '12px'],
			['ref.radius.8', '8px'],
			['ref.type.200.size', '12px'],
			['ref.type.200.line', '16px'],
			['ref.type.300.size', '14px'],
			['ref.type.300.line', '20px'],
		]) {
			await op('studio', 'add', id, {
				value: JSON.stringify(value),
				metadata: JSON.stringify({ tier: 'global', category: 'spacing' }),
			});
		}

		await setConstraints('studio', [
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
			{
				id: 'type-size-ramp',
				name: 'Type size ramp',
				applyTo: 'type.*.size',
				severity: 'error',
				config: {
					type: 'ramp',
					ramp: 'ref.type.*.size',
					requireOffRampReason: true,
					repeatThreshold: 2,
					pairWith: {
						fromSuffix: '.size',
						toSuffix: '.line',
						rampTarget: 'ref.type.*.line',
					},
				},
			},
		]);

		return store;
	}

	it('follows chained aliases to terminal ramp step and flags wrong-family or broken refs first', async () => {
		const { db, op } = await setupStudio();
		await op('studio', 'add', 'space.base', { value: JSON.stringify({ ref: 'ref.space.8' }) });
		await op('studio', 'add', 'space.chained', { value: JSON.stringify({ ref: 'space.base' }) });
		await op('studio', 'add', 'space.wrong', { value: JSON.stringify({ ref: 'ref.radius.8' }) });
		await op('studio', 'add', 'space.broken', { value: JSON.stringify({ ref: 'ref.space.10' }) });

		const report = await validateConstraints(db, 'studio/light', { onlyViolating: true });
		expect(report.valid).toBe(false);
		expect(report.summary.errors).toBe(2);
		expect(report.results.map((r) => r.tokenId).sort()).toEqual(['space.broken', 'space.wrong']);

		const broken = report.results.find((r) => r.tokenId === 'space.broken');
		expect(broken?.violations[0]).toMatchObject({
			code: 'ramp:broken-ref',
			severity: 'error',
		});
		expect(broken?.violations[0]?.message).toContain('TOKEN_REFERENCE_NOT_FOUND');

		const wrong = report.results.find((r) => r.tokenId === 'space.wrong');
		expect(wrong?.violations[0]).toMatchObject({
			code: 'ramp:wrong-family',
			severity: 'error',
			expected: 'alias matching ref.space.*',
			actual: 'ref.radius.8',
		});
	});

	it('emits nearest unit-matched bounds, handles unit mismatch, and rejects legacy import sentinel', async () => {
		const { db, op } = await setupStudio();
		await op('studio', 'add', 'space.between', { value: JSON.stringify('5px') });
		await op('studio', 'add', 'space.unit-mismatch', { value: JSON.stringify('0.5rem') });
		await op('studio', 'add', 'space.legacy', {
			value: JSON.stringify('7px'),
			reason: LEGACY_IMPORT_REASON,
		});
		await op('studio', 'add', 'space.reasoned', {
			value: JSON.stringify('9px'),
			reason: 'Deliberate optical spacing',
		});

		const report = await validateConstraints(db, 'studio/light', { onlyViolating: true });
		expect(report.summary.errors).toBe(3);

		const between = report.results.find((r) => r.tokenId === 'space.between');
		expect(between?.violations[0]?.code).toBe('ramp:unreasoned');
		expect(between?.violations[0]?.message).toMatch(/ref\.space\.4 \(4px\).*ref\.space\.6 \(6px\)/);

		const mismatch = report.results.find((r) => r.tokenId === 'space.unit-mismatch');
		expect(mismatch?.violations[0]?.code).toBe('ramp:unreasoned');
		expect(mismatch?.violations[0]?.message).toContain("unit 'rem' does not match ramp units");

		const legacy = report.results.find((r) => r.tokenId === 'space.legacy');
		expect(legacy?.violations[0]?.code).toBe('ramp:unreasoned');

		expect(report.results.find((r) => r.tokenId === 'space.reasoned')).toBeUndefined();
	});

	it('emits both ramp:unreasoned (error) and ramp:repeat (advisory warning) on repeated unreasoned off-ramps even when filtered', async () => {
		const { db, op } = await setupStudio();
		await op('studio', 'add', 'space.first', { value: JSON.stringify('5px') });
		await op('studio', 'add', 'space.second', { value: JSON.stringify('5px') });

		const filtered = await validateConstraints(db, 'studio/light', {
			filter: 'space.first',
			onlyViolating: true,
		});
		expect(filtered.valid).toBe(false);
		expect(filtered.summary).toMatchObject({
			totalTokens: 1,
			validTokens: 0,
			errors: 1,
			warnings: 1,
		});
		const codes = filtered.results[0]?.violations.map((v) => [v.code, v.severity]);
		expect(codes).toEqual([
			['ramp:unreasoned', 'error'],
			['ramp:repeat', 'warning'],
		]);
		expect(filtered.results[0]?.violations[1]?.message).toContain('space.first');
		expect(filtered.results[0]?.violations[1]?.message).toContain('space.second');

		// Validator registry multi-violation path returns both findings directly too
		const resolved = await resolveTokens(db, 'studio/light');
		const tokenMap = new Map(resolved.tokens.map((t) => [t.id, t]));
		const first = tokenMap.get('space.first');
		expect(first).toBeDefined();
		const viaRegistry = validateValues(
			first?.resolvedValue,
			{
				type: 'ramp',
				ramp: 'ref.space.*',
				requireOffRampReason: true,
				repeatThreshold: 2,
			},
			'space-ramp',
			'Spacing ramp',
			{ allTokens: tokenMap, token: first, applyTo: 'space.*', severity: 'error' },
		);
		expect(viaRegistry.map((v) => [v.code, v.severity])).toEqual([
			['ramp:unreasoned', 'error'],
			['ramp:repeat', 'warning'],
		]);
	});

	it('does not disable semantic validation when ramp is "*" and handles exact pairWith targets without wildcards', async () => {
		const { db, node, op, setConstraints } = createStore();
		await node('root', null);
		await op('root', 'add', 'ref.type.200.size', { value: JSON.stringify('12px') });
		await op('root', 'add', 'ref.type.200.line', { value: JSON.stringify('16px') });
		await op('root', 'add', 'space.badge', { value: JSON.stringify('5px') });
		await op('root', 'add', 'type.exact.size', {
			value: JSON.stringify({ ref: 'ref.type.200.size' }),
		});
		await op('root', 'add', 'type.exact.line', {
			value: JSON.stringify({ ref: 'ref.type.200.line' }),
		});
		await setConstraints('root', [
			{
				id: 'broad-ramp',
				name: 'Broad ramp',
				applyTo: 'space.*',
				severity: 'error',
				config: { type: 'ramp', ramp: '*', requireOffRampReason: true, repeatThreshold: 2 },
			},
			{
				id: 'exact-pair',
				name: 'Exact type pair',
				applyTo: 'type.*.size',
				severity: 'error',
				config: {
					type: 'ramp',
					ramp: 'ref.type.200.size',
					requireOffRampReason: true,
					repeatThreshold: 2,
					pairWith: {
						fromSuffix: '.size',
						toSuffix: '.line',
						rampTarget: 'ref.type.200.line',
					},
				},
			},
		]);

		const report = await validateConstraints(db, 'root', { onlyViolating: true });
		expect(report.results.map((r) => [r.tokenId, r.violations[0]?.code])).toEqual([
			['space.badge', 'ramp:unreasoned'],
		]);
	});

	it('checks pairWith symmetrically when filtering on .size or .line and stays quiet if sibling is absent', async () => {
		const { db, op } = await setupStudio();
		await op('studio', 'add', 'type.solo.size', {
			value: JSON.stringify({ ref: 'ref.type.300.size' }),
		});
		await op('studio', 'add', 'type.badge.size', {
			value: JSON.stringify({ ref: 'ref.type.300.size' }),
		});
		await op('studio', 'add', 'type.badge.line', {
			value: JSON.stringify({ ref: 'ref.type.200.line' }),
		});

		const solo = await validateConstraints(db, 'studio/light', { filter: 'type.solo.size' });
		expect(solo.valid).toBe(true);

		const onLine = await validateConstraints(db, 'studio/light', { filter: 'type.badge.line' });
		expect(onLine.valid).toBe(false);
		expect(onLine.results[0]?.violations[0]).toMatchObject({
			constraintId: 'type-size-ramp',
			code: 'ramp:pair',
			severity: 'error',
		});
		expect(onLine.results[0]?.violations[0]?.message).toContain('ref.type.300.size');

		const onSize = await validateConstraints(db, 'studio/light', { filter: 'type.badge.size' });
		expect(onSize.valid).toBe(false);
		expect(onSize.results[0]?.violations[0]?.code).toBe('ramp:pair');
	});

	it('validates pattern.target: "id" across leading, middle, and trailing positional segments', async () => {
		const { db, node, op, setConstraints } = createStore();
		await node('root', null);
		await op('root', 'add', 'space.stack.group', { value: JSON.stringify('8px') });
		await op('root', 'add', 'space.stack.sm', { value: JSON.stringify('8px') });
		await op('root', 'add', 'sm.stack', { value: JSON.stringify('8px') });
		await op('root', 'add', 'type.md.size', { value: JSON.stringify('14px') });
		await setConstraints('root', [
			{
				id: 'no-positional',
				name: 'No positional segments',
				applyTo: '*',
				severity: 'error',
				config: {
					type: 'pattern',
					target: 'id',
					pattern: '^(?!(?:xs|sm|md|lg|xl)(?:\\.|$))(?!.*\\.(?:xs|sm|md|lg|xl)(?:\\.|$)).+$',
				},
			},
		]);

		const report = await validateConstraints(db, 'root', { onlyViolating: true });
		expect(report.results.map((r) => r.tokenId).sort()).toEqual([
			'sm.stack',
			'space.stack.sm',
			'type.md.size',
		]);
	});

	it('throws TokenDomainError for missing nodes and circular includes', async () => {
		const { db, node } = createStore();
		await expect(validateConstraints(db, 'missing')).rejects.toMatchObject({
			code: ErrorCodes.NODE_NOT_FOUND,
		});
		await node('a', null, { includes: ['b'] });
		await node('b', null, { includes: ['a'] });
		await expect(validateConstraints(db, 'a')).rejects.toMatchObject({
			code: ErrorCodes.CIRCULAR_REFERENCE,
		});
	});

	it('evaluates warnUneven deterministically on config.ramp tokens with ignoreAbove, unit matching, and advisory warning severity', async () => {
		const { db, node, op, setConstraints } = createStore();
		await node('studio', null);
		await node('studio/light', 'studio');

		// Add steps intentionally out of id/value order, mixing px and rem units, a pill sentinel (9999px),
		// zero/non-numeric tokens, and two uneven jumps in px (min ratio 8/6 = 1.33x; limit 1.33 * 1.5 = 2.0x).
		for (const [id, value] of [
			['ref.radius.pill', '9999px'], // > ignoreAbove (1000): excluded
			['ref.radius.500', '100px'], // 24px -> 100px = 4.17x (uneven)
			['ref.radius.200', '6px'], // 4px -> 6px = 1.50x (within 2.0x)
			['ref.radius.100', '4px'],
			['ref.radius.300', '8px'], // 6px -> 8px = 1.33x (minRatio)
			['ref.radius.400', '24px'], // 8px -> 24px = 3.00x (uneven)
			['ref.radius.zero', '0px'], // non-positive: skipped
			['ref.radius.auto', 'auto'], // non-numeric: skipped
			['ref.radius.rem.1', '0.25rem'], // separate rem unit group: 0.25 -> 0.5 (2x) -> 1 (2x), even!
			['ref.radius.rem.2', '0.5rem'],
			['ref.radius.rem.3', '1rem'],
		]) {
			await op('studio', 'add', id, { value: JSON.stringify(value) });
		}

		await setConstraints('studio', [
			{
				id: 'radius-ramp',
				name: 'Radius ramp with progression check',
				applyTo: 'radius.*',
				severity: 'error',
				config: {
					type: 'ramp',
					ramp: 'ref.radius.*',
					requireOffRampReason: true,
					repeatThreshold: 2,
					warnUneven: {
						maxRatioSpread: 1.5,
						ignoreAbove: 1000,
					},
				},
			},
		]);

		const report = await validateConstraints(db, 'studio/light', {
			filter: 'ref.radius.*',
			onlyViolating: true,
		});
		// Advisory warnings keep the node valid even though constraint.severity is 'error'
		expect(report.valid).toBe(true);
		expect(report.summary.errors).toBe(0);
		expect(report.summary.warnings).toBe(2);
		// Deterministically ordered by token id (not insertion order)
		expect(report.results.map((r) => r.tokenId)).toEqual(['ref.radius.400', 'ref.radius.500']);
		for (const entry of report.results) {
			expect(entry.valid).toBe(true);
			expect(entry.violations).toHaveLength(1);
			expect(entry.violations[0]).toMatchObject({
				constraintId: 'radius-ramp',
				severity: 'warning',
				code: 'ramp:uneven',
			});
		}

		// Direct validator registry path also preserves advisory 'warning' severity
		const resolved = await resolveTokens(db, 'studio/light');
		const tokenMap = new Map(resolved.tokens.map((t) => [t.id, t]));
		const step400 = tokenMap.get('ref.radius.400');
		expect(step400).toBeDefined();
		const viaRegistry = validateValues(
			step400?.resolvedValue,
			{
				type: 'ramp',
				ramp: 'ref.radius.*',
				requireOffRampReason: true,
				repeatThreshold: 2,
				warnUneven: { maxRatioSpread: 1.5, ignoreAbove: 1000 },
			},
			'radius-ramp',
			'Radius ramp with progression check',
			{ allTokens: tokenMap, token: step400, applyTo: 'radius.*', severity: 'error' },
		);
		expect(viaRegistry).toHaveLength(1);
		expect(viaRegistry[0]).toMatchObject({ code: 'ramp:uneven', severity: 'warning' });
	});

	it('handles warnUneven exact threshold, just-above-threshold jumps, ignoreAbove inclusion boundary, and overlapping globs', async () => {
		const { db, node, op, setConstraints } = createStore();
		await node('exact', null);
		// Exact ratios: 2 -> 4 (2.0x), 4 -> 12 (3.0x); 3.0 == 2.0 * 1.5 exactly (should stay quiet)
		await op('exact', 'add', 'ref.space.2', { value: JSON.stringify('2px') });
		await op('exact', 'add', 'ref.space.4', { value: JSON.stringify('4px') });
		await op('exact', 'add', 'ref.space.12', { value: JSON.stringify('12px') });
		// Only 2 steps in rem: never warns
		await op('exact', 'add', 'ref.space.rem.1', { value: JSON.stringify('1rem') });
		await op('exact', 'add', 'ref.space.rem.2', { value: JSON.stringify('10rem') });
		await setConstraints('exact', [
			{
				id: 'space-ramp',
				name: 'Space ramp',
				applyTo: 'space.*',
				severity: 'error',
				config: {
					type: 'ramp',
					ramp: 'ref.space.*',
					requireOffRampReason: true,
					repeatThreshold: 2,
					warnUneven: { maxRatioSpread: 1.5 },
				},
			},
		]);

		const exactReport = await validateConstraints(db, 'exact', { onlyViolating: true });
		expect(exactReport.valid).toBe(true);
		expect(exactReport.summary.warnings).toBe(0);
		expect(exactReport.results).toEqual([]);

		// Just above threshold (1 -> 2 -> 6.000000001 with spread 1.5 -> 3.0000000005 > 3): must warn
		await node('just-above', null);
		await op('just-above', 'add', 'ref.step.1', { value: JSON.stringify(1) });
		await op('just-above', 'add', 'ref.step.2', { value: JSON.stringify(2) });
		await op('just-above', 'add', 'ref.step.3', { value: JSON.stringify(6.000000001) });
		await setConstraints('just-above', [
			{
				id: 'step-ramp',
				name: 'Step ramp',
				applyTo: 'step.*',
				severity: 'error',
				config: {
					type: 'ramp',
					ramp: 'ref.step.*',
					requireOffRampReason: true,
					repeatThreshold: 2,
					warnUneven: { maxRatioSpread: 1.5 },
				},
			},
		]);
		const aboveReport = await validateConstraints(db, 'just-above', { onlyViolating: true });
		expect(aboveReport.valid).toBe(true);
		expect(aboveReport.results.map((r) => r.tokenId)).toEqual(['ref.step.3']);
		expect(aboveReport.results[0]?.violations[0]?.code).toBe('ramp:uneven');

		// ignoreAbove boundary inclusion: 2 -> 4 (2x) -> 16 (4x > 3x) with ignoreAbove: 16 must INCLUDE 16px and warn
		// while 17px (> 16) is excluded.
		await node('boundary', null);
		await op('boundary', 'add', 'ref.rad.2', { value: JSON.stringify('2px') });
		await op('boundary', 'add', 'ref.rad.4', { value: JSON.stringify('4px') });
		await op('boundary', 'add', 'ref.rad.16', { value: JSON.stringify('16px') });
		await op('boundary', 'add', 'ref.rad.17', { value: JSON.stringify('17px') });
		await setConstraints('boundary', [
			{
				id: 'rad-ramp',
				name: 'Rad ramp',
				applyTo: 'radius.*',
				severity: 'error',
				config: {
					type: 'ramp',
					ramp: 'ref.rad.*',
					requireOffRampReason: true,
					repeatThreshold: 2,
					warnUneven: { maxRatioSpread: 1.5, ignoreAbove: 16 },
				},
			},
		]);
		const boundaryReport = await validateConstraints(db, 'boundary', { onlyViolating: true });
		expect(boundaryReport.valid).toBe(true);
		expect(boundaryReport.results.map((r) => r.tokenId)).toEqual(['ref.rad.16']);

		// Overlapping ramp & applyTo globs: primary error must precede advisory warning so validateValue never hides errors
		await node('overlap', null);
		await op('overlap', 'add', 'size.a', { value: JSON.stringify(1) });
		await op('overlap', 'add', 'size.b', { value: JSON.stringify(2) });
		await op('overlap', 'add', 'size.c', { value: JSON.stringify(10) });
		const overlapTokens = new Map(
			(await resolveTokens(db, 'overlap')).tokens.map((t) => [t.id, t]),
		);
		const sizeC = overlapTokens.get('size.c');
		expect(sizeC).toBeDefined();
		const overlapConfig = {
			type: 'ramp' as const,
			ramp: '*',
			requireOffRampReason: true,
			repeatThreshold: 2,
			warnUneven: { maxRatioSpread: 1.5 },
		};
		const overlapContext = {
			allTokens: overlapTokens,
			token: sizeC,
			applyTo: 'size.*',
			severity: 'error' as const,
		};
		const allViolations = validateValues(
			sizeC?.resolvedValue,
			overlapConfig,
			'overlap-ramp',
			'Overlap ramp',
			overlapContext,
		);
		expect(allViolations.map((v) => [v.code, v.severity])).toEqual([
			['ramp:unreasoned', 'error'],
			['ramp:uneven', 'warning'],
		]);
		const firstViolation = validateValue(
			sizeC?.resolvedValue,
			overlapConfig,
			'overlap-ramp',
			'Overlap ramp',
			overlapContext,
		);
		expect(firstViolation).toMatchObject({ code: 'ramp:unreasoned', severity: 'error' });
	});
});

describe('excludePrefixes on core resolveTokens and exportTokens', () => {
	it('resolves aliases against the full node before excluding ref.* and emits literals under outputReferences', async () => {
		const { db, node, op } = createStore();
		await node('studio', null);
		await op('studio', 'add', 'ref.space.8', { value: JSON.stringify('8px') });
		await op('studio', 'add', 'space.inline.group', {
			value: JSON.stringify({ ref: 'ref.space.8' }),
		});

		const resolved = await resolveTokens(db, 'studio', { excludePrefixes: ['ref.'] });
		expect(resolved.tokens.map((t) => t.id)).toEqual(['space.inline.group']);
		expect(resolved.tokens[0]?.resolvedValue).toBe('8px');
		expect(resolved.tokens[0]?.aliasOf).toBe('ref.space.8');

		const exported = await exportTokens(db, 'studio', {
			format: 'css',
			excludePrefixes: ['ref.'],
			outputReferences: true,
		});
		expect(exported.tokenCount).toBe(1);
		expect(exported.content).toContain('--space-inline-group: 8px;');
		expect(exported.content).not.toContain('--ref-space-8');
	});
});
