/**
 * Uncaught errors and unhandled rejections during a retained story's run. What counts is what
 * Vitest browser mode counts (`catchWindowErrors` in its `error-catcher.js`), so a suite moved
 * from Storybook's Vitest addon keeps this check: an event with no error value, such as a
 * ResizeObserver notice, is not a failure, and neither is any event of a kind the page listens
 * for itself. A page's own listener is how a story says it expects the error.
 */
/** A label and the value raised, as the page reported it. */
export type PageError = readonly [label: string, value: unknown];

const CHANNELS = {
	error: ['error', 'Uncaught error'],
	unhandledrejection: ['reason', 'Unhandled rejection'],
} as const;

/** What the story being watched raised; `undefined` between stories. */
let recorded: PageError[] | undefined;

/** Listen from the page's start, so listeners a story module adds as it loads are counted. */
export function installPageErrors(): void {
	const ownListeners: Record<string, number> = { error: 0, unhandledrejection: 0 };
	// Past any wrapper a host has on `window`, whose own count this listener must not join.
	for (const [type, [field, label]] of Object.entries(CHANNELS))
		EventTarget.prototype.addEventListener.call(window, type, (event) => {
			const value = (event as unknown as Record<string, unknown>)[field];
			if (!ownListeners[type] && value != null) recorded?.push([label, value]);
		});
	const target = window as unknown as Record<string, (...args: unknown[]) => unknown>;
	for (const [method, step] of [
		['addEventListener', 1],
		['removeEventListener', -1],
	] as const) {
		const original = target[method] as (...args: unknown[]) => unknown;
		target[method] = (...args) => {
			const type = args[0] as string;
			const count = Object.hasOwn(ownListeners, type) && (ownListeners[type] as number) + step;
			if (count !== false && count >= 0) ownListeners[type] = count;
			return original.apply(window, args);
		};
	}
}

/** Start watching, or carry on if the story's loading already started. */
export function watchPageErrors(): void {
	recorded ??= [];
}

/** Stop watching after the browser's next task, and return what was raised. */
export async function takePageErrors(): Promise<PageError[]> {
	// The browser reports an unawaited rejection in a later task, and a run can end on a frame.
	await new Promise((resolve) => setTimeout(resolve, 0));
	const raised = recorded ?? [];
	recorded = undefined;
	return raised;
}
