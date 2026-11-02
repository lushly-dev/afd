/** @fileoverview `ICONS_V1`, registered in the nav's lazy chunk (phase 1 specification, 4.2). */

import { registerSystemAttachIcon } from '@lushly-dev/violet-elements/dist/icon/generated/icons/system-attach.js';
import { registerSystemCalendarIcon } from '@lushly-dev/violet-elements/dist/icon/generated/icons/system-calendar.js';
import { registerSystemCheckmarkIcon } from '@lushly-dev/violet-elements/dist/icon/generated/icons/system-checkmark.js';
import { registerSystemClockIcon } from '@lushly-dev/violet-elements/dist/icon/generated/icons/system-clock.js';
import { registerSystemDocumentIcon } from '@lushly-dev/violet-elements/dist/icon/generated/icons/system-document.js';
import { registerSystemFolderIcon } from '@lushly-dev/violet-elements/dist/icon/generated/icons/system-folder.js';
import { registerSystemWarningIcon } from '@lushly-dev/violet-elements/dist/icon/generated/icons/system-warning.js';

let registered = false;

export function registerAppIcons(): void {
	if (registered) return;
	registered = true;
	registerSystemAttachIcon();
	registerSystemCalendarIcon();
	registerSystemCheckmarkIcon();
	registerSystemClockIcon();
	registerSystemDocumentIcon();
	registerSystemFolderIcon();
	registerSystemWarningIcon();
}
