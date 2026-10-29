import { describe, expect, it } from 'vitest';
import {
	cssLengthToPx,
	durationToMs,
	safeCssColor,
	safeCssLength,
	safeCssNumber,
	safeDuration,
	safeEasing,
	safeFontFamily,
	safeShadow,
} from './safe-css.js';

/**
 * Values an attacker who can write a token might try, to break out of a style
 * declaration, load a resource or run script. Every validator rejects all of them.
 */
const HOSTILE = [
	'url(https://evil.example/x.png)',
	'url(javascript:alert(1))',
	'expression(alert(1))',
	'red;background:url(x)',
	'16px;}body{display:none',
	'16px }',
	'}',
	'{',
	'/* comment */ 16px',
	'16px/**/',
	'\\75 rl(x)',
	'\\31 6px',
	'16px\\',
	'"Segoe UI"; x: y',
	"'a'}",
	'</style><script>alert(1)</script>',
	'<img src=x onerror=alert(1)>',
	'16px !important',
	'var(--x)',
	'calc(1px + 1px)',
	'attr(data-x)',
	'image-set("x.png" 1x)',
	'env(safe-area-inset-top)',
	'16px\n}',
	'16px\u0000',
	'@import "x"',
	'',
	'   ',
];

const VALIDATORS = {
	safeCssColor,
	safeCssLength,
	safeFontFamily,
	safeShadow,
	safeDuration,
	safeEasing,
	safeCssNumber: (value: unknown) => safeCssNumber(value),
};

describe('CSS validators reject hostile input', () => {
	for (const [name, validate] of Object.entries(VALIDATORS)) {
		it(`${name} rejects every hostile value`, () => {
			for (const value of HOSTILE) {
				expect(validate(value), `${name}(${JSON.stringify(value)})`).toBeNull();
			}
		});

		it(`${name} rejects non-strings and very long input`, () => {
			for (const value of [null, undefined, {}, [], ['16px'], { toString: () => '16px' }, true]) {
				expect(validate(value)).toBeNull();
			}
			expect(validate(`${'1'.repeat(10_000)}px`)).toBeNull();
			expect(validate(`${'a'.repeat(100_000)}`)).toBeNull();
			expect(validate(`0 0 0 ${'#000 '.repeat(500)}`)).toBeNull();
		});
	}
});

describe('safeCssColor', () => {
	it('accepts hex and functional colours', () => {
		expect(safeCssColor('#0078D4')).toBe('#0078D4');
		expect(safeCssColor(' #fff ')).toBe('#fff');
		expect(safeCssColor('rgba(0, 0, 0, 0.12)')).toBe('rgba(0, 0, 0, 0.12)');
		expect(safeCssColor('hsl(210 70% 40%)')).toBe('hsl(210 70% 40%)');
	});

	it('rejects names and malformed values', () => {
		expect(safeCssColor('red')).toBeNull();
		expect(safeCssColor('#12345')).toBeNull();
		expect(safeCssColor('rgb(0, 0)')).toBeNull();
		expect(safeCssColor('rgb(0, 0, 0); color: red')).toBeNull();
	});
});

describe('safeCssLength', () => {
	it('accepts single lengths and normalizes units', () => {
		expect(safeCssLength('16px')).toBe('16px');
		expect(safeCssLength('1.5REM')).toBe('1.5rem');
		expect(safeCssLength('-0.02em')).toBe('-0.02em');
		expect(safeCssLength('.5em')).toBe('.5em');
		expect(safeCssLength('50%')).toBe('50%');
		expect(safeCssLength('0')).toBe('0');
		expect(safeCssLength('0px')).toBe('0px');
		expect(safeCssLength(0)).toBe('0');
	});

	it('rejects unitless numbers, lists and unknown units', () => {
		expect(safeCssLength(16)).toBeNull();
		expect(safeCssLength('16')).toBeNull();
		expect(safeCssLength('16px 8px')).toBeNull();
		expect(safeCssLength('16furlongs')).toBeNull();
		expect(safeCssLength('1e3px')).toBeNull();
		expect(safeCssLength('--16px')).toBeNull();
		expect(safeCssLength('1234567px')).toBeNull();
	});

	it('converts absolute lengths to pixels', () => {
		expect(cssLengthToPx('16px')).toBe(16);
		expect(cssLengthToPx('1.5rem')).toBe(24);
		expect(cssLengthToPx('-2px')).toBe(-2);
		expect(cssLengthToPx('0')).toBe(0);
		expect(cssLengthToPx('50%')).toBeNull();
	});
});

describe('safeCssNumber', () => {
	it('accepts numbers within bounds', () => {
		expect(safeCssNumber(600, { min: 1, max: 1000 })).toBe('600');
		expect(safeCssNumber('1.43')).toBe('1.43');
		expect(safeCssNumber(1001, { min: 1, max: 1000 })).toBeNull();
		expect(safeCssNumber(Number.NaN)).toBeNull();
		expect(safeCssNumber(Number.POSITIVE_INFINITY)).toBeNull();
		expect(safeCssNumber('1e3')).toBeNull();
	});
});

