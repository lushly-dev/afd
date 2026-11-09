/**
 * @fileoverview Notes' commands (documents specification, 10), with the `store` and `clock` grants. Each is
 * an instance command, so the shell checks the document first: it exists, the actor may read it, it is a
 * note, in the call's scope and not in the trash (4.2). A note's content is `{ text, embeds? }`, under
 * `documentContentKey(document)` in the document's scope, and only these commands read or write it. Links
 * are separate commands, which a surface calls: a handler may not, by D68's "a nested call may only be a
 * query", so `notes-content-set` reminds a caller whose text names a document it has not linked.
 */

import {
	type AppCallContextV1,
	type AppStoreV1,
	documentContentKey,
	failure,
	type LinkRowV1,
	success,
} from '@lushly-dev/loam-sdk';
import { parseLinks } from './links.js';

/** A note's content, version 1, with the time it was last saved, which the content schema leaves out. */
export interface NoteV1 {
	text: string;
	embeds?: string[];
	savedAt?: number;
}

const STORE_MISSING = {
	code: 'APP_GRANT_MISSING',
	message: 'Notes needs the `store` grant to keep notes',
	suggestion: 'Declare the `store` grant in the manifest',
};

const MAX_TEXT = 200_000;

/** The note's content as stored, or an empty note when its row is missing. */
async function read(store: AppStoreV1, document: string): Promise<NoteV1> {
	const held = await store.get<NoteV1>(documentContentKey(document));
	return held && typeof held.text === 'string' ? held : { text: '' };
}

/** Content an import may write: `{ text, embeds? }`, in its bounds. */
function contentOf(value: unknown): NoteV1 | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
	const { text, embeds } = value as Record<string, unknown>;
	if (typeof text !== 'string' || text.length > MAX_TEXT) return undefined;
	if (embeds === undefined) return { text };
	if (
		!Array.isArray(embeds) ||
		embeds.length > 20 ||
		embeds.some((id) => typeof id !== 'string' || id.length < 1 || id.length > 128)
	) {
		return undefined;
	}
	return { text, embeds: [...embeds] };
}

/**
 * Whether `text` names a document this note has no `reference` link to, by a nested query, which a handler
 * may make: the links are the caller's to add (documents specification, 10).
 */
async function unlinked(
	document: string,
	text: string,
	context: AppCallContextV1
): Promise<boolean> {
	const named = parseLinks(text);
	if (named.length === 0) return false;
	const read = await context.client.call<{ out: LinkRowV1[] }>('document-link-list', {
		document,
		direction: 'out',
	});
	const linked = new Set(
		(read.data?.out ?? []).filter((row) => row.link.kind === 'reference').map((row) => row.link.to)
	);
	return named.some((link) => !linked.has(link.document));
}

/** What a read answers: the content, with `embeds` always a list. */
const shown = (note: NoteV1) => ({
	text: note.text,
	embeds: note.embeds ?? [],
	...(note.savedAt !== undefined ? { savedAt: note.savedAt } : {}),
});

export const handlers = {
	async 'notes-content-get'(input: { document: string }, context: AppCallContextV1) {
		if (!context.store) return failure(STORE_MISSING);
		return success(shown(await read(context.store, input.document)));
	},

	async 'notes-content-set'(
		input: { document: string; text: string; embeds?: string[] },
		context: AppCallContextV1
	) {
		const { store } = context;
		if (!store) return failure(STORE_MISSING);
		const previous = await read(store, input.document);
		const note: NoteV1 = {
			text: input.text,
			embeds: input.embeds ?? previous.embeds ?? [],
			...(context.now ? { savedAt: context.now() } : {}),
		};
		await store.put(documentContentKey(input.document), note);
		return success(shown(note), {
			undoCommand: 'notes-content-set',
			undoArgs: { document: input.document, text: previous.text, embeds: previous.embeds ?? [] },
			...((await unlinked(input.document, input.text, context))
				? {
						warnings: [
							{
								code: 'NOTE_LINKS_SEPARATE',
								message: 'links are separate: document-link-add',
							},
						],
					}
				: {}),
		});
	},

	async 'notes-export'(input: { document: string }, context: AppCallContextV1) {
		if (!context.store) return failure(STORE_MISSING);
		const { text, embeds } = await read(context.store, input.document);
		return success({ content: { text, ...(embeds?.length ? { embeds } : {}) } });
	},

	async 'notes-import'(input: { document: string; content: unknown }, context: AppCallContextV1) {
		const { store } = context;
		if (!store) return failure(STORE_MISSING);
		const content = contentOf(input.content);
		if (!content) {
			return failure({
				code: 'NOTE_CONTENT_INVALID',
				message:
					'A note is { text, embeds? }: text of at most 200,000 characters, at most 20 embeds',
				suggestion: 'Import what notes-export answered, as document-import passes it',
			});
		}
		// It writes over what the note held, as `document-import`'s `data.next` asks for a new one; called on
		// any other note, it replaces that note's content, which its undo restores.
		const previous = await read(store, input.document);
		const note: NoteV1 = { ...content, ...(context.now ? { savedAt: context.now() } : {}) };
		await store.put(documentContentKey(input.document), note);
		return success(shown(note), {
			undoCommand: 'notes-content-set',
			undoArgs: { document: input.document, text: previous.text, embeds: previous.embeds ?? [] },
		});
	},
};
