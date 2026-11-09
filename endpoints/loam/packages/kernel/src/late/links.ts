/**
 * @fileoverview References (documents specification, 9.3; D81), in the `late` chunk: the `document-link`
 * table, `createDocumentIndex`, its two maps built once by one `list` of the table, and the three
 * `document-link-*` commands. Links cross projects freely within the workspace; a reader sees only the rows
 * whose other document it may read, and nothing counts the rest. Through an app's port, a row or an end
 * outside the call's scope is the same as a missing one (4.2).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import {
	defineCommandWithSchema,
	type JsonSchema,
	success,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import type { DocumentLinkV1, DocumentRecordV1, LinkRowV1 } from '@lushly-dev/loam-sdk';
import type { BatchOperation, DataAdapter } from '@lushly-dev/local-db';
import {
	enum as choice,
	maxLength,
	minLength,
	optional,
	regex,
	strictObject,
	string,
	unknown,
} from 'zod/mini';
import type { KernelFieldContext } from '../context-fields.js';
import { kernelFailure } from '../errors.js';
import { actorKey } from '../scope/access.js';
import type { ScopeV1 } from '../scope/records.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import {
	callNow,
	DOCUMENT_TABLE,
	type DocumentCheck,
	documentNotFound,
	sameScope,
} from './document-types.js';

/** The link table (9.3). */
export const LINK_TABLE = 'document-link';

/** A link's anchor, as JSON, is at most this many bytes (9.3). */
export const LINK_ANCHOR_MAX_BYTES = 1024;

/** The index (9.3): each document's links out and in, built once by one `list` of the table. */
export interface DocumentIndex {
	/** The links from `document`, then to it. */
	of(document: string): Promise<{ out: DocumentLinkV1[]; in: DocumentLinkV1[] }>;
	/** Every link from or to one of `documents`, each once: what expiry deletes with them. */
	touching(documents: readonly string[]): Promise<DocumentLinkV1[]>;
	/** After a write that landed: a link added, or one removed. */
	added(link: DocumentLinkV1): void;
	removed(link: DocumentLinkV1): void;
	/** Whether `id` names a link `document-link-remove` removed, which only its undo adds again. */
	undone(id: string): boolean;
	/**
	 * Run `run` after every earlier change to the table, so an add never misses a link another add is
	 * writing, and expiry never deletes beside a write.
	 */
	serial<T>(run: () => Promise<T>): Promise<T>;
}

const bucket = (
	map: Map<string, Map<string, DocumentLinkV1>>,
	key: string
): Map<string, DocumentLinkV1> => {
	const held = map.get(key) ?? new Map<string, DocumentLinkV1>();
	map.set(key, held);
	return held;
};

/**
 * The index over `store`'s link table (9.3; A4): two `Map`s, from and to, built by one `list` at the first
 * read, then kept by what the commands and expiry write.
 */
export function createDocumentIndex(store: DataAdapter): DocumentIndex {
	const from = new Map<string, Map<string, DocumentLinkV1>>();
	const to = new Map<string, Map<string, DocumentLinkV1>>();
	let built: Promise<void> | undefined;
	/** The ids `document-link-remove` removed, which its undo may name. */
	const gone = new Set<string>();
	let chain: Promise<unknown> = Promise.resolve();
	const add = (link: DocumentLinkV1) => {
		bucket(from, link.from).set(link.id, link);
		bucket(to, link.to).set(link.id, link);
	};
	const build = (): Promise<void> =>
		(built ??= store.list<DocumentLinkV1>(LINK_TABLE).then(
			({ data }) => {
				for (const link of data) add(link);
			},
			(cause) => {
				// A first list that fails is tried again by the next read.
				built = undefined;
				throw cause;
			}
		));
	return {
		async of(document) {
			await build();
			return {
				out: [...(from.get(document)?.values() ?? [])],
				in: [...(to.get(document)?.values() ?? [])],
			};
		},
		async touching(documents) {
			await build();
			const found = new Map<string, DocumentLinkV1>();
			for (const document of documents) {
				for (const link of from.get(document)?.values() ?? []) found.set(link.id, link);
				for (const link of to.get(document)?.values() ?? []) found.set(link.id, link);
			}
			return [...found.values()];
		},
		added: add,
		removed(link) {
			from.get(link.from)?.delete(link.id);
			to.get(link.to)?.delete(link.id);
			gone.add(link.id);
		},
		undone: (id) => gone.has(id),
		serial(run) {
			const next = chain.then(run, run);
			chain = next.catch(() => undefined);
			return next;
		},
	};
}

