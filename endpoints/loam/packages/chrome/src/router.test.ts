import { describe, expect, it } from 'vitest';
import { homePaths, matchRoute } from './router.js';

describe('the router seam', () => {
	const base = 'http://127.0.0.1:4173/';

	it('has one route, the base, and its index.html', () => {
		expect(homePaths(base)).toEqual(['/', '/index.html']);
		expect(matchRoute('http://127.0.0.1:4173/', base)).toBe('home');
		expect(matchRoute('/index.html', base)).toBe('home');
		expect(matchRoute('/elsewhere', base)).toBe('not-found');
		expect(matchRoute('http://example.com/', base)).toBe('not-found');
	});

	it('routes relative to a base that is not the origin root', () => {
		const nested = 'http://127.0.0.1:4173/loam/index.html';
		expect(matchRoute('http://127.0.0.1:4173/loam/', nested)).toBe('home');
		expect(matchRoute('http://127.0.0.1:4173/', nested)).toBe('not-found');
	});

	it('uses URLPattern when the platform has it', () => {
		const Pattern = class {
			constructor(private readonly init: { pathname: string }) {}
			test(input: { pathname: string }) {
				return input.pathname === this.init.pathname;
			}
		};
		expect(matchRoute('/', base, Pattern)).toBe('home');
		expect(matchRoute('/x', base, Pattern)).toBe('not-found');
	});
});
