/**
 * @fileoverview The `document-*` commands (documents specification, section 4; D79), in a chunk of their
 * own, `late-documents`, which `loadLate` imports before stage B's last `setAppCommands` (scope and projects
 * specification, 2.4). `document-open` is the editor area's, in `late-editor` with `editor-*` (step 10), and
 * `document-link-*` step 12's. Each command that names
 * a document runs 4.2's check first, and each `project` it names `decideAccess`, answering
 * `PROJECT_NOT_FOUND` for missing and refused alike. The shell never reads a document's content: it writes
 * a template's, and moves the row whole (3).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { JsonSchema, ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { DocumentRecordV1 } from '@lushly-dev/loam-sdk';
import type { BatchOperation, DataAdapter } from '@lushly-dev/local-db';
import type { AppStoreRecord } from '../apps/store.js';
import type { KernelCallFields, KernelFieldContext } from '../context-fields.js';
import type { ScopeV1 } from '../scope/records.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import type { CallOptionsV1 } from '../types.js';
import type { DocumentKit } from './document-kit.js';
import type { DocumentCheck, RegisteredTypeV1 } from './document-types.js';

export interface DocumentCommandDeps {
	scope: ScopeRuntime;
	store: DataAdapter;
	check: DocumentCheck;
	/**
	 * The editor area's, so a trashed or moved document's tabs close (4.1, 5.7), and neither runs while one of
	 * them holds an unsaved change (Status deviation 16).
	 */
	editor?: {
		closeDocument(
			document: string,
			at: ScopeV1,
			context: CommandContext
		): Promise<CommandResult<never> | undefined>;
	};
	/** The kernel's `run`, for `document-export`'s nested query (11.1). */
	run<T>(
		iface: 'palette' | 'agent',
		name: string,
		input: unknown,
		options: CallOptionsV1,
		fields: KernelCallFields
	): Promise<CommandResult<T>>;
}

/** The export envelope (4.1). */
export interface DocumentEnvelopeV1 {
	loam_document: 1;
	type: string;
	content_version: number;
	title: string;
	tags: string[];
	content: unknown;
}

const DAY_MS = 86_400_000;

/** A mutation with an undo. */
const UNDOABLE = { mutation: true, undoable: true } as const;

/** The workspace's records trashed before `before`, which expiry deletes (4.1). */
const trashedBefore = (records: DocumentRecordV1[], workspace: string, before: number) =>
	records.filter(
		(record) =>
			record.workspace === workspace &&
			record.status === 'trashed' &&
			record.trashedAt !== null &&
			record.trashedAt < before
	);

