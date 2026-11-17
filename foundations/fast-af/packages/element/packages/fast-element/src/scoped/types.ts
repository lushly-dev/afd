/**
 * Type definitions for Scoped Custom Element Registries.
 */

/**
 * Extended ShadowRootInit with registry support.
 *
 * @remarks
 * Extends the standard ShadowRootInit to support scoped custom element registries.
 * The `customElementRegistry` property is the native spec key (Safari 26+, Chrome 133+ OT).
 * The `registry` property is deprecated and will be removed in a future version.
 *
 * @public
 */
export interface ScopedShadowRootInit extends ShadowRootInit {
    /** @deprecated Use customElementRegistry instead */
    registry?: CustomElementRegistry;
    /** Native spec key - preferred (Safari 26+, Chrome 133+ Origin Trial) */
    customElementRegistry?: CustomElementRegistry;
}
