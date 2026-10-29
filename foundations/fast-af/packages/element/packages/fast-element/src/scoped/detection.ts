/**
 * Detection and polyfill loading for Scoped Custom Element Registries.
 */

import { isDevMode } from "../dev-mode.js";

declare global {
    interface GlobalThis {
        __scopedRegistryPolyfillApplied?: boolean;
        __scopedRegistryPolyfillPromise?: Promise<void>;
    }
}

/**
 * Robust feature detection for Scoped Custom Element Registries.
 *
 * @remarks
 * Tests the full API surface, not just the constructor existence.
 * This ensures the browser actually supports attaching a custom registry
 * to a shadow root, which is the critical functionality.
 *
 * @returns true if the browser supports scoped custom element registries
 *
 * @example
 * ```typescript
 * if (supportsScopedRegistries()) {
 *   const registry = new CustomElementRegistry();
 *   element.attachShadow({ mode: 'open', customElementRegistry: registry });
 * }
 * ```
 *
 * @public
 */
export function supportsScopedRegistries(): boolean {
    try {
        // Test 1: Can we construct a CustomElementRegistry?
        const reg = new CustomElementRegistry();

        // Test 2: Can we use it with attachShadow?
        const div = document.createElement("div");
        const shadow = div.attachShadow({
            mode: "open",
            customElementRegistry: reg,
            registry: reg,
        } as ShadowRootInit);

        const scopedShadow = shadow as ShadowRoot & {
            customElementRegistry?: CustomElementRegistry;
            registry?: CustomElementRegistry;
        };

        return (
            scopedShadow.customElementRegistry === reg || scopedShadow.registry === reg
        );
    } catch {
        return false;
    }
}

/**
 * Idempotency-safe polyfill loading for Scoped Custom Element Registries.
 *
 * @remarks
 * Safe to call from multiple micro-frontend bundles. Uses a global flag
 * (`window.__scopedRegistryPolyfillApplied`) to prevent double-patching
 * which could corrupt the CustomElementRegistry prototype.
 *
 * If native support is detected, returns immediately without loading the polyfill.
 * On polyfill load failure, the flag is reset to allow retry on subsequent calls.
 *
 * @throws Error if the polyfill fails to load (network error, etc.)
 *
 * @example
 * ```typescript
 * // At app startup
 * await ensureScopedRegistrySupport();
 *
 * // Now safe to use scoped registries
 * const registry = new CustomElementRegistry();
 * ```
 *
 * @public
 */
export async function ensureScopedRegistrySupport(): Promise<void> {
    // Check native support first
    if (supportsScopedRegistries()) {
        return;
    }

    const scope = globalThis as typeof globalThis & {
        __scopedRegistryPolyfillApplied?: boolean;
        __scopedRegistryPolyfillPromise?: Promise<void>;
    };

    if (scope.__scopedRegistryPolyfillPromise) {
        return scope.__scopedRegistryPolyfillPromise;
    }

    scope.__scopedRegistryPolyfillPromise = import(
        "@webcomponents/scoped-custom-element-registry"
    )
        .then(() => {
            scope.__scopedRegistryPolyfillApplied = true;

            if (isDevMode()) {
                console.info("[fast-af] Scoped registry polyfill loaded successfully");
            }
        })
        .catch(e => {
            scope.__scopedRegistryPolyfillApplied = false;
            scope.__scopedRegistryPolyfillPromise = void 0;
            const error = new Error("[fast-af] Failed to load scoped registry polyfill");
            (error as Error & { cause?: unknown }).cause = e;
            throw error;
        });

    return scope.__scopedRegistryPolyfillPromise;
}
