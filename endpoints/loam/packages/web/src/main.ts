/**
 * The browser host's entry (phase 0 specification, step 7): the kernel over IndexedDB, the chrome
 * with Loam's theme, and the "open in another tab" notice when the journal's writer lock is held.
 */

// First, before any module that parses with Zod loads.
import './zod-jitless.js';
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

boot().catch(async (error: unknown) => {
	// A store that cannot open (blocked, out of quota, a newer version) leaves no blank page.
	reportError(error);
	await renderNotice(document.body, {
		themeCss,
		heading: 'Loam cannot start',
		message: `Its local stores could not open: ${error instanceof Error ? error.message : String(error)}. Reload to try again.`,
	});
	document.documentElement.dataset.loamHost = 'failed';
});