/** The DELETE of each link, by path, for a batch. */
export const linkDeletes = (links: readonly DocumentLinkV1[]): BatchOperation[] =>
	links.map((link) => ({
		method: 'DELETE',
		path: `/${LINK_TABLE}/${encodeURIComponent(link.id)}`,
	}));

/**
 * Expiry's part (documents specification, 4.1): `run` gets the DELETE of every link from or to `documents`,
 * to put in its batch, after every earlier change to the table; once it returns, they leave the index.
 */
export function expireLinks(index: DocumentIndex) {
	return <T>(documents: readonly string[], run: (operations: BatchOperation[]) => Promise<T>) =>
		index.serial(async () => {
			const links = await index.touching(documents);
			const result = await run(linkDeletes(links));
			for (const link of links) index.removed(link);
			return result;
		});
}

export interface LinkDeps {
	scope: ScopeRuntime;
	store: DataAdapter;
	check: DocumentCheck;
	index: DocumentIndex;
}

const isRefusal = (value: unknown): value is CommandResult<never> =>
	typeof value === 'object' && value !== null && 'success' in value;

/** A closed object's JSON Schema, as Zod Mini's `strictObject` writes it. */
const object = (properties: Record<string, JsonSchema>, required: string[]): JsonSchema =>
	({ type: 'object', properties, required, additionalProperties: false }) as JsonSchema;

const ID_JSON: JsonSchema = { type: 'string', minLength: 1, maxLength: 128 };
const LINK_ID = /^lnk_[0-9a-z]{12}$/;
const KIND = /^[a-z][a-z-]{0,31}$/;

