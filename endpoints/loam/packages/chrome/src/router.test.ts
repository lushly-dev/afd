/**
 * P2-E8 (phase 2 specification, section 15), its units: `parseRoute` and `formatRoute` over each shape of
 * 6.1, round trips, and hostile paths, each `not-found` or literal text.
 */
import { describe, expect, it } from 'vitest';
import { formatRoute } from './route-format.js';
import { createRouter, parseRoute, type RouteV1, STATE_INFO } from './router.js';

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
		['assets/index-a1.js', "one of the deployment's files"],
		['apps/hello/app-manifest.json', "one of the deployment's files"],
		['mounts/hello/mcp', 'a reserved workspace'],
		['sandbox/proxy.html', 'a reserved workspace'],
		['p', 'a reserved workspace'],
		['~', 'a reserved workspace'],
		['deployment.json', "one of the deployment's files"],
		['404.html', "one of the deployment's files"],
		['Acme', 'an upper-case workspace'],
		['%61cme', 'a percent-encoded workspace, never decoded'],
		['acme//hello', 'an empty segment'],
		['acme/p', 'a project marker with no slug'],
		['acme/p/-atlas', 'a slug off its pattern'],
		['acme/p/__proto__', 'a slug off its pattern'],
		['acme/__proto__', 'an instance off its pattern'],
		['acme/p/atlas/p', 'an instance of `p`'],
		['acme/~', 'a section marker with no section'],
		['acme/~/settings', 'an unknown section'],
		['acme/hello/a%2Fb', 'an encoded slash in the rest'],
		['acme/hello/a%5Cb%2F..', 'an encoded slash and dot segment'],
		['acme/hello/%2E%2E%2F', 'a segment that decodes to ../, which the URL parser keeps'],
		['acme/hello/%E0%A4%A', 'a segment that does not decode'],
		[`acme/hello/${'a'.repeat(10_000)}`, 'a 10,000-character segment'],
		[`acme/hello/${'a'.repeat(600)}/${'b'.repeat(424)}`, 'a rest of 1,025 characters'],
		[`acme/${'a'.repeat(10_000)}`, 'a 10,000-character instance'],
		// A trailing slash, in every shape, and an empty segment anywhere (6.1).
		['acme/', 'a trailing slash'],
		['acme/p/', 'an empty slug'],
		['acme/p/atlas/', 'a trailing slash'],
		['acme/~/projects/', 'a trailing slash'],
		['acme/hello/', 'a trailing slash'],
		['acme/hello/a//b', 'an empty segment in the rest'],
	])('P2-E8: %s is not-found (%s)', (url, _why) => {
		const route = parseRoute(url.startsWith('http') || url.startsWith('/') ? url : at(url), base);
		expect(route).toEqual({ kind: 'not-found' });
	});

	it('P2-E8: holds a rest of exactly 1,024 characters', () => {
		const route = parseRoute(at(`acme/hello/${'a'.repeat(600)}/${'b'.repeat(423)}`), base);
		expect(route).toMatchObject({ kind: 'app', rest: ['a'.repeat(600), 'b'.repeat(423)] });
	});

	it('P2-E8: reads a name that only fits an instance as one, as text', () => {
		expect(parseRoute(at('acme/constructor/x'), base)).toEqual({
			kind: 'app',
			workspace: 'acme',
			instance: 'constructor',
			rest: ['x'],
		});
	});

	it('P2-E8: an encoded dot segment is walked by the URL parser before routing ever sees it', () => {
		// WHATWG resolves `%2E%2E` as `..`, so this names the app `x`, as `/acme/x` does.
		expect(parseRoute(at('acme/hello/%2E%2E/x'), base)).toEqual({
			kind: 'app',
			workspace: 'acme',
			instance: 'x',
			rest: [],
		});
	});

	it('P2-E8: the base without its trailing slash is outside it', () => {
		const root = new URL(base).href;
		if (root.endsWith('/loam/')) expect(parseRoute(root.slice(0, -1), base).kind).toBe('not-found');
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
		for (const rest of [['..'], ['.'], ['a', '..', 'b'], ['a/b'], ['a', '']]) {
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
		for (const workspace of ['', '/', '//evil.example', 'a/../../b']) {
			expect(() => formatRoute({ kind: 'workspace', workspace }, base)).toThrow(TypeError);
		}
		for (const workspace of ['https:', '%2e%2e', '?x', '#x', '\\evil.example']) {
			const url = new URL(formatRoute({ kind: 'workspace', workspace }, base));
			expect(url.origin).toBe(ORIGIN);
			expect(url.pathname.startsWith(new URL(base).pathname)).toBe(true);
			expect(url.search + url.hash).toBe('');
		}
	});
});

