/**
 * @fileoverview `document-open` and the `editor-*` commands (documents specification, 5.1 to 5.4; D80), in
 * a chunk of their own, `late-editor`, with the editor's state, which `loadLate` imports with `late-documents`
 * before stage B's last `setAppCommands` (scope and projects specification, 2.4). It imports types alone, as
 * `late-documents` does: `late` hands it what it runs with (`DOCUMENT_KIT`), since a module first paint or
 * `late` holds, imported here too, would part their chunks. Each reads and writes `context.scope`'s record, `loam.editor` or
 * `loam.editor@<project>`, not the active scope's, so a replay finds the same one; the scope middleware
 * decides that scope first (scope and projects specification, 3.4). `document-open` names a document, so
 * 4.2's check runs on it, and a document in another scope switches the scope first, by the switch's rules.
 * Through a port, `editor-get` is all an app may call here, and `document-open` only for the active app or
 * the editor owner, in its own scope (11).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { JsonSchema, ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import type { DocumentRecordV1 } from '@lushly-dev/loam-sdk';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { AppsRuntime } from '../apps-runtime.js';
import type { KernelFieldContext } from '../context-fields.js';
import type { OverlayStore } from '../overlays.js';
import type { LateScope } from '../scope/middleware.js';
import type { ScopeV1 } from '../scope/records.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import type { ShellState } from '../shell-state.js';
import type { DocumentKit } from './document-kit.js';
import type { DocumentCheck } from './document-types.js';
import {
	activateTab,
	activeTab,
	closeDocument,
	closeTab,
	createEditors,
	type EditorChange,
	type EditorStateV1,
	findTab,
	keepTabs,
	moveTab,
	openDocument,
	pinTab,
	promoteTab,
	unknownTab,
} from './editor-state.js';

export interface EditorCommandDeps {
	scope: ScopeRuntime;
	viewState: ViewStateRegistry;
	state: ShellState;
	store: DataAdapter;
	overlays: OverlayStore;
	apps(): AppsRuntime;
	lateScope: LateScope;
	check: DocumentCheck;
	isMutation(name: string): boolean;
}

/** What the rest of `late` asks of the editor area. */
export interface EditorParts {
	commands: ZodCommandDefinition[];
	/**
	 * The editor owner (5.4): the owning plugin of the active tab, while main shows the editor area in the
	 * active scope; null otherwise. The overlay rules treat it as an active app.
	 */
	owner(): Promise<string | null>;
	/**
	 * After a call that may have moved main, the active tab or the scope: an editor owner that changed gives
	 * up its overlays, as an app switch does (5.4, phase 1's section 8).
	 */
	settle(name: string, call: CommandContext): Promise<void>;
	/**
	 * `EDITOR_TAB_DIRTY` while a tab of `record` holds an unsaved change, in any scope's record, so a trash
	 * or a move waits for its save (Status deviation 16); undefined otherwise.
	 */
	unsaved(record: DocumentRecordV1): CommandResult<never> | undefined;
	/** Close every tab of a trashed or moved document in its scope's record, none of them unsaved (4.1). */
	closeDocument(document: string, at: ScopeV1, context: CommandContext): Promise<void>;
	/** `section-get`, with a document's id as the documents section's path: the active tab's (5.1). */
	sectionGet(boot: ZodCommandDefinition): ZodCommandDefinition;
	/** Register and read `project`'s record, or the workspace's: stage B's for the active scope (6). */
	ensure(project: string | undefined): Promise<unknown>;
	/** Forget the dirty tabs and selections, which live in memory, as a reload does (5.2). */
	reset(): void;
}

const isRefusal = (value: unknown): value is CommandResult<never> =>
	typeof value === 'object' && value !== null && 'success' in value;

