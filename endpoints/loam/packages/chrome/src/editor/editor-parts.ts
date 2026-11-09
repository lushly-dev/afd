/**
 * @fileoverview What the `editor` chunk's controller (`editor.ts`) is built from, apart from itself
 * (documents specification, 5 and 6): `editor-get`'s shape, the chunk's constants and styles, its elements'
 * definition, and the types of a frame's life (5.6). It lives in the same chunk.
 */

import { css, type FASTElement } from '@lushly-dev/fast-element';
import type { LoamKernelV2 } from '@lushly-dev/loam-kernel';
import type { DocumentRecordV1, DocumentRefV1, DocumentTypeV1 } from '@lushly-dev/loam-sdk';
import type { LoamShell } from '../elements/shell.js';
import { editorAreaDefinition, LoamEditorArea } from './editor-area.js';
import { editorFrameDefinition, LoamEditorFrame, type SurfaceHostV1 } from './editor-frame.js';
import { editorGroupDefinition, LoamEditorGroup } from './editor-group.js';

/** `editor-get`'s answer (5.4): the call's scope's state, with `dirty` per tab. */
export interface EditorReadV1 {
	version: 1;
	groups: Array<{
		id: string;
		active: string | null;
		tabs: Array<{
			id: string;
			document: string;
			pinned: boolean;
			preview: boolean;
			dirty: boolean;
		}>;
	}>;
	activeGroup: string;
}

/** How many native editors a group keeps parked, its oldest dropped through `dispose` (5.6). */
export const PARKED_PER_GROUP = 10;

/** The phase 1 modal's `MODAL_RESULT_EVENT`, named here so this chunk imports no element of `surfaces`. */
export const MODAL_RESULT_EVENT = 'loam-modal-result';

/** How long the area waits for the app surfaces, which load beside stage B, before a frame fails. */
export const SURFACES_WAIT_MS = 15_000;

/** Added to `loam-main` from this chunk, so the empty shell's styles do not grow. */
export const mainWithEditor = css`
	:host([data-section='documents']) {
		display: flex;
		flex-direction: column;
		padding: 0;
		overflow: hidden;
	}
	:host([data-section]) .landing {
		display: none;
	}
	:host([data-section][route='not-found']) .landing {
		display: grid;
	}
	:host([route='not-found']) ::slotted(loam-editor-area) {
		display: none;
	}
`;

let defined: Promise<unknown> | undefined;
/** Define the chunk's elements once; FAST's `define` settles later, so it is awaited before any is made. */
export function define(): Promise<unknown> {
	defined ??= Promise.all(
		[
			[LoamEditorArea, editorAreaDefinition],
			[LoamEditorGroup, editorGroupDefinition],
			[LoamEditorFrame, editorFrameDefinition],
		].map(([type, definition]) =>
			customElements.get((definition as { name: string }).name)
				? undefined
				: (type as typeof FASTElement).define(definition as never)
		)
	);
	return defined;
}

/** A document's scope, as a call's option takes it. */
export type ScopeOf = DocumentRecordV1['scope'];

/**
 * Where a frame is (5.6): held by its tab, in `#frames`; parked while its save runs, in `#parking`; leaving,
 * in neither, while a closed, left or reopened frame saves; or gone, once disposed.
 */
export type Place = 'shown' | 'parked' | 'leaving' | 'disposed';
/** Why a frame leaves: another's call closed its tab, it parked as an eleventh editor, or its scope went. */
export type How = 'closed' | 'parked' | 'left';
/**
 * One frame's life: the visit of a scope it was made in, its one place, its editor's edits, a leave asked
 * again, whether its leave's save or reopen is under way, and whether that leave still holds a draft.
 */
export interface Life {
	visit: number;
	place: Place;
	edits: number;
	queued?: How;
	busy?: boolean;
	/** Its leave holds a draft: unsaved as the leave began, and not yet saved, kept or lost. */
	draft?: boolean;
	/** Its edits when the person chose Discard in the modal: discarded while no edit has followed. */
	discard?: number;
	/** The tab its reopen opened for it, which a Discard of its draft closes. */
	opened?: string;
	/** A view's editor whose teardown's save rejected: its edits then, so it is not torn down again unedited (5.6). */
	kept?: number;
	/** A view's editor saving before a move, where the browser has no `moveBefore`, held where it is meanwhile. */
	moving?: boolean;
}

/**
 * `frame` in `group`, moved only when it is elsewhere: a view's by `moveBefore` where the browser has it,
 * which keeps its frame's document; anything else re-inserted, as a view's is in a browser without it (5.6).
 */
