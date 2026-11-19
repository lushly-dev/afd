/**
 * @fileoverview The rarer half of phase 4's step 4 chrome, in the lazy `overlays` chunk (section 1, the review's R3):
 * each open dialog as a non-modal `loam-modal`, restacked on every render; a prompt's fields; and `loam-global`, the
 * strips under the title bar, one persistent polite live region whose text changes. Phase 1's modal shell, the slot's
 * renderer, stays in `surfaces`.
 */

import type { GlobalInputV1, OverlayV1 } from '@lushly-dev/loam-sdk';
import { globalDefinition, LoamGlobal } from '../elements/global-strip.js';
import type { LoamModal, QuestionInput, QuestionOptions } from '../elements/modal.js';
import type { LoamShell } from '../elements/shell.js';

export { promptFields } from '../elements/prompt-fields.js';

/** How the renderer shows a question, and who hears a person's answer to it, passed in from `surfaces`. */
export interface QuestionHelpers {
	optionsOf(overlay: OverlayV1): QuestionOptions;
	bindAnswer(question: LoamModal): void;
	focusFallback(shell: LoamShell): void;
}

/** Each open dialog, non-modal; a parked one is not shown, and comes back when the kernel restores it (6.1). */
export function createDialogs(shell: LoamShell, helpers: QuestionHelpers) {
	const shown = new Map<string, LoamModal>();
	return {
		async render(dialogs: OverlayV1[]): Promise<void> {
			for (const [overlayId, question] of [...shown]) {
				if (dialogs.some((each) => each.overlayId === overlayId)) continue;
				shown.delete(overlayId);
				const hadFocus = question.shadowRoot?.activeElement != null;
				if (!question.hide() && hadFocus) helpers.focusFallback(shell);
				question.remove();
			}
			for (const overlay of dialogs) {
				if (shown.has(overlay.overlayId)) continue;
				const question = shell.ownerDocument.createElement('loam-modal') as LoamModal;
				helpers.bindAnswer(question);
				shown.set(overlay.overlayId, question);
				shell.shadowRoot?.append(question);
				await question.show(
					overlay.overlayId,
					overlay.input as QuestionInput,
					helpers.optionsOf(overlay)
				);
			}
			// Restacked every time, in the kernel's order, so no two sit on one place (the review's 11): up to the fourth.
			let place = 0;
			for (const overlay of dialogs) {
				const question = shown.get(overlay.overlayId);
				if (question) question.dataset.stack = String(Math.min(place++, 3));
			}
		},
		dispose(): void {
			for (const question of shown.values()) {
				question.hide();
				question.remove();
			}
			shown.clear();
		},
	};
}

/** The strips under the title bar (6.1): one live region, created once and kept, whose text changes. */
export function createGlobals(shell: LoamShell) {
	if (!customElements.get(globalDefinition.name)) LoamGlobal.define(globalDefinition);
	const doc = shell.ownerDocument;
	const region = doc.createElement(globalDefinition.name) as LoamGlobal;
	region.setAttribute('role', 'status');
	region.setAttribute('aria-live', 'polite');
	// Never hidden: empty, it takes no room, and it stays in the accessibility tree for its next line.
	shell.shadowRoot?.append(region);
	let key = '';
	// The region is in the page a frame before its first text, so that text is read out (a live region's rule).
	let pending: OverlayV1[] | null = null;
	let ready = false;
	requestAnimationFrame(() => {
		ready = true;
		if (pending) apply(pending);
	});
	function apply(strips: OverlayV1[]): void {
		pending = null;
		const next = JSON.stringify(strips.map(({ input }) => input));
		// Unchanged strips are left alone, so nothing is read out again on every read.
		if (next === key) return;
		key = next;
		region.replaceChildren(
			...strips.map(({ input }) => {
				const { message, tone } = input as GlobalInputV1;
				const line = doc.createElement('p');
				line.dataset.tone = tone ?? 'info';
				line.textContent = message;
				return line;
			})
		);
	}
	return {
		render(strips: OverlayV1[]): void {
			if (ready) apply(strips);
			else pending = strips;
		},
		dispose: () => region.remove(),
	};
}
