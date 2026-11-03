/**
 * @fileoverview The kernel's scope state, in first paint (phase 2 specification, 3 and 4): the
 * workspace, the active scope in memory, the project and workspace-app caches, and what a call's event
 * learns of its scope.
 */

import { decideAccess } from './access.js';
import { createRecordCache, type RecordCache } from './cache.js';
import {
	PROJECT_TABLE,
	type ProjectV1,
	type ScopeChangeV2,
	type ScopeV1,
	WORKSPACE_APP_TABLE,
	WORKSPACE_TABLE,
	type WorkspaceAppV1,
	type WorkspaceV1,
} from './records.js';

/** What a call's event carries of its scope, kept by trace ID as `seqs` is (11.1). */
export interface ScopeSeen {
	scope?: ScopeV1;
	scopeChanged?: ScopeChangeV2;
	mainChanged?: 'push' | 'replace';
}

export interface ScopeRuntime {
	readonly workspace: { readonly id: string; readonly name: string };
	readonly projects: RecordCache<ProjectV1>;
	readonly workspaceApps: RecordCache<WorkspaceAppV1>;
	/** The `workspace` table: one row in phase 2, once a deployment or a project created it. */
	readonly workspaces: RecordCache<WorkspaceV1>;
	/** The active scope: an input to each in-process call, never connection state (D4). */
	active(): ScopeV1;
	setActive(scope: ScopeV1): void;
	/** A project by `id` or slug. */
	project(ref: string): ProjectV1 | undefined;
	/** `decideAccess`, with the project read from the cache. */
	allows(actor: string, scope: ScopeV1): boolean;
	/** By trace ID: what the handler and the middleware leave for `run`'s event. */
	readonly seen: Map<string, ScopeSeen>;
	note(traceId: string | undefined, seen: ScopeSeen): void;
}

export function createScopeRuntime(workspace: { id: string; name: string }): ScopeRuntime {
	let active: ScopeV1 = { workspace: workspace.id };
	const projects = createRecordCache<ProjectV1>(PROJECT_TABLE);
	const workspaceApps = createRecordCache<WorkspaceAppV1>(WORKSPACE_APP_TABLE);
	const workspaces = createRecordCache<WorkspaceV1>(WORKSPACE_TABLE);
	const seen = new Map<string, ScopeSeen>();
	const project = (ref: string) =>
		projects.get(ref) ?? projects.all().find((candidate) => candidate.slug === ref);
	return {
		workspace,
		projects,
		workspaceApps,
		workspaces,
		active: () => active,
		setActive(scope) {
			active = scope;
		},
		project,
		allows: (actor, scope) =>
			decideAccess({
				actor,
				scope,
				project: scope.project === undefined ? undefined : projects.get(scope.project),
			}).allowed,
		seen,
		note(traceId, extra) {
			if (traceId === undefined) return;
			seen.set(traceId, { ...seen.get(traceId), ...extra });
		},
	};
}
