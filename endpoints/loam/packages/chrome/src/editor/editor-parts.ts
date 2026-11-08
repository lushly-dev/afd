/**
 * @fileoverview What the `editor` chunk's controller (`editor.ts`) is built from, apart from itself
 * (documents specification, 5 and 6): `editor-get`'s shape, the chunk's constants and styles, its elements'
 * definition, and the types of a frame's life (5.6). It lives in the same chunk.
 */

import { css, type FASTElement } from '@lushly-dev/fast-element';
import type { DocumentRecordV1 } from '@lushly-dev/loam-sdk';
import type { LoamShell } from '../elements/shell.js';
import { editorAreaDefinition, LoamEditorArea } from './editor-area.js';
import { editorFrameDefinition, LoamEditorFrame } from './editor-frame.js';
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
 * again, whether its leave's save or reopen is under way, and whether the person discarded it meanwhile.
 */
export interface Life {
	visit: number;
	place: Place;
	edits: number;
	queued?: How;
	busy?: boolean;
	/** The person discarded its draft while it was leaving: a rejected save then brings nothing back. */
	discarded?: boolean;
}

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
