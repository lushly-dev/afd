import type { EventDeclaration, EventExpectation, EventRecord } from '../types.js';
import { describe } from './plugins.js';
import { realDelay } from './real-timers.js';

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
const DEFAULT_ABSENT_WAIT_MS = 100;

function enclosingFormHost(element: Element): Element | null {
	if ((element as Element & { form?: HTMLFormElement | null }).form != null) return null;
	for (
		let root = element.getRootNode();
		root instanceof ShadowRoot;
		root = root.host.getRootNode()
	) {
		if (
			root.host.localName.includes('-') &&
			(root.host.constructor as { formAssociated?: boolean }).formAssociated === true
		) {
			return root.host;
		}
	}
	return null;
}

export function recordEvents(root: Element, declared: EventDeclaration[]): EventRecorder {
	const history: (EventRecord & { interval: number })[] = [];
	const bound = new Map<string, Element>();
	const hostFallback = new Map<string, Element>();
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
		const exact =
			listeningFor ??
			declarations.find((item) => {
				const target = item.target ? bound.get(item.target) : undefined;
				return target !== undefined && path.includes(target);
			})?.target ??
			null;
		// Reserve form-associated host fallback for events originating on the host itself, so an
		// event from a sibling control inside a shared shadow host cannot satisfy another target.
		const named =
			exact ??
			declarations.find((item) => {
				const host = item.target ? hostFallback.get(item.target) : undefined;
				return host !== undefined && path[0] === host;
			})?.target ??
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
			const host = enclosingFormHost(element);
			if (host) hostFallback.set(name, host);
			for (const item of declared)
				if (item.target === name) {
					observe(element, item.type, (event) => record(event, name));
					if (element.shadowRoot)
						observe(element.shadowRoot, item.type, (event) => record(event, name));
					if (host) {
						observe(host, item.type, (event) => record(event, null));
						if (host.shadowRoot)
							observe(host.shadowRoot, item.type, (event) => record(event, null));
					}
				}
		},
		stepStarted(id) {
			interval += 1;
			step = id;
			if (id) intervals.set(id, interval);
		},
		async expect({ event, target, since, timeoutMs, absent }) {
			const start = intervals.get(since);
			if (start === undefined) throw new Error(`Step '${since}' has not run.`);
			const found = () =>
				history.some(
					(item) =>
						item.type === event &&
						item.interval >= start &&
						(target === undefined || item.target === target)
				);
			if (absent) {
				// Long enough for what it would have caused, not for a second per expectation.
				await realDelay(timeoutMs ?? DEFAULT_ABSENT_WAIT_MS);
				if (found())
					throw new Error(
						`Expected no event '${event}'${target ? ` on '${target}'` : ''} since step '${since}'; one fired.`
					);
				return;
			}
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
				await realDelay(10);
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
