/**
 * @fileoverview The URL and the state, both ways (phase 2 specification, 6.3), in a chunk of its own that
 * loads when stage B ends: everything here runs a late command or answers an event of one, so first
 * paint holds only `parseRoute`, the router's interception and stage A's check (2.4). A person's
 * navigation runs journaled commands; a command, from anyone, moves the URL. While a route is being
 * applied, state to URL waits and compares once at the end, so a traverse never pushes between its
 * commands and Forward survives.
 */

import type { AppSummaryV2, KernelEventV2, LoamKernelV2 } from '@lushly-dev/loam-kernel';
import { formatRoute } from './route-format.js';
import type { RouterV1, RouteV1 } from './router.js';

/** What the URL shows, from `scope-get` and `section-get`, both unjournaled. */
export interface MainStateV1 {
	scope: { project?: string };
	workspace: { id: string };
	project: { slug: string } | null;
	/** Stage A's active scope is not the one `loam.scope` records. */
	pending?: boolean;
	section: string | null;
	path: string;
	active: string | null;
}

/** What the shell gives this chunk: `loam-shell` itself. */
export interface UrlHostV1 {
	readonly kernel: LoamKernelV2 | null;
	readonly base: string;
	readonly ownerDocument: Document;
	readonly router: RouterV1 | null;
	/** The rows `app-list` last gave. */
	readonly appList: readonly AppSummaryV2[];
	readState(): Promise<MainStateV1>;
	/** Main's "Nothing here", or what it shows. */
	route: 'home' | 'not-found';
}

interface NavigationLike {
	navigate(url: string, options: { history: 'push' | 'replace'; info: unknown }): unknown;
}

/** The router's `STATE_INFO`, repeated so this chunk imports no router at run time. */
const STATE_INFO = 'loam-state';

export interface UrlSyncV1 {
	/** Stage B's half of the boot, once. */
	boot(): Promise<void>;
	/** A person's navigation: the router's `onRoute`. */
	navigated(route: RouteV1): Promise<void>;
	/** A kernel event: one with `scopeChanged` or `mainChanged` moves the URL. */
	changed(event: KernelEventV2): void;
}

/**
 * Whether `instance` is an app here that can open, and supports the level the route names: a disabled,
 * failed or refused one fails before any command runs.
 */
export function supports(
	apps: readonly AppSummaryV2[],
	instance: string,
	project: string | undefined
): boolean {
	const app = apps.find((row) => row.instance === instance);
	return (
		(app?.state === 'ready' || app?.state === 'loading') &&
		app.scopeLevels.includes(project === undefined ? 'workspace' : 'project')
	);
}

/** The route that shows `state`, or none while its project is not one the actor may see. */
export function routeOf(state: MainStateV1): RouteV1 | undefined {
	const workspace = state.workspace.id;
	const slug = state.project?.slug;
	if (state.scope.project !== undefined && slug === undefined) return undefined;
	const at = slug === undefined ? { workspace } : { workspace, project: slug };
	const rest = state.path === '' ? [] : state.path.split('/');
	if (state.active !== null) return { kind: 'app', ...at, instance: state.active, rest };
	// A project's home is the projects section in it, with no path (4.3).
	if (state.section !== null && !(slug && state.section === 'projects' && !state.path)) {
		return { kind: 'section', ...at, section: state.section, rest };
	}
	return slug === undefined ? { kind: 'root' } : { kind: 'project', workspace, project: slug };
}

