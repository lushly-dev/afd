/**
 * @fileoverview The header's breadcrumbs (phase 2 specification, 7.4): the workspace, the project, the app,
 * then each segment of its route, as text, each ancestor a link by the URL scheme; the last is the page.
 * An app supplies no labels in phase 2: its route's segments are what it has.
 */

import type { PartHeaderCrumb } from '../elements/part-header.js';
import { formatRoute } from '../route-format.js';
import type { MainStateV1 } from '../url-sync.js';

export function crumbsOf(
	state: MainStateV1 | null,
	instance: string,
	title: string,
	base: string
): PartHeaderCrumb[] {
	if (!state) return [];
	const workspace = state.workspace.id;
	const project = state.project?.slug;
	const rest = state.path ? state.path.split('/') : [];
	const at = { workspace, ...(project !== undefined ? { project } : {}) };
	const crumbs: Array<{ label: string; route: Parameters<typeof formatRoute>[0] }> = [
		{ label: state.workspace.name ?? workspace, route: { kind: 'workspace', workspace } },
	];
	if (project !== undefined) {
		crumbs.push({
			label: state.project?.name ?? project,
			route: { kind: 'project', workspace, project },
		});
	}
	crumbs.push({ label: title, route: { kind: 'app', ...at, instance, rest: [] } });
	rest.forEach((segment, index) => {
		crumbs.push({
			label: segment,
			route: { kind: 'app', ...at, instance, rest: rest.slice(0, index + 1) },
		});
	});
	return crumbs.map(({ label, route }, index) => {
		if (index === crumbs.length - 1) return { label };
		try {
			return { label, href: formatRoute(route, base) };
		} catch {
			return { label };
		}
	});
}
