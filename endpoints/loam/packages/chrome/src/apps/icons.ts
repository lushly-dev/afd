/** @fileoverview `ICONS_V1`, registered in the nav's lazy chunk (phase 1 specification, 4.2). */

import { registerSystemAttachIcon } from '@lushly-dev/violet-elements/icons/system-attach';
import { registerSystemCalendarIcon } from '@lushly-dev/violet-elements/icons/system-calendar';
import { registerSystemCheckmarkIcon } from '@lushly-dev/violet-elements/icons/system-checkmark';
import { registerSystemClockIcon } from '@lushly-dev/violet-elements/icons/system-clock';
import { registerSystemDocumentIcon } from '@lushly-dev/violet-elements/icons/system-document';
import { registerSystemFolderIcon } from '@lushly-dev/violet-elements/icons/system-folder';
import { registerSystemWarningIcon } from '@lushly-dev/violet-elements/icons/system-warning';

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