export function createUrlSync(host: UrlHostV1): UrlSyncV1 {
	const kernel = host.kernel as LoamKernelV2;
	const router = host.router as RouterV1;
	const { base } = host;
	const view = host.ownerDocument.defaultView ?? window;
	let queue: Promise<void> = Promise.resolve();
	let applying = 0;
	const queued = (task: () => Promise<void>): Promise<void> => {
		queue = queue.then(task).catch(reportError);
		return queue;
	};

	/**
	 * The journaled commands that make state what `route` names, each only where it differs: `scope-set`,
	 * then `app-open` and `app-route-set`, or `section-open`. A person's navigation to `/` or `/<workspace>`
	 * closes main, by `app-close`, so Back to the session's first entry shows the landing; at boot, `/` shows
	 * what is persisted. False when the route names nothing here, or the kernel refuses it: a slug that is
	 * missing and one the actor may not enter fail alike.
	 */
	async function apply(route: RouteV1, state: MainStateV1, navigated: boolean): Promise<boolean> {
		if (route.kind === 'not-found') return false;
		if (route.kind !== 'root') {
			if (route.workspace !== state.workspace.id) return false;
			if (route.kind === 'app' && !supports(host.appList, route.instance, route.project)) {
				return false;
			}
			const project = route.kind === 'workspace' ? undefined : route.project;
			const here = state.scope.project === undefined ? undefined : (state.project?.slug ?? '');
			if (project !== here) {
				if (!(await kernel.call('scope-set', { project: project ?? null })).success) return false;
				state = await host.readState();
			}
		}
		if (route.kind === 'app') {
			let { path } = state;
			if (state.active !== route.instance) {
				if (!(await kernel.call('app-open', { instance: route.instance })).success) return false;
				path = '';
			}
			const rest = route.rest.join('/');
			return (
				rest === path ||
				(await kernel.call('app-route-set', { instance: route.instance, path: rest })).success
			);
		}
		if (route.kind === 'root' || route.kind === 'workspace') {
			return (
				!navigated ||
				(state.active === null && state.section === null) ||
				(await kernel.call('app-close')).success
			);
		}
		const section = route.kind === 'project' ? 'projects' : route.section;
		const rest = route.kind === 'project' ? '' : route.rest.join('/');
		return (
			(state.active === null && state.section === section && state.path === rest) ||
			(await kernel.call('section-open', { section, path: rest })).success
		);
	}

	/**
	 * Run `task` with state to URL suspended, and show "Nothing here" when it found nothing. `undefined`
	 * leaves what main shows as it was.
	 */
	async function under(task: () => Promise<boolean | undefined>): Promise<boolean | undefined> {
		applying++;
		let found: boolean | undefined = false;
		try {
			found = await task();
		} finally {
			applying--;
			if (found !== undefined) host.route = found ? 'home' : 'not-found';
		}
		return found;
	}

	/** Stage B's half of the boot (6.3). */
	async function boot(): Promise<void> {
		let state = await host.readState();
		// A route stage A found nothing for applies nothing, so a refused project journals no refusal.
		const route: RouteV1 = host.route === 'home' ? router.route : { kind: 'not-found' };
		// An app here that cannot open, or not at this level: as 6.3's `not-found`, the scope goes back to the
		// record's rather than stage A's choice being journaled, as an in-page navigation checks first.
		const refused = route.kind === 'app' && !supports(host.appList, route.instance, route.project);
		const found = await under(async () => {
			if (state.pending) {
				// What stage A chose in memory is journaled, with the persisted record as its `previous` (10).
				let to = state.scope.project ?? null;
				if (refused) {
					const record = await kernel.call<{ state: { project: string | null } }>(
						'view-state-get',
						{
							id: 'loam.scope',
						}
					);
					to = record.data?.state.project ?? null;
				}
				let set = await kernel.call('scope-set', { project: to });
				// The record's project, refused to this actor now: the workspace, as stage A would have chosen.
				if (!set.success && refused && to !== null) {
					set = await kernel.call('scope-set', { project: null });
				}
				// Never apply a route against a state the kernel did not take.
				if (!set.success) return undefined;
				state = await host.readState();
			}
			return !refused && apply(route, state, false);
		});
		if (found) await follow('replace');
	}

	/**
	 * Move the URL to what the state names, when it differs, by a navigation whose `info` the router passes
	 * over, or `history.replaceState` where the Navigation API is absent. `/` and `/<workspace>` stay while the state
	 * names nothing.
	 */
	async function follow(history: 'push' | 'replace'): Promise<void> {
		const state = await host.readState();
		const wanted = routeOf(state);
		const here = view.location.origin + view.location.pathname;
		if (!wanted) return;
		let url: string;
		try {
			url = formatRoute(wanted, base);
		} catch {
			// An app's route with a dot segment: the URL stays where it is (6.1).
			return;
		}
		const workspace = formatRoute({ kind: 'workspace', workspace: state.workspace.id }, base);
		// The URL already names the state: main shows it, so not "Nothing here", as after an app reopened
		// from there.
		if (
			url === here ||
			(wanted.kind === 'root' && [`${url}index.html`, workspace].includes(here))
		) {
			host.route = 'home';
			return;
		}
		const navigation = (view as unknown as { navigation?: NavigationLike }).navigation;
		// Without the API, only a replace: a pushed entry would need a `popstate` listener in first paint,
		// and Back and Forward across whole documents load each URL as a deep link does.
		if (navigation) navigation.navigate(url, { history, info: STATE_INFO });
		else view.history.replaceState(null, '', url);
		host.route = 'home';
	}

	// A person's navigation and an event wait for the boot's own route, which stage B starts (6.3).
	let booted: () => void = () => {};
	const bootStarted = new Promise<void>((resolve) => {
		booted = resolve;
	});

	return {
		boot() {
			const done = queued(boot);
			booted();
			return done;
		},
		async navigated(route) {
			await kernel.appsReady;
			// "Could not load" stays: without the late commands, no route can be applied.
			if (kernel.lateFailure) return;
			await bootStarted;
			return queued(async () => {
				// Once this navigation has finished, so the write does not abort it: the URL follows the state.
				if (await under(async () => apply(route, await host.readState(), true))) {
					setTimeout(() => void queued(() => follow('replace')));
				}
			});
		},
		changed(event) {
			if (!event.success || !(event.scopeChanged || event.mainChanged) || applying > 0) return;
			const history = event.mainChanged ?? 'push';
			void bootStarted.then(() => queued(() => follow(history)));
		},
	};
}
