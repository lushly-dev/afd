/**
 * @fileoverview `formatRoute` (phase 2 specification, 6.1), in a module of its own so that only the URL's
 * chunk, which loads when stage B ends, holds it: first paint parses a URL and never formats one (2.4).
 */

import type { RouteV1 } from './router.js';

/** As the router's: a dot segment, or one holding a slash. Repeated so this chunk imports no router. */
const unsafe = (segment: string): boolean =>
	segment === '.' || segment === '..' || segment.includes('/');

/**
 * The absolute URL of `route` under `base`, each segment percent-encoded. It refuses a `.` or `..`
 * segment, and a `not-found` route, with a `TypeError`: `encodeURIComponent('..')` is `..`, which
 * `new URL` would walk out of the place it names (6.1).
 */
export function formatRoute(route: RouteV1, base: string): string {
	if (route.kind === 'not-found') throw new TypeError('A not-found route has no URL');
	const parts: string[] = [];
	if (route.kind !== 'root') {
		parts.push(route.workspace);
		if ('project' in route && route.project !== undefined) parts.push('p', route.project);
		if (route.kind === 'section') parts.push('~', route.section, ...route.rest);
		if (route.kind === 'app') parts.push(route.instance, ...route.rest);
	}
	if (parts.some(unsafe)) throw new TypeError('A route segment may not be `.`, `..` or hold `/`');
	// `./` first, so an empty first segment cannot make the path absolute and leave the base.
	return new URL(`./${parts.map(encodeURIComponent).join('/')}`, base).href;
}
