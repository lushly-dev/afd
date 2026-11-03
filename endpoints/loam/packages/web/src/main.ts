/**
 * The browser host's entry (phase 0 specification, step 7): the kernel over IndexedDB, the chrome
 * with Loam's theme, and the "open in another tab" notice when the journal's writer lock is held. Every
 * deployment paints the same first frame: `readBoot` reads `deployment.json` with no validator, and the
 * reader and the ports load in stage B, after it (phase 2 specification, 2.2).
 */

import { mountShell, renderNotice } from '@lushly-dev/loam-chrome';
import type { AppsLoadV2 } from '@lushly-dev/loam-kernel';
import { readBoot } from '@lushly-dev/loam-manifest';
import themeCss from '@lushly-dev/loam-theme/loam-theme.css?inline';
import { createHostKernel, mediaEnvironment, OTHER_TAB_NOTICE } from './host.js';

const CANNOT_START = 'Loam cannot start';

/** The reader and the ports, in a chunk of their own: what stage B calls. */
async function loadApps(raw: unknown): Promise<AppsLoadV2> {
	// Named here because this chunk has the bundler's dynamic import helper, and that one does not.
	return (await import('./deployment.js')).readOrNotice(
		raw,
		document,
		() => import('@lushly-dev/loam-chrome/view'),
		() => import('./mount.js')
	);
}

/**
 * Why a `deployment.json` `readBoot` could not read is refused, from the reader itself, which refuses
 * whatever `readBoot` does: the version, the list and the workspace's pattern.
 */
async function refusalOf(raw: unknown): Promise<string> {
	return ((await loadApps(raw)) as { refused: string }).refused;
}

async function boot(): Promise<void> {
	const raw: unknown = await fetch('deployment.json')
		.then((response) => response.json())
		.catch(() => undefined);
	const read = readBoot(raw);
	if (read === undefined) {
		// Nothing Loam wrote: the reader loads at once to say why (9.4).
		await renderNotice(document.body, {
			themeCss,
			heading: CANNOT_START,
			message: await refusalOf(raw),
		});
		document.documentElement.dataset.loamHost = 'failed';
		return;
	}
	const host = await createHostKernel({
		environment: mediaEnvironment(window),
		boot: read,
		appsLoader: () => loadApps(raw),
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
		listsApps: read.apps.length > 0,
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
