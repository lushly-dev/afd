/**
 * Uncaught errors and unhandled rejections during a retained story's run. What counts is what
 * Vitest browser mode counts (`catchWindowErrors` in its `error-catcher.js`), so a suite moved
 * from Storybook's Vitest addon keeps this check: an event with no error value, such as a
 * ResizeObserver notice, is not a failure, and neither is any event of a kind the page listens
 * for itself. A page's own listener is how a story says it expects the error.
 */
const CHANNELS = [
	{ type: 'error', field: 'error', label: 'Uncaught error' },
	{ type: 'unhandledrejection', field: 'reason', label: 'Unhandled rejection' },
] as const;

/** The messages of the story being watched, once each; `undefined` between stories. */
let recorded: Set<string> | undefined;

function describe(value: unknown): string {
	try {
		const { name, message } = Object(value) as { name?: unknown; message?: unknown };
		if (typeof message !== 'string') return String(value);
		return typeof name === 'string' && name !== 'Error' ? `${name}: ${message}` : message;
	} catch {
		return 'a value that cannot be printed';
	}
}

/** Listen from the page's start, so listeners a story module adds as it loads are counted. */
export function installPageErrors(): void {
	const ownListeners = new Map<string, number>();
	for (const { type, field, label } of CHANNELS) {
		ownListeners.set(type, 0);
		// Past any wrapper a host has on `window`, whose own count this listener must not join.
		EventTarget.prototype.addEventListener.call(window, type, (event) => {
			const value = (event as unknown as Record<string, unknown>)[field];
			if (recorded && ownListeners.get(type) === 0 && value != null)
				recorded.add(`${label}: ${describe(value)}`);
		});
	}
	const add = window.addEventListener;
	const remove = window.removeEventListener;
	window.addEventListener = ((...args: Parameters<typeof add>) => {
		const count = ownListeners.get(args[0]);
		if (count !== undefined) ownListeners.set(args[0], count + 1);
		return add.apply(window, args);
	}) as typeof add;
	window.removeEventListener = ((...args: Parameters<typeof remove>) => {
		const count = ownListeners.get(args[0]);
		if (count) ownListeners.set(args[0], count - 1);
		return remove.apply(window, args);
	}) as typeof remove;
}

/** Start watching, or carry on if the story's loading already started. */
export function watchPageErrors(): void {
	recorded ??= new Set();
}

/** Stop watching and return what was recorded. */
export function takePageErrors(): string[] {
	const messages = [...(recorded ?? [])];
	recorded = undefined;
	return messages;
}
