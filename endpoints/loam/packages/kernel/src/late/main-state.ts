/**
 * @fileoverview The late commands' writes of `loam.apps` and `loam.scope`, and the disabled gate (phase 2
 * specification, 4.1, 4.3 and 6.3). First paint reads these records; only late commands write them, so
 * the writes are here.
 */

import type { ViewStateRegistry } from '@lushly-dev/afd-view-state';
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
