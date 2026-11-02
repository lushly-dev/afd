/** @fileoverview Tally's commands, with the `store` grant holding the total and its history. */

import { type AppCallContextV1, failure, success } from '@lushly-dev/loam-sdk';

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

export const handlers = {
	async 'tally-add'(input: { by?: number }, context: AppCallContextV1) {
		if (!context.store) return failure(STORE_MISSING);
		const by = input.by ?? 1;
		const held = (await context.store.get<Held>('tally')) ?? { total: 0, history: [] };
		const next: Held = { total: held.total + by, history: [...held.history, by].slice(-50) };
		await context.store.put('tally', next);
		for (const listener of listeners) listener();
		return success(next);
	},
	async 'tally-get'(_input: Record<string, never>, context: AppCallContextV1) {
		if (!context.store) return failure(STORE_MISSING);
		return success((await context.store.get<Held>('tally')) ?? { total: 0, history: [] });
	},
};
