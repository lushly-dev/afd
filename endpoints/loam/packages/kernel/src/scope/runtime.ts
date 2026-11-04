/**
 * @fileoverview The kernel's scope state, in first paint (phase 2 specification, 3 and 4): the
 * workspace, the active scope in memory, the project and workspace-app caches, and what a call's event
 * learns of its scope.
 */

import { actorKey, decideAccess } from './access.js';
import { createRecordCache, type RecordCache } from './cache.js';
import {
	PROJECT_TABLE,
	type ProjectV1,
	type ScopeChangeV2,
	type ScopeV1,
	WORKSPACE_APP_TABLE,
	type WorkspaceAppV1,
} from './records.js';

/**
 * On a call's context, set by `run`: `'run'` for every call made through it, `'active'` when its scope
 * also defaulted to the active scope. A server's call has neither, so its actor never moves a person's
 * scope, and only a call that asked for the active scope follows it when an actor change leaves it (3.4).
 */
export const CALL_MARK = Symbol();

/** What a call's event carries of its scope, kept by trace ID as `seqs` is (11.1). */
export interface ScopeSeen {
	scope?: ScopeV1;
	scopeChanged?: ScopeChangeV2;
	mainChanged?: 'push' | 'replace';
	/** A type's instance command that changed this document succeeded (documents specification, 5.7). */
	document?: string;
}

export interface ScopeRuntime {
	readonly workspace: { readonly id: string; readonly name: string };
	readonly projects: RecordCache<ProjectV1>;
	readonly workspaceApps: RecordCache<WorkspaceAppV1>;
	/** The active scope: an input to each in-process call, never connection state (D4). */
	active(): ScopeV1;
	setActive(scope: ScopeV1): void;
	/** A project by `id` or slug. */
	project(ref: string): ProjectV1 | undefined;
	/** `decideAccess`, with the project read from the cache. */
	allows(actor: string, scope: ScopeV1): boolean;
	/** The actor `decideAccess` reads from a call's context: its id, or `local`. */
	actorKey(context: { actor?: { id?: string } }): string;
	/**
	 * Whether an app can open in a scope with `project`, or none (phase 2 specification, 7.1 and 9.1): with
	 * no project, if its levels hold the workspace; in a project, always, by narrowing, unless the instance
	 * lists `projects` and this one's slug is not among them. The rail's `available`, `app-open`'s refusal and
	 * a switch's keep or leave all read it.
	 */
	opensIn(instance: string, levels: readonly string[], project: string | undefined): boolean;
	/** By trace ID: what the handler and the middleware leave for `run`'s event. */
	readonly seen: Map<string, ScopeSeen>;
	note(traceId: string | undefined, seen: ScopeSeen): void;
}

export function createScopeRuntime(workspace: { id: string; name: string }): ScopeRuntime {
	let active: ScopeV1 = { workspace: workspace.id };
	const projects = createRecordCache<ProjectV1>(PROJECT_TABLE);
	const workspaceApps = createRecordCache<WorkspaceAppV1>(WORKSPACE_APP_TABLE);
	const seen = new Map<string, ScopeSeen>();
	const project = (ref: string) =>
		projects.get(ref) ?? projects.all().find((candidate) => candidate.slug === ref);
	return {
		workspace,
		projects,
		workspaceApps,
		active: () => active,
		setActive(scope) {
			active = scope;
		},
		project,
		actorKey,
		allows: (actor, scope) =>
			decideAccess({
				actor,
				scope,
				project: scope.project === undefined ? undefined : projects.get(scope.project),
			}).allowed,
		opensIn(instance, levels, inProject) {
			if (inProject === undefined) return levels.includes('workspace');
			const listed = workspaceApps.get(instance)?.projects;
			return !listed || listed.includes(projects.get(inProject)?.slug as string);
		},
		seen,
		// Only for a call `run` made, which deletes its entry: a server's call leaves nothing behind.
		note(traceId, extra) {
			const held = seen.get(traceId as string);
			if (held) Object.assign(held, extra);
		},
	};
}
