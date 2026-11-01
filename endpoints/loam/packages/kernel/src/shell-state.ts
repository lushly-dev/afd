/**
 * @fileoverview The two view-state handlers, `loam.layout` and `loam.appearance`, on one
 * `ViewStateRegistry` that both registries' commands close over (phase 0 specification, 6.1).
 *
 * Each handler's `set` and `replace` go through the shared validator, so a caller of the registry
 * or of `view-state-set` can bypass nothing. A refusal throws a {@link LoamKernelError}; the
 * guarded `view-state-set` checks first, so it returns the refusal as a result instead.
 */

import type { ViewStateHandler, ViewStateRegistry } from '@lushly-dev/afd-view-state';
import {
	APPEARANCE_VIEW_STATE_ID,
	type AppearanceStateV0,
	createDefaultAppearance,
	validateAppearancePatch,
} from './appearance.js';
import { LoamKernelError } from './errors.js';
import {
	cloneLayout,
	createDefaultLayout,
	LAYOUT_VIEW_STATE_ID,
	type LayoutStateV0,
	validateLayoutPatch,
	validateLayoutState,
} from './layout.js';

export interface ShellState {
	layout(): LayoutStateV0;
	appearance(): AppearanceStateV0;
	/** Load the persisted records. An invalid record is ignored and its defaults kept. */
	hydrate(): Promise<void>;
}

export function registerShellState(viewState: ViewStateRegistry): ShellState {
	let layout = createDefaultLayout();
	let appearance = createDefaultAppearance();
	let hydrating = false;

	const layoutHandler: ViewStateHandler<LayoutStateV0 & Record<string, unknown>> = {
		get: () => cloneLayout(layout) as LayoutStateV0 & Record<string, unknown>,
		set(partial) {
			const checked = validateLayoutPatch(layout, partial);
			if (checked.valid) layout = checked.state;
			else if (!hydrating) throw LoamKernelError.fromCommandError(checked.error);
		},
		replace(state) {
			const checked = validateLayoutState(state);
			if (!checked.valid) throw LoamKernelError.fromCommandError(checked.error);
			layout = checked.state;
		},
	};

	const appearanceHandler: ViewStateHandler<AppearanceStateV0 & Record<string, unknown>> = {
		get: () => ({ ...appearance }) as AppearanceStateV0 & Record<string, unknown>,
		set(partial) {
			const checked = validateAppearancePatch(appearance, partial);
			if (checked.valid) appearance = checked.state;
			else if (!hydrating) throw LoamKernelError.fromCommandError(checked.error);
		},
		replace(state) {
			const checked = validateAppearancePatch(appearance, state, true);
			if (!checked.valid) throw LoamKernelError.fromCommandError(checked.error);
			appearance = checked.state;
		},
	};

	viewState.register(LAYOUT_VIEW_STATE_ID, layoutHandler as unknown as ViewStateHandler);
	viewState.register(APPEARANCE_VIEW_STATE_ID, appearanceHandler as unknown as ViewStateHandler);

	return {
		layout: () => cloneLayout(layout),
		appearance: () => ({ ...appearance }),
		async hydrate() {
			hydrating = true;
			try {
				await viewState.hydrate();
			} finally {
				hydrating = false;
			}
		},
	};
}
