// This fixture imports via bare `@lushly-dev/fast-element/*` specifiers so it
// resolves to the built package (dist), exercising the public `exports` map as
// a consumer would. The source entries (main.ts, declarative-main.ts) resolve to
// src instead, so importing the same singleton-bearing module (such as
// Schema/schemaRegistry, ArrayObserver, or the observable engine) from both
// sides loads two copies and breaks identity and enable() state. Import any such
// shared symbol from one side only.
export { ArrayObserver } from "@lushly-dev/fast-element/arrays.js";
export {
    CommandRegistry,
    command,
    failure,
    isFailure,
    isSuccess,
    success,
} from "@lushly-dev/fast-element/command.js";
export {
    AttributeMap,
    attributeMap,
} from "@lushly-dev/fast-element/attribute-map.js";
export {
    ObserverMap,
    observerMap,
} from "@lushly-dev/fast-element/observer-map.js";
export {
    FASTElementDefinition,
    fastElementRegistry,
} from "@lushly-dev/fast-element/registry.js";
export { Schema } from "@lushly-dev/fast-element/schema.js";
export {
    createRegistry,
    createRegistryAsync,
    ensureScopedRegistrySupport,
    ScopedRegistryMixin,
    supportsScopedRegistries,
} from "@lushly-dev/fast-element/scoped.js";
export {
    diffSchemas,
    disableDefinitionSchema,
    enableDefinitionSchema,
    getAllSchemas,
    getComponentSchema,
    getSchema,
    getSchemaOrThrow,
    toCustomElementsManifest,
    toPascalCase,
} from "@lushly-dev/fast-element/definition-schema.js";
export {
    getTrustSignals,
    hasTrustSignals,
    TRUST_KEY,
} from "@lushly-dev/fast-element/trust.js";
