/**
 * @fileoverview Regression tests: constraint glob dialect, filtered validation context,
 * validator edge cases and pattern safety
 */

import { checkPattern, hasNestedQuantifier } from '@lushly-dev/violet-core/engine';
import {
	calculateContrastRatio,
	matchesPattern,
	parseColor,
	parseNumericValue,
	patternValidator,
	scaleValidator,
} from '@lushly-dev/violet-core/engine';
import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { setCommand } from './set.js';
import { validateCommand } from './validate.js';

describe('constraints fixes', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };
		await nodeCreateCommand.handler({ name: 'global', type: 'root', parentId: null }, context);
	});

	const add = async (tokenId: string, value: string) => {
		const result = await tokenAddCommand.handler({ nodeId: 'global', tokenId, value }, context);
		expect(result.success).toBe(true);
	};

	describe('applyTo glob dialect', () => {
		it('matchesPattern: color.* matches nested ids', () => {
			expect(matchesPattern('color.brand.primary', 'color.*')).toBe(true);
			expect(matchesPattern('colors.x', 'color.*')).toBe(false);
		});

		it('constraints.validate applies color.* to color.brand.primary', async () => {
			await add('color.brand.primary', '#FF0000');
			await setCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{
							id: 'enum',
							name: 'Allowed colors',
							config: { type: 'enum', values: ['#000000'] },
							severity: 'error',
							applyTo: 'color.*',
						},
					],
				},
				context,
			);

			const result = await validateCommand.handler({ nodeId: 'global' }, context);
			expect(result.success).toBe(true);
			expect(result.data?.summary.errors).toBe(1);
		});

		it('metacharacters in the filter do not throw', async () => {
			await add('color.brand.primary', '#FF0000');
			for (const filter of ['(', '[', 'color.(']) {
				const result = await validateCommand.handler({ nodeId: 'global', filter }, context);
				expect(result.success).toBe(true);
				expect(result.data?.summary.totalTokens).toBe(0);
			}
		});
	});

	describe('constraints.validate with a filter', () => {
		it('does not report false reference/contrast errors for filtered runs', async () => {
			await add('color.fg', '#000000');
			await add('color.bg', '#FFFFFF');
			await setCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{
							id: 'fg-ref',
							name: 'fg references bg',
							config: { type: 'reference', token: 'color.bg' },
							severity: 'error',
							applyTo: 'color.fg',
						},
						{
							id: 'fg-contrast',
							name: 'fg contrast',
							config: { type: 'contrast', against: 'color.bg', min: 4.5 },
							severity: 'error',
							applyTo: 'color.fg',
						},
					],
				},
				context,
			);

			const unfiltered = await validateCommand.handler({ nodeId: 'global' }, context);
			expect(unfiltered.data?.summary.errors).toBe(0);

			const filtered = await validateCommand.handler(
				{ nodeId: 'global', filter: 'color.fg' },
				context,
			);
			expect(filtered.success).toBe(true);
			expect(filtered.data?.summary.totalTokens).toBe(1);
			expect(filtered.data?.summary.errors).toBe(0);
			expect(filtered.data?.valid).toBe(true);
		});
	});

	describe('scale validator', () => {
		const run = (value: unknown, base: number, tolerance = 0) =>
			scaleValidator.validate(value, { type: 'scale', base, tolerance }, 'scale', 'Scale', {
				allTokens: new Map(),
			});

		it('rejects negatives that are not multiples', () => {
			expect(run(-5, 8)).not.toBeNull();
			expect(run('-5px', 8)).not.toBeNull();
			expect(run(-8, 8)).toBeNull();
			expect(run(-16, 8)).toBeNull();
		});

		it('does not flag floating point multiples', () => {
			expect(run(0.3, 0.1)).toBeNull();
			expect(run(0.7, 0.1)).toBeNull();
			expect(run(0.35, 0.1)).not.toBeNull();
		});

		it('still honours tolerance', () => {
			expect(run(9, 8, 1)).toBeNull();
			expect(run(7, 8, 1)).toBeNull();
			expect(run(10, 8, 1)).not.toBeNull();
		});
	});

	describe('parseNumericValue', () => {
		it('reads exponents and units', () => {
			expect(parseNumericValue('1e3px')).toBe(1000);
			expect(parseNumericValue('1e3')).toBe(1000);
			expect(parseNumericValue('-2.5e-1rem')).toBe(-0.25);
			expect(parseNumericValue('1em')).toBe(1);
			expect(parseNumericValue('8px')).toBe(8);
			expect(parseNumericValue('50%')).toBe(50);
			expect(parseNumericValue(12)).toBe(12);
		});

		it('rejects non numeric input', () => {
			expect(parseNumericValue('abc')).toBeNull();
			expect(parseNumericValue('1.2.3')).toBeNull();
			expect(parseNumericValue(Number.NaN)).toBeNull();
		});
	});

	describe('parseColor', () => {
		it('parses 8-digit and 4-digit hex (alpha ignored)', () => {
			expect(parseColor('#FF000080')).toEqual({ r: 255, g: 0, b: 0 });
			expect(parseColor('#f008')).toEqual({ r: 255, g: 0, b: 0 });
			expect(parseColor('#00ff00')).toEqual({ r: 0, g: 255, b: 0 });
		});

		it('parses hsl() and hsla()', () => {
			expect(parseColor('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0 });
			expect(parseColor('hsl(120 100% 50%)')).toEqual({ r: 0, g: 255, b: 0 });
			expect(parseColor('hsla(240, 100%, 50%, 0.5)')).toEqual({ r: 0, g: 0, b: 255 });
			expect(parseColor('hsl(0, 0%, 100%)')).toEqual({ r: 255, g: 255, b: 255 });
		});

		it('clamps rgb channels', () => {
			expect(parseColor('rgb(300, 0, -5)')).toEqual({ r: 255, g: 0, b: 0 });
			expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30 });
			expect(parseColor('rgb(100%, 0%, 0%)')).toEqual({ r: 255, g: 0, b: 0 });
		});

		it('rejects garbage', () => {
			expect(parseColor('red')).toBeNull();
			expect(parseColor('#12')).toBeNull();
			expect(parseColor('hsl(a, b, c)')).toBeNull();
		});

		it('computes contrast for hsl and 8-digit hex colors', () => {
			const black = parseColor('#000000FF');
			const white = parseColor('hsl(0, 0%, 100%)');
			expect(black).not.toBeNull();
			expect(white).not.toBeNull();
			if (black && white) {
				expect(calculateContrastRatio(black, white)).toBeCloseTo(21, 0);
			}
		});
	});

	describe('pattern safety', () => {
		it('detects nested quantifiers', () => {
			expect(hasNestedQuantifier('^(a+)+$')).toBe(true);
			expect(hasNestedQuantifier('(a*)*')).toBe(true);
			expect(hasNestedQuantifier('^(\\w+\\s?)*$')).toBe(true);
			expect(hasNestedQuantifier('^((a+)b)+$')).toBe(true);
			expect(hasNestedQuantifier('^#[0-9A-Fa-f]{6}$')).toBe(false);
			expect(hasNestedQuantifier('^(red|blue)$')).toBe(false);
			expect(hasNestedQuantifier('^[a+*]+$')).toBe(false);
			expect(hasNestedQuantifier('^\\(a+\\)+$')).toBe(false);
			expect(hasNestedQuantifier('^(a{2}){3}$')).toBe(false);
		});

		it('checkPattern reports invalid and oversized patterns without throwing', () => {
			expect(checkPattern('(').ok).toBe(false);
			expect(checkPattern('abc', 'zz').ok).toBe(false);
			expect(checkPattern('a'.repeat(501)).ok).toBe(false);
			expect(checkPattern('^#[0-9a-f]{6}$', 'i').ok).toBe(true);
		});

		it('constraints.set rejects invalid and catastrophic patterns', async () => {
			for (const pattern of ['^(a+)+$', '(', '[', 'a'.repeat(600)]) {
				const result = await setCommand.handler(
					{
						nodeId: 'global',
						constraints: [
							{
								id: 'bad',
								name: 'Bad pattern',
								config: { type: 'pattern', pattern },
								severity: 'error',
								applyTo: '*',
							},
						],
					},
					context,
				);
				expect(result.success).toBe(false);
				expect(result.error?.code).toBe('VALIDATION_ERROR');
			}
			expect(await db.getConstraints('global')).toEqual([]);
		});

		it('constraints.set accepts ordinary patterns', async () => {
			const result = await setCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{
							id: 'hex',
							name: 'Hex',
							config: { type: 'pattern', pattern: '^#[0-9A-Fa-f]{6}$' },
							severity: 'error',
							applyTo: 'color.*',
						},
					],
				},
				context,
			);
			expect(result.success).toBe(true);
		});

		it('the validator never runs a catastrophic pattern stored earlier', () => {
			const started = Date.now();
			const violation = patternValidator.validate(
				`${'a'.repeat(30)}!`,
				{ type: 'pattern', pattern: '^(a+)+$' },
				'stored',
				'Stored',
				{ allTokens: new Map() },
			);
			expect(Date.now() - started).toBeLessThan(500);
			expect(violation?.message).toContain('Unusable regex pattern');
		});

		it('the validator reports an invalid pattern as a structured violation', () => {
			const violation = patternValidator.validate(
				'x',
				{ type: 'pattern', pattern: '(' },
				'stored',
				'Stored',
				{ allTokens: new Map() },
			);
			expect(violation?.severity).toBe('error');
			expect(violation?.message).toContain('Unusable regex pattern');
		});
	});
});
