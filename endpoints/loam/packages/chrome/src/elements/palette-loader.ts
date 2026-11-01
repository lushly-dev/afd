/**
 * @fileoverview The palette loads after first paint: its module, with `violet-dialog`,
 * `violet-listbox` and `violet-option`, is a chunk of its own that the shell imports when idle or
 * on the first Mod+K, whichever comes first (decided by step 7 for the bundle budget, 8.1).
 */

let loading: Promise<void> | null = null;

export function definePalette(): Promise<void> {
	loading ??= import('./palette.js').then(async ({ LoamPalette, paletteDefinition }) => {
		if (!customElements.get(paletteDefinition.name)) await LoamPalette.define(paletteDefinition);
	});
	return loading;
}

/** Run `task` when the page is idle, or soon where `requestIdleCallback` is missing. */
export function whenIdle(view: Window, task: () => void): void {
	const idle = (view as { requestIdleCallback?: (callback: () => void) => number })
		.requestIdleCallback;
	if (idle) idle.call(view, task);
	else view.setTimeout(task, 1);
}
