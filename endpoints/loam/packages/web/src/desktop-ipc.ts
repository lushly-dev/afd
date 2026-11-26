/**
 * @fileoverview Single boot-time capture of Tauri's main-frame IPC `invoke` (`__TAURI_INTERNALS__.invoke`).
 *
 * `main.ts` captures `invoke` once at module load, before stage B imports any native app, and hands the
 * bound function (or `null` when absent at boot, so production paths never re-read globals later) to the
 * desktop mount transport, model transport, and inbound dispatcher. Centralizing the lookup retains Loam's
 * captured `invoke` reference and receiver as defense in depth; it is NOT a JS-realm isolation boundary
 * against native apps, which share `main`'s realm, desktop IPC commands, and `loam:*` DOM events (D54), and
 * Tauri's own `invoke` implementation still reads `window.__TAURI_INTERNALS__.ipc` on each call.
 */

/** Tauri's main-frame IPC invoker, bound to `__TAURI_INTERNALS__`. */
export type DesktopInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;

interface TauriHost {
	__TAURI_INTERNALS__?: { invoke?: DesktopInvoke };
}

/**
 * Captures and binds `__TAURI_INTERNALS__.invoke` from `target`, or returns `null` when absent at boot.
 * Callers pass `null` explicitly down production paths so an absent bridge is never looked up again later.
 */
export function captureDesktopInvoke(target: unknown = globalThis): DesktopInvoke | null {
	const internals = (target as TauriHost | null | undefined)?.__TAURI_INTERNALS__;
	return typeof internals?.invoke === 'function' ? internals.invoke.bind(internals) : null;
}