/** A selection in the binding's shape (3.1), or null, which clears it. */
function selectionFits(selection: unknown, shape: string): boolean {
	if (selection === null) return true;
	const held = selection as Record<string, unknown>;
	if (typeof selection !== 'object' || Array.isArray(selection)) return false;
	if (shape === 'text-range') {
		const { start, end } = held;
		return (
			Object.keys(held).length === 3 &&
			held.kind === 'text-range' &&
			Number.isInteger(start) &&
			Number.isInteger(end) &&
			(start as number) >= 0 &&
			(end as number) >= (start as number)
		);
	}
	return (
		shape === 'item' &&
		Object.keys(held).length === 2 &&
		held.kind === 'item' &&
		typeof held.id === 'string' &&
		held.id.length > 0 &&
		held.id.length <= 256
	);
}

export function createEditorParts(deps: EditorCommandDeps, kit: DocumentKit): EditorParts {
	const { scope, state, store, check } = deps;
	const {
		kernelFailure,
		success,
		sameScope,
		setMain,
		marked,
		actorKey,
		table: DOCUMENT_TABLE,
	} = kit;
	const {
		strictObject,
		string,
		minLength,
		maxLength,
		optional,
		boolean,
		unknown,
		enum: choice,
	} = kit.z;
	const editors = createEditors(deps.viewState);
	/** Every definition here is the `editor` category's, a mutation and instant unless it says otherwise. */
	const defineCommandWithSchema: DocumentKit['define'] = (definition) =>
		kit.define({ category: 'editor', executionTime: 'instant', mutation: true, ...definition });
	const callScope = (context: CommandContext) => (context as KernelFieldContext).scope as ScopeV1;
	const emptyInput = strictObject({});
	const EMPTY_INPUT_JSON: JsonSchema = {
		type: 'object',
		properties: {},
		additionalProperties: false,
	};
	const id = string().check(minLength(1), maxLength(128));
	const ID_JSON: JsonSchema = { type: 'string', minLength: 1, maxLength: 128 };
	const tabInput = strictObject({ tab: id });
	const TAB_JSON: JsonSchema = {
		type: 'object',
		properties: { tab: ID_JSON },
		required: ['tab'],
		additionalProperties: false,
	};
	const openInput = strictObject({
		document: id,
		group: optional(choice(['active', 'beside'])),
		preview: optional(boolean()),
	});
	const closeInput = strictObject({ tab: id, discard: optional(boolean()) });
	const pinInput = strictObject({ tab: id, pinned: boolean() });
	const moveInput = strictObject({ tab: id, group: id });
	const dirtyInput = strictObject({ tab: id, dirty: boolean() });
	const selectionInput = strictObject({ tab: id, selection: unknown() });

	/** A tab-and-flag input's JSON Schema. */
	const tabWith = (property: string, schema: JsonSchema, required: boolean): JsonSchema => ({
		type: 'object',
		properties: { tab: ID_JSON, [property]: schema },
		required: required ? ['tab', property] : ['tab'],
		additionalProperties: false,
	});

	/** An operation's refusal as a kernel failure. */
	const refusal = (change: EditorChange<unknown>): CommandResult<never> =>
		'code' in change
			? kernelFailure(change.code, change.message, change.suggestion)
			: (undefined as never);
	const here = (context: CommandContext) => callScope(context);
	const caller = (context: CommandContext) => (context as KernelFieldContext).caller;

	/** `EDITOR_TAB_DIRTY` for `tab`, its suggestion naming its type's save (5.4). */
	const unsavedTab = (tab: string, type: string | undefined): CommandResult<never> => {
		const save = check
			.types()
			.types.get(type as string)
			?.instanceCommands.find((name) => deps.isMutation(name));
		return kernelFailure(
			'EDITOR_TAB_DIRTY',
			`Tab ${tab} has unsaved changes`,
			`${save ? `Save it with ${save}, or close` : 'Close'} it with editor-close { tab: "${tab}", discard: true }, which saves first; then retry`
		);
	};
	/** The person's own page, the chrome's calls among it: never an agent's or a server's call. */
	const person = (context: CommandContext) =>
		marked(context) && (context as { interface?: string }).interface === 'palette';

	/** By record, the documents already found in its scope, so each is read once. */
	const trusted = new Map<string, Set<string>>();

	/**
	 * `project`'s record, or the workspace's, registered and read before anything writes it. Whatever a read of
	 * the store put there, a persisted record as stage B or a later hydration reads it, a tab whose document is
	 * in another scope or workspace, or in the trash, is dropped, so a record tampered with names nothing
	 * outside its own scope (6). A missing document's tab stays, and its frame says so. The actor may read
	 * every document left, since the call reached this scope by `decideAccess`.
	 */
	async function ensure(project: string | undefined): Promise<void> {
		await editors.ensure(project);
		const key = project ?? '';
		const known = trusted.get(key) ?? new Set<string>();
		trusted.set(key, known);
		const at: ScopeV1 =
			project === undefined
				? { workspace: scope.workspace.id }
				: { workspace: scope.workspace.id, project };
		const unread = new Set(
			(editors.peek(project) as EditorStateV1).groups
				.flatMap((group) => group.tabs.map((tab) => tab.document))
				.filter((document) => !known.has(document))
		);
		const foreign = new Set<string>();
		for (const document of unread) {
			const record = await store.get<DocumentRecordV1>(DOCUMENT_TABLE, document);
			if (!record) continue;
			if (
				record.workspace === at.workspace &&
				sameScope(record.scope, at) &&
				record.status !== 'trashed'
			) {
				known.add(document);
			} else foreign.add(document);
		}
		if (foreign.size === 0) return;
		const kept = keepTabs(
			editors.peek(project) as EditorStateV1,
			(document) => !foreign.has(document)
		);
		if (kept) editors.put(project, kept);
	}

	/** The call's scope's record, registered and read before anything writes it. */
	async function read(context: CommandContext): Promise<EditorStateV1> {
		const project = here(context).project;
		await ensure(project);
		return editors.peek(project) as EditorStateV1;
	}

	/** Whether main shows the editor area of `at`: the documents section, no app, and `at` active. */
	const showing = (at: ScopeV1): boolean => {
		const main = state.main();
		return main.active === null && main.section === 'documents' && sameScope(at, scope.active());
	};

	/**
	 * Write a change to the call's scope's record, or answer its refusal. The URL follows a change of the
	 * active scope's active tab with `mainChanged` (scope and projects specification, 6.3).
	 */
	function apply<T>(
		context: CommandContext,
		before: EditorStateV1,
		change: EditorChange<T>,
		history: 'push' | 'replace'
	): T | CommandResult<never> {
		if ('code' in change) return refusal(change);
		const at = here(context);
		editors.put(at.project, change.state);
		if (showing(at) && activeTab(before)?.id !== activeTab(change.state)?.id) {
			scope.note(context.traceId, { mainChanged: history });
		}
		return change.value;
	}

	/**
	 * The editor owner: the instance whose type the active tab's document is, only while that document is in
	 * the active scope and its type is registered and opens there, so a disabled, failed or absent instance
	 * owns nothing (5.4, 2.2).
	 */
	async function owner(): Promise<string | null> {
		const active = scope.active();
		const held = showing(active) ? editors.peek(active.project) : undefined;
		const tab = held && activeTab(held);
		const record = tab && (await store.get<DocumentRecordV1>(DOCUMENT_TABLE, tab.document));
		const type = record ? check.types().types.get(record.type) : undefined;
		return record &&
			type &&
			record.workspace === active.workspace &&
			sameScope(record.scope, active) &&
			!check.opens(type, active)
			? type.instance
			: null;
	}

	/** The editor owner after the last call that could move it; undefined until first read. */
	let lastOwner: string | null | undefined;

	/** A tab's record, read by the shell, and only when it is in `at`, the scope whose record holds the tab. */
	async function recordOf(
		before: EditorStateV1,
		tab: string,
		at: ScopeV1
	): Promise<DocumentRecordV1 | undefined> {
		const found = findTab(before, tab);
		const document = found?.group.tabs[found.index]?.document;
		const record =
			document === undefined
				? undefined
				: await store.get<DocumentRecordV1>(DOCUMENT_TABLE, document);
		return record && record.workspace === at.workspace && sameScope(record.scope, at)
			? record
			: undefined;
	}

	const open = defineCommandWithSchema<
		typeof openInput,
		{ tab: string; group: string; scope?: { from: ScopeV1; to: ScopeV1 } }
	>({
		name: 'document-open',
		title: 'Open a document',
		description:
			'Open a document in the editor area, in the active group or beside it; a document in another scope switches to it first',
		category: 'document',
		undoable: true,
		input: openInput,
		jsonSchema: {
			type: 'object',
			properties: {
				document: ID_JSON,
				group: { type: 'string', enum: ['active', 'beside'] },
				preview: { type: 'boolean' },
			},
			required: ['document'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const app = caller(context);
			const from = here(context);
			// An app's call answers the same bytes as a missing id for a document outside its scope, first (4.2).
			const record = await check.find(input.document, 'document-open', context);
			if (isRefusal(record)) return record;
			// An app never switches another's screen: only the active app or the editor owner opens one, and only
			// in the scope main shows, so it never runs scope-set (11).
			if (
				app !== undefined &&
				(!sameScope(from, scope.active()) || (app !== state.activeApp() && app !== (await owner())))
			) {
				return kernelFailure(
					'DOCUMENT_OPEN_NOT_ACTIVE',
					`The app '${app}' is not active, so it cannot open a document`,
					'Open it from the active app, or ask the person to open it'
				);
			}
			const to = record.scope;
			// Only a person's or an agent's call in this page has a screen to move: a server's holds no active
			// scope, so it writes the document's record alone (scope and projects specification, 3.3).
			const screen = marked(context);
			if (screen) {
				// From the active scope, as the switch computes it, whatever scope the call named (4.3).
				if (!sameScope(scope.active(), to)) {
					const refused = deps.lateScope.applyScopeChange(to, 'document-open', context);
					if (refused) return refused;
				}
				// As `section-open`: the active app closes, and main shows the documents section (5.1).
				const closed = deps.apps().close();
				if (!closed.success) return closed as CommandResult<never>;
				setMain(deps.viewState, { active: null, section: 'documents', path: '' });
			}
			const moved = scope.seen.get(context.traceId as string)?.scopeChanged;
			await ensure(to.project);
			const before = editors.peek(to.project) as EditorStateV1;
			// A server's call into the active scope adds its tab, activating nothing the person sees (3.3).
			const change = openDocument(
				before,
				record.id,
				{ ...input, background: !screen && sameScope(to, scope.active()) },
				(tab) => editors.dirty(to.project, tab)
			);
			if ('code' in change) return refusal(change);
			editors.put(to.project, change.state);
			// A server's tab activated in an empty area main shows moves the URL with it (6.3).
			if (screen || (showing(to) && activeTab(before)?.id !== activeTab(change.state)?.id)) {
				scope.note(context.traceId, { mainChanged: screen ? 'push' : 'replace' });
			}
			const { tab, group, existed, previous } = change.value;
			// Opening a tab already open activated it: its undo activates what was active, and closes nothing
			// the person had (5.4, as amended by step 10's deviation 15).
			const undo = !existed
				? { undoCommand: 'editor-close', undoArgs: { tab } }
				: previous !== null && previous !== activeTab(change.state)?.id
					? { undoCommand: 'editor-activate', undoArgs: { tab: previous } }
					: {};
			return success(
				{
					tab,
					group,
					...(moved?.reason === 'document-open'
						? { scope: { from: moved.from, to: moved.to } }
						: {}),
				},
				undo
			);
		},
	});

	const get = defineCommandWithSchema<typeof emptyInput, EditorStateV1>({
		name: 'editor-get',
		description: "Get the editor area of the call's scope: its groups and tabs, each with dirty",
		mutation: false,
		input: emptyInput,
		jsonSchema: EMPTY_INPUT_JSON,
		async handler(_input, context) {
			const held = await read(context);
			const project = here(context).project;
			return success({
				...held,
				groups: held.groups.map((group) => ({
					...group,
					tabs: group.tabs.map((tab) => ({ ...tab, dirty: editors.dirty(project, tab.id) })),
				})),
			});
		},
	});

	const activate = defineCommandWithSchema<
		typeof tabInput,
		{ tab: string; previous: string | null }
	>({
		name: 'editor-activate',
		title: 'Activate a tab',
		description: 'Make a tab, and its group, the active one',
		undoable: true,
		input: tabInput,
		jsonSchema: TAB_JSON,
		async handler(input, context) {
			const before = await read(context);
			const done = apply(context, before, activateTab(before, input.tab), 'replace');
			if (isRefusal(done)) return done;
			return success(
				done,
				done.previous === null || done.previous === done.tab
					? {}
					: { undoCommand: 'editor-activate', undoArgs: { tab: done.previous } }
			);
		},
	});

	const close = defineCommandWithSchema<
		typeof closeInput,
		{ closed: string; previous: { document: string; group: string; pinned: boolean } }
	>({
		name: 'editor-close',
		title: 'Close a tab',
		description:
			'Close a tab; one with unsaved changes needs discard: true, or its save from its type first',
		undoable: true,
		input: closeInput,
		jsonSchema: tabWith('discard', { type: 'boolean' }, false),
		async handler(input, context) {
			const before = await read(context);
			const project = here(context).project;
			if (editors.dirty(project, input.tab) && input.discard !== true) {
				return unsavedTab(input.tab, (await recordOf(before, input.tab, here(context)))?.type);
			}
			const done = apply(context, before, closeTab(before, input.tab), 'replace');
			if (isRefusal(done)) return done;
			// The person's close has saved or discarded; another's keeps the mark until the chrome's save of the
			// open editor clears it, so a trash or a move waits for that save (Status deviation 16).
			if (person(context)) editors.setDirty(project, input.tab, false);
			editors.setSelection(project, input.tab, null);
			const { document, group, pinned, preview } = done.previous;
			return success(
				{ closed: done.closed, previous: { document, group, pinned } },
				{ undoCommand: 'document-open', undoArgs: { document, preview } }
			);
		},
	});

	const pin = defineCommandWithSchema<typeof pinInput, { tab: string; pinned: boolean }>({
		name: 'editor-pin',
		title: 'Pin a tab',
		description: 'Pin a tab, so nothing replaces it and Close others keeps it, or unpin it',
		undoable: true,
		input: pinInput,
		jsonSchema: tabWith('pinned', { type: 'boolean' }, true),
		async handler(input, context) {
			const before = await read(context);
			const was = findTab(before, input.tab);
			const done = apply(context, before, pinTab(before, input.tab, input.pinned), 'push');
			if (isRefusal(done)) return done;
			return success(done, {
				undoCommand: 'editor-pin',
				undoArgs: { tab: input.tab, pinned: was?.group.tabs[was.index]?.pinned === true },
			});
		},
	});

	const move = defineCommandWithSchema<typeof moveInput, { tab: string; group: string }>({
		name: 'editor-move',
		title: 'Move a tab',
		description: "Move a tab to another group, or to a new one with group 'new'",
		undoable: true,
		input: moveInput,
		jsonSchema: {
			type: 'object',
			properties: { tab: ID_JSON, group: ID_JSON },
			required: ['tab', 'group'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const before = await read(context);
			const done = apply(
				context,
				before,
				moveTab(before, input.tab, input.group, (tab) => editors.dirty(here(context).project, tab)),
				'push'
			);
			if (isRefusal(done)) return done;
			const after = editors.peek(here(context).project) as EditorStateV1;
			// Back to the group it left, or a new one when that group went with it.
			const back = after.groups.some((group) => group.id === done.from) ? done.from : 'new';
			return success(
				{ tab: done.tab, group: done.group },
				done.group === done.from
					? {}
					: { undoCommand: 'editor-move', undoArgs: { tab: done.tab, group: back } }
			);
		},
	});

	const dirty = defineCommandWithSchema<typeof dirtyInput, { tab: string; dirty: boolean }>({
		name: 'editor-dirty-set',
		description:
			"The chrome's, from its editor; to close unsaved work, use editor-close with discard: true",
		input: dirtyInput,
		jsonSchema: tabWith('dirty', { type: 'boolean' }, true),
		async handler(input, context) {
			const before = await read(context);
			const project = here(context).project;
			// A tab another's call closed keeps its mark, which the chrome's save clears.
			if (!findTab(before, input.tab) && (input.dirty || !editors.dirty(project, input.tab))) {
				return refusal(unknownTab(input.tab));
			}
			// THE OWNER'S DECISION (Status deviation 16): only the person's page marks an unsaved tab saved, as its
			// editor reports. To let an agent or a server do it too, delete this check; nothing else depends on it.
			if (!input.dirty && editors.dirty(project, input.tab) && !person(context)) {
				return unsavedTab(input.tab, (await recordOf(before, input.tab, here(context)))?.type);
			}
			editors.setDirty(project, input.tab, input.dirty);
			// A first edit promotes a preview tab (5.3).
			if (input.dirty) editors.put(project, promoteTab(before, input.tab));
			return success({ tab: input.tab, dirty: input.dirty });
		},
	});

	const select = defineCommandWithSchema<typeof selectionInput, { tab: string }>({
		name: 'editor-selection-set',
		description: "The chrome's, from its editor: a tab's selection, in its binding's shape",
		mutation: false,
		input: selectionInput,
		jsonSchema: tabWith('selection', {} as JsonSchema, true),
		async handler(input, context) {
			const before = await read(context);
			const record = await recordOf(before, input.tab, here(context));
			if (!record) return refusal(unknownTab(input.tab));
			if (!selectionFits(input.selection, record.binding.selection)) {
				return kernelFailure(
					'EDITOR_SELECTION_INVALID',
					`A ${record.type} selection is ${record.binding.selection === 'none' ? 'null' : `a ${record.binding.selection}, or null`}`,
					record.binding.selection === 'text-range'
						? "Report { kind: 'text-range', start, end } in UTF-16 units, start at most end"
						: record.binding.selection === 'item'
							? "Report { kind: 'item', id }"
							: 'Report null'
				);
			}
			editors.setSelection(here(context).project, input.tab, input.selection);
			return success({ tab: input.tab });
		},
	});

	return {
		commands: [
			open,
			get,
			activate,
			close,
			pin,
			move,
			dirty,
			select,
		] as unknown as ZodCommandDefinition[],
		ensure,
		unsaved(record) {
			const tab = editors.unsaved(record.id);
			return tab === undefined ? undefined : unsavedTab(tab, record.type);
		},
		reset: () => editors.reset(),
		owner,
		async settle(name, call) {
			const seen = scope.seen.get(call.traceId as string);
			if (!name.startsWith('editor-') && !seen?.mainChanged && !seen?.scopeChanged) return;
			const now = await owner();
			// The owner it left gives up its overlays, unless it is the active app now, whose they are.
			if (lastOwner && lastOwner !== now && lastOwner !== state.activeApp()) {
				deps.overlays.closeForSwitch(lastOwner);
			}
			lastOwner = now;
		},
		async closeDocument(document, at, context) {
			await ensure(at.project);
			// Trashed or moved, it is no longer this scope's to trust (6).
			trusted.get(at.project ?? '')?.delete(document);
			const before = editors.peek(at.project) as EditorStateV1;
			const after = closeDocument(before, document);
			if (!after) return;
			for (const group of before.groups)
				for (const tab of group.tabs)
					if (tab.document === document) {
						editors.setDirty(at.project, tab.id, false);
						editors.setSelection(at.project, tab.id, null);
					}
			editors.put(at.project, after);
			// Its closed tab moves the URL, as `editor-close` does (6.3).
			if (showing(at) && activeTab(before)?.document === document) {
				scope.note(context.traceId, { mainChanged: 'replace' });
			}
		},
		sectionGet(boot) {
			return {
				...boot,
				async handler(input, context) {
					const result = await boot.handler(input, context);
					const data = result.data as { section: string | null; active: string | null };
					if (data?.section !== 'documents' || data.active !== null) return result;
					// The documents section's path is the active tab's document, or none with no tab (5.1); only for a
					// call in this page whose actor may enter the active scope, so a server's caller learns no id.
					const active = scope.active();
					if (!marked(context) || !scope.allows(actorKey(context), active)) {
						return success({ ...data, path: '' });
					}
					await ensure(active.project);
					const tab = activeTab(editors.peek(active.project) as EditorStateV1);
					return success({ ...data, path: tab?.document ?? '' });
				},
			} as ZodCommandDefinition;
		},
	};
}