export function place(frame: LoamEditorFrame, group: HTMLElement): void {
	if (frame.parentElement === group) return;
	const move = (group as HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void })
		.moveBefore;
	if (frame.kind === 'view' && move && frame.isConnected) move.call(group, frame, null);
	else group.append(frame);
}

/** A scope as a key, and whether two are the same. */
export const keyOf = (scope?: ScopeOf): string => `${scope?.workspace} ${scope?.project ?? ''}`;
export const same = (one?: ScopeOf, other?: ScopeOf): boolean => keyOf(one) === keyOf(other);

/** A tab's record, or why `document-get` gave none. */
export type RecordRead = DocumentRecordV1 | { code: string; message: string; suggestion?: string };

/** Main, or the panel when a maximized panel has made main inert, as the `sections` chunk does. */
export function focusMain(shell: LoamShell, main: HTMLElement): void {
	const target = main.inert ? shell.shadowRoot?.querySelector<HTMLElement>('loam-panel') : main;
	if (!target) return;
	target.setAttribute('tabindex', '-1');
	target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
	target.focus();
}

/** The chunk's elements, defined, for a fixture that renders them on their own. */
export const defineEditorElements = (): Promise<unknown> => define();

/** Whether a key event is Mod+S: Command on macOS, Control elsewhere, by physical key. */
export const isSave = (event: KeyboardEvent, mac: boolean): boolean =>
	(mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
	!event.altKey &&
	!event.shiftKey &&
	event.code === 'KeyS';

/** The phase 1 modal's input: `Close without saving?`, Discard as `danger`, or Keep editing (5.5). */
export const discardModal = (title: string) => ({
	title: 'Close without saving?',
	body: `Your changes to ${title.slice(0, 200)} are not saved. Closing loses them.`,
	confirmLabel: 'Discard',
	cancelLabel: 'Keep editing',
	danger: true,
});

/** A rejected save's `danger` toast, with its code and suggestion (5.5). */
export function notSaved(title: string, cause: unknown) {
	const { code, suggestion } = (cause ?? {}) as { code?: string; suggestion?: string };
	const message = cause instanceof Error ? cause.message : String(cause);
	return {
		message:
			`${title} was not saved: ${message}${code ? ` (${code})` : ''}${suggestion ? `. ${suggestion}` : ''}`.slice(
				0,
				200
			),
		tone: 'danger',
		durationMs: 30_000,
	};
}

/** Open a tab's frame on its record: the type's native or view editor, or a notice saying why there is none. */
export async function openFrame(
	frame: LoamEditorFrame,
	record: RecordRead | undefined,
	types: Map<string, DocumentTypeV1>,
	kernel: LoamKernelV2,
	hostOf: () => Promise<SurfaceHostV1 | undefined>,
	theme: () => 'light' | 'dark'
): Promise<void> {
	if (!record || !('title' in record)) {
		frame.title = 'This document';
		frame.fail(
			record ?? {
				code: 'DOCUMENT_NOT_FOUND',
				message: 'No document with that id is available to you',
			}
		);
		return;
	}
	frame.record = record;
	frame.title = record.title;
	const type = types.get(record.type);
	if (!type) {
		frame.fail({
			code: 'DOCUMENT_TYPE_UNAVAILABLE',
			message: `No app this workspace runs provides the document type '${record.type}'`,
			suggestion:
				'List the apps with app-list, or redeploy the app that provides it; the document is kept.',
		});
		return;
	}
	if (record.contentVersion > type.contentVersion) {
		frame.fail({
			code: 'DOCUMENT_CONTENT_VERSION_NEWER',
			message: `This document was written by a newer version of '${type.app}', so it is not opened here`,
			suggestion: 'Update the app; nothing is overwritten.',
		});
		return;
	}
	const port = kernel.appPort(type.instance);
	const declared = port.manifest.ui?.documents?.find((each) => each.id === type.id);
	const { element, resource } = (declared?.editor ?? {}) as { element?: string; resource?: string };
	frame.autosaveMs = declared?.autosave_ms;
	const reference: DocumentRefV1 = {
		id: record.id,
		type: record.type,
		title: record.title,
		scope: record.scope,
		contentVersion: record.contentVersion,
		binding: record.binding,
		readOnly: false,
	};
	const unloaded = {
		code: 'APP_RUNTIME_UNAVAILABLE',
		message: 'The app surfaces did not load',
		suggestion: 'Reload; check that the deployment serves its assets.',
	};
	// A view's editor: a sandboxed frame of its resource, through the view chunk (5.6).
	if (type.editorKind === 'view' && resource !== undefined) {
		try {
			const { documentView } = await import('../view/view.js');
			frame.openView(
				await documentView(port, reference, resource, {
					hostVersion: String(kernel.version),
					theme,
				})
			);
		} catch (cause) {
			reportError(cause);
			frame.fail(unloaded);
		}
		return;
	}
	const host = element === undefined ? undefined : await hostOf();
	if (!host) {
		frame.fail(unloaded);
		return;
	}
	await frame.open(host, type.instance, element as string, reference);
}

/** The app surfaces' way in, once they have loaded beside stage B. */
export async function hostOf(shell: LoamShell): Promise<SurfaceHostV1 | undefined> {
	const until = Date.now() + SURFACES_WAIT_MS;
	while (!shell.apps && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 50));
	return (shell.apps as { host?(): SurfaceHostV1 } | null)?.host?.();
}

