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
const ATLAS = { id: 'prj_atlas', slug: 'atlas' };
const BEACON = { id: 'prj_beacon', slug: 'beacon' };
const PROJECTS: Record<string, { id: string; slug: string }> = {
	atlas: ATLAS,
	prj_atlas: ATLAS,
	beacon: BEACON,
	prj_beacon: BEACON,
};

/** What the queue reported: nothing, in every test. Node has no `reportError`. */
const reported: unknown[] = [];
vi.stubGlobal('reportError', (error: unknown) => reported.push(error));
afterEach(async () => {
	// A replace after a navigation waits for a timer: let each one run in its own test.
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(reported.splice(0)).toEqual([]);
});

const app = (
	instance: string,
	scopeLevels: AppSummaryV2['scopeLevels'],
	state: AppSummaryV2['state'] = 'ready'
) => ({ instance, scopeLevels, state }) as AppSummaryV2;

interface FixtureOptions {
	/** `loam.scope`'s project id, which `view-state-get` answers. */
	record?: string | null;
	/** Slugs or ids `scope-set` refuses as it does a project the actor may not enter. */
	refused?: string[];
	/** Run the boot first, and forget what it did, as a page after stage B. Default true. */
	booted?: boolean;
	route?: RouteV1;
	lateFailure?: boolean;
}

/** A shell and a kernel holding `state`; `scope-set` fails for a slug it does not hold. */
async function fixture(
	path = '',
	initial: Partial<MainStateV1> = {},
	options: FixtureOptions = {}
) {
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
		appsReady: Promise.resolve(),
		lateFailure: options.lateFailure ? { code: 'LATE_COMMANDS_UNAVAILABLE' } : undefined,
		async call(name: string, input: Record<string, unknown> = {}) {
			calls.push([name, input]);
			if (name === 'view-state-get') {
				return {
					success: true,
					data: { id: 'loam.scope', state: { project: options.record ?? null } },
				};
			}
			if (name === 'scope-set') {
				const project = input.project === null ? undefined : PROJECTS[input.project as string];
				if (
					(input.project !== null && !project) ||
					options.refused?.includes(input.project as string)
				) {
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
			if (name === 'app-close') state = { ...state, active: null, section: null, path: '' };
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
					navigate(url: string, given: { history: string; info: unknown }) {
						expect(given.info).toBe('loam-state');
						moves.push([given.history, url]);
						location.pathname = new URL(url).pathname;
					},
				},
			},
		} as unknown as Document,
		router: { route: options.route ?? { kind: 'root' }, dispose() {} } as RouterV1,
		appList: [
			app('hello', ['workspace', 'project']),
			app('counter', ['workspace']),
			app('off', ['workspace', 'project'], 'disabled'),
			app('broken', ['workspace', 'project'], 'failed'),
		],
		readState: async () => structuredClone(state),
		route: 'home',
	};
	const sync = createUrlSync(host);
	if (options.booted !== false) {
		await sync.boot();
		calls.length = 0;
		moves.length = 0;
	}
	const timers = () => new Promise((resolve) => setTimeout(resolve, 5));
	/** What ran but the unjournaled reads. */
	const commands = () => calls.filter(([name]) => !/^(scope|section)-get$/.test(name));
	return { calls, commands, moves, host, kernel, sync, timers };
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
		const { commands, moves, host, sync, timers } = await fixture();
		await sync.navigated({
			kind: 'app',
			workspace: 'acme',
			project: 'atlas',
			instance: 'hello',
			rest: ['a b', 'c'],
		});
		expect(commands()).toEqual([
			['scope-set', { project: 'atlas' }],
			['app-open', { instance: 'hello' }],
			['app-route-set', { instance: 'hello', path: 'a b/c' }],
		]);
		expect(host.route).toBe('home');
		await timers();
		expect(moves).toEqual([['replace', `${BASE}acme/p/atlas/hello/a%20b/c`]]);
	});

	it('P2-E8: runs nothing for what already holds, and opens a project home as the projects section', async () => {
		const { commands, sync } = await fixture('acme/hello/x', { active: 'hello', path: 'x' });
		await sync.navigated({ kind: 'app', workspace: 'acme', instance: 'hello', rest: ['x'] });
		expect(commands()).toEqual([]);
		await sync.navigated({ kind: 'project', workspace: 'acme', project: 'atlas' });
		expect(commands()).toEqual([
			['scope-set', { project: 'atlas' }],
			['section-open', { section: 'projects', path: '' }],
		]);
	});

	it.each<[string, Partial<MainStateV1>]>([
		['an app open', { active: 'hello' }],
		['a section open', { section: 'projects' }],
	])('P2-E8: Back to / with %s closes main, so the landing shows', async (_name, initial) => {
		const { commands, host, sync } = await fixture('acme/x', initial);
		await sync.navigated({ kind: 'root' });
		expect(commands()).toEqual([['app-close', {}]]);
		expect(host.route).toBe('home');
	});

	it('P2-E8: Back to /<workspace> leaves the project and closes main; with nothing open, nothing runs', async () => {
		const atlas = { scope: { project: ATLAS.id }, project: ATLAS, active: 'hello' };
		const { commands, sync } = await fixture('acme/p/atlas/hello', atlas);
		await sync.navigated({ kind: 'workspace', workspace: 'acme' });
		expect(commands()).toEqual([
			['scope-set', { project: null }],
			['app-close', {}],
		]);
		const idle = await fixture('acme/x');
		await idle.sync.navigated({ kind: 'root' });
		expect(idle.commands()).toEqual([]);
	});

	it.each<[string, RouteV1]>([
		['another workspace', { kind: 'workspace', workspace: 'elsewhere' }],
		['an app that does not exist', { kind: 'app', workspace: 'acme', instance: 'nope', rest: [] }],
		[
			'a workspace-only app in a project',
			{ kind: 'app', workspace: 'acme', project: 'atlas', instance: 'counter', rest: [] },
		],
		['a disabled app', { kind: 'app', workspace: 'acme', instance: 'off', rest: [] }],
		[
			'a failed app',
			{ kind: 'app', workspace: 'acme', project: 'atlas', instance: 'broken', rest: [] },
		],
		['not-found', { kind: 'not-found' }],
	])('P2-E8: %s is "Nothing here", with no command', async (_name, route) => {
		const { commands, host, sync } = await fixture();
		await sync.navigated(route);
		expect(commands()).toEqual([]);
		expect(host.route).toBe('not-found');
	});

	it('P2-E8: a slug the kernel refuses is "Nothing here", and nothing after it runs', async () => {
		const { commands, host, moves, sync, timers } = await fixture();
		await sync.navigated({
			kind: 'app',
			workspace: 'acme',
			project: 'vault',
			instance: 'hello',
			rest: [],
		});
		expect(commands()).toEqual([['scope-set', { project: 'vault' }]]);
		expect(host.route).toBe('not-found');
		await timers();
		expect(moves).toEqual([]);
	});

	it('P2-E8: a navigation before the boot waits for it, and runs after its route', async () => {
		const { commands, sync } = await fixture('', {}, { booted: false });
		const early = sync.navigated({ kind: 'app', workspace: 'acme', instance: 'hello', rest: [] });
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(commands()).toEqual([]);
		await sync.boot();
		await early;
		expect(commands()).toEqual([['app-open', { instance: 'hello' }]]);
	});

	it('P2-E8: after the late commands failed, a navigation runs nothing and keeps what main shows', async () => {
		const { commands, host, sync } = await fixture('', {}, { booted: false, lateFailure: true });
		await sync.navigated({
			kind: 'app',
			workspace: 'acme',
			project: 'atlas',
			instance: 'hello',
			rest: [],
		});
		expect(commands()).toEqual([]);
		expect(host.route).toBe('home');
	});
});

