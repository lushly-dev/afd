/**
 * @fileoverview `document-open` and the `editor-*` commands (documents specification, 5.1 to 5.4; D80), in
 * the `late` chunk with the editor's state. Each reads and writes `context.scope`'s record, `loam.editor` or
 * `loam.editor@<project>`, not the active scope's, so a replay finds the same one; the scope middleware
 * decides that scope first (scope and projects specification, 3.4). `document-open` names a document, so
 * 4.2's check runs on it, and a document in another scope switches the scope first, by the switch's rules.
 * Through a port, `editor-get` is all an app may call here, and `document-open` only for the active app or
 * the editor owner, in its own scope (11).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import {
	defineCommandWithSchema,
	type JsonSchema,
	success,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import type { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import type { DocumentRecordV1 } from '@lushly-dev/loam-sdk';
import type { DataAdapter } from '@lushly-dev/local-db';
import * as z from 'zod/mini';
import type { AppsRuntime } from '../apps-runtime.js';
import { callScope, EMPTY_INPUT_JSON, emptyInput } from '../boot-commands.js';
import type { KernelFieldContext } from '../context-fields.js';
import { kernelFailure } from '../errors.js';
import type { OverlayStore } from '../overlays.js';
import type { LateScope } from '../scope/middleware.js';
import type { ScopeV1 } from '../scope/records.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import type { ShellState } from '../shell-state.js';
import { DOCUMENT_TABLE, type DocumentCheck, sameScope } from './document-types.js';
import {
	activateTab,
	activeTab,
	closeDocument,
	closeTab,
	type EditorChange,
	type EditorStateV1,
	type Editors,
	findTab,
	moveTab,
	openDocument,
	pinTab,
	promoteTab,
	unknownTab,
} from './editor-state.js';
import { setMain } from './main-state.js';

export interface EditorCommandDeps {
	scope: ScopeRuntime;
	viewState: ViewStateRegistry;
	state: ShellState;
	store: DataAdapter;
	overlays: OverlayStore;
	apps(): AppsRuntime;
	lateScope: LateScope;
	check: DocumentCheck;
	editors: Editors;
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
	/** Close every tab of a trashed or moved document in its scope's record, with no save (4.1). */
	closeDocument(document: string, at: ScopeV1, context: CommandContext): Promise<void>;
	/** `section-get`, with a document's id as the documents section's path: the active tab's (5.1). */
	sectionGet(boot: ZodCommandDefinition): ZodCommandDefinition;
}

const id = z.string().check(z.minLength(1), z.maxLength(128));
const ID_JSON: JsonSchema = { type: 'string', minLength: 1, maxLength: 128 };
const tabInput = z.strictObject({ tab: id });
const TAB_JSON: JsonSchema = {
	type: 'object',
	properties: { tab: ID_JSON },
	required: ['tab'],
	additionalProperties: false,
};
const openInput = z.strictObject({
	document: id,
	group: z.optional(z.enum(['active', 'beside'])),
	preview: z.optional(z.boolean()),
});
const closeInput = z.strictObject({ tab: id, discard: z.optional(z.boolean()) });
const pinInput = z.strictObject({ tab: id, pinned: z.boolean() });
const moveInput = z.strictObject({ tab: id, group: id });
const dirtyInput = z.strictObject({ tab: id, dirty: z.boolean() });
const selectionInput = z.strictObject({ tab: id, selection: z.unknown() });

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

