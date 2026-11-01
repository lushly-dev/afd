/**
 * @fileoverview MCP resources and the Skills extension's methods (`spec/mcp-resources.md`).
 *
 * A server given `resources` serves a {@link ResourceProvider}'s entries; one given `skills`
 * serves a {@link SkillCatalog} through `skills/list`, `skills/get` and the skill files as
 * resources. A server given either declares the `resources` capability (never `subscribe` or
 * `listChanged`: AFD servers push nothing), and one given a catalog also declares
 * `io.modelcontextprotocol/skills`.
 *
 * A read runs no command, middleware, confirmation, approval or journal entry, and
 * `createContext` does not run for it; failures are JSON-RPC errors, never `CommandResult`s. An
 * unknown URI is `-32602` with `data.uri` on both MCP eras.
 */

import { ProtocolError, ProtocolErrorCode, type Server } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { checkMetaEntry } from './meta-keys.js';
import { DIGEST_META_KEY, SKILLS_EXTENSION_ID, type SkillCatalog, sha256Digest } from './skills.js';

/** The MIME type MCP Apps requires of a `ui://` resource. */
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

/**
 * One item of `resources/list` (`spec/mcp-resources.md`, R2).
 *
 * The server checks the entries when it is built and each time it lists them, and refuses the
 * whole list with `-32603` when one breaks a rule.
 */
export interface ResourceEntry {
	/** An absolute URI with a scheme and no whitespace or control character, unique in the server. */
	uri: string;
	/** Non-empty. */
	name: string;
	title?: string;
	description?: string;
	icons?: unknown[];
	annotations?: Record<string, unknown>;
	/** SHOULD be set. A `ui://` entry needs {@link MCP_APP_MIME_TYPE}. */
	mimeType?: string;
	/**
	 * The length in bytes of what a read returns. Filled in from `content` when that is given; when
	 * both are, they must agree.
	 */
	size?: number;
	/**
	 * Extra `_meta` entries under the key rule (T2), where `ui` is not allowed. The server adds
	 * `dev.afd/digest` for an entry with `content`.
	 */
	_meta?: Record<string, unknown>;
	/**
	 * The resource's bytes, when the provider has them up front: the server serves them, lists the
	 * `size` and sets `dev.afd/digest`. A string is stored as UTF-8. Without it, a read calls
	 * {@link ResourceProvider.read}.
	 */
	content?: string | Uint8Array;
}

/** What {@link ResourceProvider.read} returns: the bytes of one resource. */
export interface ResourceContents {
	/** Sent as `text` when valid UTF-8, otherwise as `blob` (standard base64). */
	content: string | Uint8Array;
	/** Used only when the resource has no listed entry (the entry's is used otherwise). */
	mimeType?: string;
	/**
	 * `_meta` of the content item under the key rule, where `ui` is allowed so an MCP Apps view can
	 * carry its `_meta.ui` (`csp`, `permissions`, `domain`, `prefersBorder`).
	 */
	_meta?: Record<string, unknown>;
}

/**
 * What a server is given to serve resources (`spec/mcp-resources.md`, "Terms").
 *
 * `list` is called each time the server lists, so a provider may change its entries while the
 * server runs; the list MUST NOT vary by caller, connection or context, and an AFD provider is
 * given no request input. An entry with `content` is served by the server; any other is read
 * through `read`.
 */
export interface ResourceProvider {
	/** The entries, in the order `resources/list` returns them. */
	list(): readonly ResourceEntry[];
	/**
	 * The content at `uri`, or `undefined` when the provider serves nothing there (`-32602`). A
	 * server MAY serve a URI it does not list, so this is called for every URI that is not a skill
	 * file and not an entry with `content`. A throw is `-32603`, reported to `onError`.
	 */
	read?(uri: string): ResourceContents | undefined | Promise<ResourceContents | undefined>;
}

/** What `createMcpServer` and `createMcpHandler` take as `resources`: a provider, or static entries. */
export type ResourcesOption = ResourceProvider | readonly ResourceEntry[];

const utf8 = new TextEncoder();

function bytesOf(content: string | Uint8Array): Uint8Array {
	return typeof content === 'string' ? utf8.encode(content) : content;
}

/** The scheme of an absolute URI, when `uri` has one that RFC 3986 allows and no whitespace or control character. */
function schemeOf(uri: string): string | undefined {
	const match = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/su.exec(uri);
	if (!match || /[\p{White_Space}\p{Cc}]/u.test(match[2] as string)) return undefined;
	return match[1];
}

