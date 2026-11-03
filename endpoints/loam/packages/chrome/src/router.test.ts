/**
 * P2-E8 (phase 2 specification, section 15), its units: `parseRoute` and `formatRoute` over each shape of
 * 6.1, round trips, and hostile paths, each `not-found` or literal text.
 */
import { describe, expect, it } from 'vitest';
import { formatRoute } from './route-format.js';
import { parseRoute, type RouteV1 } from './router.js';

const ORIGIN = 'http://127.0.0.1:4173';

describe.each([`${ORIGIN}/`, `${ORIGIN}/loam/`])('P2-E8: the URL scheme under %s', (base) => {
	const at = (path: string) => new URL(path, base).href;

	const SHAPES: Array<[string, RouteV1]> = [
		['', { kind: 'root' }],
		['acme', { kind: 'workspace', workspace: 'acme' }],
		['acme/~/projects', { kind: 'section', workspace: 'acme', section: 'projects', rest: [] }],
		[
			'acme/~/documents/doc_1234567890',
			{ kind: 'section', workspace: 'acme', section: 'documents', rest: ['doc_1234567890'] },
		],
		['acme/p/atlas', { kind: 'project', workspace: 'acme', project: 'atlas' }],
		[
			'acme/p/atlas/~/projects',
			{ kind: 'section', workspace: 'acme', project: 'atlas', section: 'projects', rest: [] },
		],
		[
			'acme/p/atlas/hello/items/42',
			{
				kind: 'app',
				workspace: 'acme',
				project: 'atlas',
				instance: 'hello',
				rest: ['items', '42'],
			},
		],
		['acme/hello', { kind: 'app', workspace: 'acme', instance: 'hello', rest: [] }],
		[
			'acme/hello/a%20b/c%3Fd/%C3%A9',
			{ kind: 'app', workspace: 'acme', instance: 'hello', rest: ['a b', 'c?d', 'é'] },
		],
		[
			'acme/hello/a//b',
			{ kind: 'app', workspace: 'acme', instance: 'hello', rest: ['a', '', 'b'] },
		],
	];

	it.each(SHAPES)('P2-E8: parses /%s', (path, route) => {
		expect(parseRoute(at(path), base)).toEqual(route);
	});

	it.each(SHAPES)('P2-E8: formats /%s back to the same URL', (path) => {
		expect(formatRoute(parseRoute(at(path), base), base)).toBe(at(path));
	});

	it('P2-E8: reads /index.html as the root, and a relative URL against the base', () => {
		expect(parseRoute(at('index.html'), base)).toEqual({ kind: 'root' });
		expect(parseRoute('acme', base)).toEqual({ kind: 'workspace', workspace: 'acme' });
	});

	it.each([
		// Elsewhere: another origin, outside the base, a reserved or malformed name.
		['http://evil.example/acme', 'another origin'],
		['//evil.example/acme', 'a scheme-relative URL'],
		['\\\\evil.example\\acme', 'backslashes'],
		['apps', 'a reserved workspace'],
		['assets', 'a reserved workspace'],
		['p', 'a reserved workspace'],
		['~', 'a reserved workspace'],
		['deployment.json', 'a file of the deployment'],
		['404.html', 'a file of the deployment'],
		['Acme', 'an upper-case workspace'],
		['%61cme', 'a percent-encoded workspace, never decoded'],
		['acme/', 'an empty segment'],
		['acme//hello', 'an empty segment'],
		['acme/p', 'a project marker with no slug'],
		['acme/p/', 'an empty slug'],
		['acme/p/-atlas', 'a slug off its pattern'],
		['acme/p/__proto__', 'a slug off its pattern'],
		['acme/__proto__', 'an instance off its pattern'],
		['acme/constructor/x', 'an app instance read as text, then a route'],
		['acme/p/atlas/p', 'an instance of `p`'],
		['acme/~', 'a section marker with no section'],
		['acme/~/settings', 'an unknown section'],
		['acme/hello/a%2Fb', 'an encoded slash in the rest'],
		['acme/hello/a%5Cb%2F..', 'an encoded slash and dot segment'],
		['acme/hello/%2E%2E/x', 'an encoded dot segment'],
		['acme/hello/%E0%A4%A', 'a segment that does not decode'],
		[`acme/hello/${'a'.repeat(10_000)}`, 'a 10,000-character segment'],
		[`acme/${'a'.repeat(10_000)}`, 'a 10,000-character instance'],
	])('P2-E8: %s is not-found, or text (%s)', (url, _why) => {
		const route = parseRoute(url.startsWith('http') || url.startsWith('/') ? url : at(url), base);
		if (route.kind === 'app' || route.kind === 'section') {
			for (const segment of route.rest) expect(segment).not.toMatch(/^\.\.?$|\//);
		} else expect(route).toEqual({ kind: 'not-found' });
	});

	it('P2-E8: holds __proto__ in the rest as literal text, and never as a key', () => {
		const route = parseRoute(at('acme/hello/__proto__'), base);
		expect(route).toEqual({
			kind: 'app',
			workspace: 'acme',
			instance: 'hello',
			rest: ['__proto__'],
		});
		expect(Object.getPrototypeOf(route)).toBe(Object.prototype);
	});

	it('P2-E8: refuses a dot segment, and a not-found route, when formatting', () => {
		const app = { kind: 'app', workspace: 'acme', instance: 'hello' } as const;
		for (const rest of [['..'], ['.'], ['a', '..', 'b'], ['a/b']]) {
			expect(() => formatRoute({ ...app, rest }, base)).toThrow(TypeError);
		}
		expect(() =>
			formatRoute({ kind: 'section', workspace: '..', section: 'projects', rest: [] }, base)
		).toThrow(TypeError);
		expect(() => formatRoute({ kind: 'not-found' }, base)).toThrow(TypeError);
	});

	it('P2-E8: resolves dot segments before routing, so one cannot climb out of the base', () => {
		const climbed = parseRoute(`${new URL(base).href}../acme`, base);
		expect(climbed).toEqual(
			new URL(base).pathname === '/'
				? { kind: 'workspace', workspace: 'acme' }
				: { kind: 'not-found' }
		);
	});

	it('P2-E8: never leaves the base, whatever a segment holds', () => {
		for (const workspace of ['/', '//evil.example', 'a/../../b']) {
			expect(() => formatRoute({ kind: 'workspace', workspace }, base)).toThrow(TypeError);
		}
		for (const workspace of ['', 'https:', '%2e%2e', '?x', '#x', '\\evil.example']) {
			const url = new URL(formatRoute({ kind: 'workspace', workspace }, base));
			expect(url.origin).toBe(ORIGIN);
			expect(url.pathname.startsWith(new URL(base).pathname)).toBe(true);
			expect(url.search + url.hash).toBe('');
		}
	});
});
