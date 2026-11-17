/**
 * Scoped Custom Element Registries support for FAST-AF.
 *
 * @remarks
 * FAST renders a host's template against the registry its shadow root was given,
 * so a component whose `shadowOptions` carry a `customElementRegistry` creates its
 * template's children in that registry, not the global one. Build the registry with
 * the browser's own API (`new CustomElementRegistry()` and `define`); this module
 * only checks for support and loads the polyfill where the browser lacks it.
 *
 * A server-rendered host must declare its shadow root with
 * `<template shadowrootmode="open" shadowrootcustomelementregistry>`. The browser
 * then leaves the root without a registry, and the host gives it the scoped one
 * when it upgrades, which upgrades the server-rendered children and scopes every
 * view hydrated or created in it later. A declarative shadow root without that
 * attribute is bound to the global registry: its children, and every view created
 * in it later, stay global.
 *
 * A FASTElement child must be composed first and defined in the scoped registry
 * through its definition (`definition.define(registry)`), so the registry reuses
 * its FAST definition; creating an element of an undefined FASTElement class
 * throws FAST error 1401.
 *
 * @example
 * ```typescript
 * import { FASTElement, FASTElementDefinition, html } from '@lushly-dev/fast-element';
 * import { ensureScopedRegistrySupport } from '@lushly-dev/fast-element/scoped.js';
 *
 * await ensureScopedRegistrySupport();
 *
 * class MyButton extends FASTElement {}
 * class MyCard extends FASTElement {}
 *
 * const registry = new CustomElementRegistry();
 * (await FASTElementDefinition.compose(MyButton, { name: 'my-button' })).define(registry);
 *
 * // <my-button> is created against the card's registry and is not defined globally.
 * await MyCard.define({
 *   name: 'my-card',
 *   template: html`<my-button>Click me</my-button>`,
 *   shadowOptions: { mode: 'open', customElementRegistry: registry },
 * });
 * ```
 *
 * @packageDocumentation
 */

// Types
export type { ScopedShadowRootInit } from "./types.js";

// Detection
export { supportsScopedRegistries, ensureScopedRegistrySupport } from "./detection.js";
