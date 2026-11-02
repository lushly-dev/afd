/**
 * The browser host's entry (phase 0 specification, step 7): the kernel over IndexedDB, the chrome
 * with Loam's theme, and the "open in another tab" notice when the journal's writer lock is held. A
 * deployment that lists apps loads its reader and ports (phase 1 specification, 9.4).
 */

import { mountShell, renderNotice } from '@lushly-dev/loam-chrome';
import themeCss from '@lushly-dev/loam-theme/loam-theme.css?inline';
import {
	createHostKernel,
	type HostKernelOptions,
	isEmptyProjection,
	mediaEnvironment,
	OTHER_TAB_NOTICE,
} from './host.js';

const CANNOT_START = 'Loam cannot start';

/** What reads the deployment did not load: each app is listed with the reason, and the shell runs (D66). */
async function readApps(raw: unknown): Promise<HostKernelOptions['apps'] | string> {
	try {
		const read = (await import('./deployment.js')).readOrNotice(raw, document);
		return read.ok ? read.apps : read.message;
	} catch (error) {
		reportError(error);
		return {
			deployment: raw as never,
			appsUnavailable: error instanceof Error ? error.message : String(error),
		};
	}
}

async function boot(): Promise<void> {
	const raw: unknown = await fetch('deployment.json')
		.then((response) => response.json())
		.catch(() => undefined);
	const apps = isEmptyProjection(raw) ? undefined : await readApps(raw);
	if (typeof apps === 'string') {
		await renderNotice(document.body, { themeCss, heading: CANNOT_START, message: apps });
		document.documentElement.dataset.loamHost = 'failed';
		return;
	}
	const host = await createHostKernel({
		environment: mediaEnvironment(window),
		...(apps ? { apps } : {}),
	});
	if (host.kind === 'locked') {
		await renderNotice(document.body, { themeCss, ...OTHER_TAB_NOTICE });
		document.documentElement.dataset.loamHost = 'locked';
		return;
	}
	await mountShell(document.body, {
		kernel: host.kernel,
		journal: host.journal,
		themeCss,
		...(apps ? { apps: true } : {}),
	});
	document.documentElement.dataset.loamHost = 'web';
}

boot().catch(async (error: unknown) => {
	// A store that cannot open (blocked, out of quota, a newer version) leaves no blank page.
	reportError(error);
	await renderNotice(document.body, {
		themeCss,
		heading: CANNOT_START,
		message: `Its local stores could not open: ${error instanceof Error ? error.message : String(error)}. Reload to try again.`,
	});
	document.documentElement.dataset.loamHost = 'failed';
});