describe('P2-E8: what the router intercepts', () => {
	const BASE = `${ORIGIN}/loam/`;

	/** A page with the Navigation API, and a navigation as the browser dispatches it. */
	function routed() {
		const navigation = new EventTarget();
		const view = { location: new URL(`${BASE}acme`), navigation } as unknown as Window;
		const seen: RouteV1[] = [];
		const router = createRouter(view, BASE, (route) => {
			seen.push(route);
		});
		const navigate = (url: string, extra: Record<string, unknown> = {}) => {
			let options: { handler(): unknown; focusReset?: string } | undefined;
			const event = Object.assign(new Event('navigate'), {
				canIntercept: true,
				hashChange: false,
				downloadRequest: null,
				formData: null,
				navigationType: 'push',
				destination: { url },
				intercept(given: typeof options) {
					options = given;
				},
				...extra,
			});
			navigation.dispatchEvent(event);
			return options;
		};
		return { router, seen, navigate };
	}

	it("P2-E8: intercepts a shape under the base, and gives the person's navigation to onRoute", async () => {
		const { router, seen, navigate } = routed();
		const options = navigate(`${BASE}acme/hello/x`);
		expect(options?.focusReset).toBeUndefined();
		await options?.handler();
		expect(seen).toEqual([{ kind: 'app', workspace: 'acme', instance: 'hello', rest: ['x'] }]);
		expect(router.route).toEqual(seen[0]);
	});

	it("P2-E8: intercepts the shell's own write, keeps focus, and gives it to no one", async () => {
		const { router, seen, navigate } = routed();
		const options = navigate(`${BASE}acme/p/atlas`, { info: STATE_INFO });
		expect(options?.focusReset).toBe('manual');
		await options?.handler();
		expect(seen).toEqual([]);
		expect(router.route).toEqual({ kind: 'project', workspace: 'acme', project: 'atlas' });
	});

	it.each([
		['another origin', 'http://evil.example/loam/acme', {}],
		['outside the base', `${ORIGIN}/acme`, {}],
		["the deployment's assets", `${BASE}assets/index-a1.js`, {}],
		["an app's package", `${BASE}apps/hello/app-manifest.json`, {}],
		['the projection', `${BASE}deployment.json`, {}],
		['404.html', `${BASE}404.html`, {}],
		['the sandbox', `${BASE}sandbox/proxy.html`, {}],
		['a malformed route', `${BASE}acme/hello/`, {}],
		['a form submission', `${BASE}acme/hello`, { formData: {} }],
		['a reload', `${BASE}acme`, { navigationType: 'reload' }],
		['a hash change', `${BASE}acme#x`, { hashChange: true }],
		['a download', `${BASE}acme/hello`, { downloadRequest: 'file.txt' }],
		['what the browser does not let it', `${BASE}acme/hello`, { canIntercept: false }],
	])('P2-E8: leaves %s to the browser', (_name, url, extra) => {
		const { seen, navigate } = routed();
		expect(navigate(url, extra)).toBeUndefined();
		expect(seen).toEqual([]);
	});
});
