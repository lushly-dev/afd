/**
 * @fileoverview The router seam (phase 0 specification, section 7): the Navigation API with
 * URLPattern, intercepting same-origin navigations and registering no precommit handler (W6).
 * Phase 0 has one route, `/`, relative to the document's base; phase 2 owns the URL scheme.
 */

export type RouteV0 = 'home' | 'not-found';

interface PatternLike {
	test(input: { pathname: string }): boolean;
}

type PatternConstructor = new (init: { pathname: string }) => PatternLike;

/** The home path of a base URL, and its `index.html`. */
export function homePaths(base: string): string[] {
	const path = new URL('./', base).pathname;
	return [path, `${path}index.html`];
}

/** The route of a URL against the document's base. */
export function matchRoute(url: string, base: string, Pattern?: PatternConstructor): RouteV0 {
	const target = new URL(url, base);
	if (target.origin !== new URL(base).origin) return 'not-found';
	const paths = homePaths(base);
	if (Pattern) {
		const patterns = paths.map((pathname) => new Pattern({ pathname }));
		return patterns.some((pattern) => pattern.test({ pathname: target.pathname }))
			? 'home'
			: 'not-found';
	}
	return paths.includes(target.pathname) ? 'home' : 'not-found';
}

interface NavigateEventLike extends Event {
	navigationType?: string;
	canIntercept: boolean;
	hashChange: boolean;
	downloadRequest: string | null;
	destination: { url: string };
	intercept(options: { handler: () => Promise<void> | void }): void;
}

interface NavigationLike extends EventTarget {}

export interface RouterV0 {
	readonly route: RouteV0;
	dispose(): void;
}

/**
 * Route the current document, then every same-origin navigation the Navigation API lets it
 * intercept. Without the API, the first route is all there is.
 */
export function createRouter(view: Window, onRoute: (route: RouteV0) => void): RouterV0 {
	const Pattern = (view as unknown as { URLPattern?: PatternConstructor }).URLPattern;
	const base = view.document.baseURI;
	let route = matchRoute(view.location.href, base, Pattern);
	onRoute(route);
	const navigation = (view as unknown as { navigation?: NavigationLike }).navigation;
	const listener = (event: Event) => {
		const navigate = event as NavigateEventLike;
		if (!navigate.canIntercept || navigate.hashChange || navigate.downloadRequest !== null) return;
		// A reload reloads the document; intercepting it would keep the page as it is.
		if (navigate.navigationType === 'reload') return;
		if (new URL(navigate.destination.url).origin !== view.location.origin) return;
		navigate.intercept({
			handler: () => {
				route = matchRoute(navigate.destination.url, base, Pattern);
				onRoute(route);
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
