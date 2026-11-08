/**
 * @fileoverview The document type registry and the check on every document command (documents
 * specification, 2.2, 4.2 and 4.4; D79), in the `late` chunk. The `document-*` commands' definitions are
 * `documents.ts`, a chunk of its own. The registry is built from each admitted app's manifest whenever it
 * is read, so a disabled or failed instance's types leave it at once, and their records stay.
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { ManifestV2 } from '@lushly-dev/loam-manifest';
import type { DocumentRecordV1, DocumentTypeV1 } from '@lushly-dev/loam-sdk';
import type { BatchOperation, DataAdapter } from '@lushly-dev/local-db';
import type { AppsRuntime } from '../apps-runtime.js';
import type { KernelFieldContext } from '../context-fields.js';
import { kernelFailure } from '../errors.js';
import { actorKey } from '../scope/access.js';
import type { ScopeV1 } from '../scope/records.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import { archivedRefusal, canOpen, mismatchRefusal } from './main-state.js';
import { checkStamped } from './stores.js';

/** The record table (documents specification, 3). */
export const DOCUMENT_TABLE = 'document';

/**
 * The store key of a document's content, `doc/<id>` (3): the SDK's `documentContentKey`, which `late`
 * does not import, since the SDK's index would join the chunk it shares with `apps` (2.4). A unit test
 * holds the two equal.
 */
export const documentContentKey = (document: string): string => `doc/${document}`;

/** An instance command's input, as JSON, is at most this many bytes (4.4). */
export const DOCUMENT_INPUT_MAX_BYTES = 256 * 1024;

type ManifestType = NonNullable<NonNullable<ManifestV2['ui']>['documents']>[number];

/** A registered type: what `document-type-list` shows, and what only the kernel reads. */
export interface RegisteredTypeV1 extends DocumentTypeV1 {
	/** Each template's content, which only `document-create` reads (2.2). */
	readonly declared: ManifestType;
}

/** The registry (2.2): the types by id, and each conflict's notice by the instance that lost it. */
export interface DocumentTypesV1 {
	readonly types: ReadonlyMap<string, RegisteredTypeV1>;
	readonly conflicts: ReadonlyMap<string, Array<{ code: string; message: string }>>;
}

/** An app the registry may read: not failed, refused or disabled, and not mounted, which has no types. */
export interface TypedApp {
	instance: string;
	app: string;
	kind: 'native' | 'view' | 'mounted';
	manifest?: ManifestV2;
}

/**
 * Build the registry from the apps in deployment order (2.2). Two plugins with one type id: the later one
 * keeps its other contributions, and that type is reported in its notices, `DOCUMENT_TYPE_CONFLICT`.
 */
export function buildDocumentTypes(apps: readonly TypedApp[]): DocumentTypesV1 {
	const types = new Map<string, RegisteredTypeV1>();
	const conflicts = new Map<string, Array<{ code: string; message: string }>>();
	for (const { instance, app, kind, manifest } of apps) {
		if (kind === 'mounted') continue;
		for (const declared of manifest?.ui?.documents ?? []) {
			const held = types.get(declared.id);
			if (held) {
				conflicts.set(instance, [
					...(conflicts.get(instance) ?? []),
					{
						code: 'DOCUMENT_TYPE_CONFLICT',
						message: `The document type '${declared.id}' is already registered by '${held.instance}', so this app's is not. Rename the type.`,
					},
				]);
				continue;
			}
			types.set(declared.id, {
				id: declared.id,
				title: declared.title,
				icon: declared.icon,
				instance,
				app,
				scopeLevels: [...(declared.scope_levels ?? manifest?.app?.scope_levels ?? ['workspace'])],
				contentVersion: declared.content_version,
				templates: declared.templates.map(({ id, title }) => ({ id, title })),
				surfaces: (['editor', 'embed', 'inspector'] as const).filter((part) => declared[part]),
				binding: { ...declared.binding } as DocumentTypeV1['binding'],
				instanceCommands: [...declared.instance_commands],
				editorKind: kind,
				declared,
			});
		}
	}
	return { types, conflicts };
}

export const sameScope = (a: ScopeV1, b: ScopeV1): boolean =>
	a.workspace === b.workspace && a.project === b.project;

/** `DOCUMENT_NOT_FOUND`: one message for "does not exist" and "you may not", in the same bytes (4.2). */
export const documentNotFound = (): CommandResult<never> =>
	kernelFailure(
		'DOCUMENT_NOT_FOUND',
		'No document with that id is available to you',
		'List the documents you can open with document-list'
	);

/**
 * The commands that may name a document in another scope than the call's (4.2): reads where the actor may
 * read, and those that state a target. Every other one is `SCOPE_MISMATCH`.
 */