/** Check a provider's entries against R2. @throws An error naming the entry. */
export function checkEntries(entries: readonly ResourceEntry[]): void {
	if (!Array.isArray(entries)) throw new Error('resources: list() must return an array of entries');
	const seen = new Set<string>();
	for (const entry of entries) {
		const uri = (entry as { uri?: unknown } | null)?.uri;
		const fail = (rule: string) => new Error(`resource "${String(uri)}": ${rule}`);
		if (typeof uri !== 'string') throw fail('the uri must be a string');
		const scheme = schemeOf(uri);
		if (scheme === undefined) throw fail('the uri must be an absolute URI with a scheme');
		if (seen.has(uri)) throw fail('the uri is used by another entry');
		seen.add(uri);
		if (typeof entry.name !== 'string' || entry.name === '') {
			throw fail('the name must not be empty');
		}
		for (const field of ['title', 'description', 'mimeType'] as const) {
			if (entry[field] !== undefined && typeof entry[field] !== 'string') {
				throw fail(`${field} must be a string`);
			}
		}
		if (entry.size !== undefined && !(Number.isSafeInteger(entry.size) && entry.size >= 0)) {
			throw fail('the size must be a non-negative integer');
		}
		if (scheme.toLowerCase() === 'skill') {
			throw fail('the skill:// scheme belongs to the skill catalog (the skills option)');
		}
		if (scheme.toLowerCase() === 'ui' && entry.mimeType !== MCP_APP_MIME_TYPE) {
			throw fail(`a ui:// entry must have the mimeType ${MCP_APP_MIME_TYPE}`);
		}
		if (entry._meta !== undefined) {
			if (entry._meta === null || typeof entry._meta !== 'object' || Array.isArray(entry._meta)) {
				throw fail('_meta must be an object');
			}
			for (const [key, value] of Object.entries(entry._meta)) {
				const reason = checkMetaEntry(key, value, false);
				if (reason) throw fail(reason);
			}
		}
		if (entry.content !== undefined) {
			if (typeof entry.content !== 'string' && !(entry.content instanceof Uint8Array)) {
				throw fail('content must be a string or a Uint8Array');
			}
			if (entry.size !== undefined && entry.size !== bytesOf(entry.content).length) {
				throw fail("the size must equal the length of the content's bytes");
			}
		}
	}
}

/** One `contents` item: `text` when the bytes are valid UTF-8, otherwise `blob`. */
function contentItem(
	uri: string,
	mimeType: string | undefined,
	bytes: Uint8Array,
	meta?: Record<string, unknown>
): Record<string, unknown> {
	const item: Record<string, unknown> = { uri };
	if (mimeType !== undefined) item.mimeType = mimeType;
	try {
		item.text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
	} catch {
		item.blob = Buffer.from(bytes).toString('base64');
	}
	if (meta && Object.keys(meta).length > 0) item._meta = meta;
	return item;
}

/** The `resources/list` item of an entry: its fields, the size and digest of its bytes, and `_meta`. */
function listItem(entry: ResourceEntry): Record<string, unknown> {
	const bytes = entry.content === undefined ? undefined : bytesOf(entry.content);
	const meta = {
		...entry._meta,
		...(bytes && { [DIGEST_META_KEY]: sha256Digest(bytes) }),
	};
	return {
		uri: entry.uri,
		name: entry.name,
		...(entry.title !== undefined && { title: entry.title }),
		...(entry.description !== undefined && { description: entry.description }),
		...(entry.icons !== undefined && { icons: entry.icons }),
		...(entry.annotations !== undefined && { annotations: entry.annotations }),
		...(entry.mimeType !== undefined && { mimeType: entry.mimeType }),
		...((bytes ?? entry.size) !== undefined && { size: bytes ? bytes.length : entry.size }),
		...(Object.keys(meta).length > 0 && { _meta: meta }),
	};
}

function notFound(uri: string): ProtocolError {
	return new ProtocolError(ProtocolErrorCode.InvalidParams, 'Resource not found', { uri });
}

function refuseCursor(cursor: unknown): void {
	if (cursor === undefined) return;
	throw new ProtocolError(
		ProtocolErrorCode.InvalidParams,
		'This server returns one page and never issues a cursor'
	);
}

/** The cache fields of a modern-era result (R3): the `tools/list` TTL option, `cacheScope: "public"`. */
function hints(modern: boolean, ttlMs: number): Record<string, unknown> {
	return modern ? { ttlMs, cacheScope: 'public' } : {};
}

/** What a server serves beyond tools. */
export interface ResourceService {
	/** The capabilities to declare in `server/discover` and `initialize` (R1, S1). */
	readonly capabilities: Record<string, unknown>;
	/** Install the handlers on one `Server` instance. */
	install(server: Server, options: ResourceServing): void;
}

/** How one `Server` instance serves resources. */
export interface ResourceServing {
	/** Whether the instance serves MCP 2026-07-28 (cache fields on results). */
	modern: boolean;
	/** The error a failure while serving becomes (`-32603`, reported to `onError`). */
	internalError(error: unknown): ProtocolError;
}

