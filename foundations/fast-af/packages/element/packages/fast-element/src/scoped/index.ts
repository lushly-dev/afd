/**
 * Scoped Custom Element Registries support for FAST-AF.
 *
 * @remarks
 * This module provides utilities for working with Scoped Custom Element Registries,
 * enabling isolated component definitions within shadow roots. This solves namespace
 * collisions for micro-frontends and design system versioning.
 *
 * @example Using ScopedRegistryMixin (recommended)
 * ```typescript
 * import { FASTElement, html } from '@lushly-dev/fast-element';
 * import { ScopedRegistryMixin } from '@lushly-dev/fast-element/scoped.js';
 *
 * class MyButton extends HTMLElement {}
 *
 * class MyCard extends ScopedRegistryMixin(FASTElement) {
 *   static elementDefinitions = {
 *     'my-button': MyButton,
 *   };
 * }
 *
 * // The shadow root gets the scoped registry, so <my-button> is upgraded without
 * // being defined globally.
 * await FASTElement.define(MyCard, {
 *   name: 'my-card',
 *   template: html`<my-button>Click me</my-button>`,
 *   shadowOptions: MyCard.getShadowOptions(),
 * });
 * ```
 *
 * @example Using createRegistry directly
 * ```typescript
 * import {
 *   createRegistry,
 *   createRegistryAsync,
 *   supportsScopedRegistries,
 *   ensureScopedRegistrySupport,
 * } from '@lushly-dev/fast-element/scoped.js';
 *
 * class MyButton extends HTMLElement {}
 * class MyInput extends HTMLElement {}
 *
 * // Check support
 * if (supportsScopedRegistries()) {
 *   const registry = createRegistry([
 *     [MyButton, 'my-button'],
 *     [MyInput, 'my-input'],
 *   ]);
 *
 *   element.attachShadow({
 *     mode: 'open',
 *     customElementRegistry: registry,
 *   });
 * }
 *
 * // Or use async version with automatic polyfill
 * const registry = await createRegistryAsync([
 *   [MyButton, 'my-button'],
 * ]);
 * ```
 *
 * @packageDocumentation
 */

// Types
export type {
    ScopedShadowRootInit,
    ElementDefinition,
    CreateRegistryOptions,
} from "./types.js";

// Detection
export { supportsScopedRegistries, ensureScopedRegistrySupport } from "./detection.js";

// Registry Builder
export { createRegistry, createRegistryAsync } from "./registry.js";

// Mixin
export { ScopedRegistryMixin } from "./mixin.js";
export type {
    ElementDefinitionMap,
    ScopedRegistryHost,
    ScopedRegistryHostConstructor,
} from "./mixin.js";
