/**
 * @fileoverview Each dispatch's own view of a context's clock and random source (#2890).
 *
 * The journal records a call by having its handler read a recording clock and random source,
 * and keeps a secret call off tape by having it read the sources under them. Assigning those to
 * `context.clock` and `context.random` for the length of the call would let a concurrent call on
 * the same context object read them too: a chain composed by hand and run concurrently on one
 * context would put a secret call's values on a sibling's tape, or take a sibling's reads off its
 * own, and could leave a finished call's recorder on the context.
 *
 * So, where the runtime has `AsyncLocalStorage` (Node, Deno, Bun), a journal step sets the
 * sources for its own dispatch only, in an async-local view. While any step runs on a context,
 * its `clock` and `random` are accessors that return the current dispatch's source, or the
 * context's own (unchanged, `undefined` included) to any other reader; the last step to leave
 * puts the property back as it was. A spread of the context (`{ ...context }`, as each engine
 * makes for a nested call) reads the accessor, so the copy holds the plain source its parent's
 * dispatch reads and never the view. The view travels with the accessor, under a registered
 * symbol, so a second copy of this package uses the first one's.
 *
 * `AsyncLocalStorage` is looked up at run time (`process.getBuiltinModule`), so the
 * browser-safe entries import nothing from Node. Where it is missing (a browser), or the context
 * refuses an accessor, the step assigns the sources for the length of the call, as before: every
 * engine in this package gives each dispatch its own context object, and a chain composed by
 * hand must too.
 */

import type { Clock, CommandContext, RandomSource } from '@lushly-dev/afd-core';

type SourceKey = 'clock' | 'random';
type Source = Clock | RandomSource;

/** The sources one step sets for its dispatch; a key left out is not set. */
export interface DispatchSources {
	clock?: Clock;
	random?: RandomSource;
}

interface AsyncStore<T> {
	getStore(): T | undefined;
	run<R>(store: T, callback: () => R): R;
}

/** Each property view to the step whose source the current dispatch reads. Never mutated. */
type View = ReadonlyMap<object, Step>;

function loadStore(): AsyncStore<View> | undefined {
	try {
		const host = globalThis as {
			process?: { getBuiltinModule?: (id: string) => unknown };
		};
		const hooks = host.process?.getBuiltinModule?.('node:async_hooks') as
			| { AsyncLocalStorage?: new () => AsyncStore<View> }
			| undefined;
		return hooks?.AsyncLocalStorage ? new hooks.AsyncLocalStorage() : undefined;
	} catch {
		return undefined;
	}
}

const views = loadStore();

/** Whether each dispatch gets its own view here, or the step assigns the sources (a browser). */
export const hasDispatchViews = views !== undefined;

/** On a view accessor's getter: the view, so a separately installed copy of this package uses it. */
const VIEW = Symbol.for('dev.afd/journal-view');

/** One step running through a property view. Its shape is shared by every copy of this package. */
interface Step {
	source: Source;
	/** Told when a read this step may have needed went elsewhere: its tape is incomplete. */
	missed?: () => void;
	/** A step that keeps its call off tape: a read through it must reach no recording. */
	offTape?: boolean;
	/** The step on this view whose dispatch this one started in, set when it runs. */
	parent?: Step;
}

/** Whether `step` runs inside `ancestor`'s dispatch, at any depth. */
function within(step: Step, ancestor: Step): boolean {
	for (let at = step.parent; at; at = at.parent) if (at === ancestor) return true;
	return false;
}

/** The view of one source property of one context while journal steps run on it. */
interface PropertyView {
	/** What the current dispatch reads: its step's source, else the context's own. */
	read(): Source | undefined;
	run<T>(step: Step, next: () => Promise<T>): Promise<T>;
	/** The context's own source, as the property gave it before the first step. */
	readonly base: Source | undefined;
	/** Take the view off again when no step has run through it. */
	discard?(): void;
	/** The context's own source when an assignment replaced the view, read just before it. */
	replacedFrom?: Source | undefined;
}

function viewOf(context: CommandContext, key: SourceKey): PropertyView | undefined {
	const descriptor = Object.getOwnPropertyDescriptor(context, key);
	const getter = descriptor?.get as { [VIEW]?: PropertyView } | undefined;
	return getter?.[VIEW];
}

/** Whether `context[key]` can take a view: a configurable property, or room for a new one. */
function canView(context: CommandContext, key: SourceKey): boolean {
	const descriptor = Object.getOwnPropertyDescriptor(context, key);
	return descriptor ? descriptor.configurable === true : Object.isExtensible(context);
}

