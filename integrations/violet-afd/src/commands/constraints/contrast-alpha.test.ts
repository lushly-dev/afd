/**
 * @fileoverview Contrast checks composite translucent colors before measuring (#1326)
 */

import {
	type ValidatorToken,
	calculateContrastRatio,
	compositeOver,
	contrastValidator,
	createMemoryDatabase,
	parseColorWithAlpha,
} from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { setCommand } from './set.js';
import { validateCommand } from './validate.js';

const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };

function tokens(values: Record<string, string>): Map<string, ValidatorToken> {
	return new Map(Object.entries(values).map(([id, value]) => [id, { id, resolvedValue: value }]));
}

function check(
	value: string,
	values: Record<string, string>,
	config: { against: string; backdrop?: string; min?: number },
) {
	return contrastValidator.validate(
		value,
		{ type: 'contrast', min: 4.5, ...config },
		'rule',
		'Rule',
		{ allTokens: tokens(values) },
	);
}

describe('parseColorWithAlpha', () => {
	it('keeps the alpha of every translucent form', () => {
		expect(parseColorWithAlpha('#00000080')?.a).toBeCloseTo(128 / 255);
		expect(parseColorWithAlpha('#0008')?.a).toBeCloseTo(136 / 255);
		expect(parseColorWithAlpha('rgba(0, 0, 0, 0.5)')?.a).toBe(0.5);
		expect(parseColorWithAlpha('rgb(0 0 0 / 25%)')?.a).toBe(0.25);
		expect(parseColorWithAlpha('hsla(0, 0%, 0%, 0.2)')?.a).toBe(0.2);
		expect(parseColorWithAlpha('hsl(0 0% 0% / 40%)')?.a).toBe(0.4);
	});

	it('reads an opaque form as alpha 1, and clamps alpha', () => {
		expect(parseColorWithAlpha('#123456')).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 1 });
		expect(parseColorWithAlpha('rgb(1, 2, 3)')?.a).toBe(1);
		expect(parseColorWithAlpha('hsl(0, 0%, 0%)')?.a).toBe(1);
		expect(parseColorWithAlpha('rgba(0, 0, 0, 2)')?.a).toBe(1);
		expect(parseColorWithAlpha('rgba(0, 0, 0, -1)')?.a).toBe(0);
	});

	it('refuses what is not a color', () => {
		expect(parseColorWithAlpha('red')).toBeNull();
		expect(parseColorWithAlpha('12px')).toBeNull();
	});
});

describe('compositeOver', () => {
	it('mixes a translucent color into an opaque one', () => {
		const half = compositeOver({ ...BLACK, a: 0.5 }, WHITE);
		expect(half).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
	});

	it('leaves an opaque top as it is', () => {
		expect(compositeOver({ r: 10, g: 20, b: 30, a: 1 }, WHITE)).toEqual({
			r: 10,
			g: 20,
			b: 30,
			a: 1,
		});
	});
});

describe('contrast validator with alpha', () => {
	it('fails translucent text that RGB alone would pass', () => {
		// Black at 20% on white is a pale grey, about 1.6:1; read as opaque black it is 21:1
		const violation = check('rgba(0, 0, 0, 0.2)', { surface: '#ffffff' }, { against: 'surface' });
		expect(violation?.severity).toBe('error');
		const expected = calculateContrastRatio(
			compositeOver({ ...BLACK, a: 0.2 }, WHITE),
			WHITE,
		).toFixed(2);
		expect(violation?.actual).toBe(`${expected}:1`);
		expect(Number(expected)).toBeLessThan(2);
	});

	it('passes translucent text that is dark enough once composited', () => {
		expect(check('#000000e6', { surface: '#ffffff' }, { against: 'surface' })).toBeNull();
	});

	it('measures a translucent background over its backdrop', () => {
		// A 50% black scrim over white is mid-grey: white text on it is about 4:1, not 21:1
		const values = { scrim: 'rgba(0, 0, 0, 0.5)', page: '#ffffff' };
		const violation = check('#ffffff', values, { against: 'scrim', backdrop: 'page' });
		expect(violation?.severity).toBe('error');
		const grey = compositeOver({ ...BLACK, a: 0.5 }, WHITE);
		expect(violation?.actual).toBe(`${calculateContrastRatio(WHITE, grey).toFixed(2)}:1`);

		// Over a black page the same scrim is black, so white text passes
		expect(
			check('#ffffff', { ...values, page: '#000000' }, { against: 'scrim', backdrop: 'page' }),
		).toBeNull();
	});

	it('warns, instead of guessing, when a translucent background has no backdrop', () => {
		const values = { scrim: 'rgba(0, 0, 0, 0.5)', page: 'rgba(255, 255, 255, 0.5)' };
		const none = check('#ffffff', values, { against: 'scrim' });
		expect(none?.severity).toBe('warning');
		expect(none?.message).toContain("name the opaque surface under it as 'backdrop'");

		const missing = check('#ffffff', values, { against: 'scrim', backdrop: 'gone' });
		expect(missing?.message).toContain("backdrop token 'gone' not found");

		const translucent = check('#ffffff', values, { against: 'scrim', backdrop: 'page' });
		expect(translucent?.message).toContain('must be opaque');

		const notColor = check(
			'#ffffff',
			{ ...values, page: '4px' },
			{
				against: 'scrim',
				backdrop: 'page',
			},
		);
		expect(notColor?.message).toContain('is not a color');
	});

	it('measures opaque colors as before', () => {
		const violation = check('#777777', { surface: '#ffffff' }, { against: 'surface' });
		expect(violation?.actual).toBe('4.48:1');
	});
});

describe('constraints.validate with translucent colors', () => {
	let context: CommandContext;

	beforeEach(async () => {
		context = { db: createMemoryDatabase(), actor: 'test' };
		await nodeCreateCommand.handler({ name: 'global', type: 'root', parentId: null }, context);
		for (const [tokenId, value] of Object.entries({
			'color.text.muted': 'rgba(0, 0, 0, 0.3)',
			'color.surface.page': '#ffffff',
			'color.surface.scrim': 'rgba(0, 0, 0, 0.6)',
			'color.text.on-scrim': '#ffffff',
		})) {
			await tokenAddCommand.handler({ nodeId: 'global', tokenId, value }, context);
		}
	});

	it('reports translucent text and a scrim checked over the page', async () => {
		const set = await setCommand.handler(
			{
				nodeId: 'global',
				constraints: [
					{
						id: 'text-on-page',
						name: 'Text on the page',
						config: { type: 'contrast', against: 'color.surface.page', min: 4.5 },
						applyTo: 'color.text.muted',
					},
					{
						id: 'text-on-scrim',
						name: 'Text on the scrim',
						config: {
							type: 'contrast',
							against: 'color.surface.scrim',
							backdrop: 'color.surface.page',
							min: 4.5,
						},
						applyTo: 'color.text.on-scrim',
					},
				],
			},
			context,
		);
		expect(set.success).toBe(true);

		const result = await validateCommand.handler({ nodeId: 'global' }, context);
		expect(result.success).toBe(true);
		const failing = result.data?.results
			.filter((token) => !token.valid)
			.map((token) => token.tokenId)
			.sort();
		// Muted text at 30% fails on white; white on a 60% scrim over white is about 5.7:1
		expect(failing).toEqual(['color.text.muted']);
	});
});
