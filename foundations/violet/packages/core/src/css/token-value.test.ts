import { describe, expect, it } from 'vitest';
import {
	UnsafeCssValueError,
	checkCssToken,
	checkCssTokenValue,
	cssValueKind,
} from './token-value.js';

describe('cssValueKind', () => {
	it('reads the DTCG type first, then the category', () => {
		expect(cssValueKind({ type: 'color' })).toBe('color');
		expect(cssValueKind({ type: 'dimension', category: 'color' })).toBe('length');
		expect(cssValueKind({ type: 'cubicBezier' })).toBe('easing');
		expect(cssValueKind({ category: 'spacing' })).toBe('length');
		expect(cssValueKind({ category: 'radius' })).toBe('length');
		expect(cssValueKind({ category: 'custom' })).toBeNull();
		expect(cssValueKind({ type: 'typography' })).toBeNull();
		expect(cssValueKind(undefined)).toBeNull();
	});
});

describe('checkCssTokenValue', () => {
	it.each([
		['#121214; background: url(https://evil.example)', "';'"],
		['red} body { display: none', "'}'"],
		['#fff /* */', 'comment'],
		['\\0041', "'\\'"],
		['blue !important', "'!'"],
		['line\nbreak', 'control character'],
		['url(https://evil.example/x.png)', 'loads a resource'],
		['-webkit-image-set(a 1x)', 'loads a resource'],
		['expression(alert(1))', 'loads a resource'],
		['"unclosed', 'unclosed quote'],
		['rgb(1, 2, 3', 'unbalanced bracket'],
		['a)', 'unbalanced bracket'],
	])('refuses %j in an untyped token', (value, problem) => {
		expect(checkCssTokenValue(value)).toContain(problem);
	});

	it('refuses an over-long string', () => {
		expect(checkCssTokenValue('a'.repeat(2000))).toContain('longer than');
	});

	it.each([
		'#ffffff',
		'transparent',
		'1px solid #000',
		'"Segoe UI", sans-serif',
		'calc(100% - 8px)',
		'0 1px 2px rgba(0, 0, 0, 0.3)',
		'cubic-bezier(0.2, 0, 0, 1)',
		'{color.base}',
	])('accepts %j in an untyped token', (value) => {
		expect(checkCssTokenValue(value)).toBeNull();
	});

	it('holds a typed token to its kind', () => {
		const color = { type: 'color' };
		expect(checkCssTokenValue('#5b3fd1', color)).toBeNull();
		expect(checkCssTokenValue('rgba(0, 0, 0, 0.5)', color)).toBeNull();
		expect(checkCssTokenValue('currentColor', color)).toBeNull();
		expect(checkCssTokenValue('12px', color)).toContain('is not a colour');
		// Real colour keywords only, not any word
		expect(checkCssTokenValue('rebeccapurple', color)).toBeNull();
		expect(checkCssTokenValue('Canvas', color)).toBeNull();
		expect(checkCssTokenValue('penguin', color)).toContain('is not a colour');
		// Modern colour functions and var()
		expect(checkCssTokenValue('oklch(70% 0.1 250)', color)).toBeNull();
		expect(checkCssTokenValue('color-mix(in srgb, red 50%, blue)', color)).toBeNull();
		expect(checkCssTokenValue('var(--brand)', color)).toBeNull();
		expect(checkCssTokenValue('var(--x, url(evil))', color)).toContain('loads a resource');

		const length = { type: 'dimension' };
		expect(checkCssTokenValue('16px', length)).toBeNull();
		expect(checkCssTokenValue('calc(1px + 2px)', length)).toBeNull();
		expect(checkCssTokenValue('clamp(1rem, 2vw, 2rem)', length)).toBeNull();
		expect(checkCssTokenValue('2px 4px', length)).toContain('is not one length');

		expect(
			checkCssTokenValue('"Inter", -apple-system, sans-serif', { type: 'fontFamily' }),
		).toBeNull();
		expect(
			checkCssTokenValue('inset 0 2px 3px -1px rgba(0, 0, 0, 0.28)', { type: 'shadow' }),
		).toBeNull();
		expect(checkCssTokenValue('180ms', { type: 'duration' })).toBeNull();
		expect(checkCssTokenValue('2h', { type: 'duration' })).toContain('is not a time');
		expect(checkCssTokenValue('ease-out', { type: 'cubicBezier' })).toBeNull();
		expect(checkCssTokenValue('linear(0, 0.5 25%, 1)', { type: 'cubicBezier' })).toBeNull();
		expect(checkCssTokenValue('1.5', { type: 'number' })).toBeNull();
		expect(checkCssTokenValue('wide', { category: 'spacing' })).toContain('is not one length');
	});

	it('refuses declaration breakers even in a value its kind would rebuild', () => {
		expect(checkCssTokenValue('#fff;', { type: 'color' })).toContain("';'");
	});

	it('holds a number to its kind', () => {
		expect(checkCssTokenValue(23, { type: 'color' })).toContain('is a bare number');
		expect(checkCssTokenValue(4, { type: 'dimension' })).toContain('is a bare number');
		expect(checkCssTokenValue(0, { type: 'dimension' })).toBeNull();
		expect(checkCssTokenValue(1.5, { type: 'number' })).toBeNull();
		expect(checkCssTokenValue(4)).toBeNull();
		expect(checkCssTokenValue(Number.NaN)).toContain('finite');
	});

	it('passes whole-value references, which are checked once resolved, and refuses others', () => {
		expect(checkCssTokenValue({ ref: 'color.base' }, { type: 'color' })).toBeNull();
		expect(checkCssTokenValue('{color.base}', { type: 'color' })).toBeNull();
		// The resolver follows only a whole-value alias, so braces inside a string stay as written
		expect(checkCssTokenValue('0 1px 2px {color.shadow}', { type: 'shadow' })).toContain("'{'");
		expect(checkCssTokenValue('{color.base}; x: y', { type: 'color' })).toContain(
			'can end or escape',
		);
	});

	it('passes as an alias or reference only what the resolver follows', () => {
		const color = { type: 'color' };
		expect(checkCssTokenValue(' {x</style><script>alert(1)</script>}', color)).not.toBeNull();
		expect(checkCssTokenValue(' {x;color:red}', color)).not.toBeNull();
		expect(checkCssTokenValue('{x;color:red}', color)).not.toBeNull();
		expect(checkCssTokenValue(' {color.base}', color)).not.toBeNull();
		expect(
			checkCssTokenValue({ ref: '</style><script>alert(2)</script>', note: 1 }, color),
		).not.toBeNull();
		expect(checkCssTokenValue({ ref: 'color.base', note: 1 }, color)).not.toBeNull();
		expect(checkCssTokenValue({ ref: '</style>' }, color)).not.toBeNull();
		expect(checkCssTokenValue({ ref: 'color.base', transform: 'multiply(2)' }, color)).toBeNull();
	});

	it('checks the keys of a composite as well as its leaves', () => {
		expect(checkCssTokenValue({ 'a": 1); } body { color: red': '1px' })).toContain('key');
		expect(checkCssTokenValue({ '</style>': 'x' })).toContain('key');
	});

	it('holds a platform value to the kind, and every leaf of a composite to the general check', () => {
		expect(checkCssTokenValue({ web: '12px' }, { type: 'color' })).toContain('web is not');
		expect(checkCssTokenValue({ web: '#fff', ios: 'UIColor.white' }, { type: 'color' })).toBeNull();
		expect(
			checkCssTokenValue({ fontFamily: 'Inter', fontSize: '1rem;}' }, { type: 'typography' }),
		).toContain("fontSize holds ';'");
		expect(checkCssTokenValue({ layers: ['0 1px #000', 'url(x)'] })).toContain('layers[1]');
	});

	it('names the token in the error the exports throw', () => {
		const error = new UnsafeCssValueError('color.page', "the value holds ';'");
		expect(error.message).toBe("Token 'color.page': the value holds ';'");
		expect(error.tokenId).toBe('color.page');
	});

	describe('checkCssToken', () => {
		const token = (id: string, value: unknown, extra: Record<string, unknown> = {}) => ({
			id,
			value,
			resolvedValue: typeof value === 'object' ? JSON.stringify(value) : value,
			...extra,
		});

		it('refuses an id that cannot be a CSS name', () => {
			expect(checkCssToken(token('color.page', '#fff'))).toBeNull();
			expect(checkCssToken(token('a;}body{background:red}x{--b', '#fff'))).toContain('its id');
			expect(checkCssToken(token('color.page', '#fff'), 'bad prefix ')).toContain('its id');
		});

		it('checks a composite by its keys and leaves, not its JSON', () => {
			const typography = { fontFamily: 'Inter', fontSize: '16px', fontWeight: 600 };
			expect(
				checkCssToken(token('type.body', typography, { metadata: { type: 'typography' } })),
			).toBeNull();
			expect(checkCssToken(token('type.body', { fontFamily: 'x;}' }))).toContain(
				"fontFamily holds ';'",
			);
		});

		it('checks a platform value and an alias by what they resolve to', () => {
			expect(
				checkCssToken(
					token('c', { web: '#fff' }, { resolvedValue: '#fff', metadata: { type: 'color' } }),
				),
			).toBeNull();
			expect(
				checkCssToken(
					token('c', { ref: 'd' }, { resolvedValue: '12px', metadata: { type: 'color' } }),
				),
			).toContain('is not a colour');
		});
	});
});
