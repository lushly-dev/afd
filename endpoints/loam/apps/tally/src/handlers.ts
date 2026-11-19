/** @fileoverview Tally's commands, with the `store` grant holding the total and its history. */

import { type AppCallContextV1, type AppStoreV1, failure, success } from '@lushly-dev/loam-sdk';

const STORE_MISSING = {
	code: 'APP_GRANT_MISSING',
	message: 'Tally needs the `store` grant to keep a total',
	suggestion: 'Declare the `store` grant in the manifest',
};

interface Held {
	total: number;
	history: number[];
}

/** Told after a command changes the store, so a surface in this page can read it again. */
const listeners = new Set<() => void>();

export function onTallyChanged(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** One change at a time: two quick presses would otherwise read the same total, and a reset lands between adds. */
let adding: Promise<unknown> = Promise.resolve();

async function add(by: number, store: AppStoreV1): Promise<Held> {
	const held = (await store.get<Held>('tally')) ?? { total: 0, history: [] };
	const next: Held = { total: held.total + by, history: [...held.history, by].slice(-50) };
	await store.put('tally', next);
	return next;
}

export const handlers = {
	async 'tally-add'(input: { by?: number }, context: AppCallContextV1) {
		const { store } = context;
		if (!store) return failure(STORE_MISSING);
		const added = adding.then(() => add(input.by ?? 1, store));
		adding = added.catch(() => {});
		const next = await added;
		for (const listener of listeners) listener();
		return success(next);
	},
	/** Back to zero, history cleared, after the person confirmed (phase 4 specification, 7.2): the shell asks, not the app. */
	async 'tally-reset'(_input: Record<string, never>, context: AppCallContextV1) {
		const { store } = context;
		if (!store) return failure(STORE_MISSING);
		const reset = adding.then(async () => {
			const next: Held = { total: 0, history: [] };
			await store.put('tally', next);
			return next;
		});
		adding = reset.catch(() => {});
		const next = await reset;
		for (const listener of listeners) listener();
		return success(next);
	},
	async 'tally-get'(_input: Record<string, never>, context: AppCallContextV1) {
		if (!context.store) return failure(STORE_MISSING);
		return success((await context.store.get<Held>('tally')) ?? { total: 0, history: [] });
	},
};