describe('safeFontFamily', () => {
	it('accepts family lists and rebuilds them', () => {
		expect(safeFontFamily('Segoe UI, system-ui, sans-serif')).toBe(
			'Segoe UI, system-ui, sans-serif',
		);
		expect(safeFontFamily("'Cascadia Code',Consolas,  monospace")).toBe(
			'"Cascadia Code", Consolas, monospace',
		);
		expect(safeFontFamily('"Font Awesome 6.0"')).toBe('"Font Awesome 6.0"');
		expect(safeFontFamily('Segoe   UI   Variable')).toBe('Segoe UI Variable');
	});

	it('rejects keywords, empty names, unbalanced quotes and digits first', () => {
		expect(safeFontFamily('inherit')).toBeNull();
		expect(safeFontFamily('Arial, initial')).toBeNull();
		expect(safeFontFamily('Arial,,serif')).toBeNull();
		expect(safeFontFamily('"Arial')).toBeNull();
		expect(safeFontFamily('"Arial\'')).toBeNull();
		expect(safeFontFamily('3D Font')).toBeNull();
		expect(safeFontFamily('"a"b"')).toBeNull();
		expect(safeFontFamily(Array.from({ length: 11 }, (_, i) => `F${i}`).join(','))).toBeNull();
	});
});

describe('safeShadow', () => {
	it('accepts box shadows and rebuilds them', () => {
		expect(safeShadow('none')).toBe('none');
		expect(safeShadow('0 4px 8px rgba(0, 0, 0, 0.12)')).toBe('0 4px 8px rgba(0, 0, 0, 0.12)');
		expect(safeShadow('0  1px 2px #0002, inset 0 0 0 1px #fff')).toBe(
			'0 1px 2px #0002, inset 0 0 0 1px #fff',
		);
		expect(safeShadow('#000 2px 2px')).toBe('2px 2px #000');
		expect(safeShadow('2px 2px 4px transparent inset')).toBe('inset 2px 2px 4px transparent');
	});

	it('rejects malformed layers', () => {
		expect(safeShadow('4px')).toBeNull();
		expect(safeShadow('1px 2px 3px 4px 5px')).toBeNull();
		expect(safeShadow('1px 2px #000 #fff')).toBeNull();
		expect(safeShadow('1px #000 2px')).toBeNull();
		expect(safeShadow('inset inset 1px 2px')).toBeNull();
		expect(safeShadow('0 0 0 red')).toBeNull();
		expect(safeShadow('0 0 rgb((0,0,0))')).toBeNull();
		expect(safeShadow('0 0 rgb(0,0,0')).toBeNull();
		expect(safeShadow('0 0 #000,')).toBeNull();
		expect(safeShadow(Array.from({ length: 7 }, () => '0 0 #000').join(','))).toBeNull();
	});
});

describe('safeDuration', () => {
	it('accepts times up to a minute', () => {
		expect(safeDuration('200ms')).toBe('200ms');
		expect(safeDuration('0.3S')).toBe('0.3s');
		expect(safeDuration('60s')).toBe('60s');
		expect(durationToMs('0.3s')).toBe(300);
		expect(durationToMs('200ms')).toBe(200);
	});

	it('rejects negatives, unitless and long durations', () => {
		expect(safeDuration('-200ms')).toBeNull();
		expect(safeDuration(200)).toBeNull();
		expect(safeDuration('200')).toBeNull();
		expect(safeDuration('61s')).toBeNull();
		expect(safeDuration('200ms 100ms')).toBeNull();
	});
});

describe('safeEasing', () => {
	it('accepts keywords, cubic-bezier and steps', () => {
		expect(safeEasing('ease-out')).toBe('ease-out');
		expect(safeEasing('Linear')).toBe('linear');
		expect(safeEasing('cubic-bezier(0.33, 0, 0.67, 1)')).toBe('cubic-bezier(0.33, 0, 0.67, 1)');
		expect(safeEasing('cubic-bezier(.2,-0.5,.1,1.5)')).toBe('cubic-bezier(0.2, -0.5, 0.1, 1.5)');
		expect(safeEasing('steps(4, jump-end)')).toBe('steps(4, jump-end)');
		expect(safeEasing('steps(2)')).toBe('steps(2)');
	});

	it('rejects out-of-range and unknown functions', () => {
		expect(safeEasing('cubic-bezier(2, 0, 0, 1)')).toBeNull();
		expect(safeEasing('cubic-bezier(0, 0, 1)')).toBeNull();
		expect(safeEasing('cubic-bezier(0, 0, 1, x)')).toBeNull();
		expect(safeEasing('steps(0)')).toBeNull();
		expect(safeEasing('linear(0, 1)')).toBeNull();
		expect(safeEasing('spring(1)')).toBeNull();
	});
});