describe('P2-E8: a command moves the URL', () => {
	it('P2-E8: pushes or replaces as mainChanged says, and not while a route is being applied', async () => {
		const { kernel, moves, sync, timers } = await fixture('acme/hello', { active: 'hello' });
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
		expect(moves).toEqual([['replace', `${BASE}acme/p/atlas`]]);
		kernel.call = call;
		moves.length = 0;
		await call('app-open', { instance: 'hello' });
		sync.changed(event({ command: 'app-open', mainChanged: 'push' }));
		await timers();
		await call('app-route-set', { instance: 'hello', path: 'x' });
		// An app's own route replaces, as the kernel says for a port's call.
		sync.changed(event({ command: 'app-route-set', caller: 'hello', mainChanged: 'replace' }));
		await timers();
		expect(moves).toEqual([
			['push', `${BASE}acme/p/atlas/hello`],
			['replace', `${BASE}acme/p/atlas/hello/x`],
		]);
	});

	it('P2-E8: ignores a failure, and an event that changes neither scope nor main', async () => {
		const { moves, sync, timers } = await fixture('', { active: 'hello' }, { booted: false });
		await sync.boot();
		moves.length = 0;
		sync.changed(event({ success: false, mainChanged: 'push' }));
		sync.changed(event({ command: 'layout-set' }));
		await timers();
		expect(moves).toEqual([]);
	});

	it("P2-E8: keeps the URL where it is for an app's path with a dot segment", async () => {
		const { moves, sync, timers } = await fixture('acme/hello', {
			active: 'hello',
			path: 'a/../b',
		});
		sync.changed(event({ command: 'app-route-set', mainChanged: 'push' }));
		await timers();
		expect(moves).toEqual([]);
	});

	it('P2-E8: an app reopened from "Nothing here" brings main and the URL back to it', async () => {
		const { host, moves, sync, timers } = await fixture(
			'acme/p/nowhere',
			{ active: 'hello' },
			{ booted: false, route: { kind: 'not-found' } }
		);
		host.route = 'not-found';
		await sync.boot();
		expect(moves).toEqual([]);
		// `app-open` of the active app reports `mainChanged` though nothing in `loam.apps` changed.
		sync.changed(event({ command: 'app-open', mainChanged: 'push' }));
		await timers();
		expect(moves).toEqual([['push', `${BASE}acme/hello`]]);
		expect(host.route).toBe('home');
		// Where the URL already names it, main shows it again.
		host.route = 'not-found';
		sync.changed(event({ command: 'app-open', mainChanged: 'push' }));
		await timers();
		expect(host.route).toBe('home');
	});
});

