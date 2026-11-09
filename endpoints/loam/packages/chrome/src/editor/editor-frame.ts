/**
 * @fileoverview `loam-editor-frame`: one tab's editor (documents specification, 5.6 and 5.8), a native
 * type's element in a `loam-mount` with the plugin's registry, made through the app surfaces' `host()`, so
 * the plugin activates once even with no rail entry. It shows a loading line, then the editor, or a failure
 * as a `loam-notice` body with Close: `DOCUMENT_NOT_FOUND`, `DOCUMENT_TYPE_UNAVAILABLE`,
 * `DOCUMENT_CONTENT_VERSION_NEWER` or `APP_ACTIVATION_FAILED`. It hears the editor's dirty and selection
 * events, bubbling and composed from the element, and tells the editor area; it calls the element's hooks
 * when the area asks. A hidden frame keeps its element, parked with where it was scrolled to.
 */

import { css, FASTElement, html, observable } from '@lushly-dev/fast-element';
import type {
	DocumentChangeV1,
	DocumentRecordV1,
	DocumentRefV1,
	LoamEditorElementV1,
} from '@lushly-dev/loam-sdk';
import type { LoamMount } from '../elements/mount.js';
import type { LoamNotice } from '../elements/notice.js';
import type { LoamViewFrame } from '../view/view-frame.js';

/** The SDK's event names (5.6), written here so this chunk imports nothing of the SDK at run time. */
export const EDITOR_DIRTY_EVENT = 'loam-editor-dirty';
export const EDITOR_SELECTION_EVENT = 'loam-editor-selection';

/** What the app surfaces give the editor frame (scope and projects specification, 2.2): its way in. */
export interface SurfaceHostV1 {
	/** Run the plugin's `activate` once; rejects with what a failure shows. */
	ensureActivated(instance: string): Promise<void>;
	/**
	 * A mount of one of the plugin's elements, with a surface port fixed to `scope`, and its document; an
	 * embed's port is read-only (9.2).
	 */
	createMount(
		instance: string,
		element: string,
		options: { scope: DocumentRefV1['scope']; document: DocumentRefV1; readOnly?: boolean }
	): LoamMount;
}

/** Why a frame shows no editor: the code, and what the notice says. */
export interface FrameFailure {
	code: string;
	message: string;
	suggestion?: string;
}

/** What the frame reports to the editor area. */
export interface FrameListener {
	dirty(frame: LoamEditorFrame, dirty: boolean): void;
	selection(frame: LoamEditorFrame, selection: unknown): void;
	closeFrame(frame: LoamEditorFrame): void;
}

const template = html<LoamEditorFrame>`
	<p class="loading" role="status" ?hidden="${(x) => x.state !== 'loading'}">
		${(x) => (x.state === 'loading' ? `Opening ${x.title}…` : '')}
	</p>
	<div class="failed" ?hidden="${(x) => x.state !== 'failed'}">
		<slot name="notice"></slot>
		<button class="close" type="button" @click="${(x) => x.listener?.closeFrame(x)}">Close</button>
	</div>
	<slot></slot>
`;

const styles = css`
	:host {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-block-size: 0;
		color: var(--color-text-primary);
	}
	:host([hidden]),
	[hidden] {
		display: none;
	}
	::slotted(loam-mount),
	::slotted(loam-view-frame) {
		flex: 1 1 auto;
		min-block-size: 0;
	}
	.loading {
		margin: 0;
		padding: var(--space-layout-md);
		color: var(--color-text-secondary);
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
	}
	/* Not on [hidden], which the same specificity would otherwise lose to: a working frame shows no Close. */
	.failed:not([hidden]) {
		display: grid;
		justify-items: start;
		gap: var(--space-stack-md);
		padding-block-end: var(--space-layout-md);
		overflow: auto;
	}
	.close {
		min-block-size: var(--size-target-natural);
		margin-inline: var(--space-layout-md);
		padding-inline: var(--space-inline-md);
		border: 1px solid var(--color-action-secondary-border);
		border-radius: var(--radius-md);
		background: var(--color-action-secondary-background);
		color: var(--color-action-secondary-text);
		font: inherit;
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--type-label-sm-weight);
		cursor: pointer;
		transition: background-color var(--duration-fast) var(--easing-standard);
	}
	.close:hover {
		background: var(--color-action-secondary-hover);
	}
	.close:active {
		background: var(--color-action-secondary-pressed);
	}
	.close:focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: var(--size-space-xs);
	}
	@media (prefers-reduced-motion: reduce) {
		.close {
			transition: none;
		}
	}
	@media (forced-colors: active) {
		.loading,
		.close {
			background: ButtonFace;
			color: ButtonText;
			border-color: ButtonText;
		}
		.close:focus-visible {
			outline-color: Highlight;
		}
	}
`;

/** A scroller's offsets, through open shadow roots, so a parked editor comes back where it was (5.6). */
type Offsets = Array<[Element, number, number]>;
function offsets(root: Element, found: Offsets = []): Offsets {
	if (root.scrollTop !== 0 || root.scrollLeft !== 0)
		found.push([root, root.scrollTop, root.scrollLeft]);
	for (const child of root.children) offsets(child, found);
	if (root.shadowRoot) for (const child of root.shadowRoot.children) offsets(child, found);
	return found;
}

