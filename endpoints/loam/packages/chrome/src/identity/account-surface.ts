/**
 * @fileoverview What an app's account section shows (phase 3 specification, 5.5), with no DOM, so a unit reads it in
 * Node. The manifest's `accountSurfaceOf` decides the same table at install time; this reads it again in the page.
 */

import type { AppPortV2, AppSummaryV2, LoamKernelV5 } from '@lushly-dev/loam-kernel';
import { ownerTitle } from '@lushly-dev/loam-kernel/owner-title';
import type { AccountSectionV1 } from '@lushly-dev/loam-sdk';

/** One app's section, as a tab: its path under `~/account` is `<instance>/<id>`. */
export interface AppAccountTab {
	key: string;
	instance: string;
	/** The app's name as an owner line shows it: never one that says the shell's, a twin's with its instance. */
	app: string;
	section: AccountSectionV1;
}

/**
 * What `surface` shows (5.5), as the manifest's rule decides it: a native app's `main`, `inspector` or custom `sidebar`
 * element, or a view app's `main` resource. The manifest's `accountSurfaceOf` holds the same table.
 */
export function surfaceOf(
	port: Pick<AppPortV2, 'manifest'>,
	surface: string
): { element: string } | { resource: string; command?: string } | undefined {
	const { manifest } = port;
	const surfaces = manifest.ui?.surfaces;
	if (manifest.plugin.kind === 'view') {
		const main = surface === 'main' ? surfaces?.main : undefined;
		return main?.resource === undefined
			? undefined
			: { resource: main.resource, ...(main.command ? { command: main.command } : {}) };
	}
	if (manifest.plugin.kind !== 'native') return undefined;
	// A sidebar's element shows only with `shape = "custom"`; a list or a tree is the shell's (4.2).
	const element =
		surface === 'main' || surface === 'inspector'
			? surfaces?.[surface]?.element
			: surface === 'sidebar' && surfaces?.sidebar?.shape === 'custom'
				? surfaces.sidebar.element
				: undefined;
	return element === undefined ? undefined : { element };
}

/** Each ready native or view app's `ui.account` sections, in `app-list`'s order: no mounted, failed or disabled app's. */
export async function appTabs(
	kernel: Pick<LoamKernelV5, 'call' | 'appPort'>
): Promise<AppAccountTab[]> {
	const listed = await kernel.call<{ apps: AppSummaryV2[] }>('app-list');
	const apps = listed.data?.apps ?? [];
	const tabs: AppAccountTab[] = [];
	for (const app of apps) {
		if (app.state !== 'ready' || (app.kind !== 'native' && app.kind !== 'view')) continue;
		let sections: AccountSectionV1[];
		try {
			sections = kernel.appPort(app.instance).manifest.ui?.account ?? [];
		} catch {
			continue;
		}
		if (sections.length === 0) continue;
		// A surface whose experiment is off shows nowhere, here no more than in main (phase 4 specification, 5.3). Unread,
		// the gates are not known: the app's tabs fail closed, as main renders only from a detail it was given.
		const detail = await kernel.call<{ gates?: Record<string, { open: boolean }> }>('app-get', {
			instance: app.instance,
		});
		if (!detail.success) continue;
		const gates = detail.data?.gates;
		for (const section of sections) {
			if (gates?.[section.surface]?.open === false) continue;
			tabs.push({
				key: `${app.instance}/${section.id}`,
				instance: app.instance,
				app: ownerTitle(apps, app.instance),
				section,
			});
		}
	}
	return tabs;
}
