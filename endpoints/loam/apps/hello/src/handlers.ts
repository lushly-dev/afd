/**
 * @fileoverview Hello's commands, written once (phase 1 specification, 11.1). Nothing here touches the
 * DOM, so the same module serves as a native app, a view's handler frame and the test kit.
 */

import { type AppCallContextV1, failure, success } from '@lushly-dev/loam-sdk';

const STORE_MISSING = {
	code: 'APP_GRANT_MISSING',
	message: 'Hello needs the `store` grant to remember names',
	suggestion: 'Declare the `store` grant in the manifest',
};

/** Told after a command changes the store, so a surface in this page can read it again. */
const listeners = new Set<() => void>();

export function onGreetingsChanged(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

const changed = (): void => {
	for (const listener of listeners) listener();
};

const nameOf = (input: { name?: string }, context: AppCallContextV1): string =>
	input.name ??
	(typeof context.config.default_name === 'string' ? context.config.default_name : 'world');

/** `hello.general.greeting`'s default (the manifest's), and what Hello says without the `settings` grant. */
export const DEFAULT_GREETING = 'Hello';

/**
 * The greeting that applies here (phase 4 specification, 3.8): the project's, else the workspace's, else the default,
 * read through the `settings` grant. A read that fails greets with the default.
 */
export async function greetingOf(context: Pick<AppCallContextV1, 'settings'>): Promise<string> {
	const value = await context.settings
		?.get<string>('hello.general', 'greeting')
		.catch(() => undefined);
	return typeof value === 'string' && value.trim() !== '' ? value : DEFAULT_GREETING;
}

export const handlers = {
	async 'hello-greet'(input: { name?: string }, context: AppCallContextV1) {
		if (!context.store) return failure(STORE_MISSING);
		const name = nameOf(input, context);
		const greeting = await greetingOf(context);
		const at = context.now?.() ?? null;
		await context.store.put(name, { at });
		changed();
		return success(
			{ greeting: `${greeting}, ${name}!`, at },
			{ undoCommand: 'hello-forget', undoArgs: { name } }
		);
	},
	async 'hello-list'(_input: Record<string, never>, context: AppCallContextV1) {
		if (!context.store) return failure(STORE_MISSING);
		const stored = await context.store.list();
		return success({ items: stored.map(({ key }) => ({ id: key, title: key })) });
	},
	/**
	 * The guest book (phase 4 specification, section 1's `apps/hello` row): every visitor Hello has met, by name, with
	 * whether it greeted them. A visitor joins it when `hello-greet` greets them, an inbox action among the ways.
	 */
	async 'hello-guests'(_input: Record<string, never>, context: AppCallContextV1) {
		if (!context.store) return failure(STORE_MISSING);
		const stored = await context.store.list();
		return success({
			guests: stored.map(({ key, value }) => ({
				name: key,
				greeted: true,
				at: (value as { at?: number | null } | undefined)?.at ?? null,
			})),
		});
	},
	async 'hello-forget'(input: { name: string }, context: AppCallContextV1) {
		if (!context.store) return failure(STORE_MISSING);
		await context.store.delete(input.name);
		changed();
		return success({ name: input.name });
	},
};
