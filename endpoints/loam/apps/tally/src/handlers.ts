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

/** One add at a time: two quick presses would otherwise read the same total. */
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
	async 'tally-get'(_input: Record<string, never>, context: AppCallContextV1) {
		if (!context.store) return failure(STORE_MISSING);
		return success((await context.store.get<Held>('tally')) ?? { total: 0, history: [] });
	},
};