export function createEditorParts(deps: EditorCommandDeps): EditorParts {
	const { scope, state, store, editors, check } = deps;
	const here = (context: CommandContext) => callScope(context);
	const caller = (context: CommandContext) => (context as KernelFieldContext).caller;

	/** The call's scope's record, registered and read before anything writes it. */
	async function read(context: CommandContext): Promise<EditorStateV1> {
		const project = here(context).project;
		await editors.ensure(project);
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

	async function owner(): Promise<string | null> {
		const active = scope.active();
		const held = showing(active) ? editors.peek(active.project) : undefined;
		const tab = held && activeTab(held);
		if (!tab) return null;
		return (await store.get<DocumentRecordV1>(DOCUMENT_TABLE, tab.document))?.instance ?? null;
	}

	/** The editor owner after the last call that could move it; undefined until first read. */
	let lastOwner: string | null | undefined;

	/** A tab's record, read by the shell: its scope's record holds only its own scope's documents. */
	async function recordOf(
		before: EditorStateV1,
		tab: string
	): Promise<DocumentRecordV1 | null | undefined> {
		const found = findTab(before, tab);
		const document = found?.group.tabs[found.index]?.document;
		return document === undefined
			? undefined
			: await store.get<DocumentRecordV1>(DOCUMENT_TABLE, document);
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
		mutation: true,
		undoable: true,
		executionTime: 'instant',
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
			const switched = !sameScope(from, to);
			if (switched) {
				// The switch's rules (4.3 of the first specification): a left app lands, a shell modal refuses it.
				const refused = deps.lateScope.applyScopeChange(to, 'document-open', context);
				if (refused) return refused;
			}
			// As `section-open`: the active app closes, and main shows the documents section (5.1).
			const closed = deps.apps().close();
			if (!closed.success) return closed as CommandResult<never>;
			setMain(deps.viewState, { active: null, section: 'documents', path: '' });
			await editors.ensure(to.project);
			const before = editors.peek(to.project) as EditorStateV1;
			const change = openDocument(before, record.id, input, (tab) =>
				editors.dirty(to.project, tab)
			);
			if ('code' in change) return refusal(change);
			editors.put(to.project, change.state);
			scope.note(context.traceId, { mainChanged: 'push' });
			return success(
				{ ...change.value, ...(switched ? { scope: { from, to } } : {}) },
				{ undoCommand: 'editor-close', undoArgs: { tab: change.value.tab } }
			);
		},
	});

	const get = defineCommandWithSchema<typeof emptyInput, EditorStateV1>({
		name: 'editor-get',
		description: "Get the editor area of the call's scope: its groups and tabs, each with dirty",
		category: 'editor',
		mutation: false,
		executionTime: 'instant',
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
		category: 'editor',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
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
		category: 'editor',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: closeInput,
		jsonSchema: tabWith('discard', { type: 'boolean' }, false),
		async handler(input, context) {
			const before = await read(context);
			const project = here(context).project;
			if (editors.dirty(project, input.tab) && input.discard !== true) {
				const record = await recordOf(before, input.tab);
				const save = check
					.types()
					.types.get(record?.type as string)
					?.instanceCommands.find((name) => deps.isMutation(name));
				return kernelFailure(
					'EDITOR_TAB_DIRTY',
					'This tab has unsaved changes',
					`${save ? `Save it with ${save}, or close` : 'Close'} it with editor-close { tab: "${input.tab}", discard: true }, which loses them`
				);
			}
			const done = apply(context, before, closeTab(before, input.tab), 'replace');
			if (isRefusal(done)) return done;
			editors.setDirty(project, input.tab, false);
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
		category: 'editor',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
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
		category: 'editor',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: moveInput,
		jsonSchema: {
			type: 'object',
			properties: { tab: ID_JSON, group: ID_JSON },
			required: ['tab', 'group'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const before = await read(context);
			const done = apply(context, before, moveTab(before, input.tab, input.group), 'push');
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
			"The chrome's, from an editor's dirty event: mark a tab as holding unsaved changes or not",
		category: 'editor',
		mutation: true,
		executionTime: 'instant',
		input: dirtyInput,
		jsonSchema: tabWith('dirty', { type: 'boolean' }, true),
		async handler(input, context) {
			const before = await read(context);
			const project = here(context).project;
			if (!findTab(before, input.tab)) return refusal(unknownTab(input.tab));
			editors.setDirty(project, input.tab, input.dirty);
			// A first edit promotes a preview tab (5.3).
			if (input.dirty) editors.put(project, promoteTab(before, input.tab));
			return success({ tab: input.tab, dirty: input.dirty });
		},
	});

	const select = defineCommandWithSchema<typeof selectionInput, { tab: string }>({
		name: 'editor-selection-set',
		description:
			"The chrome's, from an editor's selection event: hold the selection, in the binding's shape, for the inspector",
		category: 'editor',
		mutation: false,
		executionTime: 'instant',
		input: selectionInput,
		jsonSchema: tabWith('selection', {} as JsonSchema, true),
		async handler(input, context) {
			const before = await read(context);
			const record = await recordOf(before, input.tab);
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
			await editors.ensure(at.project);
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
					// The documents section's path is the active tab's document, or none with no tab (5.1).
					const project = scope.active().project;
					await editors.ensure(project);
					const tab = activeTab(editors.peek(project) as EditorStateV1);
					return success({ ...data, path: tab?.document ?? '' });
				},
			} as ZodCommandDefinition;
		},
	};
}
