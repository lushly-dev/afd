/** The two hooks the React page needs over the shared session and the violet elements. */
import type { SessionState, TodoSession } from '@afd/example-todo-ui/session';
import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';

/** The session's state, re-rendering on every change. */
export function useSessionState(session: TodoSession): SessionState {
	const subscribe = useCallback(
		(onChange: () => void) => session.subscribe(() => onChange()),
		[session]
	);
	return useSyncExternalStore(subscribe, () => session.snapshot);
}

type Handlers = Record<string, (event: Event) => void>;

/**
 * A ref callback that listens to a violet element's events (`change`, `approve`, `dismiss`,
 * `request-close`...) while it is mounted: attached when the element appears, removed when it goes
 * (React 19 runs the cleanup a ref callback returns), always calling the latest handlers.
 */
export function useElementEvents(handlers: Handlers): (element: HTMLElement | null) => () => void {
	const latest = useRef(handlers);
	useLayoutEffect(() => {
		latest.current = handlers;
	});
	const names = Object.keys(handlers).sort().join(' ');
	return useCallback(
		(element: HTMLElement | null) => {
			if (!element) return () => {};
			const listeners = names
				.split(' ')
				.filter(Boolean)
				.map((name) => {
					const listener = (event: Event) => latest.current[name]?.(event);
					element.addEventListener(name, listener);
					return () => element.removeEventListener(name, listener);
				});
			return () => {
				for (const remove of listeners) remove();
			};
		},
		[names]
	);
}
