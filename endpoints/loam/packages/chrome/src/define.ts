/**
 * @fileoverview Registering the chrome's elements, mounting the shell and rendering a full-page
 * notice. Loam's elements register globally under the `loam-` prefix in phase 0; scoped
 * registries arrive with apps in phase 1.
 */

import type { FASTElement } from '@lushly-dev/fast-element';
import type { LoamKernelV0 } from '@lushly-dev/loam-kernel';
import { LoamRail, LoamTabbar, railDefinition, tabbarDefinition } from './elements/app-nav.js';
import { emptyStateDefinition, LoamEmptyState } from './elements/empty-state.js';
import { LoamMain, mainDefinition } from './elements/main.js';
import { LoamNotice, noticeDefinition } from './elements/notice.js';
import { LoamPanel, panelDefinition } from './elements/panel.js';
import { LoamResizeHandle, resizeHandleDefinition } from './elements/resize-handle.js';
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
	[LoamStatusItem, statusItemDefinition],
	[LoamNotice, noticeDefinition],
	[LoamResizeHandle, resizeHandleDefinition],
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

/** Every element the chrome defines, by tag name; `loam-palette` loads after first paint. */
export const CHROME_ELEMENTS: readonly string[] = Object.freeze([
	...ELEMENTS.map(([, definition]) => definition.name),
	'loam-palette',
]);

let defined: Promise<void> | null = null;

export { definePalette } from './elements/palette-loader.js';

/** Define every chrome element once, but the palette, which the shell loads when idle. */
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
	kernel: LoamKernelV0;
	/** The text of `@lushly-dev/loam-theme/loam-theme.css`, adopted on the document. */
	themeCss: string;
	/** Where the status bar reads the journal's last sequence number at boot. */
	journal?: JournalReader;
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
	const notice = container.ownerDocument.createElement('loam-notice') as LoamNotice;
	notice.heading = options.heading;
	notice.message = options.message;
	container.append(notice);
	return notice;
}