export class LoamEditorFrame extends FASTElement {
	declare state: 'loading' | 'ready' | 'failed';
	declare title: string;
	/** The tab this frame renders, and its document. */
	tab = '';
	document = '';
	/** The record, once read: what the editor's `document` reference is made from. */
	record: DocumentRecordV1 | null = null;
	/** The type's `autosave_ms`, or undefined when it saves when told. */
	autosaveMs: number | undefined;
	listener: FrameListener | null = null;
	/** The editor's last dirty report, as the frame tells the editor area on a change only. */
	dirty = false;
	/** A view type's editor is torn down when its tab hides, never parked (5.6). */
	kind: 'native' | 'view' = 'native';
	#mount: LoamMount | LoamViewFrame | null = null;
	#parked: Offsets = [];

	constructor() {
		super();
		this.state = 'loading';
		this.title = '';
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.addEventListener(EDITOR_DIRTY_EVENT, this.#onDirty);
		this.addEventListener(EDITOR_SELECTION_EVENT, this.#onSelection);
	}

	override disconnectedCallback(): void {
		this.removeEventListener(EDITOR_DIRTY_EVENT, this.#onDirty);
		this.removeEventListener(EDITOR_SELECTION_EVENT, this.#onSelection);
		super.disconnectedCallback();
	}

	#onDirty = (event: Event) => {
		event.stopPropagation();
		const dirty = (event as CustomEvent<{ dirty?: unknown }>).detail?.dirty === true;
		this.listener?.dirty(this, dirty);
	};

	#onSelection = (event: Event) => {
		event.stopPropagation();
		this.listener?.selection(this, (event as CustomEvent).detail ?? null);
	};

	/** The editor's element, once mounted, or a view type's frame, which answers the same hooks. */
	get editor(): LoamEditorElementV1 | null {
		const mount = this.#mount;
		return ((this.kind === 'view' ? mount : (mount as LoamMount | null)?.surface) ??
			null) as LoamEditorElementV1 | null;
	}

	/** A renamed document's view hears its new title (5.6). */
	titleChanged(): void {
		(this.#mount as LoamViewFrame | null)?.retitle?.(this.title);
	}

	/** A view type's editor (5.6): its frame, which the view chunk made, fixed to the document's scope. */
	openView(view: LoamViewFrame): void {
		this.kind = 'view';
		this.#mount = view;
		this.append(view);
		this.state = 'ready';
	}

	/** Mount the type's element, fixed to the document's scope; a failure shows its notice. */
	async open(
		host: SurfaceHostV1,
		instance: string,
		element: string,
		reference: DocumentRefV1
	): Promise<void> {
		try {
			await host.ensureActivated(instance);
		} catch (cause) {
			this.fail({
				code: 'APP_ACTIVATION_FAILED',
				message: `The app that edits this document did not start: ${cause instanceof Error ? cause.message : String(cause)}`,
				suggestion: "Read the page's console, then reload; the document is kept.",
			});
			return;
		}
		const mount = host.createMount(instance, element, {
			scope: reference.scope,
			document: reference,
		});
		this.#mount = mount;
		this.append(mount);
		this.state = 'ready';
	}

	/** Show why there is no editor, with Close. */
	fail(failure: FrameFailure): void {
		this.#mount?.remove();
		this.#mount = null;
		for (const child of [...this.children]) child.remove();
		const notice = this.ownerDocument.createElement('loam-notice') as LoamNotice;
		notice.slot = 'notice';
		notice.toggleAttribute('embedded', true);
		notice.heading = this.title || 'This document';
		notice.message = `${failure.message} (${failure.code})`;
		notice.suggestion = failure.suggestion ?? '';
		notice.dataset.code = failure.code;
		this.append(notice);
		this.state = 'failed';
	}

	/** Shown or parked: a parked editor keeps its element, and where it was scrolled to (5.6). */
	show(shown: boolean): void {
		if (shown === !this.hidden) return;
		if (!shown) this.#parked = offsets(this);
		this.hidden = !shown;
		if (shown) {
			requestAnimationFrame(() => {
				for (const [element, top, left] of this.#parked) {
					element.scrollTop = top;
					element.scrollLeft = left;
				}
				this.#parked = [];
			});
		}
	}

	/** The type's `save()`, or nothing for one with none. */
	async save(): Promise<void> {
		await this.editor?.save?.();
	}

	/** Another call changed the document (5.7). */
	changed(change: DocumentChangeV1): void {
		try {
			this.editor?.documentChanged?.(change);
		} catch (cause) {
			reportError(cause);
		}
	}

	/** The editor's element takes focus, as Enter on its tab asks (5.8). */
	focusEditor(): void {
		const editor = this.editor;
		if (editor) editor.focus();
		else this.shadowRoot?.querySelector<HTMLElement>('.close:not([hidden])')?.focus();
	}

	/** Dropped: `dispose` first, with no time limit, and the element goes. */
	async dispose(): Promise<void> {
		const editor = this.editor;
		this.listener = null;
		try {
			await editor?.dispose?.();
		} catch (cause) {
			reportError(cause);
		}
		this.remove();
	}
}
observable(LoamEditorFrame.prototype, 'state');
observable(LoamEditorFrame.prototype, 'title');

export const editorFrameDefinition = { name: 'loam-editor-frame', template, styles } as const;
