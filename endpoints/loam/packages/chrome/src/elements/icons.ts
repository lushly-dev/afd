/**
 * @fileoverview The system icons the chrome uses, registered once (design.md, "Iconography").
 * Importing `violet-icon` registers no icon.
 */

import '@lushly-dev/violet-elements/dist/icon/violet-icon.js';
import { registerSystemCloseIcon } from '@lushly-dev/violet-elements/dist/icon/generated/icons/system-close.js';
import { registerSystemDocumentIcon } from '@lushly-dev/violet-elements/dist/icon/generated/icons/system-document.js';
import { registerSystemFolderIcon } from '@lushly-dev/violet-elements/dist/icon/generated/icons/system-folder.js';
import { registerSystemSearchIcon } from '@lushly-dev/violet-elements/dist/icon/generated/icons/system-search.js';
import { registerSystemSettingsIcon } from '@lushly-dev/violet-elements/dist/icon/generated/icons/system-settings.js';

let registered = false;

export function registerChromeIcons(): void {
	if (registered) return;
	registered = true;
	registerSystemCloseIcon();
	// The rail's Projects, Documents and the switcher with no project (phase 2 specification, 7.2).
	registerSystemFolderIcon();
	registerSystemDocumentIcon();
	registerSystemSearchIcon();
	registerSystemSettingsIcon();
}