const ACROSS: ReadonlySet<string> = new Set([
	'document-get',
	'document-open',
	'document-list',
	'document-link-add',
	'document-link-remove',
	'document-link-list',
	'document-trash',
	'document-restore',
	'document-move',
]);

export interface DocumentCheckDeps {
	scope: ScopeRuntime;
	store: DataAdapter;
	apps(): AppsRuntime;
	isMutation(name: string): boolean;
}

export interface DocumentCheck {
	/** The registry, as the apps stand now. */
	types(): DocumentTypesV1;
	/**
	 * 4.2's check for a command naming `document`: the record, or the refusal. `type` is an instance
	 * command's own type, which the record's must be.
	 */
	find(
		document: unknown,
		name: string,
		context: CommandContext,
		type?: string
	): Promise<DocumentRecordV1 | CommandResult<never>>;
	/** Line 5 of a call for a type's instance command, with 4.4's bound first; undefined lets it run. */
	instance(
		name: string,
		input: unknown,
		call: CommandContext
	): Promise<CommandResult<never> | undefined>;
	/**
	 * After an instance command: when it is a mutation and succeeded, the record the check found gets its
	 * `updatedAt`, and the event its `document`. The record is the one checked, held by the call, never read
	 * again from an input the handler could have changed.
	 */
	after(name: string, call: CommandContext, succeeded: boolean): Promise<void>;
	/**
	 * A record written with its workspace, actor and time, or refused (architecture section 7), in one batch
	 * with `with`, what must land with it or not at all: a new document's content, a moved one's row.
	 */
	put(record: DocumentRecordV1, with_?: BatchOperation[]): Promise<void>;
	/** Why `type`'s instance cannot open at `at` (`canOpen`): disabled, gone, or not listing its project. */
	opens(type: RegisteredTypeV1, at: ScopeV1): CommandResult<never> | undefined;
	/**
	 * Run `run` after every earlier change to `document`'s record has finished, so each reads the record the
	 * last one wrote: rename, update, move, trash, restore and an instance command's stamp. Nothing run under
	 * it waits on another change to the same record, so it cannot wait on itself.
	 */
	serial<T>(document: string, run: () => Promise<T>): Promise<T>;
	/**
	 * The document a type's instance mutation names, whose chain its check, its handler's write and its stamp
	 * run in together, so a move or a trash never lands between them; undefined for anything else, an instance
	 * query among them, which runs unchained.
	 */
	chained(name: string, input: unknown): string | undefined;
}

/** Leave the call without its input in the journal, and answered from its record in a replay (4.4). */
export function markOversized(scope: ScopeRuntime, call: CommandContext): void {
	if (typeof call.traceId === 'string') {
		scope.oversized ??= new Set();
		scope.oversized.add(call.traceId);
	}
	(call as CommandContext & KernelFieldContext).replay = 'recorded';
}

/** An instance's manifest, or undefined for one with no port: refused, or not deployed. */
function manifestOf(apps: AppsRuntime, instance: string): ManifestV2 | undefined {
	try {
		return apps.port(instance).manifest;
	} catch {
		return undefined;
	}
}

/** The time of the call's clock, so a replay reproduces it. */
export const callNow = (context: CommandContext): number => context.clock?.now() ?? Date.now();

