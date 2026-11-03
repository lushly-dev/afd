/**
 * P2-E8 (phase 2 specification, section 15), its units: the URL to the state and back (6.3), against a
 * kernel that records each call and a page with the Navigation API's `navigate`. A route runs journaled
 * commands only where the state differs; the URL holds only what the state names, and never a project the
 * actor may not see.
 */
import type { AppSummaryV2, KernelEventV2, LoamKernelV2 } from '@lushly-dev/loam-kernel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouterV1, RouteV1 } from './router.js';
import { createUrlSync, type MainStateV1, routeOf, type UrlHostV1 } from './url-sync.js';

const BASE = 'http://127.0.0.1:4173/loam/';

/** What the queue reported: nothing, in every test. Node has no `reportError`. */
const reported: unknown[] = [];
vi.stubGlobal('reportError', (error: unknown) => reported.push(error));
afterEach(async () => {
	// A replace after a navigation waits for a timer: let each one run in its own test.
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(reported.splice(0)).toEqual([]);
});
const ATLAS = { id: 'prj_atlas', slug: 'atlas' };
const PROJECTS: Record<string, { id: string; slug: string }> = { atlas: ATLAS, prj_atlas: ATLAS };

const app = (instance: string, scopeLevels: AppSummaryV2['scopeLevels']) =>
	({ instance, scopeLevels }) as AppSummaryV2;

/** A shell and a kernel holding `state`; `scope-set` fails for a slug it does not hold. */
function fixture(path = '', initial: Partial<MainStateV1> = {}) {
	const calls: Array<[string, unknown]> = [];
	const moves: Array<[string, string]> = [];
	let state: MainStateV1 = {
		scope: {},
		workspace: { id: 'acme' },
		project: null,
		section: null,
		path: '',
		active: null,
		...initial,
	};
	const location = { origin: 'http://127.0.0.1:4173', pathname: `/loam/${path}` };
	const kernel = {
		async call(name: string, input: Record<string, unknown> = {}) {
			calls.push([name, input]);
			if (name === 'scope-set') {
				const project = input.project === null ? undefined : PROJECTS[input.project as string];
				if (input.project !== null && !project) {
					return { success: false, error: { code: 'PROJECT_NOT_FOUND' } };
				}
				state = {
					...state,
					scope: project ? { project: project.id } : {},
					project: project ?? null,
					path: '',
					pending: false,
				};
			}
			if (name === 'app-open') state = { ...state, active: input.instance as string, path: '' };
			if (name === 'app-route-set') state = { ...state, path: input.path as string };
			if (name === 'section-open') {
				state = {
					...state,
					active: null,
					section: input.section as string,
					path: input.path as string,
				};
			}
			return { success: true, data: {} };
		},
	};
	const host: UrlHostV1 = {
		kernel: kernel as unknown as LoamKernelV2,
		base: BASE,
		ownerDocument: {
			defaultView: {
				location,
				navigation: {
					navigate(url: string, options: { history: string; info: unknown }) {
						expect(options.info).toBe('loam-state');
						moves.push([options.history, url]);
						location.pathname = new URL(url).pathname;
					},
				},
			},
		} as unknown as Document,
		router: { route: { kind: 'root' } as RouteV1, dispose() {} } as RouterV1,
		appList: [app('hello', ['workspace', 'project']), app('counter', ['workspace'])],
		readState: async () => structuredClone(state),
		route: 'home',
	};
	const sync = createUrlSync(host);
	const timers = () => new Promise((resolve) => setTimeout(resolve, 5));
	return { calls, moves, host, kernel, sync, timers };
}

const event = (extra: Partial<KernelEventV2>): KernelEventV2 =>
	({
		command: 'scope-set',
		interface: 'agent',
		success: true,
		mutation: true,
		...extra,
	}) as KernelEventV2;

describe('P2-E8: a route runs journaled commands, only where the state differs', () => {
	it('P2-E8: an app in a project: scope-set, then app-open, then app-route-set, and one replace', async () => {
		const { calls, moves, host, sync, timers } = fixture();
		await sync.navigated({
			kind: 'app',
			workspace: 'acme',
			project: 'atlas',
			instance: 'hello',
			rest: ['a b', 'c'],
		});
		expect(calls.filter(([name]) => !name.endsWith('-get'))).toEqual([
			['scope-set', { project: 'atlas' }],
			['app-open', { instance: 'hello' }],
			['app-route-set', { instance: 'hello', path: 'a b/c' }],
		]);
		expect(host.route).toBe('home');
		await timers();
		await sync.navigated({ kind: 'root' });
		expect(moves).toEqual([['replace', `${BASE}acme/p/atlas/hello/a%20b/c`]]);
	});

	it('P2-E8: runs nothing for what already holds, and opens a project home as the projects section', async () => {
		const { calls, sync } = fixture('', { active: 'hello', path: 'x' });
		await sync.navigated({ kind: 'app', workspace: 'acme', instance: 'hello', rest: ['x'] });
		expect(calls.filter(([name]) => !name.endsWith('-get'))).toEqual([]);
		await sync.navigated({ kind: 'project', workspace: 'acme', project: 'atlas' });
		expect(calls.filter(([name]) => !name.endsWith('-get'))).toEqual([
			['scope-set', { project: 'atlas' }],
			['section-open', { section: 'projects', path: '' }],
		]);
	});

	it.each<[string, RouteV1]>([
		['another workspace', { kind: 'workspace', workspace: 'elsewhere' }],
		['an app that does not exist', { kind: 'app', workspace: 'acme', instance: 'nope', rest: [] }],
		[
			'a workspace-only app in a project',
			{ kind: 'app', workspace: 'acme', project: 'atlas', instance: 'counter', rest: [] },
		],
		['not-found', { kind: 'not-found' }],
	])('P2-E8: %s is "Nothing here", with no command', async (_name, route) => {
		const { calls, host, sync } = fixture();
		await sync.navigated(route);
		expect(calls.filter(([name]) => !name.endsWith('-get'))).toEqual([]);
		expect(host.route).toBe('not-found');
	});

	it('P2-E8: a slug the kernel refuses is "Nothing here", and nothing after it runs', async () => {
		const { calls, host, moves, sync, timers } = fixture();
		await sync.navigated({
			kind: 'app',
			workspace: 'acme',
			project: 'vault',
			instance: 'hello',
			rest: [],
		});
		expect(calls.filter(([name]) => !name.endsWith('-get'))).toEqual([
			['scope-set', { project: 'vault' }],
		]);
		expect(host.route).toBe('not-found');
		await timers();
		expect(moves).toEqual([]);
	});
});

