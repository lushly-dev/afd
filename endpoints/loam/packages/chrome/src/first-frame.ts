/**
 * @fileoverview The moment after the first frame: two animation frames raced with a timer, since a
 * hidden tab fires none. It never waits for idle (phase 2 specification, 2.2).
 */

const HIDDEN_TAB_MS = 300;

export function afterFirstFrame(
	view: Pick<Window, 'requestAnimationFrame' | 'setTimeout'>
): Promise<void> {
	return new Promise((resolve) => {
		view.setTimeout(resolve, HIDDEN_TAB_MS);
		view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve()));
	});
}
