/**
 * @fileoverview The kernel's scope state, in first paint (phase 2 specification, 3 and 4): the
 * workspace, the active scope in memory, the project and workspace-app caches, and what a call's event
 * learns of its scope.
 */

import { type AccessActorV1, decideAccess, type MembershipV1 } from './access.js';
import { createRecordCache, type RecordCache } from './cache.js';
import {
	type AgentMemberV1,
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
	/**
	 * `decideAccess` version 2 (phase 3 specification, 3.3), with the project read from the cache, the
	 * kernel's {@link ScopeRuntime.membership} and an agent member's record from {@link ScopeRuntime.agents}.
	 */
	allows(actor: AccessActorV1, scope: ScopeV1): boolean;
	/**
	 * The membership a browser kernel decides with (phase 3 specification, 3.3 and 7.6): `local` mode's,
	 * where every actor is a member and an owner, unless the host gave stage A the probe's.
	 */
	membership: MembershipV1;
	/**
	 * The `agent-member` table, loaded by `late/` with the late commands: before then no record exists, so an
	 * `agt_` actor is refused (phase 3 specification, 3.3's line 4).
	 */
	agents?: RecordCache<AgentMemberV1>;
	/**
	 * Whether an app can open in a scope with `project`, or none (phase 2 specification, 7.1 and 9.1): with
	 * no project, if its levels hold the workspace; in a project, always, by narrowing, unless the instance
	 * lists `projects` and this one's slug is not among them. The rail's `available`, `app-open`'s refusal and
	 * a switch's keep or leave all read it.
	 */
	opensIn(instance: string, levels: readonly string[], project: string | undefined): boolean;
	/**
	 * The trace IDs of calls the kernel's own 256 KiB bound refused (documents specification, 4.4), so
	 * `apps.redact` journals them without their input. Set by `late/` at that check, consumed by the
	 * redaction, and never read from a result, so no app can ask for it. Absent until a refusal.
	 */
	oversized?: Set<string>;
	/**
	 * The shell commands an app with these grants may call besides its own (phase 2 specification, 11.2):
	 * set by `late/` when it loads, before any app, so the list is written once, out of `apps` (2.4). Absent,
	 * an app may call none.
	 */
	callable?(grants: ReadonlySet<string>, base: readonly string[]): ReadonlySet<string>;
	/** By trace ID: what the handler and the middleware leave for `run`'s event. */
	readonly seen: Map<string, ScopeSeen>;
	note(traceId: string | undefined, seen: ScopeSeen): void;
}

export function createScopeRuntime(
	workspace: { id: string; name: string },
	membership: MembershipV1
): ScopeRuntime {
	let active: ScopeV1 = { workspace: workspace.id };
	const projects = createRecordCache<ProjectV1>(PROJECT_TABLE);
	const workspaceApps = createRecordCache<WorkspaceAppV1>(WORKSPACE_APP_TABLE);
	const seen = new Map<string, ScopeSeen>();
	const project = (ref: string) =>
		projects.get(ref) ?? projects.all().find((candidate) => candidate.slug === ref);
	const runtime: ScopeRuntime = {
		workspace,
		projects,
		workspaceApps,
		membership,
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
				membership: runtime.membership,
				// The table holds only `agt_` ids, and `decideAccess` reads the record only for one.
				agent: runtime.agents?.get(actor?.id as string),
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
	return runtime;
}
