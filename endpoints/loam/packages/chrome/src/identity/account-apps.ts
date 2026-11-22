/**
 * @fileoverview An app's account sections (phase 3 specification, 5.5), in the `account` chunk: a tab of the account
 * section per `ui.account` entry of each ready native or view app, which shows the declared surface at workspace level.
 * The surface's port is fixed to `{ workspace }` and is writable (D83), whatever project is active, so the surface learns
 * no project from it and a call that names another scope is refused by the port (`app-scope-refuse`). Its calls carry
 * the app's grants and the caller's actor, which the kernel stamps, never an email, a session or a credential. That is
 * the surface port's boundary, not the module's: a native app's `activate` context keeps its own port, as it does for
 * every native surface (D54).
 *
 * Each tab names its app, by the owner line's rule (`ownerTitle`), so no app's tab passes for one of the shell's. A
 * native app's element mounts through the app surfaces' `host()`, which activates the app once. A view app's `main`
 * resource opens in a `loam-view-frame` from the view chunk, loaded only when such a tab shows, and is told before it
 * goes (phase 1 specification, 6.2).
 */

import type { AppPortV2, LoamKernelV5 } from '@lushly-dev/loam-kernel';
import { deliverSettings, settingsHeard } from '../apps/surface-calls.js';
import type { SurfaceHostV1 } from '../editor/editor-frame.js';
import type { LoamViewFrame } from '../view/view-frame.js';
import { el } from './account-parts.js';
import { type AppAccountTab, surfaceOf } from './account-surface.js';

export { type AppAccountTab, appTabs } from './account-surface.js';

/** What a tab's surface needs of the shell. */
export interface AppTabHost {
	kernel: LoamKernelV5;
	workspace: string;
	/**
	 * The app surfaces' way in, once the `surfaces` chunk has loaded; null when the shell has no apps, or once `stale`
	 * says the read that asked is no longer wanted.
	 */
	surfaces(stale: () => boolean): Promise<SurfaceHostV1 | null>;
	theme(): 'light' | 'dark';
	/** Whether main shows the person's workspace: signed out, no member or the wrong binding, no app's tab shows. */
	open(): boolean;
	/** Hear each change of that gate; returns the way to stop. */
	watchGate(listener: () => void): () => void;
}

/** A shown tab's surface, kept while its tab stays shown, so a re-read of the section recreates nothing. */
export interface ShownAppTab {
	key: string;
	node: HTMLElement;
	/** It could not show its surface: a later read tries again rather than keeping the notice. */
	failed: boolean;
	/** Its app's own settings sections changed (phase 4 specification, 3.8). */
	settingsChanged(sections: readonly string[]): void;
	/** Goes, a view once it has answered its teardown or 500 ms have passed (6.2). */
	dispose(): Promise<void>;
}

/**
 * The tab's panel: who it comes from, in words, then the surface at workspace level. A surface that cannot show says
 * why, in words, as main says it for an app.
 */
export async function showAppTab(
	tab: AppAccountTab,
	host: AppTabHost,
	stale: () => boolean
): Promise<ShownAppTab> {
	const { kernel, workspace } = host;
	const scope = { workspace };
	const wrap = el(
		'div',
		{ class: 'app-section', 'data-app': tab.instance },
		el('p', { class: 'note' }, `From ${tab.app}, an app, for this workspace.`)
	);
	let surface: HTMLElement | null = null;
	let port: AppPortV2 | undefined;
	const shown: ShownAppTab = {
		key: tab.key,
		node: wrap,
		failed: false,
		settingsChanged: (sections) => {
			if (surface) deliverSettings([surface], settingsHeard(port?.manifest, sections));
		},
		dispose: async () => {
			wrap.remove();
		},
	};
	const unavailable = (why: string) => {
		wrap.append(el('p', { role: 'note' }, `${tab.section.title} is unavailable: ${why}`));
		shown.failed = true;
		return shown;
	};
	try {
		port = kernel.appPort(tab.instance);
	} catch {
		return unavailable('the app is not installed.');
	}
	const shows = surfaceOf(port, tab.section.surface);
	if (!shows) return unavailable('its manifest names no surface that can show here.');
	if ('element' in shows) {
		const surfaces = await host.surfaces(stale);
		// A read no longer wanted activates nothing and makes no port.
		if (stale()) return unavailable('the section moved on.');
		if (!surfaces) return unavailable('the apps have not loaded. Reload to try again.');
		try {
			await surfaces.ensureActivated(tab.instance);
		} catch (cause) {
			return unavailable(cause instanceof Error ? cause.message : String(cause));
		}
		if (stale()) return unavailable('the section moved on.');
		const mount = surfaces.createMount(tab.instance, shows.element, { scope });
		mount.setAttribute('role', 'region');
		mount.setAttribute('aria-label', `${tab.section.title}, from ${tab.app}`);
		wrap.append(mount);
		surface = mount;
		return shown;
	}
	let frame: LoamViewFrame;
	try {
		const view = await import('../view/view.js');
		await view.defineViewFrame();
		frame = globalThis.document.createElement('loam-view-frame') as LoamViewFrame;
		frame.configure({
			port,
			// The frame's broker is its surface's, closed over the workspace (D83).
			view: port.surface({ scope }).view,
			scope,
			route: '',
			source: view.packageViewSource(port),
			heading: `${tab.section.title}, from ${tab.app}`,
			hostVersion: String(kernel.version),
			resource: shows.resource,
			...(shows.command !== undefined ? { command: shows.command } : {}),
			theme: host.theme,
		});
	} catch {
		return unavailable('the view host could not load. Reload to try again.');
	}
	wrap.append(frame);
	surface = frame;
	// Hidden at once, and removed only once the view has answered: removing its iframe first would end it (6.2).
	shown.dispose = async () => {
		wrap.hidden = true;
		await frame.dispose();
		wrap.remove();
	};
	return shown;
}
