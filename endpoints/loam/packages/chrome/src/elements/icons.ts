/**
 * @fileoverview The system icons the chrome uses, registered once (design.md, "Iconography").
 * Importing `violet-icon` registers no icon.
 */

import '@lushly-dev/violet-elements/icon/define';
import { registerSystemCloseIcon } from '@lushly-dev/violet-elements/icons/system-close';
import { registerSystemDocumentIcon } from '@lushly-dev/violet-elements/icons/system-document';
import { registerSystemFolderIcon } from '@lushly-dev/violet-elements/icons/system-folder';
import { registerSystemSearchIcon } from '@lushly-dev/violet-elements/icons/system-search';
import { registerSystemSettingsIcon } from '@lushly-dev/violet-elements/icons/system-settings';

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