export function createLinkCommands(deps: LinkDeps): ZodCommandDefinition[] {
	const { scope, store, check, index } = deps;
	const workspace = scope.workspace.id;
	const id = string().check(minLength(1), maxLength(128));
	const addInput = strictObject({
		from: id,
		to: id,
		anchor: optional(unknown()),
		kind: optional(string().check(regex(KIND))),
		// The undo of a remove, which adds the same link again; never an app's (below).
		id: optional(string().check(regex(LINK_ID))),
	});
	const removeInput = strictObject({ link: id });
	const listInput = strictObject({
		document: id,
		direction: optional(choice(['out', 'in', 'both'])),
	});
	const callOf = (context: CommandContext) => context as CommandContext & KernelFieldContext;

	/** `lnk_` and twelve base-36 characters from the command's random, so a replay reproduces it. */
	const linkId = (context: CommandContext): string =>
		`lnk_${`${(context.random?.next() ?? Math.random()).toString(36).slice(2)}000000000000`.slice(0, 12)}`;

	/** Every link's other document as the reader may see it: read, within the call's scope for an app (4.2). */
	async function rows(
		links: readonly DocumentLinkV1[],
		other: 'from' | 'to',
		context: CommandContext
	): Promise<LinkRowV1[]> {
		const call = callOf(context);
		const here = call.scope as ScopeV1;
		const actor = actorKey(context);
		const found: LinkRowV1[] = [];
		for (const link of links) {
			const record = await store.get<DocumentRecordV1>(DOCUMENT_TABLE, link[other]);
			// Left out, and counted nowhere: missing, refused, or outside an app's scope (9.3).
			if (
				!record ||
				record.workspace !== workspace ||
				!scope.allows(actor, record.scope) ||
				(call.caller !== undefined && !sameScope(record.scope, here))
			)
				continue;
			const { title, type, status } = record;
			found.push({
				link,
				document: { id: record.id, title, type, status, scope: record.scope },
			});
		}
		return found;
	}

	const sameLink = (link: DocumentLinkV1, anchor: unknown, kind: string, to: string) =>
		link.to === to && link.kind === kind && JSON.stringify(link.anchor) === JSON.stringify(anchor);

	const add = defineCommandWithSchema<typeof addInput, DocumentLinkV1>({
		name: 'document-link-add',
		title: 'Link two documents',
		description:
			"Link a document to another, in any project; kind is 'reference' by default, or 'embed'",
		category: 'document',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: addInput,
		jsonSchema: object(
			{
				from: ID_JSON,
				to: ID_JSON,
				anchor: {} as JsonSchema,
				kind: { type: 'string', pattern: KIND.source },
				id: { type: 'string', pattern: LINK_ID.source },
			},
			['from', 'to']
		),
		handler: (input, context) =>
			index.serial(async () => {
				// `from` is changed, so it may not be in the trash or an archived project; `to` is only named, and a
				// trashed target may be (4.2). Either one refused or missing is a missing document.
				const source = await check.find(input.from, 'document-link-add', context);
				if (isRefusal(source)) return source;
				const target = await check.find(input.to, 'document-link-list', context);
				if (isRefusal(target)) return target;
				const anchor = input.anchor ?? null;
				const kind = input.kind ?? 'reference';
				if (new TextEncoder().encode(JSON.stringify(anchor) ?? '').length > LINK_ANCHOR_MAX_BYTES) {
					return kernelFailure(
						'VALIDATION_ERROR',
						"A link's anchor is at most 1 KiB of JSON",
						'Anchor the link with a smaller locator, or none'
					);
				}
				const held = (await index.of(source.id)).out.find((link) =>
					sameLink(link, anchor, kind, target.id)
				);
				// One link of a pair, kind and anchor: an existing one is the answer, and nothing changes to undo.
				if (held) return success(held);
				const link: DocumentLinkV1 = {
					id: input.id ?? linkId(context),
					workspace,
					from: source.id,
					to: target.id,
					anchor,
					kind,
					createdAt: callNow(context),
					createdBy: actorKey(context),
				};
				// Only a remove's undo names an id, never an app's: any other, or one taken, is a missing document's
				// answer, so nothing learns whether an id exists. No write lands over an existing id.
				if (input.id !== undefined) {
					if (callOf(context).caller !== undefined || !index.undone(input.id))
						return documentNotFound();
				}
				for (let tries = 0; await store.get(LINK_TABLE, link.id); tries++) {
					if (input.id !== undefined || tries === 3) return documentNotFound();
					link.id = linkId(context);
				}
				const { summary } = await store.batch([
					{ method: 'PUT', path: `/${LINK_TABLE}/${encodeURIComponent(link.id)}`, body: link },
				]);
				if (summary.failed > 0) throw new Error('The store could not write the link');
				index.added(link);
				return success(link, {
					undoCommand: 'document-link-remove',
					undoArgs: { link: link.id },
				});
			}),
	});

	const remove = defineCommandWithSchema<typeof removeInput, { link: string }>({
		name: 'document-link-remove',
		title: 'Remove a link',
		description: 'Remove a link, by its id from document-link-list',
		category: 'document',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: removeInput,
		jsonSchema: object({ link: ID_JSON }, ['link']),
		handler: (input, context) =>
			index.serial(async () => {
				const link = await store.get<DocumentLinkV1>(LINK_TABLE, input.link);
				// A missing link answers in the bytes of a missing document, as a refused one does (4.2).
				if (!link || link.workspace !== workspace) return documentNotFound();
				// Both ends decided, either refusal the bytes of a missing id (4.2): the read first, then `from`, the one
				// changed, so a trashed source is said only once the reader may see both ends.
				const target = await check.find(link.to, 'document-link-list', context);
				if (isRefusal(target)) return target;
				const source = await check.find(link.from, 'document-link-remove', context);
				if (isRefusal(source)) return source;
				const { summary } = await store.batch(linkDeletes([link]));
				if (summary.failed > 0) throw new Error('The store could not remove the link');
				index.removed(link);
				const { from, to, anchor, kind } = link;
				return success(
					{ link: link.id },
					{
						undoCommand: 'document-link-add',
						undoArgs: { from, to, anchor, kind, id: link.id },
					}
				);
			}),
	});

	const list = defineCommandWithSchema<typeof listInput, { out: LinkRowV1[]; in: LinkRowV1[] }>({
		name: 'document-link-list',
		description: "List a document's links out and in: those whose other document you may read",
		category: 'document',
		mutation: false,
		executionTime: 'instant',
		input: listInput,
		jsonSchema: object(
			{ document: ID_JSON, direction: { type: 'string', enum: ['out', 'in', 'both'] } },
			['document']
		),
		async handler(input, context) {
			const record = await check.find(input.document, 'document-link-list', context);
			if (isRefusal(record)) return record;
			const direction = input.direction ?? 'both';
			const links = await index.of(record.id);
			return success({
				out: direction === 'in' ? [] : await rows(links.out, 'to', context),
				in: direction === 'out' ? [] : await rows(links.in, 'from', context),
			});
		},
	});

	return [add, remove, list] as unknown as ZodCommandDefinition[];
}
