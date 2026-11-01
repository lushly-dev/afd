/**
 * The browser host's entry (phase 0 specification, step 7): the kernel over IndexedDB, the chrome
 * with Loam's theme, and the "open in another tab" notice when the journal's writer lock is held.
 */

import { mountShell, renderNotice } from '@lushly-dev/loam-chrome';
import themeCss from '@lushly-dev/loam-theme/loam-theme.css?inline';
import { createHostKernel, mediaEnvironment, OTHER_TAB_NOTICE } from './host.js';

async function boot(): Promise<void> {
	const host = await createHostKernel({ environment: mediaEnvironment(window) });
	if (host.kind === 'locked') {
		await renderNotice(document.body, { themeCss, ...OTHER_TAB_NOTICE });
		document.documentElement.dataset.loamHost = 'locked';
		return;
	}
	await mountShell(document.body, { kernel: host.kernel, journal: host.journal, themeCss });
	document.documentElement.dataset.loamHost = 'web';
}

void boot();
