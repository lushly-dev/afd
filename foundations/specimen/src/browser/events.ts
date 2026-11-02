import type { EventDeclaration, EventExpectation, EventRecord } from '../types.js';
import { describe } from './plugins.js';

/**
 * The declared events of a native specimen. The mount root's listener is installed before the
 * specimen is inserted, and sees what is composed or in its light tree. A non-composed event in a
 * shadow tree never reaches it, so each declared target also has listeners on itself and its open
 * shadow root once it is known. Nothing beyond the declared types is observed.
 */
export interface EventRecorder {
	/** A declared target's element, once the host has resolved it. */
	bind(name: string, element: Element): void;
	/** A scenario step begins; later events belong to its interval. */
	stepStarted(id: string | null): void;
	expect(expectation: EventExpectation): Promise<void>;
	read(): { declared: EventDeclaration[]; history: EventRecord[]; unresolved: string[] };
	dispose(): void;
}

const DEFAULT_EXPECT_TIMEOUT_MS = 1000;

export function recordEvents(root: Element, declared: EventDeclaration[]): EventRecorder {
	const history: (EventRecord & { interval: number })[] = [];
	const bound = new Map<string, Element>();
	const intervals = new Map<string, number>();
	const seen = new WeakSet<Event>();
	const removers: (() => void)[] = [];
	let interval = 0;
	let step: string | null = null;

	const observe = (node: EventTarget, type: string, listener: EventListener) => {
		node.addEventListener(type, listener, true);
		removers.push(() => node.removeEventListener(type, listener, true));
	};
	const record = (event: Event, listeningFor: string | null) => {
		if (seen.has(event)) return;
		seen.add(event);
		const path = event.composedPath();
		const declarations = declared.filter((item) => item.type === event.type);
		const named =
			listeningFor ??
			declarations.find(
				(item) => item.target && path.includes(bound.get(item.target) as EventTarget)
			)?.target ??
			null;
		// An event on another target is not what was declared, once that target is known.
		const counts =
			named !== null || declarations.some((item) => !item.target || !bound.has(item.target));
		if (!counts) return;
		history.push({
			type: event.type,
			target: named,
			step,
			interval,
			composed: event.composed,
			bubbles: event.bubbles,
			trusted: event.isTrusted,
			// Only a `CustomEvent`'s: a mouse event's `detail` is its click count.
			detail: event instanceof CustomEvent ? describe(event.detail ?? null) : null,
		});
	};
	for (const type of new Set(declared.map((item) => item.type)))
		observe(root, type, (event) => record(event, null));

	return {
		bind(name, element) {
			if (bound.has(name)) return;
			bound.set(name, element);
			for (const item of declared)
				if (item.target === name) {
					observe(element, item.type, (event) => record(event, name));
					if (element.shadowRoot)
						observe(element.shadowRoot, item.type, (event) => record(event, name));
				}
		},
		stepStarted(id) {
			interval += 1;
			step = id;
			if (id) intervals.set(id, interval);
		},
		async expect({ event, target, since, timeoutMs }) {
			const start = intervals.get(since);
			if (start === undefined) throw new Error(`Step '${since}' has not run.`);
			const found = () =>
				history.some(
					(item) =>
						item.type === event &&
						item.interval >= start &&
						(target === undefined || item.target === target)
				);
			const deadline = performance.now() + (timeoutMs ?? DEFAULT_EXPECT_TIMEOUT_MS);
			while (!found()) {
				if (performance.now() >= deadline) {
					const saw = history
						.filter((item) => item.interval >= start)
						.map((item) => (item.target ? `${item.type} on ${item.target}` : item.type));
					throw new Error(
						`Expected event '${event}'${target ? ` on '${target}'` : ''} since step '${since}'; saw ${
							saw.length ? saw.join(', ') : 'no declared event'
						}.`
					);
				}
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		},
		read() {
			return {
				declared,
				history: history.map(({ interval: _interval, ...item }) => item),
				unresolved: [
					...new Set(
						declared.flatMap((item) =>
							item.target && !bound.has(item.target) ? [item.target] : []
						)
					),
				],
			};
		},
		dispose() {
			for (const remove of removers.splice(0)) remove();
		},
	};
}
