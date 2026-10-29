/**
 * Public API for the Definition Schema system.
 * Enables AI agents to query component capabilities via JSON introspection.
 */

// Re-export all types
export type {
    PropertyType,
    ComponentSchema,
    PropertySchema,
    AriaHint,
    EventSchema,
    SlotSchema,
    CSSPropertySchema,
    CommandSchema,
    SchemaDiff,
    JSONSchema,
} from "./types.js";
export type {
    CustomElementsManifest,
    ManifestDeclaration,
    ManifestModule,
} from "./cem.js";

// Re-export all API functions
export {
    getSchema,
    getSchemaOrThrow,
    getComponentSchema,
    getAllSchemas,
    diffSchemas,
} from "./api.js";

export { toCustomElementsManifest, toPascalCase } from "./cem.js";

export { disableDefinitionSchema, enableDefinitionSchema } from "./extension.js";
