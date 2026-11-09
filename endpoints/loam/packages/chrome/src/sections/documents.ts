/**
 * @fileoverview The `documents` chunk (documents specification, 1 and 8): the documents section, shown when
 * `section-get` says `documents` and no app is active, loaded by the URL's chunk beside the editor area's,
 * which hears every change of scope and of main, so first paint holds none of it (scope and projects
 * specification, 2.4). Its sidebar is `loam-documents-sidebar`, the tree, in the shell's sidebar part, with
 * tabs open or not; main is the editor area while the scope's editor state has tabs and the section's list,
 * `loam-documents-section`, while it has none (5.1). The section's layout is `loam.layout.~documents`, which
 * declares the sidebar; the title bar's other toggles say the section has none.
 */

import { css, type FASTElement, Updates } from '@lushly-dev/fast-element';
import type { LoamKernelV2 } from '@lushly-dev/loam-kernel';
import type { LoamShell } from '../elements/shell.js';
import { documentsSectionDefinition, LoamDocumentsSection } from './documents-section.js';
import { documentsSidebarDefinition, LoamDocumentsSidebar } from './documents-sidebar.js';
import { defineTree } from './tree.js';

/** `loam-tree`, which an app's `tree` sidebar takes from this chunk (phase 2 specification, 7.2). */
export { defineTree };

const SECTION = documentsSectionDefinition.name;
const SIDEBAR = documentsSidebarDefinition.name;
const PARTS = ['inspector', 'panel'] as const;
const toggleTitle = (part: string): string => `Documents has no ${part}`;

/** Added to `loam-main` from this chunk: "Nothing here" hides the list, as it hides the editor area. */
const mainWithList = css`
	:host([route='not-found']) ::slotted(loam-documents-section) {
		display: none;
	}
`;

let defined: Promise<unknown> | undefined;
function define(): Promise<unknown> {
	defined ??= Promise.all([
		defineTree(),
		customElements.get(SECTION)
			? undefined
			: LoamDocumentsSection.define(documentsSectionDefinition),
		customElements.get(SIDEBAR)
			? undefined
			: LoamDocumentsSidebar.define(documentsSidebarDefinition),
	]);
	return defined;
}

/** The title bar's inspector and panel toggles, `aria-disabled` while the section shows; a mark another left stays. */
function markToggles(shell: LoamShell, on: boolean): void {
	const titlebar = shell.shadowRoot?.querySelector('loam-titlebar');
	for (const part of PARTS) {
		const toggle = titlebar?.shadowRoot?.querySelector(`[data-toggle="${part}"]`);
		if (!toggle) continue;
		if (on) {
			toggle.setAttribute('aria-disabled', 'true');
			toggle.setAttribute('title', toggleTitle(part));
		} else if (toggle.getAttribute('title') === toggleTitle(part)) {
			toggle.removeAttribute('aria-disabled');
			toggle.removeAttribute('title');
		}
	}
	// The sidebar is the section's: a mark another section left on it goes.
	const sidebar = titlebar?.shadowRoot?.querySelector('[data-toggle="sidebar"]');
	if (on && sidebar?.getAttribute('title')?.endsWith('has no sidebar')) {
		sidebar.removeAttribute('aria-disabled');
		sidebar.removeAttribute('title');
	}
}

/** Main, or the panel when a maximized panel has made main inert, written here so this chunk shares no module. */
function focusMain(shell: LoamShell, main: HTMLElement): void {
	const target = main.inert ? shell.shadowRoot?.querySelector<HTMLElement>('loam-panel') : main;
	if (!target) return;
	target.setAttribute('tabindex', '-1');
	target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
	target.focus();
}

const queues = new WeakMap<LoamShell, Promise<void>>();

/** Follow the state: show, update or remove the section's parts. One at a time per shell, so a later state wins. */
export function syncDocuments(shell: LoamShell): Promise<void> {
	const next = (queues.get(shell) ?? Promise.resolve()).then(() => sync(shell)).catch(reportError);
	queues.set(shell, next);
	return next;
}

async function sync(shell: LoamShell): Promise<void> {
	const kernel = shell.kernel as LoamKernelV2;
	const root = shell.shadowRoot;
	const main = root?.querySelector<HTMLElement & FASTElement>('loam-main');
	const part = root?.querySelector<HTMLElement>('loam-sidebar');
	if (!kernel || !main || !part) return;
	const state = await shell.readState();
	const side = part.querySelector<LoamDocumentsSidebar>(SIDEBAR);
	const held = main.querySelector<LoamDocumentsSection>(SECTION);
	const empty = part.querySelector<HTMLElement>('loam-empty-state');
	if (state.section !== 'documents' || state.active !== null) {
		if (!side && !held) return;
		const hadFocus = held?.matches(':focus-within') || side?.matches(':focus-within');
		held?.remove();
		side?.remove();
		if (part.getAttribute('heading') === 'Documents') part.setAttribute('heading', 'Sidebar');
		// The app surfaces show it again when an app opens with no sidebar of its own.
		if (empty && state.active === null) empty.hidden = false;
		markToggles(shell, false);
		if (hadFocus) focusMain(shell, main);
		return;
	}
	await define();
	// Loaded after a failure that said so: the landing says what it said before (`loam-shell`'s own text).
	if (shell.landing === 'Could not load. Reload to try again.' && !kernel.lateFailure) {
		shell.landing = 'Choose an app';
	}
	let sidebar = side;
	if (!sidebar) {
		sidebar = shell.ownerDocument.createElement(SIDEBAR) as LoamDocumentsSidebar;
		sidebar.kernel = kernel;
		part.prepend(sidebar);
	}
	sidebar.compact = shell.presentation.layoutClass === 'compact';
	part.setAttribute('heading', 'Documents');
	if (empty) {
		empty.hidden = true;
		// Its own words again, after a failed load put the failure there (with a tab open).
		if (empty.getAttribute('message') === 'Could not load. Reload to try again.') {
			empty.setAttribute('message', "The active app's navigation will appear here.");
		}
	}
	const project = state.scope.project;
	void sidebar.show(`${state.workspace.id} ${project ?? ''}`);
	markToggles(shell, true);
	// Main: the editor area while the scope's editor state has tabs, and the list while it has none (5.1).
	const editor = await kernel.call<{ groups: Array<{ tabs: unknown[] }> }>('editor-get');
	const tabs = editor.data?.groups.some((group) => group.tabs.length > 0) ?? false;
	if (tabs) {
		held?.remove();
	} else {
		let section = held;
		if (!section) {
			section = shell.ownerDocument.createElement(SECTION) as LoamDocumentsSection;
			section.kernel = kernel;
			section.host = shell;
			if (!main.dataset.listReady) {
				main.dataset.listReady = '';
				main.$fastController.addStyles(mainWithList);
				// Focus that lands on main itself, as when the last tab closes, goes to the list's heading.
				main.addEventListener('focus', () =>
					main.querySelector<LoamDocumentsSection>(SECTION)?.focusHeading()
				);
			}
			main.append(section);
		}
		section.base = shell.base;
		section.workspace = state.workspace.id;
		const entering = !held;
		await section.read();
		if (entering && main.matches(':focus')) {
			await Updates.next();
			section.focusHeading();
		}
	}
	// The section declares the sidebar alone: `loam.layout.~documents`.
	await shell.readLayout();
}
