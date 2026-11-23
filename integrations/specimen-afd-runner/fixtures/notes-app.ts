import type { CommandResult } from '@lushly-dev/afd-core';
import { failure, success } from '@lushly-dev/afd-core/result';

export interface NoteRecord {
	id: string;
	title: string;
	body: string;
	openEditors: number;
}

export interface NotesAppState {
	workspace: string;
	notes: Map<string, NoteRecord>;
	activeId: string | null;
	status: string;
	notice: string;
	nextId: number;
}

export interface NotesHandlerHooks {
	readDraft?: () => string;
	onRender?: (state: NotesAppState) => void;
	onCancel?: () => void;
}

export const NOTES_COMMANDS = [
	'note-seed',
	'note-create',
	'note-open',
	'note-open-beside',
	'note-noop',
	'note-save-external',
	'note-cancel-mid-run',
	'note-hang',
] as const;

export function createNotesCommandHandler(hooks: NotesHandlerHooks = {}) {
	const state: NotesAppState = {
		workspace: 'default',
		notes: new Map(),
		activeId: null,
		status: 'ready',
		notice: '',
		nextId: 1,
	};

	const render = () => {
		hooks.onRender?.(state);
	};

	const call = async (
		name: string,
		input: Record<string, unknown> = {}
	): Promise<CommandResult<unknown>> => {
		switch (name) {
			case 'note-seed': {
				const workspace = typeof input.workspace === 'string' ? input.workspace : 'seeded';
				state.workspace = workspace;
				state.status = `workspace:${workspace}`;
				render();
				return success({ workspace });
			}

			case 'note-create': {
				const title = typeof input.title === 'string' ? input.title.trim() : '';
				if (!title) {
					return failure({
						code: 'INVALID_TITLE',
						message: 'Note title must be a non-empty string.',
						suggestion: 'Provide a non-empty title when calling note-create.',
					});
				}
				const body = typeof input.body === 'string' ? input.body : '';
				const id = `note-${state.nextId++}`;
				const record: NoteRecord = { id, title, body, openEditors: 0 };
				state.notes.set(id, record);
				state.status = `created:${id}:${title}`;
				render();
				return success({
					id,
					title,
					body,
					workspace: state.workspace,
					createdAt: new Date().toISOString(),
				});
			}

			case 'note-open': {
				const id = typeof input.id === 'string' ? input.id : '';
				const note = state.notes.get(id);
				if (!note) {
					return failure({
						code: 'NOTE_NOT_FOUND',
						message: `Note '${id}' does not exist.`,
						suggestion: 'Create a note with note-create before opening it.',
					});
				}
				note.openEditors = Math.max(note.openEditors, 1);
				state.activeId = note.id;
				state.status = `open:${note.id}:${note.title}`;
				render();
				return success({ id: note.id, title: note.title, openEditors: note.openEditors });
			}

			case 'note-open-beside': {
				const id = typeof input.id === 'string' ? input.id : '';
				const note = state.notes.get(id);
				if (!note) {
					return failure({
						code: 'NOTE_NOT_FOUND',
						message: `Note '${id}' does not exist.`,
						suggestion: 'Create a note with note-create before opening it beside itself.',
					});
				}
				note.openEditors = 2;
				state.activeId = note.id;
				state.status = `two-editors:${note.id}:${note.title} @ ${new Date().toISOString()}`;
				render();
				return success({ id: note.id, title: note.title, openEditors: 2 });
			}

			case 'note-noop': {
				return success({ ok: true, activeId: state.activeId });
			}

			case 'note-save-external': {
				const id = typeof input.id === 'string' ? input.id : '';
				const note = state.notes.get(id);
				if (!note) {
					return failure({
						code: 'NOTE_NOT_FOUND',
						message: `Note '${id}' does not exist.`,
						suggestion: 'Create a note with note-create before saving external changes.',
					});
				}
				note.body = typeof input.body === 'string' ? input.body : note.body;
				const draft = hooks.readDraft?.() ?? '';
				const conflict = draft.length > 0;
				state.notice = conflict ? `Conflict: kept ${draft}` : 'Saved cleanly';
				render();
				return success({
					id: note.id,
					saved: true,
					conflict,
					savedAt: new Date().toISOString(),
				});
			}

			case 'note-cancel-mid-run': {
				hooks.onCancel?.();
				return success({ cancelled: true });
			}

			case 'note-hang': {
				return new Promise<CommandResult<unknown>>(() => {
					// Intentionally never settles; Specimen's timeoutMs deadline cancels the run.
				});
			}

			default:
				return failure({
					code: 'UNKNOWN_COMMAND',
					message: `Unknown notes command '${name}'.`,
					suggestion: `Use one of: ${NOTES_COMMANDS.join(', ')}.`,
				});
		}
	};

	return { state, call, commands: () => [...NOTES_COMMANDS] };
}

export function mountNotesApp(density: 'comfortable' | 'compact' = 'comfortable'): HTMLElement {
	const root = document.createElement('main') as HTMLElement & {
		call?: (name: string, input?: Record<string, unknown>) => Promise<CommandResult<unknown>>;
		commands?: () => string[];
	};
	root.id = 'notes-app';
	root.dataset.density = density;

	const heading = document.createElement('h1');
	heading.id = 'workspace-heading';
	heading.textContent = `Notes (${density})`;

	const statusEl = document.createElement('p');
	statusEl.id = 'status';
	statusEl.textContent = `ready @ ${new Date().toISOString()}`;

	const draftLabel = document.createElement('label');
	draftLabel.htmlFor = 'draft-input';
	draftLabel.textContent = 'Second editor draft';

	const draftInput = document.createElement('input');
	draftInput.id = 'draft-input';
	draftInput.type = 'text';

	const noticeEl = document.createElement('p');
	noticeEl.id = 'notice';
	noticeEl.setAttribute('role', 'status');
	noticeEl.textContent = '';

	const handler = createNotesCommandHandler({
		readDraft: () => draftInput.value,
		onRender: (state) => {
			heading.textContent = `Notes (${density}) - ${state.workspace}`;
			statusEl.textContent = state.status;
			noticeEl.textContent = state.notice;
		},
		onCancel: () => {
			(window as unknown as { __specimen?: { cancel?: () => void } }).__specimen?.cancel?.();
		},
	});

	root.call = handler.call;
	root.commands = handler.commands;
	root.append(heading, statusEl, draftLabel, draftInput, noticeEl);
	return root;
}
