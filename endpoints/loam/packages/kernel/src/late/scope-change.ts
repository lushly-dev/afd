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
import { BOOT_ONLY } from '../commands.js';
import type { KernelFieldContext } from '../context-fields.js';
import { kernelFailure } from '../errors.js';
import { SHELL_OWNER } from '../overlay-owner.js';
import type { OverlayStore } from '../overlays.js';
import { type AccessActorV1, personOf } from '../scope/access.js';
import { type LateScope, projectNotFound, sessionActor } from '../scope/middleware.js';
import type { ProjectV1, ScopeChangeV2, ScopeV1 } from '../scope/records.js';
import { CALL_MARK, type ScopeRuntime } from '../scope/runtime.js';
import { rowProject, storeRecordId } from '../scope/store-id.js';
import type { ShellState } from '../shell-state.js';
import { lineZero } from './auth-gate.js';
import type { DocumentCheck } from './document-types.js';
import {
	archivedRefusal,
	canOpen,
	disabledRefusal,
	mismatchRefusal,
	setMain,
	setScopeProject,
} from './main-state.js';

export interface LateScopeDeps {
	scope: ScopeRuntime;
	viewState: ViewStateRegistry;
	state: ShellState;
	overlays: OverlayStore;
	store: DataAdapter;
	apps(): AppsRuntime;
	auth: AuthAdapter;
	isMutation(name: string): boolean;
	/** The documents specification's check, for a type's instance commands (4.2 and 4.4). */
	documents?: DocumentCheck;
	/** After every call: the editor owner it may have moved gives up its overlays (documents specification, 5.4). */
	settle?(name: string, call: CommandContext): Promise<void> | undefined;
	/**
	 * What only a replay sets (10): its recorded actor by trace ID, undefined when the journal has no such
	 * entry, and `replaying`.
	 */
	internals?: {
		actorOf?(traceId: string | undefined): { actor?: Actor } | undefined;
		replaying?: boolean;
	};
}

/**
 * The shell commands that read or write at the call's scope, naming no project (3.4): the documents
 * specification's commands, which check a record on top, and the `app-*` commands that keep a value per
 * project, the status values, the selection. `layout-*` is first paint's own. Boot's own work is not one.
 */
const AT_CALL_SCOPE = /^(document-|editor-|new-list$|app-get$|app-selection-|status-item-set$)/;

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
		const { actor } = call;
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
		if (call.caller !== undefined) {
			return kernelFailure(
				'SCOPE_MISMATCH',
				`\`${key}\` is in another scope`,
				'It is not in the scope this surface runs in; open it where it is, and run this again.'
			);
		}
		return mismatchRefusal(key, target, current);
	}

	/** The person the last call was for (phase 3 specification, 3.1): an agent's call for them is no change. */
	let lastActor: string | undefined;

	/** Leave the active project when `actor` may not be in it. */
	const leaveIfRefused = (actor: AccessActorV1, context: CommandContext): void => {
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
			const refused = lineZero(scope, call, name);
			if (refused) return refused;
			// The journal's actor, whatever the replay's one Mock holds, so a refusal stays one (10).
			const recorded = deps.internals?.actorOf?.(call.traceId);
			if (recorded) {
				if (recorded.actor) call.actor = recorded.actor;
				else delete call.actor;
			}
			// A person's or an agent's calls, and a replay's: a server's call has no active scope to move.
			const mark = (call as { [CALL_MARK]?: string })[CALL_MARK];
			const person = personOf(call);
			if (mark === undefined || person === lastActor) return;
			lastActor = person;
			leaveIfRefused(call.actor, call);
			// A shell command that asked for the active scope runs where it lands, so a person's `layout-get`
			// keeps working. An app's command, a surface's call and an explicit scope keep theirs, and line 2
			// refuses them.
			if (mark === 'active' && call.caller === undefined && !deps.apps().owners.has(name)) {
				call.scope = scope.active();
			}
		},
		async run(name, input, call, next) {
			// A replay answers a recorded call from its entry before the registry, so a recorded command that
			// gets here, past validation, is one the journal does not hold as recorded: nested and unanswered,
			// or a top-level entry whose context lost the mark, or a command a redeploy made mounted. It stops
			// before its handler could reach a server (10 and 12). Recorded is the kernel's own word, never the
			// context's: `app-instance-refresh`, or a command a mounted instance owns.
			if (
				deps.internals?.replaying &&
				(name === 'app-instance-refresh' || deps.apps().owners.get(name)?.recorded)
			) {
				return kernelFailure(
					'REPLAY_NOT_RECORDED',
					`The journal does not record '${name}' under this call, so the replay does not run it`,
					'Replay the whole journal the session recorded'
				);
			}
			const requested = call.scope as ScopeV1;
			const apps = deps.apps();
			const owner = apps.owners.get(name)?.instance;
			// A shell command that acts at the call's scope: the access decision on that scope first, so a
			// project an actor may not enter answers as a missing one, on every path, MCP's `_meta` too (3.4).
			if (
				owner === undefined &&
				AT_CALL_SCOPE.test(name) &&
				!BOOT_ONLY.includes(name) &&
				!scope.allows(call.actor, requested)
			) {
				return projectNotFound();
			}
			if (owner !== undefined) {
				// A gate, not an omission, so it takes effect at once and replays the same (4.1).
				const off = disabledRefusal(scope, owner);
				if (off) return off;
				// Line 2: the access decision, before anything else about the call.
				if (!scope.allows(call.actor, requested)) return projectNotFound();
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
			}
			const rest = async () => {
				if (owner === undefined) return next();
				// Line 5: a type's instance command names a document in this scope, of its type, under 256 KiB
				// (documents specification, 4.2 and 4.4); then a store key in another scope.
				const mismatch =
					(await deps.documents?.instance(name, input, call)) ??
					(await checkResource(name, input, call));
				if (mismatch) return mismatch;
				// Line 6: a mutation under an archived project.
				const at = (call.scope as ScopeV1).project;
				const project = at === undefined ? undefined : scope.projects.get(at);
				if (project?.status === 'archived' && deps.isMutation(name))
					return archivedRefusal(project);
				const done = await next();
				await deps.documents?.after(name, call, done.success);
				return done;
			};
			// An instance mutation's check, write and stamp run in its document's chain, so a move or a trash of
			// it waits, or it waits for theirs and is checked against what they left (documents specification,
			// Status, deviation 18). A nested mutation is refused at the port, and nothing chained waits on itself.
			const documents = owner === undefined ? undefined : deps.documents;
			const chained = documents?.chained(name, input);
			const result =
				documents && chained !== undefined ? await documents.serial(chained, rest) : await rest();
			await deps.settle?.(name, call);
			if (
				result.success &&
				name.startsWith('auth-') &&
				(call as { [CALL_MARK]?: string })[CALL_MARK]
			) {
				// After sign-in or sign-out: the actor the adapter now reports (3.4).
				const actor = sessionActor(deps.auth);
				lastActor = personOf({ actor });
				leaveIfRefused(actor, call);
			}
			return result;
		},
		forgetActor() {
			lastActor = undefined;
		},
	};
}