/** Put a view on `context[key]`, or `undefined` when the context refuses an accessor there. */
function install(
	store: AsyncStore<View>,
	context: CommandContext,
	key: SourceKey
): PropertyView | undefined {
	const original = Object.getOwnPropertyDescriptor(context, key);
	// The context's own source as the property gives it, a getter's live value included.
	const own = (): Source | undefined =>
		(original
			? original.get
				? original.get.call(context)
				: original.value
			: Reflect.get(Object.getPrototypeOf(context) ?? {}, key, context)) as Source | undefined;
	const steps = new Set<Step>();
	let installed = true;
	const restore = () => {
		installed = false;
		if (original) Object.defineProperty(context, key, original);
		else delete (context as Record<string, unknown>)[key];
	};
	const view: PropertyView = {
		get base() {
			return own();
		},
		read() {
			const step = store.getStore()?.get(view);
			if (!installed || !step) return own();
			// Work this dispatch started before an off-tape call inside it (a worker, a queue) reads
			// in this dispatch's scope, and may be reading for that call: whose read it is cannot be
			// told, so it reaches no tape, and this step's tape says it may be missing one.
			for (const running of steps) {
				if (running.offTape && within(running, step)) {
					step.missed?.();
					return running.source;
				}
			}
			return step.source;
		},
		async run(step, next) {
			const scope = new Map(store.getStore() ?? []);
			step.parent = scope.get(view);
			steps.add(step);
			scope.set(view, step);
			try {
				return await store.run(scope, next);
			} finally {
				steps.delete(step);
				if (installed && steps.size === 0) restore();
			}
		},
		discard() {
			if (installed && steps.size === 0) restore();
		},
	};
	const get = Object.assign(() => view.read(), { [VIEW]: view });
	try {
		Object.defineProperty(context, key, {
			configurable: true,
			enumerable: original?.enumerable ?? true,
			get,
			set(value: unknown) {
				// Whoever assigns replaces the source for every call, as the property itself takes
				// it. The steps running read the new one too, which their tapes do not hold.
				for (const step of steps) step.missed?.();
				view.replacedFrom = own();
				restore();
				// An ordinary assignment, so a setter the context or its prototype has still runs.
				(context as Record<string, unknown>)[key] = value;
			},
		});
	} catch {
		// A proxy that refuses it.
		return undefined;
	}
	return view;
}

/**
 * The `clock` or `random` the current dispatch reads on `context`: the source its own journal
 * step set, else the context's own. Never another call's on the same context.
 */
export function dispatchSource(context: CommandContext, key: 'clock'): Clock | undefined;
export function dispatchSource(context: CommandContext, key: 'random'): RandomSource | undefined;
export function dispatchSource(context: CommandContext, key: SourceKey): Source | undefined {
	return context[key] as Source | undefined;
}

/**
 * Run `next` with `context.clock` and `context.random` reading `sources`, for this dispatch only
 * where the runtime has `AsyncLocalStorage`, and for the length of the call otherwise. `missed`
 * is told when a source the step set was replaced on the context while it ran.
 */
export async function runWithSources<T>(
	context: CommandContext,
	sources: DispatchSources,
	next: () => Promise<T>,
	options: { missed?: () => void; offTape?: boolean; optional?: boolean } = {}
): Promise<T> {
	const keys = (['clock', 'random'] as const).filter((key) => sources[key] !== undefined);
	// Every key or none: a context that refuses a view on one has the sources swapped on both.
	const viewable =
		views !== undefined && keys.every((key) => viewOf(context, key) || canView(context, key));
	if (!viewable) return options.optional ? next() : swap(context, keys, sources, next);
	const viewed: Array<[SourceKey, PropertyView, Source]> = [];
	for (const key of keys) {
		const view = viewOf(context, key) ?? install(views, context, key);
		if (!view) {
			for (const [, taken] of viewed) taken.discard?.();
			return options.optional ? next() : swap(context, keys, sources, next);
		}
		viewed.push([key, view, sources[key] as Source]);
	}
	let call = next;
	for (const [, view, source] of viewed) {
		const inner = call;
		const step: Step = {
			source,
			...(options.missed ? { missed: options.missed } : {}),
			...(options.offTape ? { offTape: true } : {}),
		};
		call = () => view.run(step, inner);
	}
	try {
		return await call();
	} finally {
		// A journal that assigns instead (an older copy of this package) replaced the view and
		// wrote back what it read through it: this step's source. Put the context's own back.
		for (const [key, view, source] of viewed) {
			// Only a view an assignment replaced: one that restored itself left nothing behind.
			if (!('replacedFrom' in view) || viewOf(context, key) === view) continue;
			try {
				if (context[key] !== source || view.replacedFrom === source) continue;
				(context as Record<SourceKey, unknown>)[key] = view.replacedFrom;
			} catch {
				// A source the context gives through a getter alone, or one that throws: leave it.
			}
		}
	}
}

/** Assign `sources` for the length of the call, as the journal did before #2890. */
async function swap<T>(
	context: CommandContext,
	keys: readonly SourceKey[],
	sources: DispatchSources,
	next: () => Promise<T>
): Promise<T> {
	const saved: Array<readonly [SourceKey, unknown, boolean]> = [];
	try {
		for (const key of keys) {
			const entry = [key, context[key], Object.hasOwn(context, key)] as const;
			(context as Record<SourceKey, unknown>)[key] = sources[key];
			saved.push(entry);
		}
		return await next();
	} finally {
		for (const [key, value, own] of saved.reverse()) {
			// The assignment added an own property, or went through an inherited setter.
			if (!own && Object.hasOwn(context, key)) delete (context as Record<SourceKey, unknown>)[key];
			else (context as Record<SourceKey, unknown>)[key] = value;
		}
	}
}
