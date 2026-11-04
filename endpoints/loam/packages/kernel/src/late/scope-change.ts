/**
 * @fileoverview The one function that changes the active scope, and the resource check (phase 2
 * specification, 3.4, 3.5 and 4.3; D72). In the late chunk: until it loads, no `auth-*` command can have
 * run, so stage A needs no copy.
 */

import type { AuthAdapter } from '@lushly-dev/afd-auth';
import type { Actor, CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { AppStoreRecord } from '../apps/store.js';
import type { AppsRuntime } from '../apps-runtime.js';
import type { KernelFieldContext } from '../context-fields.js';
import { kernelFailure } from '../errors.js';
import { SHELL_OWNER } from '../overlay-owner.js';
import type { OverlayStore } from '../overlays.js';
import { actorKey } from '../scope/access.js';
import { type LateScope, projectNotFound, sessionActor } from '../scope/middleware.js';
import type { ProjectV1, ScopeChangeV2, ScopeV1 } from '../scope/records.js';
import { CALL_MARK, type ScopeRuntime } from '../scope/runtime.js';
import { rowProject, storeRecordId } from '../scope/store-id.js';
import type { ShellState } from '../shell-state.js';
import { canOpen, disabledRefusal, setMain, setScopeProject } from './main-state.js';

export interface LateScopeDeps {
	scope: ScopeRuntime;
	viewState: ViewStateRegistry;
	state: ShellState;
	overlays: OverlayStore;
	store: DataAdapter;
	apps(): AppsRuntime;
	auth: AuthAdapter;
	isMutation(name: string): boolean;
	/**
	 * What only a replay sets (10): its recorded actor by trace ID, undefined when the journal has no such
	 * entry, and `replaying`.
	 */
	internals?: {
		actorOf?(traceId: string | undefined): { actor?: Actor } | undefined;
		replaying?: boolean;
	};
}

const sameScope = (a: ScopeV1, b: ScopeV1): boolean =>
	a.workspace === b.workspace && a.project === b.project;

export function createLateScope(deps: LateScopeDeps): LateScope {
	const { scope, state, overlays } = deps;
	const levelsOf = (instance: string) =>
		deps
			.apps()
			.summaries()
			.find((app) => app.instance === instance)?.scopeLevels ?? ['workspace'];

	/**
	 * An app that leaves main with no command of its own: a project-only app leaving for no project, or a
	 * workspace app leaving for a project, lands in the projects section, the list or the project's home.
	 */
	function land(left: string): void {
		overlays.closeForSwitch(left);
		setMain(deps.viewState, { active: null, section: 'projects', path: '' });
	}

	/** From the persisted record, as stage A reads it, so a replay's reload reads the same (10). */
	function activeRefusal(): CommandResult<never> | undefined {
		const active = state.activeApp();
		if (active === null) return undefined;
		return canOpen(deps.apps(), scope, active, state.scopeProject() ?? undefined);
	}

	/**
	 * 4.3's switch rules, atomically: `loam.scope` and `loam.apps` written, selections cleared, a left app's
	 * overlays dismissed, and the change recorded for the call's event. A shell-owned modal refuses it, but
	 * for `actor`, which cancels the modal, since no person chose it.
	 */
	function applyScopeChange(
		to: ScopeV1,
		reason: ScopeChangeV2['reason'],
		context: CommandContext
	): CommandResult<never> | undefined {
		// A server's call (no mark) holds no active scope, so it moves none: `project-archive` over MCP
		// archives, and a person's scope stays where they put it (3.3).
		if (!(context as { [CALL_MARK]?: string })[CALL_MARK]) return undefined;
		// From the persisted record, not memory: stage A may hold the URL's project, or the workspace in place
		// of a project it refused, in memory alone (6.3). A replay has no URL and starts from the record, so
		// the switch is computed from what both hold, and stage B's `scope-set` replays the same (10).
		const recorded = state.scopeProject();
		const from: ScopeV1 =
			recorded === null
				? { workspace: scope.active().workspace }
				: { workspace: scope.active().workspace, project: recorded };
		if (sameScope(from, to)) {
			scope.setActive(to);
			return undefined;
		}
		const modal = overlays.modalOpen();
		if (modal?.owner === SHELL_OWNER) {
			if (reason !== 'actor') {
				return kernelFailure(
					'OVERLAY_MODAL_BUSY',
					"The shell's modal is open, so the scope cannot change",
					'Close the modal first',
					{ retryable: true }
				);
			}
			overlays.close(modal.overlayId, 'cancel', 'app-switch');
		}
		const active = state.activeApp();
		let left: string | undefined;
		if (active !== null) {
			// Kept where it takes the level and can open (4.3): a workspace-only app leaves for a project, and
			// an instance that does not list the project leaves too (7.1, 9.1).
			const levels = levelsOf(active);
			const kept =
				scope.opensIn(active, levels, to.project) &&
				(to.project === undefined || levels.includes('project'));
			if (!kept) left = active;
		}
		if (left !== undefined) land(left);
		else setMain(deps.viewState, { path: '' });
		deps.apps().clearSelections();
		setScopeProject(deps.viewState, to.project ?? null);
		scope.setActive(to);
		scope.note(context.traceId, {
			scopeChanged: { from, to, ...(left !== undefined ? { left } : {}), reason },
			mainChanged: 'push',
		});
		return undefined;
	}

	/**
	 * Line 5: a key `app.resource_keys` names, absent from this scope, searched for in the instance's table.
	 * Found where the actor may go, it is `SCOPE_MISMATCH` naming the place; found nowhere, or only where
	 * the actor may not go, the call proceeds and reveals nothing. An app learns no project's name.
	 */
	async function checkResource(
		name: string,
		input: unknown,
		context: CommandContext
	): Promise<CommandResult<never> | undefined> {
		const named = deps.apps().resourceKeyOf(name);
		const key =
			named === undefined ? undefined : (input as Record<string, unknown> | null)?.[named.property];
		if (named === undefined || typeof key !== 'string' || key === '' || key.startsWith('p~')) {
			return undefined;
		}
		const call = context as CommandContext & KernelFieldContext;
		const here = call.scope as ScopeV1;
		const table = `app-${named.instance}`;
		if (await deps.store.get(table, storeRecordId(here, key))) return undefined;
		const { data } = await deps.store.list<AppStoreRecord>(table);
		const actor = actorKey(call);
		const levels = levelsOf(named.instance);
		const ids = data.filter((row) => row.key === key).map((row) => rowProject(row.id));
		// A project the cache does not hold is nowhere, not the workspace: only an id with no project is.
		const projects = ids
			.map((id) => (id === undefined ? undefined : scope.projects.get(id)))
			.filter(
				(project): project is ProjectV1 =>
					project !== undefined &&
					project.id !== here.project &&
					scope.allows(actor, { workspace: here.workspace, project: project.id })
			)
			.sort((a, b) => a.createdAt - b.createdAt);
		const inWorkspace =
			here.project !== undefined && levels.includes('workspace') && ids.includes(undefined);
		const target = projects[0];
		if (target === undefined && !inWorkspace) return undefined;
		const current = here.project === undefined ? undefined : scope.projects.get(here.project);
		const where = target ? `the project ${target.name}` : 'the workspace';
		const answer = (message: string, suggestion: string, details?: Record<string, unknown>) =>
			kernelFailure(
				'SCOPE_MISMATCH',
				message,
				suggestion,
				details === undefined ? {} : { details }
			);
		if (call.caller !== undefined) {
			return answer(
				`\`${key}\` is in another scope`,
				'It is not in the scope this surface runs in; open it where it is, and run this again.'
			);
		}
		return answer(
			`\`${key}\` is in ${where}, not ${current ? current.name : 'the workspace'}`,
			target
				? `Switch with scope-set { project: "${target.slug}" } and run this again.`
				: 'Switch with scope-set { project: null } and run this again.',
			target ? { project: { id: target.id, slug: target.slug, name: target.name } } : {}
		);
	}

	let lastActor: string | undefined;

	/** Leave the active project when `actor` may not be in it. */
	const leaveIfRefused = (actor: string, context: CommandContext): void => {
		const active = scope.active();
		if (!scope.allows(actor, active)) {
			applyScopeChange({ workspace: active.workspace }, 'actor', context);
		}
	};

	return {
		applyScopeChange,
		activeRefusal,
		settleActive() {
			const left = state.activeApp();
			const refused = activeRefusal();
			if (left === null || !refused) return undefined;
			land(left);
			return { left, code: refused.error?.code as string };
		},
		/**
		 * A session that ends with no command, as an expiry, takes effect at the next call (3.4). That call
		 * asked for the active scope it was made in, so when this leaves it, it runs where it lands, and a
		 * person's `layout-get` keeps working.
		 */
		before(call, name) {
			// The journal's actor, whatever the replay's one Mock holds, so a refusal stays one (10).
			const recorded = deps.internals?.actorOf?.(call.traceId);
			if (recorded) {
				if (recorded.actor) call.actor = recorded.actor;
				else delete call.actor;
			}
			// A person's or an agent's calls, and a replay's: a server's call has no active scope to move.
			const mark = (call as { [CALL_MARK]?: string })[CALL_MARK];
			const actor = actorKey(call);
			if (mark === undefined || actor === lastActor) return;
			lastActor = actor;
			leaveIfRefused(actor, call);
			// A shell command that asked for the active scope runs where it lands, so a person's `layout-get`
			// keeps working. An app's command, a surface's call and an explicit scope keep theirs, and line 2
			// refuses them.
			if (mark === 'active' && call.caller === undefined && !deps.apps().owners.has(name)) {
				call.scope = scope.active();
			}
		},
		async run(name, input, call, next) {
			// A replay runs a nested call its journal does not answer, so validation answers as it did live;
			// a recorded one that gets here stops, before its handler could reach a server (10 and 12).
			if (deps.internals?.replaying && call.parent !== undefined && call.replay === 'recorded') {
				return kernelFailure(
					'REPLAY_NOT_RECORDED',
					`The journal does not record '${name}' under this call, so the replay does not run it`,
					'Replay the whole journal the session recorded'
				);
			}
			const requested = call.scope as ScopeV1;
			const apps = deps.apps();
			const owner = apps.owners.get(name)?.instance;
			if (owner !== undefined) {
				// A gate, not an omission, so it takes effect at once and replays the same (4.1).
				const off = disabledRefusal(scope, owner);
				if (off) return off;
				// Line 2: the access decision, before anything else about the call.
				if (!scope.allows(actorKey(call), requested)) return projectNotFound();
				// Line 3: the owning app's levels.
				const levels = apps.scopeLevelsOf(name) ?? ['workspace'];
				if (!levels.includes('workspace') && requested.project === undefined) {
					return kernelFailure('SCOPE_PROJECT_REQUIRED', 'Open a project first', 'Run scope-set');
				}
				// Line 4: narrowing never refuses, so a workspace app keeps working with a project active.
				if (!levels.includes('project') && requested.project !== undefined) {
					call.scope = { workspace: requested.workspace };
					scope.note(call.traceId, { scope: call.scope });
				}
				// Line 5: a store key in another scope.
				const mismatch = await checkResource(name, input, call);
				if (mismatch) return mismatch;
				// Line 6: a mutation under an archived project.
				const at = (call.scope as ScopeV1).project;
				const project = at === undefined ? undefined : scope.projects.get(at);
				if (project?.status === 'archived' && deps.isMutation(name)) {
					return kernelFailure(
						'PROJECT_ARCHIVED',
						`The project '${project.name}' is archived, so nothing in it can change`,
						`Restore it with project-restore { project: "${project.slug}" }`
					);
				}
			}
			const result = await next();
			if (
				result.success &&
				name.startsWith('auth-') &&
				(call as { [CALL_MARK]?: string })[CALL_MARK]
			) {
				// After sign-in or sign-out: the actor the adapter now reports (3.4).
				lastActor = sessionActor(deps.auth);
				leaveIfRefused(lastActor, call);
			}
			return result;
		},
		forgetActor() {
			lastActor = undefined;
		},
	};
}
