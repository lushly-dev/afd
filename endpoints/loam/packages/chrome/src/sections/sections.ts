/**
 * @fileoverview The `sections` chunk (phase 2 specification, 7.2 and 7.7): main's projects section, shown
 * when `section-get` says `projects` and no app is active. `syncSection` follows the state, once per change
 * of scope or of main, and is loaded by the URL's chunk, which hears those, so first paint holds none of it
 * (2.4). It owns what the section changes outside itself: main's landing hidden, and the title bar's toggles
 * disabled, since the section declares main alone (`loam.layout.~projects`).
 */

import { css, type FASTElement, Updates } from '@lushly-dev/fast-element';
import type { LoamKernelV2, ProjectV1 } from '@lushly-dev/loam-kernel';
import type { LoamShell } from '../elements/shell.js';
import { LoamProjectsSection, projectsSectionDefinition } from './projects-section.js';

const NAME = projectsSectionDefinition.name;
const PARTS = ['sidebar', 'inspector', 'panel'] as const;
const toggleTitle = (part: string): string => `Projects has no ${part}`;

/** Added to `loam-main` from this chunk, so the empty shell's styles do not grow. */
const mainWithSection = css`
	:host([data-section]) .landing {
		display: none;
	}
	:host([data-section][route='not-found']) .landing {
		display: grid;
	}
	:host([route='not-found']) ::slotted(loam-projects-section) {
		display: none;
	}
`;

/**
 * Defined once. The cards' icons are `ICONS_V1`, which the app surfaces register, as they load wherever an
 * app has a summary; this chunk imports nothing of theirs, so it moves no shared chunk (2.4).
 */
let defined: Promise<unknown> | undefined;
function define(): Promise<unknown> {
	// FAST's `define` settles later: an element made before it would not be upgraded, and its fields would
	// then replace what was set on it.
	defined ??= customElements.get(NAME)
		? Promise.resolve()
		: Promise.resolve(LoamProjectsSection.define(projectsSectionDefinition));
	return defined;
}

/**
 * Main, or the panel when a maximized panel has made main inert, as `focusFallback` does, written here so
 * this chunk shares no module with first paint or the surfaces (2.4).
 */
function focusMain(shell: LoamShell, main: HTMLElement): void {
	const target = main.inert ? shell.shadowRoot?.querySelector<HTMLElement>('loam-panel') : main;
	if (!target) return;
	target.setAttribute('tabindex', '-1');
	target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
	target.focus();
}

/** The title bar's toggles, `aria-disabled` while the section shows; a mark another left stays. */
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
}

/** Whether focus has nowhere a person put it: the page, main, or main's own landing. */
function focusLost(shell: LoamShell, main: HTMLElement, section: Element): boolean {
	// As `deepActiveElement`, written here so this chunk shares no module with first paint (2.4).
	let active = shell.ownerDocument.activeElement;
	while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
	return (
		active === null ||
		active === shell.ownerDocument.body ||
		// The status bar's project item asks for the project's home, which takes focus, as leaving an app (7.8).
		active.classList.contains('project-home') ||
		active === main ||
		active.getRootNode() === main.shadowRoot ||
		section.contains(active) ||
		active.getRootNode() === section.shadowRoot
	);
}

const queues = new WeakMap<LoamShell, Promise<void>>();

/** Follow the state: show, update or remove the section. One at a time per shell, so a later state wins. */
export function syncSection(shell: LoamShell): Promise<void> {
	const next = (queues.get(shell) ?? Promise.resolve()).then(() => sync(shell)).catch(reportError);
	queues.set(shell, next);
	return next;
}

async function sync(shell: LoamShell): Promise<void> {
	const kernel = shell.kernel as LoamKernelV2;
	const main = shell.shadowRoot?.querySelector<HTMLElement & FASTElement>('loam-main');
	if (!kernel || !main) return;
	const state = await shell.readState();
	const held = main.querySelector<LoamProjectsSection>(NAME);
	if (state.section !== 'projects' || state.active !== null) {
		if (!held) return;
		const hadFocus = held.matches(':focus-within');
		held.remove();
		// The documents section's editor area may already own main (documents specification, 5.1).
		if (main.dataset.section === 'projects') delete main.dataset.section;
		markToggles(shell, false);
		await shell.readLayout();
		// Focus that was in the section goes to main, or to the panel when main is inert, not to the page.
		if (hadFocus) focusMain(shell, main);
		return;
	}
	await define();
	let section = held;
	const entering = !section;
	if (!section) {
		section = shell.ownerDocument.createElement(NAME) as LoamProjectsSection;
		section.kernel = kernel;
		section.base = shell.base;
		if (!main.dataset.sectionReady) {
			main.dataset.sectionReady = '';
			main.$fastController.addStyles(mainWithSection);
			// Focus that lands on main itself, as when the app that held it leaves, goes to the section's
			// heading (7.8), whichever of the two runs first.
			main.addEventListener('focus', () =>
				main.querySelector<LoamProjectsSection>(NAME)?.focusHeading()
			);
		}
		main.dataset.section = 'projects';
		main.append(section);
	}
	// A project's home is the projects section in it, with no path (4.3); anywhere else, the list.
	const inProject =
		state.scope.project !== undefined && state.project !== null && state.path === '';
	const view = inProject ? 'home' : 'list';
	const moved = entering || view !== section.view || state.scope.project !== section.project?.id;
	const lost = focusLost(shell, main, section);
	await section.show(
		view,
		inProject ? (state.project as ProjectV1) : null,
		state.workspace.id,
		moved && lost
	);
	markToggles(shell, true);
	// The section declares main alone: its layout, `loam.layout.~projects`, has every other part closed.
	await shell.readLayout();
	// Leaving an app, or a home that archiving left, puts focus on the section's heading (7.8); a person's
	// press in the rail keeps it where it is.
	if (moved && lost) {
		await Updates.next();
		section.focusHeading();
	}
}
