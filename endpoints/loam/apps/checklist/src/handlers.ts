/**
 * @fileoverview Checklist's commands (documents specification, 10.1), with the `store`, `clock` and `random`
 * grants. Each is an instance command, so the shell checks the document first: it exists, the actor may read
 * it, it is a checklist, in the call's scope and not in the trash (4.2). A checklist's content is
 * `{ items }`, under `documentContentKey(document)` in the document's scope, and only these commands read or
 * write it. Every change is a command at once, with its undo, so the editor holds no draft.
 */

import {
	type AppCallContextV1,
	type AppStoreV1,
	documentContentKey,
	failure,
	success,
} from '@lushly-dev/loam-sdk';

export interface ChecklistItemV1 {
	id: string;
	text: string;
	done: boolean;
}

/** A checklist's content, version 1, with when it last changed, which the content schema leaves out. */
export interface ChecklistV1 {
	items: ChecklistItemV1[];
	changedAt?: number;
}

export const MAX_ITEMS = 500;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

const STORE_MISSING = {
	code: 'APP_GRANT_MISSING',
	message: 'Checklist needs the `store` grant to keep checklists',
	suggestion: 'Declare the `store` grant in the manifest',
};

const notFound = (item: string) =>
	failure({
		code: 'CHECKLIST_ITEM_NOT_FOUND',
		message: `This checklist has no item ${item}`,
		suggestion: "Read the checklist's items and their ids with checklist-get",
	});

const isItem = (value: unknown): value is ChecklistItemV1 => {
	const held = value as Partial<ChecklistItemV1> | null;
	return (
		typeof held === 'object' &&
		held !== null &&
		typeof held.id === 'string' &&
		typeof held.text === 'string' &&
		typeof held.done === 'boolean'
	);
};

/** The checklist as stored, keeping only well-formed items, or an empty one when its row is missing. */
async function read(store: AppStoreV1, document: string): Promise<ChecklistV1> {
	const held = await store.get<ChecklistV1>(documentContentKey(document));
	const items = Array.isArray(held?.items) ? held.items.filter(isItem) : [];
	return {
		items: items.map(({ id, text, done }) => ({ id, text, done })),
		...(typeof held?.changedAt === 'number' ? { changedAt: held.changedAt } : {}),
	};
}

async function write(
	store: AppStoreV1,
	document: string,
	items: ChecklistItemV1[],
	context: AppCallContextV1
): Promise<ChecklistV1> {
	const checklist: ChecklistV1 = { items, ...(context.now ? { changedAt: context.now() } : {}) };
	await store.put(documentContentKey(document), checklist);
	return checklist;
}

/** How many ids `newItemId` draws before it gives up: a free one is all but certain in the first. */
export const ID_ATTEMPTS = 32;

/**
 * A new item's id, `itm_` and 10 characters from the call's random, not already in `taken`; or undefined
 * when `ID_ATTEMPTS` draws all collide, as only a random that repeats itself makes them.
 */
export function newItemId(random: () => number, taken: ReadonlySet<string>): string | undefined {
	for (let attempt = 0; attempt < ID_ATTEMPTS; attempt += 1) {
		let id = 'itm_';
		for (let at = 0; at < 10; at += 1) {
			id += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length) % ID_ALPHABET.length];
		}
		if (!taken.has(id)) return id;
	}
	return undefined;
}

/** What every command answers: the items in order, and how many are done. */
const shown = (checklist: ChecklistV1) => ({
	items: checklist.items,
	done: checklist.items.filter((item) => item.done).length,
	...(checklist.changedAt !== undefined ? { changedAt: checklist.changedAt } : {}),
});

export const handlers = {
	async 'checklist-get'(input: { document: string }, context: AppCallContextV1) {
		if (!context.store) return failure(STORE_MISSING);
		return success(shown(await read(context.store, input.document)));
	},

	async 'checklist-item-add'(
		input: { document: string; text: string; item?: string; done?: boolean; index?: number },
		context: AppCallContextV1
	) {
		const { store } = context;
		if (!store) return failure(STORE_MISSING);
		const text = input.text.trim();
		if (text === '') {
			return failure({
				code: 'CHECKLIST_ITEM_TEXT_EMPTY',
				message: 'An item needs some text',
				suggestion: 'Give the item text that is not only spaces',
			});
		}
		const { items } = await read(store, input.document);
		if (items.length >= MAX_ITEMS) {
			return failure({
				code: 'CHECKLIST_FULL',
				message: `A checklist holds at most ${MAX_ITEMS} items`,
				suggestion: 'Remove an item with checklist-item-remove, or start another checklist',
			});
		}
		const taken = new Set(items.map(({ id }) => id));
		// A named id puts back a removed item, as its undo does, and never writes over one that is there.
		if (input.item !== undefined && taken.has(input.item)) {
			return failure({
				code: 'CHECKLIST_ITEM_EXISTS',
				message: `This checklist already has an item ${input.item}`,
				suggestion:
					'Leave out `item` to add a new one; it names a removed item only to undo its removal',
			});
		}
		if (input.item === undefined && !context.random) {
			return failure({
				code: 'APP_GRANT_MISSING',
				message: 'Checklist needs the `random` grant to give a new item its id',
				suggestion: 'Declare the `random` grant in the manifest',
			});
		}
		const id = input.item ?? newItemId(context.random as () => number, taken);
		if (id === undefined) {
			return failure({
				code: 'CHECKLIST_ITEM_ID_UNAVAILABLE',
				message: `No free item id was found in ${ID_ATTEMPTS} tries`,
				suggestion: 'Call checklist-item-add again; a new call draws new ids',
			});
		}
		const item: ChecklistItemV1 = {
			id,
			text,
			done: input.done === true,
		};
		const at = Math.min(input.index ?? items.length, items.length);
		const next = [...items.slice(0, at), item, ...items.slice(at)];
		const checklist = await write(store, input.document, next, context);
		return success(
			{ item, ...shown(checklist) },
			{
				undoCommand: 'checklist-item-remove',
				undoArgs: { document: input.document, item: item.id },
			}
		);
	},

	async 'checklist-item-toggle'(
		input: { document: string; item: string },
		context: AppCallContextV1
	) {
		const { store } = context;
		if (!store) return failure(STORE_MISSING);
		const { items } = await read(store, input.document);
		const found = items.find(({ id }) => id === input.item);
		if (!found) return notFound(input.item);
		const item = { ...found, done: !found.done };
		const checklist = await write(
			store,
			input.document,
			items.map((held) => (held.id === item.id ? item : held)),
			context
		);
		return success(
			{ item, ...shown(checklist) },
			{
				undoCommand: 'checklist-item-toggle',
				undoArgs: { document: input.document, item: item.id },
			}
		);
	},

	async 'checklist-item-remove'(
		input: { document: string; item: string },
		context: AppCallContextV1
	) {
		const { store } = context;
		if (!store) return failure(STORE_MISSING);
		const { items } = await read(store, input.document);
		const index = items.findIndex(({ id }) => id === input.item);
		const item = items[index];
		if (!item) return notFound(input.item);
		const checklist = await write(
			store,
			input.document,
			items.filter(({ id }) => id !== item.id),
			context
		);
		return success(
			{ item, ...shown(checklist) },
			{
				undoCommand: 'checklist-item-add',
				undoArgs: {
					document: input.document,
					text: item.text,
					item: item.id,
					done: item.done,
					index,
				},
			}
		);
	},
};
