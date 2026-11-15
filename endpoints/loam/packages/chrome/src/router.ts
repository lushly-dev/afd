/**
 * @fileoverview The URL scheme (phase 2 specification, section 6; D74), in first paint: `parseRoute` over
 * the shapes of 6.1, relative to the deployment's base, and the router, which
 * intercepts same-origin navigations through the Navigation API and registers no precommit handler (W6).
 * Five fixed shapes need no pattern language, so there is no URLPattern (R5). The URL is untrusted input:
 * a route only names a place, which the kernel's `decideAccess` then allows or refuses. `formatRoute` is
 * in `route-format.ts`, which only the URL's late chunk imports, so first paint does not hold it (2.4).
 */

export type RouteV1 =
	| { kind: 'root' }
	| { kind: 'workspace'; workspace: string }
	| { kind: 'section'; workspace: string; project?: string; section: string; rest: string[] }
	| { kind: 'project'; workspace: string; project: string }
	| { kind: 'app'; workspace: string; project?: string; instance: string; rest: string[] }
	| { kind: 'not-found' };

/**
 * A workspace, less the segments a deployment's own files use or that would read ambiguously (6.1):
 * `apps`, `assets`, `mounts`, `sandbox` and `p`. `~`, `deployment.json`, `index.html` and `404.html` are
 * reserved too, and already off the pattern.
 */
const WORKSPACE = /^(?!(apps|assets|mounts|sandbox|p)$)[a-z0-9][a-z0-9-]{0,62}$/;
const PROJECT = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
/** An instance id, less `p`, which reads as a project's segment (4.2). */
const INSTANCE = /^(?!p$)[a-z][a-z0-9]{0,31}$/;
const SECTION = /^(projects|documents|account)$/;
const NOT_FOUND: RouteV1 = { kind: 'not-found' };

/**
 * A segment no route holds: an empty one, so a trailing slash is `not-found` in every shape; a dot
 * segment, which `new URL` would walk; or one that decoded to a slash.
 */
const unsafe = (segment: string): boolean =>
	!segment || segment === '.' || segment === '..' || segment.includes('/');

/**
 * The route of `url` against `base`, the deployment's root with its trailing slash. Naming segments
 * are matched as they are, never decoded; `<rest>` is decoded once per segment, and a segment that does
 * not decode, decodes to a dot segment or a slash, or a `<rest>` over 1,024 characters, is `not-found`, as
 * `app-route-set` refuses those.
 */
export function parseRoute(url: string, base: string): RouteV1 {
	const root = new URL(base);
	const target = new URL(url, root);
	const at = target.origin + target.pathname;
	const from = root.origin + root.pathname;
	if (!at.startsWith(from)) return NOT_FOUND;
	const path = at.slice(from.length);
	if (path === '' || path === 'index.html') return { kind: 'root' };
	const [workspace = '', ...more] = path.split('/');
	if (!WORKSPACE.test(workspace)) return NOT_FOUND;
	let project: string | undefined;
	if (more[0] === 'p') {
		project = more[1] ?? '';
		if (!PROJECT.test(project)) return NOT_FOUND;
		more.splice(0, 2);
	}
	const [head, ...encoded] = more;
	if (head === undefined) {
		return project === undefined
			? { kind: 'workspace', workspace }
			: { kind: 'project', workspace, project };
	}
	let rest: string[];
	try {
		rest = encoded.map(decodeURIComponent);
	} catch {
		return NOT_FOUND;
	}
	if (rest.some(unsafe) || rest.join('/').length > 1024) return NOT_FOUND;
	const scoped = project === undefined ? {} : { project };
	if (head === '~') {
		const [section = '', ...tail] = rest;
		// The account section is the workspace's (phase 3 specification, 5.1): never under a project.
		return SECTION.test(section) && !(project && section === 'account')
			? { kind: 'section', workspace, ...scoped, section, rest: tail }
			: NOT_FOUND;
	}
	return INSTANCE.test(head)
		? { kind: 'app', workspace, ...scoped, instance: head, rest }
		: NOT_FOUND;
}

/** The `info` of the router's own writes, which a navigation handler does nothing more for (6.3). */
export const STATE_INFO = 'loam-state';

interface NavigateEventLike extends Event {
	navigationType?: string;
	canIntercept: boolean;
	hashChange: boolean;
	downloadRequest: string | null;
	destination: { url: string };
	formData: unknown;
	info?: unknown;
	intercept(options: { handler: () => Promise<void> | void; focusReset?: 'manual' }): void;
}

export interface RouterV1 {
	/** The route of the document's URL, as of the last navigation the router saw. */
	readonly route: RouteV1;
	dispose(): void;
}

/**
 * Route every same-origin navigation the Navigation API lets the page intercept, and give `onRoute` each
 * one but the shell's own writes, whose `info` is {@link STATE_INFO}: a person's link, Back, Forward or an
 * address typed in the page. Without the API, a link is a full load, which works because a deployment
 * serves the shell at every path (6.2); the shell's writes then replace the entry and never push one, so
 * Back and Forward are full loads too, and nothing listens for `popstate`. The writes are the URL chunk's
 * (`url-sync.ts`), so first paint holds none of them.
 */
export function createRouter(
	view: Window,
	base: string,
	onRoute: (route: RouteV1) => unknown
): RouterV1 {
	let route = parseRoute(view.location.href, base);
	const navigation = (view as unknown as { navigation?: EventTarget }).navigation;
	const listener = (event: Event) => {
		const navigate = event as NavigateEventLike;
		const next = parseRoute(navigate.destination.url, base);
		const own = navigate.info === STATE_INFO;
		// A link or an address to another origin, outside the base or a deployment's own file is `not-found`,
		// and the browser loads it, as it does a form's submission. The shell's own write, and Back or
		// Forward to an entry of this document, stay here, so main shows "Nothing here". A reload reloads.
		if (
			!navigate.canIntercept ||
			navigate.hashChange ||
			navigate.downloadRequest !== null ||
			navigate.formData ||
			navigate.navigationType === 'reload' ||
			(next.kind === 'not-found' && !own && navigate.navigationType !== 'traverse')
		) {
			return;
		}
		// The shell's own write follows a command, so focus stays where the person has it; a person's
		// navigation resets it, as the platform does. The document does not scroll: main does.
		navigate.intercept({
			...(own ? { focusReset: 'manual' } : {}),
			handler: () => {
				route = next;
				if (!own) return onRoute(route) as Promise<void>;
			},
		});
	};
	navigation?.addEventListener('navigate', listener);
	return {
		get route() {
			return route;
		},
		dispose: () => navigation?.removeEventListener('navigate', listener),
	};
}