/** Look up the provider's entries, checked again each time because a provider may change them. */
function providerOf(option: ResourcesOption | undefined): ResourceProvider | undefined {
	if (option === undefined) return undefined;
	if (Array.isArray(option)) {
		const entries = [...(option as readonly ResourceEntry[])];
		return { list: () => entries };
	}
	return option as ResourceProvider;
}

/**
 * Build the resource service, or `undefined` when the server was given neither a provider nor a
 * catalog.
 *
 * @throws An error naming the entry, when the provider's entries break a rule of R2.
 */
export function createResourceService(
	option: ResourcesOption | undefined,
	skills: SkillCatalog | undefined,
	ttlMs: number
): ResourceService | undefined {
	const provider = providerOf(option);
	if (!provider && !skills) return undefined;
	if (provider && typeof provider.list !== 'function') {
		throw new Error('resources: expected an array of entries or an object with list()');
	}
	if (provider) checkEntries(provider.list());

	const entriesOf = (): readonly ResourceEntry[] => {
		if (!provider) return [];
		const entries = provider.list();
		checkEntries(entries);
		return entries;
	};

	async function readItem(uri: string): Promise<Record<string, unknown>> {
		const file = skills?.file(uri);
		if (file) return contentItem(uri, file.mimeType, file.bytes);
		// The `skill://` scheme is the catalog's alone (R2): a provider is never asked for it.
		if (!provider || schemeOf(uri)?.toLowerCase() === 'skill') throw notFound(uri);
		const entry = entriesOf().find((item) => item.uri === uri);
		if (entry?.content !== undefined) {
			return contentItem(uri, entry.mimeType, bytesOf(entry.content));
		}
		const contents = await provider.read?.(uri);
		if (!contents) throw notFound(uri);
		if (contents._meta !== undefined) {
			for (const [key, value] of Object.entries(contents._meta)) {
				const reason = checkMetaEntry(key, value, true);
				if (reason) throw new Error(`resource "${uri}": ${reason}`);
			}
		}
		const bytes = bytesOf(contents.content);
		if (entry?.size !== undefined && entry.size !== bytes.length) {
			throw new Error(
				`resource "${uri}": the listed size is ${entry.size} but the read returned ${bytes.length} bytes`
			);
		}
		return contentItem(uri, entry?.mimeType ?? contents.mimeType, bytes, contents._meta);
	}

	const uriParams = z.looseObject({ uri: z.string() });
	const listParams = z.looseObject({ cursor: z.string().optional() });

	return {
		capabilities: {
			resources: { subscribe: false, listChanged: false },
			...(skills && {
				extensions: {
					[SKILLS_EXTENSION_ID]: skills.directoryRead ? { directoryRead: true } : {},
				},
			}),
		},
		install(server, { modern, internalError }) {
			const guarded = async <T>(work: () => T | Promise<T>): Promise<T> => {
				try {
					return await work();
				} catch (error) {
					throw error instanceof ProtocolError ? error : internalError(error);
				}
			};
			const complete = <T extends Record<string, unknown>>(
				result: T
			): T & Record<string, unknown> => ({
				...result,
				...hints(modern, ttlMs),
			});

			server.setRequestHandler('resources/list', (request) =>
				guarded(() => {
					refuseCursor(request.params?.cursor);
					return {
						resources: [...entriesOf().map(listItem), ...(skills?.resources() ?? [])],
					} as never;
				})
			);
			server.setRequestHandler('resources/templates/list', (request) =>
				guarded(() => {
					refuseCursor(request.params?.cursor);
					return { resourceTemplates: [] } as never;
				})
			);
			server.setRequestHandler('resources/read', (request) =>
				guarded(async () => ({ contents: [await readItem(request.params.uri)] }) as never)
			);

			if (!skills) return;
			server.setRequestHandler('skills/list', { params: listParams }, (params) =>
				guarded(() => {
					refuseCursor(params.cursor);
					return complete({ skills: skills.entries() });
				})
			);
			server.setRequestHandler('skills/get', { params: uriParams }, (params) =>
				guarded(() => {
					const entry = skills.entry(params.uri);
					if (!entry) throw notFound(params.uri);
					return complete({ skill: entry });
				})
			);
			if (skills.directoryRead) {
				server.setRequestHandler('resources/directory/read', { params: uriParams }, (params) =>
					guarded(() => {
						const children = skills.directory(params.uri);
						if (!children) throw notFound(params.uri);
						return complete({ resources: children });
					})
				);
			}
		},
	};
}

/** The cache hints the SDK applies to the standard resource results of a modern-era server. */
export function resourceCacheHints(ttlMs: number) {
	const hint = { ttlMs, cacheScope: 'public' } as const;
	return {
		'resources/list': hint,
		'resources/templates/list': hint,
		'resources/read': hint,
	} as const;
}
