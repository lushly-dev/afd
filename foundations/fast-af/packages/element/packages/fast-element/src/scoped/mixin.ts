/**
 * ScopedRegistryMixin for FAST Elements.
 *
 * @remarks
 * Provides a mixin that enables components to define and use scoped registries,
 * following the Lit labs pattern. Child elements are isolated within the
 * component's shadow root.
 */

import { isDevMode } from "../dev-mode.js";
import { createRegistry } from "./registry.js";
import type { ElementDefinition, ScopedShadowRootInit } from "./types.js";

const initializedConstructors = new WeakSet<Function>();
const scopedRegistries = new WeakMap<Function, CustomElementRegistry | undefined>();

/**
 * Map of element definitions: tag-name to constructor.
 *
 * @remarks
 * Used with ScopedRegistryMixin to define child elements that should
 * be registered in the component's scoped registry.
 *
 * @example
 * ```typescript
 * static elementDefinitions: ElementDefinitionMap = {
 *   'my-button': MyButton,
 *   'my-input': MyInput,
 * };
 * ```
 *
 * @public
 */
export type ElementDefinitionMap = Record<string, CustomElementConstructor>;

/**
 * Interface for classes that host a scoped registry.
 *
 * @remarks
 * Implemented by classes using the ScopedRegistryMixin.
 *
 * @public
 */
export interface ScopedRegistryHost {
    /**
     * Static element definitions for the scoped registry.
     */
    elementDefinitions?: ElementDefinitionMap;

    /**
     * The scoped registry created from elementDefinitions.
     * @remarks
     * Lazily created on first access.
     */
    scopedRegistry: CustomElementRegistry | undefined;
}

/**
 * Static interface for ScopedRegistryMixin classes.
 * @public
 */
export interface ScopedRegistryHostConstructor {
    /**
     * Static element definitions for the scoped registry.
     */
    elementDefinitions?: ElementDefinitionMap;

    /**
     * The scoped registry created from elementDefinitions.
     */
    readonly scopedRegistry: CustomElementRegistry | undefined;

    /**
     * Gets shadow root options with the scoped registry configured.
     * @param baseOptions - Optional base shadow root options to extend
     * @returns Shadow root options with customElementRegistry if applicable
     */
    getShadowOptions(baseOptions?: ScopedShadowRootInit): ScopedShadowRootInit;
}

/**
 * Creates a mixin that enables scoped custom element registries for a FASTElement.
 *
 * @remarks
 * The ScopedRegistryMixin provides a way to define child elements that are
 * scoped to the component's shadow root, preventing namespace collisions
 * in micro-frontend scenarios and enabling design system versioning.
 *
 * The mixin adds:
 * - A static `elementDefinitions` property for defining child elements
 * - A static `scopedRegistry` getter that lazily creates the registry
 * - A method to get shadow root options with the scoped registry
 *
 * When scoped registries are not supported by the browser, elements fall back
 * to the global registry with a development warning.
 *
 * @param Base - The FASTElement base class to extend
 * @returns A class that supports scoped element definitions
 *
 * @example
 * ```typescript
 * import { FASTElement, html, css } from '@lushly-dev/fast-element';
 * import { ScopedRegistryMixin } from '@lushly-dev/fast-element/scoped.js';
 *
 * // Children can be plain custom elements. FASTElement children must be composed
 * // first (FASTElementDefinition.compose(MyIcon, { name: 'my-icon' })) so the
 * // registry can reuse their FAST definition; creating an element of an
 * // undefined FASTElement class throws FAST error 1401.
 * class MyButton extends HTMLElement {
 *   // Button implementation
 * }
 *
 * class MyCard extends ScopedRegistryMixin(FASTElement) {
 *   static elementDefinitions = {
 *     'my-button': MyButton,
 *   };
 * }
 *
 * // Attach the scoped registry to the shadow root through getShadowOptions().
 * // The template's <my-button> is created against it and does not need to be
 * // (and here is not) defined in the global registry.
 * await FASTElement.define(MyCard, {
 *   name: 'my-card',
 *   template: html`<my-button>Click me</my-button>`,
 *   shadowOptions: MyCard.getShadowOptions(),
 * });
 * ```
 *
 * @public
 */
export function ScopedRegistryMixin<T extends CustomElementConstructor>(
    Base: T,
): T & ScopedRegistryHostConstructor {
    return class ScopedRegistryMixinClass extends Base {
        /**
         * Map of tag names to custom element constructors.
         * @remarks
         * Define this in subclasses to specify child elements for the scoped registry.
         */
        static elementDefinitions?: ElementDefinitionMap;

        /**
         * Gets the scoped registry for this element class.
         * @remarks
         * Lazily creates the registry from elementDefinitions on first access.
         * Returns undefined if no definitions exist or if scoped registries
         * are not supported (fallback to global).
         */
        static get scopedRegistry(): CustomElementRegistry | undefined {
            if (!initializedConstructors.has(this)) {
                initializedConstructors.add(this);

                if (this.elementDefinitions) {
                    const keys = Object.keys(this.elementDefinitions);

                    if (keys.length > 0) {
                        // Convert { 'tag-name': Ctor } to [Ctor, 'tag-name'] format
                        const elementDefs: ElementDefinition[] = [];
                        for (let i = 0, len = keys.length; i < len; i++) {
                            const tagName = keys[i];
                            const ctor = this.elementDefinitions[tagName];
                            elementDefs.push([ctor, tagName]);
                        }

                        const registry = createRegistry(elementDefs);
                        scopedRegistries.set(this, registry);

                        if (isDevMode() && registry) {
                            console.debug(
                                "[fast-af] Created scoped registry for " +
                                    this.name +
                                    " with " +
                                    keys.length +
                                    " element(s)",
                            );
                        }
                    }
                }
            }

            return scopedRegistries.get(this);
        }

        /**
         * Gets shadow root options with the scoped registry configured.
         * @remarks
         * Use this method when defining the element to include the scoped registry.
         * Returns options with customElementRegistry set if a registry was created.
         *
         * @param baseOptions - Optional base shadow root options to extend
         * @returns Shadow root options with customElementRegistry if applicable
         *
         * @example
         * ```typescript
         * await FASTElement.define(MyComponent, {
         *   name: 'my-component',
         *   template: myTemplate,
         *   shadowOptions: MyComponent.getShadowOptions({ mode: 'closed' }),
         * });
         * ```
         */
        static getShadowOptions(
            baseOptions?: ScopedShadowRootInit,
        ): ScopedShadowRootInit {
            const registry = this.scopedRegistry;
            const options: ScopedShadowRootInit = {
                mode: "open",
                ...baseOptions,
            };

            if (registry) {
                options.customElementRegistry = registry;
                options.registry = registry;
            }

            return options;
        }
    } as T & ScopedRegistryHostConstructor;
}