describe('P2-E8: a command moves the URL', () => {
	it('P2-E8: pushes or replaces as mainChanged says, and not while a route is being applied', async () => {
		const { kernel, moves, sync, timers } = fixture('acme/hello', { active: 'hello' });
		const call = kernel.call;
		// Each of the route's own commands reports as the kernel does, before its call returns.
		kernel.call = async (name, input) => {
			const result = await call(name, input);
			sync.changed(event({ command: name, scopeChanged: {} as never, mainChanged: 'push' }));
			return result;
		};
		await sync.navigated({ kind: 'project', workspace: 'acme', project: 'atlas' });
		expect(moves).toEqual([]);
		// Compared once at the end, and replaced, so a traverse never pushes between its commands.
		await timers();
		await sync.navigated({ kind: 'root' });
		expect(moves).toEqual([['replace', `${BASE}acme/p/atlas`]]);
		kernel.call = call;
		moves.length = 0;
		await call('app-open', { instance: 'hello' });
		sync.changed(event({ command: 'app-open', mainChanged: 'push' }));
		await sync.navigated({ kind: 'root' });
		expect(moves).toEqual([['push', `${BASE}acme/p/atlas/hello`]]);
	});

	it('P2-E8: ignores a failure, and an event that changes neither scope nor main', async () => {
		const { moves, sync } = fixture('', { active: 'hello' });
		sync.changed(event({ success: false, mainChanged: 'push' }));
		sync.changed(event({ command: 'layout-set' }));
		await sync.navigated({ kind: 'root' });
		expect(moves).toEqual([]);
	});

	it("P2-E8: keeps the URL where it is for an app's path with a dot segment", async () => {
		const { moves, sync } = fixture('acme/hello', { active: 'hello', path: 'a/../b' });
		sync.changed(event({ command: 'app-route-set', mainChanged: 'push' }));
		await sync.navigated({ kind: 'not-found' });
		expect(moves).toEqual([]);
	});
});

describe('P2-E8: the boot (6.3)', () => {
	it("P2-E8: journals stage A's choice first, with the active project's id", async () => {
		const { calls, sync } = fixture('acme/p/atlas', {
			scope: { project: 'prj_atlas' },
			project: ATLAS,
			pending: true,
			section: 'projects',
		});
		await sync.boot();
		expect(calls.filter(([name]) => !name.endsWith('-get'))[0]).toEqual([
			'scope-set',
			{ project: 'prj_atlas' },
		]);
	});

	it('P2-E8: a reload refused its project: scope-set { project: null }, and a not-found route applies nothing', async () => {
		const { calls, host, moves, sync } = fixture('acme/p/vault', { pending: true });
		host.route = 'not-found';
		await sync.boot();
		expect(calls.filter(([name]) => !name.endsWith('-get'))).toEqual([
			['scope-set', { project: null }],
		]);
		expect(host.route).toBe('not-found');
		expect(moves).toEqual([]);
	});

	it('P2-E8: leaves / and /<workspace> alone while the state names nothing, and replaces / for an app', async () => {
		for (const path of ['', 'index.html', 'acme']) {
			const { moves, sync } = fixture(path);
			await sync.boot();
			expect(moves).toEqual([]);
		}
		const { moves, sync } = fixture('', { active: 'hello' });
		await sync.boot();
		expect(moves).toEqual([['replace', `${BASE}acme/hello`]]);
	});
});

describe('P2-E8: what a URL may hold', () => {
	const base: MainStateV1 = {
		scope: {},
		workspace: { id: 'acme' },
		project: null,
		section: null,
		path: '',
		active: null,
	};

	it('P2-E8: names no project the actor may not see, by name or by id', () => {
		expect(routeOf({ ...base, scope: { project: 'prj_vault' }, project: null })).toBeUndefined();
	});

	it('P2-E8: formats each state as its shape', () => {
		expect(routeOf(base)).toEqual({ kind: 'root' });
		const atlas = { ...base, scope: { project: 'prj_atlas' }, project: ATLAS };
		expect(routeOf(atlas)).toEqual({ kind: 'project', workspace: 'acme', project: 'atlas' });
		expect(routeOf({ ...atlas, section: 'projects' })).toEqual({
			kind: 'project',
			workspace: 'acme',
			project: 'atlas',
		});
		expect(routeOf({ ...atlas, section: 'documents', path: 'doc_1' })).toEqual({
			kind: 'section',
			workspace: 'acme',
			project: 'atlas',
			section: 'documents',
			rest: ['doc_1'],
		});
		expect(routeOf({ ...base, section: 'projects' })).toEqual({
			kind: 'section',
			workspace: 'acme',
			section: 'projects',
			rest: [],
		});
		expect(routeOf({ ...base, active: 'hello', path: 'a/b' })).toEqual({
			kind: 'app',
			workspace: 'acme',
			instance: 'hello',
			rest: ['a', 'b'],
		});
	});
});
