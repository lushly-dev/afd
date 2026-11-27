/**
 * @fileoverview Loam's support floor for native apps (D174, amended 2026-11-26): in a browser, the engines with scoped
 * custom element registries, Chromium 146, Firefox 159 and Safari 26, with nothing polyfilled, so a native app does not
 * activate below them; its commands, views, mounted apps and the console still run. In the desktop app's webview, D34's
 * polyfill is kept, because WebKitGTK 2.52 (Loam's Linux desktop) has no scoped registries and the polyfill works there
 * (`packages/desktop/test/scoped.test.ts` proves it on every Linux desktop run).
 */

import {
	ensureScopedRegistrySupport,
	supportsScopedRegistries,
} from '@lushly-dev/fast-element/scoped.js';

/** What main says when a native app cannot run below the floor. */
export const SCOPED_REGISTRIES_FLOOR =
	'This browser cannot run native apps, because it has no scoped custom element registries. Use Chrome or Edge 146, Firefox 159 or Safari 26, or later.';

/**
 * Whether this page is the desktop app's webview: `main.ts` marks it when Tauri's IPC is present at boot, before any
 * app code loads. Read once, at the first check, so a module loaded later cannot turn the polyfill on.
 */
let desktop: boolean | undefined;
const desktopWebview = (): boolean => {
	desktop ??= document.documentElement.dataset.loamWebview === 'desktop';
	return desktop;
};

/** Whether native apps can run here: natively, or through the polyfill in the desktop's webview. */
export const nativeAppsSupported = (): boolean => supportsScopedRegistries() || desktopWebview();

/** Load the polyfill where it is kept and needed (the desktop's WebKitGTK webview); elsewhere, nothing. */
export async function prepareScopedRegistries(): Promise<void> {
	if (!supportsScopedRegistries() && desktopWebview()) await ensureScopedRegistrySupport();
}

/** Whether `cause` is the floor's own activation failure: explained where the app opens, so not a page error. */
export const isSupportFloorFailure = (cause: unknown): boolean =>
	cause instanceof Error && cause.message === SCOPED_REGISTRIES_FLOOR;
