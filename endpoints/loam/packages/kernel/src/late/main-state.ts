/**
 * @fileoverview The late commands' writes of `loam.apps` and `loam.scope`, and the disabled gate (phase 2
 * specification, 4.1, 4.3 and 6.3). First paint reads these records; only late commands write them, so
 * the writes are here.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import type { AppsRuntime } from '../apps-runtime.js';
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

/** Whether a `workspace-app` record disables `instance`: a gate, not an omission (4.1). */
export const disabled = (scope: ScopeRuntime, instance: string): boolean =>
	scope.workspaceApps.get(instance)?.overrides.enabled === false;

/**
 * Why `instance` cannot open in a scope with `project`, or none: disabled (4.1), or not open there by
 * `opensIn` (7.1, 9.1). `app-open` and `scope-set { app }` both ask it first, so a refusal changes nothing.
 * An instance no deployment lists is left to `open`, which names it.
 */
export function canOpen(
	apps: AppsRuntime,
	scope: ScopeRuntime,
	instance: string,
	project: string | undefined
): CommandResult<never> | undefined {
	const app = apps.summaries().find((candidate) => candidate.instance === instance);
	if (!app) return undefined;
	if (disabled(scope, instance)) {
		return kernelFailure(
			'APP_DISABLED',
			`The app '${instance}' is disabled in this workspace`,
			`Enable it with workspace-app-set { instance: "${instance}", enabled: true }`
		);
	}
	if (scope.opensIn(instance, app.scopeLevels, project)) return undefined;
	return kernelFailure(
		'SCOPE_PROJECT_REQUIRED',
		project === undefined
			? 'Open a project first'
			: `The app '${instance}' is not available in this project`,
		'Run scope-set'
	);
}