export function createDocumentCommands(
	deps: DocumentCommandDeps,
	kit: DocumentKit
): ZodCommandDefinition[] {
	const { scope, store, check } = deps;
	const {
		z,
		define: defineWithSchema,
		success,
		kernelFailure,
		actorKey,
		projectNotFound,
		archivedRefusal,
		documentContentKey,
		scopeKeyOf,
		storeRecordId,
		callNow,
		sameScope,
		table: DOCUMENT_TABLE,
		maxBytes: DOCUMENT_INPUT_MAX_BYTES,
		markOversized,
	} = kit;
	// Destructured, so the minifier names each once: a property access keeps its name.
	const {
		array,
		boolean,
		enum: choice,
		int,
		maximum,
		maxLength,
		minimum,
		minLength,
		nullable,
		number,
		optional,
		strictObject,
		string,
		unknown,
	} = z;
	/** Every definition here is the `document` category's, a query and instant unless it says otherwise. */
	const defineCommandWithSchema: typeof defineWithSchema = (definition) =>
		defineWithSchema({
			category: 'document',
			executionTime: 'instant',
			mutation: false,
			...definition,
		});
	/** A closed object's JSON Schema, as Zod Mini's `strictObject` writes it. */
	const object = (properties: Record<string, JsonSchema>, required?: string[]): JsonSchema =>
		({
			type: 'object',
			properties,
			...(required ? { required } : {}),
			additionalProperties: false,
		}) as JsonSchema;
	const id = string().check(minLength(1), maxLength(128));
	const ID_JSON: JsonSchema = { type: 'string', minLength: 1, maxLength: 128 };
	const STRING: JsonSchema = { type: 'string' };
	const documentInput = strictObject({ document: id });
	const DOCUMENT_JSON: JsonSchema = object({ document: ID_JSON }, ['document']);
	const project = optional(nullable(id));
	const PROJECT_JSON = { anyOf: [ID_JSON, { type: 'null' }] } as JsonSchema;
	const typeListInput = strictObject({ all: optional(boolean()) });
	const createInput = strictObject({
		type: id,
		template: optional(id),
		title: optional(string()),
		project,
	});
	const listInput = strictObject({
		type: optional(id),
		status: optional(choice(['active', 'archived', 'trashed'])),
		project,
		tag: optional(string()),
		query: optional(string().check(minLength(1), maxLength(200))),
		sort: optional(choice(['recent', 'title'])),
		limit: optional(number().check(int(), minimum(1), maximum(200))),
		offset: optional(number().check(int(), minimum(0))),
	});
	const renameInput = strictObject({ document: id, title: string() });
	const updateInput = strictObject({
		document: id,
		tags: optional(array(string())),
		status: optional(choice(['active', 'archived'])),
	});
	const moveInput = strictObject({ document: id, project: nullable(id) });
	const importInput = strictObject({
		type: id,
		envelope: unknown(),
		title: optional(string()),
		project,
	});
	const expireInput = strictObject({ before: number() });

	/** `doc_` and twelve base-36 characters from the command's random, so a replay reproduces it (3). */
	const documentId = (context: CommandContext): string =>
		`doc_${`${(context.random?.next() ?? Math.random()).toString(36).slice(2)}000000000000`.slice(0, 12)}`;

	const invalid = (message: string, suggestion: string): CommandResult<never> =>
		kernelFailure('VALIDATION_ERROR', message, suggestion);

	/** A title is 1 to 200 characters, and not only spaces (3). */
	const titleRefusal = (title: string): CommandResult<never> | undefined =>
		title.trim() === '' || title.length > 200
			? invalid(
					'A document title is 1 to 200 characters',
					'Give the document a shorter, nonempty title'
				)
			: undefined;

	/** At most 20 tags, each 1 to 40 characters (3). */
	const tagsRefusal = (tags: readonly string[]): CommandResult<never> | undefined =>
		tags.length > 20 || tags.some((tag) => tag.length < 1 || tag.length > 40)
			? invalid('A document has at most 20 tags, each 1 to 40 characters', 'Shorten or drop tags')
			: undefined;

	const isRefusal = (found: unknown): found is CommandResult<never> =>
		typeof found === 'object' && found !== null && 'success' in found;

	const workspace = scope.workspace.id;
	const callOf = (context: CommandContext) => context as CommandContext & KernelFieldContext;

	/** The scope a named `project` means: the call's when absent, the workspace for `null`, or a refusal. */
	function target(
		named: string | null | undefined,
		context: CommandContext
	): ScopeV1 | CommandResult<never> {
		const here = callOf(context).scope as ScopeV1;
		// The call's own scope, which the middleware already decided; decided here too, as a named one is.
		if (named === undefined)
			return scope.allows(actorKey(context), here) ? here : projectNotFound();
		if (named === null) return { workspace };
		const found = scope.project(named);
		const at = { workspace, project: found?.id as string };
		return found && scope.allows(actorKey(context), at) ? at : projectNotFound();
	}

	/** An archived project's documents change no more (4.2); a refusal, or undefined. */
	function archived(at: ScopeV1): CommandResult<never> | undefined {
		const held = at.project === undefined ? undefined : scope.projects.get(at.project);
		return held?.status === 'archived' ? archivedRefusal(held) : undefined;
	}

	/** The registered type `id`, or `DOCUMENT_TYPE_UNAVAILABLE`: its plugin is refused, failed, disabled or gone. */
	function typeOf(type: string): RegisteredTypeV1 | CommandResult<never> {
		return (
			check.types().types.get(type) ??
			kernelFailure(
				'DOCUMENT_TYPE_UNAVAILABLE',
				`No app this workspace runs provides the document type '${type}'`,
				'List the apps with app-list, or redeploy the app that provides it; the documents stay'
			)
		);
	}

	/** A type at the level of `at`, or `DOCUMENT_SCOPE_UNSUPPORTED`, naming the levels it supports. */
	function levelRefusal(type: RegisteredTypeV1, at: ScopeV1): CommandResult<never> | undefined {
		const level = at.project === undefined ? 'workspace' : 'project';
		return type.scopeLevels.includes(level)
			? undefined
			: kernelFailure(
					'DOCUMENT_SCOPE_UNSUPPORTED',
					`A ${type.title} cannot be ${level === 'project' ? 'in a project' : 'at workspace level'}`,
					`It supports ${type.scopeLevels.join(' and ')} level`
				);
	}

	/** A document's content row in its type's `store`, at the document's scope (3). */
	const contentPath = (instance: string, at: ScopeV1, document: string) =>
		`/app-${instance}/${encodeURIComponent(storeRecordId(at, documentContentKey(document)))}`;

	async function batch(operations: BatchOperation[], what: string): Promise<void> {
		const { summary } = await store.batch(operations);
		if (summary.failed > 0) throw new Error(`The store could not ${what}`);
	}

	const recordPath = (document: string) => `/${DOCUMENT_TABLE}/${encodeURIComponent(document)}`;

	/** A new record, with no content (3). */
	function recordOf(
		type: RegisteredTypeV1,
		at: ScopeV1,
		title: string,
		tags: string[],
		context: CommandContext
	): DocumentRecordV1 {
		const when = callNow(context);
		const actor = actorKey(context);
		return {
			id: documentId(context),
			workspace,
			type: type.id,
			instance: type.instance,
			title,
			scope: at,
			scopeKey: scopeKeyOf(at),
			owner: actor,
			tags,
			status: 'active',
			trashedAt: null,
			trashedFrom: null,
			contentVersion: type.contentVersion,
			binding: { ...type.binding },
			epoch: 0,
			createdAt: when,
			updatedAt: when,
			createdBy: actor,
			updatedBy: actor,
		};
	}

	/** Write a changed record, stamped by the call, with `undo` of the same command restoring it. */
	async function change(
		record: DocumentRecordV1,
		changes: Partial<DocumentRecordV1>,
		context: CommandContext,
		undo: { command: string; args: Record<string, unknown> }
	): Promise<CommandResult<DocumentRecordV1>> {
		const next = {
			...record,
			...changes,
			updatedAt: callNow(context),
			updatedBy: actorKey(context),
		};
		await check.put(next);
		return success(next, { undoCommand: undo.command, undoArgs: undo.args });
	}

	/** The common opening of a shell mutation naming a document: 4.2's check. */
	const found = (document: string, name: string, context: CommandContext) =>
		check.find(document, name, context);

	const typeList = defineCommandWithSchema<typeof typeListInput, { types: unknown[] }>({
		name: 'document-type-list',
		description: 'List the document types the active scope allows, or every type with all',
		input: typeListInput,
		jsonSchema: object({ all: { type: 'boolean' } }),
		async handler(input, context) {
			const here = callOf(context).scope as ScopeV1;
			const level = here.project === undefined ? 'workspace' : 'project';
			// The types the scope allows: of its level, and of an instance that can open here (`canOpen`).
			return success({
				types: [...check.types().types.values()]
					.filter(
						(type) =>
							input.all === true || (type.scopeLevels.includes(level) && !check.opens(type, here))
					)
					.map(({ declared: _declared, ...shown }) => shown),
			});
		},
	});

	const create = defineCommandWithSchema<typeof createInput, DocumentRecordV1>({
		name: 'document-create',
		title: 'Create a document',
		description:
			"Create a document of a type from one of its templates, in the call's scope or a named project",
		...UNDOABLE,
		input: createInput,
		jsonSchema: object({ type: ID_JSON, template: ID_JSON, title: STRING, project: PROJECT_JSON }, [
			'type',
		]),
		async handler(input, context) {
			const at = target(input.project, context);
			if (isRefusal(at)) return at;
			const type = typeOf(input.type);
			if (isRefusal(type)) return type;
			const refused = archived(at) ?? levelRefusal(type, at) ?? check.opens(type, at);
			if (refused) return refused;
			const template =
				input.template === undefined
					? type.declared.templates[0]
					: type.declared.templates.find((candidate) => candidate.id === input.template);
			if (!template) {
				return kernelFailure(
					'DOCUMENT_TEMPLATE_UNKNOWN',
					`The type '${type.id}' has no template '${input.template}'`,
					'List its templates with document-type-list'
				);
			}
			const title = input.title ?? template.title;
			const bad = titleRefusal(title);
			if (bad) return bad;
			const record = recordOf(type, at, title, [], context);
			const key = documentContentKey(record.id);
			const content: AppStoreRecord = {
				id: storeRecordId(at, key),
				key,
				value: template.content,
				app: type.app,
				instance: type.instance,
				workspace,
				actor: context.actor ?? null,
				updatedAt: record.createdAt,
				scope: at,
				scopeKey: record.scopeKey,
			};
			// The record and its template's content in one batch, so neither lands alone (4.1).
			await check.put(record, [
				{ method: 'PUT', path: contentPath(type.instance, at, record.id), body: content },
			]);
			return success(record, {
				undoCommand: 'document-trash',
				undoArgs: { document: record.id },
			});
		},
	});

	const get = defineCommandWithSchema<typeof documentInput, DocumentRecordV1>({
		name: 'document-get',
		description: "Get one document's record: its title, type, scope and status, never its content",
		input: documentInput,
		jsonSchema: DOCUMENT_JSON,
		async handler(input, context) {
			const record = await check.find(input.document, 'document-get', context);
			return isRefusal(record) ? record : success(record);
		},
	});

	const list = defineCommandWithSchema<
		typeof listInput,
		{ documents: DocumentRecordV1[]; total: number }
	>({
		name: 'document-list',
		description: "List documents in the call's scope, a named project or every one you may enter",
		input: listInput,
		jsonSchema: object({
			type: ID_JSON,
			status: { type: 'string', enum: ['active', 'archived', 'trashed'] },
			project: PROJECT_JSON,
			tag: STRING,
			query: { type: 'string', minLength: 1, maxLength: 200 },
			sort: { type: 'string', enum: ['recent', 'title'] },
			limit: { type: 'integer', minimum: 1, maximum: 200 },
			offset: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
		}),
		async handler(input, context) {
			const call = callOf(context);
			const here = call.scope as ScopeV1;
			const named = input.project;
			const all = named === 'all';
			// An app never chooses a project (3.2): through its port only the call's own level, and anything
			// else, another project or `all`, is refused before any project is looked up, so the answer is the
			// same whether that project exists, is restricted or is missing, and names no document (4.2).
			if (
				call.caller !== undefined &&
				named !== undefined &&
				(named === 'all' ||
					(named === null
						? here.project !== undefined
						: named !== here.project &&
							(here.project === undefined || named !== scope.projects.get(here.project)?.slug)))
			) {
				return kernelFailure(
					'SCOPE_NOT_GRANTED',
					'An app lists documents only in the scope it runs in',
					"Call document-list with no project: scope is the shell's"
				);
			}
			const at = all ? here : target(named, context);
			if (isRefusal(at)) return at;
			const actor = actorKey(context);
			const status = input.status ?? 'active';
			const query = input.query?.toLowerCase();
			const rows = (await store.list<DocumentRecordV1>(DOCUMENT_TABLE)).data.filter(
				(record) =>
					record.workspace === workspace &&
					(all ? scope.allows(actor, record.scope) : sameScope(record.scope, at)) &&
					record.status === status &&
					(input.type === undefined || record.type === input.type) &&
					(input.tag === undefined || record.tags.includes(input.tag)) &&
					(query === undefined || record.title.toLowerCase().includes(query))
			);
			rows.sort((a, b) =>
				input.sort === 'title'
					? a.title.toLowerCase().localeCompare(b.title.toLowerCase()) || (a.id < b.id ? -1 : 1)
					: b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1)
			);
			const offset = input.offset ?? 0;
			return success({
				documents: rows.slice(offset, offset + (input.limit ?? 50)),
				total: rows.length,
			});
		},
	});

	const rename = defineCommandWithSchema<typeof renameInput, DocumentRecordV1>({
		name: 'document-rename',
		title: 'Rename a document',
		description: "Change a document's title",
		...UNDOABLE,
		input: renameInput,
		jsonSchema: object({ document: ID_JSON, title: STRING }, ['document', 'title']),
		async handler(input, context) {
			const record = await found(input.document, 'document-rename', context);
			if (isRefusal(record)) return record;
			const bad = titleRefusal(input.title);
			if (bad) return bad;
			return change(record, { title: input.title }, context, {
				command: 'document-rename',
				args: { document: record.id, title: record.title },
			});
		},
	});

	const update = defineCommandWithSchema<typeof updateInput, DocumentRecordV1>({
		name: 'document-update',
		title: 'Update a document',
		description: "Change a document's tags, or archive or unarchive it",
		...UNDOABLE,
		input: updateInput,
		jsonSchema: object(
			{
				document: ID_JSON,
				tags: { type: 'array', items: STRING },
				status: { type: 'string', enum: ['active', 'archived'] },
			},
			['document']
		),
		async handler(input, context) {
			const record = await found(input.document, 'document-update', context);
			if (isRefusal(record)) return record;
			const bad = input.tags === undefined ? undefined : tagsRefusal(input.tags);
			if (bad) return bad;
			const { document: _document, ...changes } = input;
			const args: Record<string, unknown> = { document: record.id };
			if (changes.tags !== undefined) args.tags = record.tags;
			if (changes.status !== undefined) args.status = record.status;
			return change(record, changes, context, { command: 'document-update', args });
		},
	});

	const move = defineCommandWithSchema<typeof moveInput, DocumentRecordV1>({
		name: 'document-move',
		title: 'Move a document',
		description: 'Move a document to another project, or to the workspace with null',
		...UNDOABLE,
		input: moveInput,
		jsonSchema: object({ document: ID_JSON, project: PROJECT_JSON }, ['document', 'project']),
		async handler(input, context) {
			const record = await found(input.document, 'document-move', context);
			if (isRefusal(record)) return record;
			const to = target(input.project, context);
			if (isRefusal(to)) return to;
			const type = typeOf(record.type);
			if (isRefusal(type)) return type;
			const refused = archived(to) ?? levelRefusal(type, to) ?? check.opens(type, to);
			if (refused) return refused;
			const from = record.scope;
			const back = { document: record.id, project: from.project ?? null };
			if (sameScope(from, to)) return success(record);
			// Its tabs in the scope it leaves close, or it is refused while one of them is unsaved, so no draft
			// is lost (4.1, Status deviation 16).
			const unsaved = await deps.editor?.closeDocument(record.id, from, context);
			if (unsaved) return unsaved;
			const next: DocumentRecordV1 = {
				...record,
				scope: to,
				scopeKey: scopeKeyOf(to),
				epoch: record.epoch + 1,
				updatedAt: callNow(context),
				updatedBy: actorKey(context),
			};
			// The content row whole, read only to move it: the shell does not look inside it (3).
			const key = documentContentKey(record.id);
			const table = `app-${record.instance}`;
			const content = await store.get<AppStoreRecord>(table, storeRecordId(from, key));
			await check.put(
				next,
				content
					? [
							{
								method: 'PUT' as const,
								path: contentPath(record.instance, to, record.id),
								body: {
									...content,
									id: storeRecordId(to, key),
									scope: to,
									scopeKey: next.scopeKey,
								},
							},
							{ method: 'DELETE' as const, path: contentPath(record.instance, from, record.id) },
						]
					: []
			);
			return success(next, { undoCommand: 'document-move', undoArgs: back });
		},
	});

	const trash = defineCommandWithSchema<typeof documentInput, DocumentRecordV1>({
		name: 'document-trash',
		title: 'Move a document to the trash',
		description:
			"Move a document to the trash, kept for the workspace's trash days; restore undoes it",
		...UNDOABLE,
		input: documentInput,
		jsonSchema: DOCUMENT_JSON,
		async handler(input, context) {
			const record = await found(input.document, 'document-trash', context);
			if (isRefusal(record)) return record;
			// Already in the trash: nothing changes, so nothing is there to undo.
			if (record.status === 'trashed') return success(record);
			// Its tabs close, as `app-switch` closes a surface, or it is refused while one of them is unsaved, so
			// no draft is lost (4.1, Status deviation 16).
			const unsaved = await deps.editor?.closeDocument(record.id, record.scope, context);
			if (unsaved) return unsaved;
			// The status it had, so a restore brings an archived document back archived.
			return change(
				record,
				{ status: 'trashed', trashedAt: callNow(context), trashedFrom: record.status },
				context,
				{ command: 'document-restore', args: { document: record.id } }
			);
		},
	});

	const restore = defineCommandWithSchema<typeof documentInput, DocumentRecordV1>({
		name: 'document-restore',
		title: 'Restore a document',
		description: 'Restore a document from the trash',
		...UNDOABLE,
		input: documentInput,
		jsonSchema: DOCUMENT_JSON,
		async handler(input, context) {
			const record = await found(input.document, 'document-restore', context);
			if (isRefusal(record)) return record;
			// Not in the trash: nothing changes, so nothing is there to undo.
			if (record.status !== 'trashed') return success(record);
			return change(
				record,
				{ status: record.trashedFrom ?? 'active', trashedAt: null, trashedFrom: null },
				context,
				{ command: 'document-trash', args: { document: record.id } }
			);
		},
	});

	const exportCommand = defineCommandWithSchema<typeof documentInput, DocumentEnvelopeV1>({
		name: 'document-export',
		description: "Export a document as an envelope, through its type's export command",
		executionTime: 'fast',
		input: documentInput,
		jsonSchema: DOCUMENT_JSON,
		async handler(input, context) {
			const record = await check.find(input.document, 'document-export', context);
			if (isRefusal(record)) return record;
			const type = typeOf(record.type);
			if (isRefusal(type)) return type;
			const command = type.declared.export_command;
			if (command === undefined) {
				return kernelFailure(
					'DOCUMENT_EXPORT_UNAVAILABLE',
					`The type '${type.id}' declares no export command, and the shell never reads content`,
					`Ask the owner of '${type.instance}' to declare export_command`
				);
			}
			// A nested query at the document's scope, journaled under this call (11.1).
			const exported = await deps.run<{ content?: unknown }>(
				context.interface === 'agent' ? 'agent' : 'palette',
				command,
				{ document: record.id },
				{},
				{ parent: context.traceId ?? '', scope: record.scope }
			);
			if (!exported.success) return exported as CommandResult<never>;
			const data = exported.data as { content?: unknown } | undefined;
			if (data === null || typeof data !== 'object' || !('content' in data)) {
				return kernelFailure(
					'HANDLER_RESULT_INVALID',
					`'${command}' did not return { content }`,
					`Report this to the owner of the app '${type.instance}'`
				);
			}
			return success({
				loam_document: 1,
				type: record.type,
				content_version: record.contentVersion,
				title: record.title,
				tags: record.tags,
				content: data.content,
			});
		},
	});

	const importCommand = defineCommandWithSchema<
		typeof importInput,
		DocumentRecordV1 & { next: { command: string; input: { document: string; content: unknown } } }
	>({
		name: 'document-import',
		title: 'Import a document',
		description:
			"Create a document from an exported envelope; data.next names the type's import command to run",
		...UNDOABLE,
		input: importInput,
		jsonSchema: object(
			{ type: ID_JSON, envelope: {} as JsonSchema, title: STRING, project: PROJECT_JSON },
			['type', 'envelope']
		),
		async handler(input, context) {
			if (
				new TextEncoder().encode(JSON.stringify(input.envelope) ?? '').length >
				DOCUMENT_INPUT_MAX_BYTES
			) {
				// The kernel's own bound, so its own marks (4.4): journaled without the envelope.
				markOversized(scope, context);
				return kernelFailure(
					'DOCUMENT_CONTENT_TOO_LARGE',
					'The envelope is over 256 KiB of JSON',
					'Import a smaller document; a type whose documents grow past that waits for collaboration'
				);
			}
			const envelope = input.envelope as Partial<DocumentEnvelopeV1> | null;
			if (
				envelope === null ||
				typeof envelope !== 'object' ||
				envelope.loam_document !== 1 ||
				typeof envelope.content_version !== 'number' ||
				!('content' in envelope)
			) {
				return invalid(
					'The envelope is not a document export: it needs loam_document 1, content_version and content',
					'Pass what document-export answered'
				);
			}
			const at = target(input.project, context);
			if (isRefusal(at)) return at;
			const type = typeOf(input.type);
			if (isRefusal(type)) return type;
			// The envelope names its type, and it is this one (4.1).
			if (envelope.type !== type.id) {
				return kernelFailure(
					'DOCUMENT_TYPE_MISMATCH',
					`The envelope holds a '${String(envelope.type).slice(0, 64)}', not a '${type.id}'`,
					'Import it as the type it was exported from'
				);
			}
			if (envelope.content_version > type.contentVersion) {
				return kernelFailure(
					'DOCUMENT_IMPORT_VERSION_NEWER',
					`The envelope's content is version ${envelope.content_version}, newer than this app's ${type.contentVersion}`,
					`Update the app '${type.instance}', then import it again`
				);
			}
			const command = type.declared.import_command;
			if (command === undefined) {
				return kernelFailure(
					'DOCUMENT_IMPORT_UNAVAILABLE',
					`The type '${type.id}' declares no import command`,
					`Ask the owner of '${type.instance}' to declare import_command`
				);
			}
			const refused = archived(at) ?? levelRefusal(type, at) ?? check.opens(type, at);
			if (refused) return refused;
			const title =
				input.title ?? (typeof envelope.title === 'string' ? envelope.title : type.title);
			const tags = Array.isArray(envelope.tags)
				? envelope.tags.filter((tag) => typeof tag === 'string')
				: [];
			const bad = titleRefusal(title) ?? tagsRefusal(tags);
			if (bad) return bad;
			// The record alone: a nested mutation is refused (D68), so the type's import command is the next call.
			const record = recordOf(type, at, title, tags, context);
			await check.put(record);
			return success(
				{ ...record, next: { command, input: { document: record.id, content: envelope.content } } },
				{ undoCommand: 'document-trash', undoArgs: { document: record.id } }
			);
		},
	});

	const expire = defineCommandWithSchema<typeof expireInput, { deleted: string[] }>({
		name: 'document-trash-expire',
		description: "Boot's own: delete each document trashed before `before`, with its content",
		mutation: true,
		input: expireInput,
		jsonSchema: object({ before: { type: 'number' } }, ['before']),
		async handler(input) {
			const expired = trashedBefore(
				(await store.list<DocumentRecordV1>(DOCUMENT_TABLE)).data,
				workspace,
				input.before
			);
			// The record and its content, deleted without reading the content (3); step 12 adds its links.
			await batch(
				expired.flatMap((record) => [
					{
						method: 'DELETE' as const,
						path: contentPath(record.instance, record.scope, record.id),
					},
					{ method: 'DELETE' as const, path: recordPath(record.id) },
				]),
				'expire the trash'
			);
			return success({ deleted: expired.map((record) => record.id) });
		},
	});

	return [
		typeList,
		create,
		get,
		list,
		rename,
		update,
		move,
		trash,
		restore,
		exportCommand,
		importCommand,
		expire,
	] as unknown as ZodCommandDefinition[];
}

/**
 * Whether stage B has trash to expire, and its `before` (4.1): a trashed record older than the workspace's
 * `trashDays`. With none, nothing runs, and nothing is journaled.
 */
export async function trashBefore(
	kit: DocumentKit,
	store: DataAdapter,
	workspace: string,
	trashDays: number,
	now: number
): Promise<number | undefined> {
	const before = now - trashDays * DAY_MS;
	const { data } = await store.list<DocumentRecordV1>(kit.table);
	return trashedBefore(data, workspace, before).length > 0 ? before : undefined;
}
