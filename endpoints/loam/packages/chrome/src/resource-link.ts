/**
 * @fileoverview `resourceLinkUrl` (documents specification, 9.1): the URL a resource link navigates to, by
 * the URL scheme. A link is navigation, never execution: it names no command, and what it opens is decided
 * by the router's commands when a person follows it, `decideAccess` among them, so a link to a project the
 * reader may not enter opens "Nothing here", as any URL does. It formats with `formatRoute`, in the chunk
 * that shows the link, so first paint holds none of it.
 */

import type { ResourceLinkV1 } from '@lushly-dev/loam-kernel';
import { formatRoute } from './route-format.js';
import type { RouteV1 } from './router.js';

/** What a reader knows of the workspace's projects: the workspace's id, and a project's slug by its id. */
export interface ProjectLookup {
	readonly workspace: string;
	/** Undefined for a project the reader does not know, missing or refused alike. */
	slugOf(project: string): string | undefined;
}

/** An instance id as the router reads one, less `p` (6.1). */
const INSTANCE = /^(?!p$)[a-z][a-z0-9]{0,31}$/;

/**
 * The absolute URL `link` navigates to under `base`, or undefined when it cannot be opened in this page:
 * another workspace, a project the reader does not know, an instance the URL cannot name, or a segment that
 * would walk out of the place it names.
 */
export function resourceLinkUrl(
	link: ResourceLinkV1,
	base: string,
	projects: ProjectLookup
): string | undefined {
	const { workspace, project } = link.scope;
	if (workspace !== projects.workspace) return undefined;
	const slug = project === undefined ? undefined : projects.slugOf(project);
	if (project !== undefined && slug === undefined) return undefined;
	const at = slug === undefined ? { workspace } : { workspace, project: slug };
	let route: RouteV1;
	if (link.kind === 'app') {
		if (!INSTANCE.test(link.instance)) return undefined;
		const rest = link.route ? link.route.split('/') : [];
		route = { kind: 'app', ...at, instance: link.instance, rest };
	} else if (link.kind === 'document') {
		route = { kind: 'section', ...at, section: 'documents', rest: [link.document] };
	} else {
		return undefined;
	}
	try {
		return formatRoute(route, base);
	} catch {
		return undefined;
	}
}
