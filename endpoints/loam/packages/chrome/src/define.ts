/**
 * @fileoverview Registering the chrome's elements, mounting the shell and rendering a full-page
 * notice. Loam's elements register globally under the `loam-` prefix in phase 0; scoped
 * registries arrive with apps in phase 1.
 */

import type { FASTElement } from '@lushly-dev/fast-element';
import type { LoamKernelV3 } from '@lushly-dev/loam-kernel';
import {
	appEntryDefinition,
	LoamAppEntry,
	LoamSectionEntry,
	sectionEntryDefinition,
} from './elements/app-entry.js';
import { LoamRail, LoamTabbar, railDefinition, tabbarDefinition } from './elements/app-nav.js';
import { emptyStateDefinition, LoamEmptyState } from './elements/empty-state.js';
import { LoamMain, mainDefinition } from './elements/main.js';
import type { LoamNotice } from './elements/notice.js';
import { defineNotice } from './elements/notice-loader.js';
import { LoamPanel, panelDefinition } from './elements/panel.js';
import { LoamProjectSwitcher, projectSwitcherDefinition } from './elements/project-switcher.js';
import { type JournalReader, LoamShell, shellDefinition } from './elements/shell.js';
import {
	inspectorDefinition,
	LoamInspector,
	LoamSidebar,
	sidebarDefinition,
} from './elements/side-part.js';
import { LoamStatusItem, statusItemDefinition } from './elements/status-item.js';
import { LoamStatusbar, statusbarDefinition } from './elements/statusbar.js';
import { LoamTitlebar, titlebarDefinition } from './elements/titlebar.js';
import { applyThemeStylesheet } from './theme.js';

const ELEMENTS: [typeof FASTElement, { name: string }][] = [
	[LoamEmptyState, emptyStateDefinition],
	// In first paint, so the rail lists the apps from their boot records (phase 2 specification, 2.2).
	[LoamAppEntry, appEntryDefinition],
	// The rail's bands (phase 2 specification, 7.2): the sections and the switcher's button.
	[LoamSectionEntry, sectionEntryDefinition],
	[LoamProjectSwitcher, projectSwitcherDefinition],
	[LoamStatusItem, statusItemDefinition],
	[LoamTitlebar, titlebarDefinition],
	[LoamRail, railDefinition],
	[LoamTabbar, tabbarDefinition],
	[LoamSidebar, sidebarDefinition],
	[LoamInspector, inspectorDefinition],
	[LoamMain, mainDefinition],
	[LoamPanel, panelDefinition],
	[LoamStatusbar, statusbarDefinition],
	[LoamShell, shellDefinition],
];

/** Every element the chrome defines, by tag name; the last ones load when they are needed. */
export const CHROME_ELEMENTS: readonly string[] = Object.freeze([
	...ELEMENTS.map(([, definition]) => definition.name),
	'loam-palette',
	'loam-resize-handle',
	'loam-notice',
	'loam-mount',
	'loam-list',
	'loam-part-header',
	'loam-status-action',
	'loam-toast-region',
	'loam-toast',
	'loam-modal',
	'loam-tooltip',
	'loam-project-list',
]);

let defined: Promise<void> | null = null;

export { defineNotice } from './elements/notice-loader.js';
export { definePalette } from './elements/palette-loader.js';

/** Define every chrome element once, but those that load after first paint (`definePalette`). */
export function defineChrome(): Promise<void> {
	defined ??= (async () => {
		for (const [type, definition] of ELEMENTS) {
			if (customElements.get(definition.name)) continue;
			// biome-ignore lint/suspicious/noExplicitAny: each definition matches its own element type
			await (type as any).define(definition);
		}
	})();
	return defined;
}

export interface MountShellOptions {
	kernel: LoamKernelV3;
	/** The text of `@lushly-dev/loam-theme/loam-theme.css`, adopted on the document. */
	themeCss: string;
	/** Where the status bar reads the journal's last sequence number at boot. */
	journal?: JournalReader;
	/**
	 * Whether the boot records list an app, so the first frame reads `app-list` and the rail lists them
	 * (phase 2 specification, 2.2). An empty shell's journal gains nothing.
	 */
	listsApps?: boolean;
	/**
	 * The deployment's root, absolute, with its trailing slash: what the router reads the URL against
	 * (phase 2 specification, 6.2). Default: the directory of the page's URL.
	 */
	base?: string;
	/**
	 * The path main's "Nothing here" links home to. Default: the base's path. Fixtures served under a
	 * path of their own set it, so two renders compare equal.
	 */
	home?: string;
}

/** Apply the theme, define the chrome and mount `loam-shell` into `container`. */
export async function mountShell(
	container: HTMLElement,
	options: MountShellOptions
): Promise<LoamShell> {
	applyThemeStylesheet(container.ownerDocument, options.themeCss);
	await defineChrome();
	const shell = container.ownerDocument.createElement('loam-shell') as LoamShell;
	shell.kernel = options.kernel;
	shell.journal = options.journal ?? null;
	if (options.base !== undefined) shell.base = options.base;
	shell.home = options.home ?? new URL(shell.base).pathname;
	if (options.listsApps) shell.listsApps = true;
	container.append(shell);
	await shell.ready;
	return shell;
}

export interface NoticeOptions {
	themeCss: string;
	heading: string;
	message: string;
}

/** Render a full-page notice in place of the shell, for example "Loam is open in another tab". */
export async function renderNotice(
	container: HTMLElement,
	options: NoticeOptions
): Promise<LoamNotice> {
	applyThemeStylesheet(container.ownerDocument, options.themeCss);
	await defineChrome();
	await defineNotice();
	const notice = container.ownerDocument.createElement('loam-notice') as LoamNotice;
	notice.heading = options.heading;
	notice.message = options.message;
	container.append(notice);
	return notice;
}
