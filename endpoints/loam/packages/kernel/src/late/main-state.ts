/**
 * @fileoverview The late commands' writes of `loam.apps` and `loam.scope`, and the disabled gate (phase 2
 * specification, 4.1, 4.3 and 6.3). First paint reads these records; only late commands write them, so
 * the writes are here.
 */

import type { CommandMiddleware, CommandResult } from '@lushly-dev/afd-core';
import type { ViewStateFlushResult, ViewStateRegistry } from '@lushly-dev/afd-view-state';
import { type AppsRuntime, unknownApp } from '../apps-runtime.js';
import { kernelFailure } from '../errors.js';
import type { ProjectV1 } from '../scope/records.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import {
	APPS_VIEW_STATE_ID,
	type MainStateV2,
	SCOPE_VIEW_STATE_ID,
	type ShellState,
} from '../shell-state.js';

/** Write `loam.apps`: what is not given keeps its value. */
export function setMain(viewState: ViewStateRegistry, main: Partial<MainStateV2>): void {
	viewState.set(APPS_VIEW_STATE_ID, main);
}

/** Write `loam.scope`, the persisted active project's id. */
export function setScopeProject(viewState: ViewStateRegistry, project: string | null): void {
	viewState.set(SCOPE_VIEW_STATE_ID, { project });
}

/**
 * Inside the journal: a call that changed `loam.apps` or `loam.scope` waits for the store to hold them before its
 * entry is recorded and its result returned. Their writes are debounced, and a reload does not wait for `pagehide`'s
 * flush, so one made at once booted from the state before them while the journal held the call, and a replay of it
 * diverged (#861). Compared by value, so every writer inside the call is covered: the handlers, the apps chunk's
 * `app-open` and `app-close`, and the scope middleware's own leaving and settling around a change of person, which is
 * why it sits right inside the journal. The store may then hold a change a moment before the journal holds its entry;
 * a reload in that gap boots from the change with no entry for it, a far narrower window than the one this closes.
 *
 * - **A call that ends while a write is in flight waits for it**, so one that saw a change after the handler that made
 *   it returned, as a second `app-open` of the same app does, is not journaled before that call. A change made before
 *   a handler awaits more work, as `project-archive`'s scope move before its record's write, is seen by calls that end
 *   meanwhile as it was before. The wait has no time limit: the store's write is what every such call waits for.
 * - **A handler that throws after a change** is written through all the same, and its error is the call's.
 * - **A write that fails** leaves the call as it was, since the change is in memory and the shell runs on it, with a
 *   `VIEW_STATE_NOT_SAVED` warning naming the records it changed, which the journal keeps: a reload would not find
 *   them. They stay unsaved until a write of them succeeds, and every call writes them again until one does.
 */
export function writeThrough(
	viewState: ViewStateRegistry,
	state: Pick<ShellState, 'main' | 'scopeProject'>
): CommandMiddleware {
	const records: ReadonlyArray<readonly [string, () => string]> = [
		[APPS_VIEW_STATE_ID, () => JSON.stringify(state.main())],
		[SCOPE_VIEW_STATE_ID, () => JSON.stringify(state.scopeProject())],
	];
	/** The records whose last write failed: every call writes them again until one succeeds. */
	const unsaved = new Set<string>();
	/** The last write-through started, until it settles. */
	let inFlight: Promise<ViewStateFlushResult> | undefined;
	const start = (): Promise<ViewStateFlushResult> => {
		const flush = viewState.flush();
		inFlight = flush;
		void flush.then(() => {
			if (inFlight === flush) inFlight = undefined;
		});
		return flush;
	};
	return async (name, _input, _context, next) => {
		const before = records.map(([, read]) => read());
		let outcome: { result: CommandResult } | { thrown: unknown };
		try {
			outcome = { result: await next() };
		} catch (thrown) {
			outcome = { thrown };
		}
		const changed = records.filter(([, read], i) => read() !== before[i]).map(([id]) => id);
		const mine = changed.length > 0 || unsaved.size > 0 ? start() : undefined;
		const waited = mine ?? inFlight;
		if (waited) {
			const { failed } = await waited;
			// A record that was waiting is written by every flush, so one not failed is saved.
			if (mine) {
				unsaved.clear();
				for (const [id] of records) if (failed.includes(id)) unsaved.add(id);
			}
		}
		if ('thrown' in outcome) throw outcome.thrown;
		const lost = changed.filter((id) => unsaved.has(id));
		if (lost.length === 0) return outcome.result;
		return {
			...outcome.result,
			warnings: [
				...(outcome.result.warnings ?? []),
				{
					code: 'VIEW_STATE_NOT_SAVED',
					message: `\`${name}\` changed ${lost.join(' and ')}, but the store did not save it; a reload would not find it`,
					severity: 'warning',
					details: { records: lost },
				},
			],
		};
	};
}

/**
 * `APP_DISABLED` when a `workspace-app` record disables `instance`: a gate, not an omission, so it takes
 * effect at once and replays the same (4.1). A call into it, `app-open` and its discovery all answer it.
 */
/**
 * `SCOPE_MISMATCH` for a person's or an agent's call (3.5; documents specification, 4.2): `what` is in
 * `target`'s project, or the workspace with none, not in `current`'s, with the switch that reaches it.
 */
export const mismatchRefusal = (
	what: string,
	target: ProjectV1 | undefined,
	current: ProjectV1 | undefined
): CommandResult<never> =>
	kernelFailure(
		'SCOPE_MISMATCH',
		`\`${what}\` is in ${target ? `the project ${target.name}` : 'the workspace'}, not ${current ? current.name : 'the workspace'}`,
		`Switch with scope-set { project: ${target ? `"${target.slug}"` : 'null'} } and run this again.`,
		{ details: target ? { project: { id: target.id, slug: target.slug, name: target.name } } : {} }
	);

/** Line 6 of a call, and an archived project's documents (3.4; documents specification, 4.2). */
export const archivedRefusal = (project: ProjectV1): CommandResult<never> =>
	kernelFailure(
		'PROJECT_ARCHIVED',
		`The project '${project.name}' is archived, so nothing in it can change`,
		`Restore it with project-restore { project: "${project.slug}" }`
	);

export const disabledRefusal = (
	scope: ScopeRuntime,
	instance: string
): CommandResult<never> | undefined =>
	scope.workspaceApps.get(instance)?.overrides.enabled === false
		? kernelFailure(
				'APP_DISABLED',
				`The app '${instance}' is disabled in this workspace`,
				`Enable it with workspace-app-set { instance: "${instance}", enabled: true }`
			)
		: undefined;

/**
 * Why `instance` cannot open in a scope with `project`, or none: disabled (4.1), or not open there by
 * `opensIn` (7.1, 9.1), or an instance no deployment lists. `app-open` and `scope-set { app }` both ask it
 * first, so a refusal changes nothing (N3, F2).
 */
export function canOpen(
	apps: AppsRuntime,
	scope: ScopeRuntime,
	instance: string,
	project: string | undefined
): CommandResult<never> | undefined {
	const app = apps.summaries().find((candidate) => candidate.instance === instance);
	if (!app) return unknownApp(instance);
	const off = disabledRefusal(scope, instance);
	if (off) return off;
	if (scope.opensIn(instance, app.scopeLevels, project)) return undefined;
	return kernelFailure(
		'SCOPE_PROJECT_REQUIRED',
		project === undefined
			? 'Open a project first'
			: `The app '${instance}' is not available in this project`,
		'Run scope-set'
	);
}
