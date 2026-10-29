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

/**
 * Element definition tuple: [Constructor, tag-name]
 *
 * @remarks
 * Used with createRegistry() to define elements in a scoped registry.
 *
 * @example
 * ```typescript
 * const definitions: ElementDefinition[] = [
 *   [MyButton, 'my-button'],
 *   [MyInput, 'my-input'],
 * ];
 * ```
 *
 * @public
 */
export type ElementDefinition = [CustomElementConstructor, string];

/**
 * Options for createRegistry helper.
 *
 * @public
 */
export interface CreateRegistryOptions {
    /**
     * If true, throw when unsupported instead of falling back to global registry.
     * Default: false (uses global registry fallback)
     */
    strict?: boolean;
}