/** Each modal of `modals` the kernel's list no longer holds, closed with no answer, answered `cancel`; a failed read answers none. */
export async function lostModals(
	kernel: LoamKernelV2,
	modals: Map<string, (result: 'confirm' | 'cancel') => void>
): Promise<void> {
	const open = (await kernel.call<{ overlays: Array<{ overlayId: string }> }>('overlay-list')).data
		?.overlays;
	// A read that failed proves nothing: every modal stays waiting for its answer.
	if (!open) return;
	for (const [id, answer] of modals) {
		if (open.some((each) => each.overlayId === id)) continue;
		modals.delete(id);
		answer('cancel');
	}
}

/** The registry's types, for each tab's editor: what the frame mounts, and its `autosave_ms`. */
export async function readTypes(kernel: LoamKernelV2): Promise<Map<string, DocumentTypeV1>> {
	const result = await kernel.call<{ types: DocumentTypeV1[] }>('document-type-list', {
		all: true,
	});
	return new Map((result.data?.types ?? []).map((type) => [type.id, type]));
}

/** A tab's record, read once while `records` holds it, or why `document-get` gave none. */
export async function readRecord(
	kernel: LoamKernelV2,
	records: Map<string, RecordRead>,
	document: string
): Promise<RecordRead> {
	let held = records.get(document);
	if (!held) {
		const result = await kernel.call<DocumentRecordV1>('document-get', { document });
		held =
			result.success && result.data
				? result.data
				: {
						code: result.error?.code ?? 'DOCUMENT_NOT_FOUND',
						message: result.error?.message ?? 'This document is not available',
						suggestion: result.error?.suggestion,
					};
		records.set(document, held);
	}
	return held;
}

/** The phase 1 modal: `Close without saving?`, Discard as `danger`, or Keep editing (5.5); its answer by `modals`. */
export async function confirmDiscard(
	kernel: LoamKernelV2,
	modals: Map<string, (result: 'confirm' | 'cancel') => void>,
	title: string
): Promise<boolean> {
	const opened = await kernel.call<{ overlayId: string }>('modal-open', discardModal(title));
	const overlayId = opened.data?.overlayId;
	if (!opened.success || overlayId === undefined) return false;
	const result = await new Promise<'confirm' | 'cancel'>((resolve) =>
		modals.set(overlayId, resolve)
	);
	return result === 'confirm';
}

/**
 * A group leaving the area goes, unless it holds a view editor with unsaved work, which its frame's removal
 * would end: it stays, hidden, in `holding` until that editor's leave or move settles (5.6).
 */
export function holdGroup(group: HTMLElement, holding: Set<HTMLElement>): void {
	const unsaved = [...group.children].some(
		(each) => (each as LoamEditorFrame).kind === 'view' && (each as LoamEditorFrame).dirty
	);
	if (!unsaved) {
		group.remove();
		return;
	}
	group.hidden = true;
	group.dataset.held = '';
	holding.add(group);
}

/** Each held group whose frames have all gone. */
export function releaseGroups(holding: Set<HTMLElement>): void {
	for (const group of holding) {
		if (group.querySelector('loam-editor-frame')) continue;
		group.remove();
		holding.delete(group);
	}
}

/** Whether `frame` must save before it leaves `from` for `to`: a view editor with unsaved work, which moving would reload where the browser has no `moveBefore` (5.6). */
export const savesToMove = (frame: LoamEditorFrame, from: HTMLElement, to: HTMLElement): boolean =>
	frame.kind === 'view' && frame.dirty && from !== to && !('moveBefore' in Element.prototype);
