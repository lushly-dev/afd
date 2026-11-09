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

/** Open a tab's frame on its record: the type's native editor, or a notice saying why there is none. */
export async function openFrame(
	frame: LoamEditorFrame,
	record: RecordRead | undefined,
	types: Map<string, DocumentTypeV1>,
	kernel: LoamKernelV2,
	hostOf: () => Promise<SurfaceHostV1 | undefined>
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
	const declared = kernel
		.appPort(type.instance)
		.manifest.ui?.documents?.find((each) => each.id === type.id);
	const element =
		declared?.editor && 'element' in declared.editor ? declared.editor.element : undefined;
	if (type.editorKind !== 'native' || element === undefined) {
		frame.fail({
			code: 'DOCUMENT_TYPE_UNAVAILABLE',
			message: "This document's editor is a view, which this shell does not open yet",
			suggestion: 'Its commands still work from the command palette.',
		});
		return;
	}
	frame.autosaveMs = declared?.autosave_ms;
	const host = await hostOf();
	if (!host) {
		frame.fail({
			code: 'APP_RUNTIME_UNAVAILABLE',
			message: 'The app surfaces did not load',
			suggestion: 'Reload; check that the deployment serves its assets.',
		});
		return;
	}
	const reference: DocumentRefV1 = {
		id: record.id,
		type: record.type,
		title: record.title,
		scope: record.scope,
		contentVersion: record.contentVersion,
		binding: record.binding,
		readOnly: false,
	};
	await frame.open(host, type.instance, element, reference);
}

/** The app surfaces' way in, once they have loaded beside stage B. */
export async function hostOf(shell: LoamShell): Promise<SurfaceHostV1 | undefined> {
	const until = Date.now() + SURFACES_WAIT_MS;
	while (!shell.apps && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 50));
	return (shell.apps as { host?(): SurfaceHostV1 } | null)?.host?.();
}
