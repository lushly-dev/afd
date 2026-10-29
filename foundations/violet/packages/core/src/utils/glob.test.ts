import { describe, expect, it } from 'vitest';
import { globToRegExp, matchesGlob } from './glob.js';

describe('glob helper', () => {
	it('lets * cross dots', () => {
		expect(matchesGlob('color.brand.primary', 'color.*')).toBe(true);
		expect(matchesGlob('color.brand.primary', '*.primary')).toBe(true);
		expect(matchesGlob('color.brand.primary', '*')).toBe(true);
	});

	it('treats ** like *', () => {
		expect(matchesGlob('color.brand.primary', 'color.**')).toBe(true);
		expect(matchesGlob('color.brand.primary', '**primary')).toBe(true);
	});

	it('supports ? as a single character', () => {
		expect(matchesGlob('space.1', 'space.?')).toBe(true);
		expect(matchesGlob('space.10', 'space.?')).toBe(false);
	});

	it('anchors the pattern on both ends', () => {
		expect(matchesGlob('node.list', 'node.*')).toBe(true);
		expect(matchesGlob('compare.nodes', 'node.*')).toBe(false);
		expect(matchesGlob('color.brand', 'color')).toBe(false);
	});

	it('treats dots literally', () => {
		expect(matchesGlob('colorXbrand', 'color.brand')).toBe(false);
	});

	it('does not throw on regex metacharacters', () => {
		for (const pattern of ['(', '[', 'a(b', '[a-', '{1,', '\\', '+', '^$|', 'a)b']) {
			expect(() => globToRegExp(pattern)).not.toThrow();
		}
		expect(matchesGlob('color(1)', 'color(1)')).toBe(true);
		expect(matchesGlob('color[0]', 'color[0]')).toBe(true);
		expect(matchesGlob('color0', 'color[0]')).toBe(false);
		expect(matchesGlob('a+b', 'a+b')).toBe(true);
		expect(matchesGlob('aab', 'a+b')).toBe(false);
	});
});