describe('P2-E8: the boot (6.3)', () => {
	it("P2-E8: journals stage A's choice first, with the active project's id", async () => {
		const { commands, sync } = await fixture(
			'acme/p/atlas',
			{ scope: { project: ATLAS.id }, project: ATLAS, pending: true, section: 'projects' },
			{ booted: false, route: { kind: 'project', workspace: 'acme', project: 'atlas' } }
		);
		await sync.boot();
		expect(commands()).toEqual([['scope-set', { project: ATLAS.id }]]);
	});

	it('P2-E8: a reload refused its project: scope-set { project: null }, and a not-found route applies nothing', async () => {
		const { commands, host, moves, sync } = await fixture(
			'acme/p/vault',
			{ pending: true },
			{ booted: false, route: { kind: 'project', workspace: 'acme', project: 'vault' } }
		);
		host.route = 'not-found';
		await sync.boot();
		expect(commands()).toEqual([['scope-set', { project: null }]]);
		expect(host.route).toBe('not-found');
		expect(moves).toEqual([]);
	});

	it("P2-E8: an app route that cannot open puts the scope back to the record's, not stage A's", async () => {
		const bogus: RouteV1 = {
			kind: 'app',
			workspace: 'acme',
			project: 'atlas',
			instance: 'bogus',
			rest: [],
		};
		const inAtlas = { scope: { project: ATLAS.id }, project: ATLAS, pending: true };
		const { commands, host, moves, sync } = await fixture('acme/p/atlas/bogus', inAtlas, {
			booted: false,
			route: bogus,
			record: BEACON.id,
		});
		await sync.boot();
		expect(commands()).toEqual([
			['view-state-get', { id: 'loam.scope' }],
			['scope-set', { project: BEACON.id }],
		]);
		expect(host.route).toBe('not-found');
		expect(moves).toEqual([]);
		// The record's project, refused to this actor now: the workspace.
		const refused = await fixture('acme/p/atlas/bogus', inAtlas, {
			booted: false,
			route: bogus,
			record: BEACON.id,
			refused: [BEACON.id],
		});
		await refused.sync.boot();
		expect(refused.commands().slice(1)).toEqual([
			['scope-set', { project: BEACON.id }],
			['scope-set', { project: null }],
		]);
	});

	it("P2-E8: stops when the kernel refuses stage B's scope-set, and applies nothing against stale state", async () => {
		const { commands, host, moves, sync } = await fixture(
			'acme/p/atlas/hello',
			{ scope: { project: ATLAS.id }, project: ATLAS, pending: true },
			{
				booted: false,
				refused: [ATLAS.id],
				route: { kind: 'app', workspace: 'acme', project: 'atlas', instance: 'hello', rest: [] },
			}
		);
		await sync.boot();
		expect(commands()).toEqual([['scope-set', { project: ATLAS.id }]]);
		expect(host.route).toBe('home');
		expect(moves).toEqual([]);
	});

	it('P2-E8: leaves / and /<workspace> alone while the state names nothing, and replaces / for an app', async () => {
		for (const path of ['', 'index.html', 'acme']) {
			const { moves, sync } = await fixture(path, {}, { booted: false });
			await sync.boot();
			expect(moves).toEqual([]);
		}
		const { commands, moves, sync } = await fixture('', { active: 'hello' }, { booted: false });
		await sync.boot();
		// The boot's `/` restores what is persisted, so it closes nothing.
		expect(commands()).toEqual([]);
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
