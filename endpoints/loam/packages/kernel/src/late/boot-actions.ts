/**
 * @fileoverview `app-get`, `app-open` and `app-close` for apps listed from their boot records alone,
 * when stage B could not read them (phase 2 specification, 2.2). In the late chunk, since only late
 * commands reach them: first paint holds only `bootApps`' list.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';
import { type AppsRuntime, unknownApp } from '../apps-runtime.js';
import { kernelFailure } from '../errors.js';
import { SHELL_OWNER } from '../overlay-owner.js';
import type { OverlayStore } from '../overlays.js';
import type { ShellState } from '../shell-state.js';

/**
 * `runtime`, from `bootApps`, answering `detail`, `open` and `close` as `unavailableApps` did. `open`
 * refuses a project-only app with no project as `SCOPE_PROJECT_REQUIRED`, and a switch under a
 * shell-owned modal as `OVERLAY_MODAL_BUSY` (#709).
 */
export function withBootActions(
	runtime: AppsRuntime,
	parts: ReadonlyMap<string, readonly string[]>,
	state: Pick<ShellState, 'activeApp' | 'setActiveApp'>,
	overlays: Pick<OverlayStore, 'modalOpen'> | undefined
): AppsRuntime {
	const find = (instance: string) =>
		runtime.summaries().find((entry) => entry.instance === instance);
	const busy = (): CommandResult<never> | undefined =>
		overlays?.modalOpen()?.owner === SHELL_OWNER
			? kernelFailure(
					'OVERLAY_MODAL_BUSY',
					"The shell's modal is open, so the app cannot change",
					'Close the modal first',
					{ retryable: true }
				)
			: undefined;
	const move = (active: string | null) => {
		const previous = state.activeApp();
		state.setActiveApp(active);
		return { active, previous };
	};
	return {
		...runtime,
		detail(instance) {
			const entry = find(instance);
			if (!entry) return unknownApp(instance);
			return success({
				...entry,
				state: entry.state === 'disabled' ? 'failed' : entry.state,
				version: '',
				trust: 'trusted',
				trustLine: '',
				surfaces: [...(parts.get(instance) ?? [])],
				compositions: [],
				grants: [],
				contexts: [],
				skills: [],
				warnings: [],
				notices: [],
				statusItems: {},
			});
		},
		open(instance) {
			const entry = find(instance);
			if (!entry) return unknownApp(instance);
			// Whether it opens in this scope is `canOpen`'s, which `app-open` and `scope-set` ask first.
			const refused = state.activeApp() === instance ? undefined : busy();
			return refused ?? success(move(instance));
		},
		close() {
			const refused = state.activeApp() === null ? undefined : busy();
			return refused ?? success(move(null) as { active: null; previous: string | null });
		},
	};
}
