/**
 * @fileoverview The late commands' writes of `loam.apps` and `loam.scope`, and the disabled gate (phase 2
 * specification, 4.1, 4.3 and 6.3). First paint reads these records; only late commands write them, so
 * the writes are here.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import { type AppsRuntime, unknownApp } from '../apps-runtime.js';
import { kernelFailure } from '../errors.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import { APPS_VIEW_STATE_ID, type MainStateV2, SCOPE_VIEW_STATE_ID } from '../shell-state.js';

/** Write `loam.apps`: what is not given keeps its value. */
export function setMain(viewState: ViewStateRegistry, main: Partial<MainStateV2>): void {
	viewState.set(APPS_VIEW_STATE_ID, main);
}

/** Write `loam.scope`, the persisted active project's id. */
export function setScopeProject(viewState: ViewStateRegistry, project: string | null): void {
	viewState.set(SCOPE_VIEW_STATE_ID, { project });
}

/**
 * `APP_DISABLED` when a `workspace-app` record disables `instance`: a gate, not an omission, so it takes
 * effect at once and replays the same (4.1). A call into it, `app-open` and its discovery all answer it.
 */
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
