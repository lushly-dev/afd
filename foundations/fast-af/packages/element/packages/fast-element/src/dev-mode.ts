import { getDebugMessageLookup } from "./platform.js";

/**
 * Build-time switch for development-only diagnostics. A bundler can define it
 * (`DEV_MODE=true|false`); it is not defined by FAST's own builds.
 * @internal
 */
declare const DEV_MODE: boolean | undefined;

/**
 * Whether development-only diagnostics (warnings, `console.debug`) are enabled.
 *
 * @remarks
 * An explicit `DEV_MODE` define always wins. Without one, diagnostics follow FAST's
 * own dev/prod distinction: they are on once `enableDebug()` has loaded the debug
 * messages (the debug entry point) and off in the production entry point, so they do
 * not ship to production by default. It is a function because `enableDebug()` may run
 * after this module is evaluated.
 *
 * @internal
 */
export function isDevMode(): boolean {
    if (typeof DEV_MODE !== "undefined") {
        return DEV_MODE;
    }

    for (const _ in getDebugMessageLookup()) {
        return true;
    }

    return false;
}
