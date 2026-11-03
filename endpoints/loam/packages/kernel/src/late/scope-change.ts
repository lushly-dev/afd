/**
 * @fileoverview The one function that changes the active scope, and the resource check (phase 2
 * specification, 3.4, 3.5 and 4.3; D72). In the late chunk: until it loads, no `auth-*` command can have
 * run, so stage A needs no copy.
 */

import type { AuthAdapter } from '@lushly-dev/afd-auth';
import type { Actor, CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import type { DataAdapter } from '@lushly-dev/local-db';
import { type AppStoreRecord, storeRecordId } from '../apps/store.js';
import type { AppsRuntime } from '../apps-runtime.js';
import type { KernelFieldContext } from '../context-fields.js';
import { kernelFailure } from '../errors.js';
import { SHELL_OWNER } from '../overlay-owner.js';
import type { OverlayStore } from '../overlays.js';
import { actorKey } from '../scope/access.js';
import { type LateScope, projectNotFound, sessionActor } from '../scope/middleware.js';
import type { ProjectV1, ScopeChangeV2, ScopeV1 } from '../scope/records.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import type { ShellState } from '../shell-state.js';
import { disabled, setMain, setScopeProject } from './main-state.js';

export interface LateScopeDeps {
	scope: ScopeRuntime;
	viewState: ViewStateRegistry;
	state: ShellState;
	overlays: OverlayStore;
	store: DataAdapter;
	apps(): AppsRuntime;
	auth: AuthAdapter;
	isMutation(name: string): boolean;
	/** A replay's recorded actor by trace ID: undefined when the journal has no such entry (10). */
	actorOf?(traceId: string | undefined): { actor?: Actor } | undefined;
}

const sameScope = (a: ScopeV1, b: ScopeV1): boolean =>
	a.workspace === b.workspace && a.project === b.project;

/** The project a store row was written in, from its id: `p~<project>~<key>`. */
const rowProject = (id: string): string | undefined =>
	id.startsWith('p~') ? id.slice(2, id.indexOf('~', 2)) : undefined;

export function createLateScope(deps: LateScopeDeps): LateScope {
	const { scope, state, overlays } = deps;
	const levelsOf = (instance: string) =>
		deps
			.apps()
			.summaries()
			.find((app) => app.instance === instance)?.scopeLevels ?? ['workspace'];

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
		const from = scope.active();
		if (sameScope(from, to)) return undefined;
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
			const levels = levelsOf(active);
			const kept =
				to.project === undefined ? levels.includes('workspace') : levels.includes('project');
			if (!kept) left = active;
		}
		if (left !== undefined) {
			overlays.closeForSwitch(left);
			// A project-only app leaving for no project, or a workspace app leaving for a project, lands in
			// the projects section: the list, or the project's home.
			setMain(deps.viewState, { active: null, section: 'projects', path: '' });
		} else setMain(deps.viewState, { path: '' });
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
		const places = data
			.filter((row) => row.key === key)
			.map((row) => rowProject(row.id))
			.map((project) => (project === undefined ? undefined : scope.projects.get(project)));
		const projects = places
			.filter(
				(project): project is ProjectV1 =>
					project !== undefined &&
					project.id !== here.project &&
					scope.allows(actor, { workspace: here.workspace, project: project.id })
			)
			.sort((a, b) => a.createdAt - b.createdAt);
		const inWorkspace =
			here.project !== undefined && levels.includes('workspace') && places.includes(undefined);
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
		/**
		 * A session that ends with no command, as an expiry, takes effect at the next call (3.4). That call
		 * asked for the active scope it was made in, so when this leaves it, it runs where it lands, and a
		 * person's `layout-get` keeps working.
		 */
		before(call) {
			// The journal's actor, whatever the replay's one Mock holds, so a refusal stays one (10).
			const recorded = deps.actorOf?.(call.traceId);
			if (recorded) {
				if (recorded.actor) call.actor = recorded.actor;
				else delete call.actor;
			}
			const actor = actorKey(call);
			if (actor === lastActor) return;
			const before = scope.active();
			if (lastActor !== undefined) leaveIfRefused(actor, call);
			lastActor = actor;
			const asked = call.scope;
			if (asked?.workspace === before.workspace && asked.project === before.project) {
				call.scope = scope.active();
			}
		},
		async run(name, input, call, next) {
			const requested = call.scope as ScopeV1;
			const apps = deps.apps();
			const owner = apps.owners.get(name)?.instance;
			if (owner !== undefined) {
				// A gate, not an omission, so it takes effect at once and replays the same (4.1).
				if (disabled(scope, owner)) {
					return kernelFailure(
						'APP_DISABLED',
						`The app '${owner}' is disabled in this workspace`,
						`Enable it with workspace-app-set { instance: "${owner}", enabled: true }`
					);
				}
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
			if (result.success && name.startsWith('auth-')) {
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