export function createDocumentCheck(deps: DocumentCheckDeps): DocumentCheck {
	const { scope, store } = deps;
	/** The record each instance command's call was checked against, by the call itself (4.2). */
	const checked = new WeakMap<CommandContext, string>();
	/** By document, the last change to its record, which the next one waits for. */
	const chains = new Map<string, Promise<unknown>>();
	const serial = <T>(document: string, run: () => Promise<T>): Promise<T> => {
		const next = (chains.get(document) ?? Promise.resolve()).then(run, run);
		const tail = next.then(
			() => undefined,
			() => undefined
		);
		chains.set(document, tail);
		void tail.then(() => chains.get(document) === tail && chains.delete(document));
		return next;
	};

	function types(): DocumentTypesV1 {
		const apps = deps.apps();
		const typed: TypedApp[] = [];
		for (const summary of apps.summaries()) {
			// A refused, failed or disabled instance's types are not registered; its records stay (2.2). A refused
			// one has no port (`APP_NOT_READY`), so `manifestOf` leaves it out; a disabled one is the override.
			if (
				summary.state === 'failed' ||
				scope.workspaceApps.get(summary.instance)?.overrides.enabled === false
			)
				continue;
			const manifest = manifestOf(apps, summary.instance);
			if (manifest) {
				typed.push({ instance: summary.instance, app: summary.app, kind: summary.kind, manifest });
			}
		}
		return buildDocumentTypes(typed);
	}

	/** The type whose `instance_commands` hold `name`, of the app that owns it, or undefined. */
	function typeOfCommand(name: string): { type: string; instance: string } | undefined {
		const apps = deps.apps();
		const instance = apps.owners.get(name)?.instance;
		if (instance === undefined) return undefined;
		const declared = manifestOf(apps, instance)?.ui?.documents?.find((type) =>
			type.instance_commands.includes(name)
		);
		return declared ? { type: declared.id, instance } : undefined;
	}

	async function find(
		document: unknown,
		name: string,
		context: CommandContext,
		type?: string
	): Promise<DocumentRecordV1 | CommandResult<never>> {
		const call = context as CommandContext & KernelFieldContext;
		const here = call.scope as ScopeV1;
		const record =
			typeof document === 'string' && document !== ''
				? await store.get<DocumentRecordV1>(DOCUMENT_TABLE, document)
				: undefined;
		// An app's call, a document outside its scope: the same bytes as a missing one, first, so it learns
		// nothing, not its project, not that it exists, not its type. Then missing, and refused, alike.
		if (
			!record ||
			record.workspace !== here.workspace ||
			(call.caller !== undefined && !sameScope(record.scope, here)) ||
			!scope.allows(actorKey(call), record.scope)
		) {
			return documentNotFound();
		}
		const project =
			record.scope.project === undefined ? undefined : scope.projects.get(record.scope.project);
		if (!sameScope(record.scope, here) && !ACROSS.has(name)) {
			return mismatchRefusal(
				record.title,
				project,
				here.project === undefined ? undefined : scope.projects.get(here.project)
			);
		}
		if (deps.isMutation(name)) {
			if (record.status === 'trashed' && name !== 'document-restore' && name !== 'document-trash') {
				return kernelFailure(
					'DOCUMENT_TRASHED',
					`\`${record.title}\` is in the trash, so it cannot change`,
					`Restore it with document-restore { document: "${record.id}" }`
				);
			}
			// Opening one changes the editor, not the document: an archived project's documents may be read.
			if (project?.status === 'archived' && name !== 'document-open') {
				return archivedRefusal(project);
			}
		}
		if (type !== undefined && record.type !== type) {
			return kernelFailure(
				'DOCUMENT_TYPE_MISMATCH',
				`\`${record.id}\` is a document of the type '${record.type}', not '${type}'`,
				"Read its type with document-get, and call that type's own commands"
			);
		}
		return record;
	}

	async function put(record: DocumentRecordV1, with_: BatchOperation[] = []): Promise<void> {
		checkStamped(DOCUMENT_TABLE, record);
		const { summary } = await store.batch([
			...with_,
			{ method: 'PUT', path: `/${DOCUMENT_TABLE}/${encodeURIComponent(record.id)}`, body: record },
		]);
		if (summary.failed > 0) throw new Error(`The store could not write '${record.id}'`);
	}

	return {
		serial,
		chained(name, input) {
			const document = (input as { document?: unknown } | null)?.document;
			return typeOfCommand(name) && deps.isMutation(name) && typeof document === 'string'
				? document
				: undefined;
		},
		types,
		find,
		put,
		opens: (type, at) => canOpen(deps.apps(), scope, type.instance, at.project),
		async instance(name, input, call) {
			const owned = typeOfCommand(name);
			if (!owned) return undefined;
			// Measured before anything is read, and refused before the handler, so a refused save never runs;
			// the journal keeps the entry without its input (4.4).
			if (new TextEncoder().encode(JSON.stringify(input) ?? '').length > DOCUMENT_INPUT_MAX_BYTES) {
				// The kernel's own marks: `apps.redact` journals the call without its input, by trace ID, and
				// `replay: 'recorded'`, a field only trusted code sets, has a replay answer the entry from its
				// record, since it cannot re-run what the journal does not hold. Nothing ran.
				markOversized(scope, call);
				return kernelFailure(
					'DOCUMENT_CONTENT_TOO_LARGE',
					`The input of '${name}' is over 256 KiB of JSON`,
					`Report this to the owner of the app '${owned.instance}': its documents outgrow what one command carries`
				);
			}
			const found = await find(
				(input as { document?: unknown } | null)?.document,
				name,
				call,
				owned.type
			);
			if ('success' in found) return found;
			checked.set(call, found.id);
			return undefined;
		},
		async after(name, call, succeeded) {
			const id = checked.get(call);
			checked.delete(call);
			if (id === undefined || !succeeded || !deps.isMutation(name)) return;
			// In the document's chain already, with the check and the write (`chained`).
			const record = await store.get<DocumentRecordV1>(DOCUMENT_TABLE, id);
			if (!record) return;
			// So `document-list`'s recents are right however the content changes (3).
			await put({ ...record, updatedAt: callNow(call), updatedBy: actorKey(call) });
			scope.note(call.traceId, { document: record.id });
		},
	};
}
