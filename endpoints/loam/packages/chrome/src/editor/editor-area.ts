/**
 * @fileoverview `loam-editor-area`: main's region "Documents" when the documents section shows (documents
 * specification, 5.1 and 5.8): its groups as columns of equal width, slotted, inside main's one F6 stop. The
 * page's `h1` is the active document's title, visually hidden, so an editor needs no `h1` of its own. With no
 * tab open it says so: the documents section's list, which takes this place, is step 11's.
 */

import { css, FASTElement, html, observable } from '@lushly-dev/fast-element';

const template = html<LoamEditorArea>`
	<section class="area" aria-label="Documents">
		<h1 id="heading" class="hidden-heading">${(x) => x.heading || 'Documents'}</h1>
		<div class="groups" ?hidden="${(x) => x.empty}"><slot></slot></div>
		<div class="empty" ?hidden="${(x) => !x.empty}">
			<p class="message">No documents are open</p>
			<p class="hint">Open one from the command palette, ${(x) => x.shortcut}.</p>
		</div>
	</section>
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
	.area {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-block-size: 0;
	}
	/* Visually hidden, read by assistive technology: the page's heading is the document's title. */
	.hidden-heading {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		margin: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.groups:not([hidden]) {
		display: grid;
		flex: 1 1 auto;
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
		min-block-size: 0;
	}
	::slotted(loam-editor-group:not(:first-child)) {
		border-inline-start: 1px solid var(--color-border-subtle);
	}
	.empty:not([hidden]) {
		display: grid;
		place-content: center;
		gap: var(--space-stack-sm);
		flex: 1 1 auto;
		padding: var(--space-layout-md);
		text-align: center;
	}
	.message,
	.hint {
		margin: 0;
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
	}
	.message {
		font-weight: var(--weight-semibold);
	}
	.hint {
		color: var(--color-text-secondary);
	}
	@media (forced-colors: active) {
		.hint {
			color: CanvasText;
		}
		::slotted(loam-editor-group:not(:first-child)) {
			border-inline-start-color: CanvasText;
		}
	}
`;

export class LoamEditorArea extends FASTElement {
	/** The active document's title: the page's `h1`. */
	declare heading: string;
	declare empty: boolean;
	declare shortcut: string;

	constructor() {
		super();
		this.heading = '';
		this.empty = true;
		this.shortcut = 'Ctrl+K';
	}
}
observable(LoamEditorArea.prototype, 'heading');
observable(LoamEditorArea.prototype, 'empty');
observable(LoamEditorArea.prototype, 'shortcut');

export const editorAreaDefinition = { name: 'loam-editor-area', template, styles } as const;
