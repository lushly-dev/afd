import type { ComponentSchema } from "./types.js";

/**
 * Schema storage: WeakMap keyed by class.
 * Uses WeakMap to allow garbage collection when classes are no longer referenced.
 */
const schemaMap = new WeakMap<Function, ComponentSchema>();

/**
 * Tag-to-class mapping per registry.
 * Enables lookup of component class by tag name within a specific registry.
 */
const registryTagMap = new WeakMap<CustomElementRegistry, Map<string, Function>>();

/**
 * Stores a component schema associated with its class constructor.
 * @param cls - The class constructor for the component.
 * @param schema - The component schema to store.
 */
export function storeSchema(cls: Function, schema: ComponentSchema): void {
    schemaMap.set(cls, schema);
}

/**
 * Retrieves a component schema by its class constructor.
 * @param cls - The class constructor to look up.
 * @returns The component schema if found, undefined otherwise.
 */
export function getSchemaByClass(cls: Function): ComponentSchema | undefined {
    return schemaMap.get(cls);
}

/**
 * Registers a tag name to class mapping within a registry.
 * @param name - The custom element tag name.
 * @param cls - The class constructor for the component.
 * @param registry - The custom element registry (defaults to global customElements).
 */
export function registerTag(
    name: string,
    cls: Function,
    registry: CustomElementRegistry = customElements,
): void {
    if (!registryTagMap.has(registry)) {
        registryTagMap.set(registry, new Map());
    }
    registryTagMap.get(registry)!.set(name, cls);
}

/**
 * Retrieves a class constructor by its tag name within a registry.
 * @param name - The custom element tag name to look up.
 * @param registry - The custom element registry (defaults to global customElements).
 * @returns The class constructor if found, undefined otherwise.
 */
export function getClassByTag(
    name: string,
    registry: CustomElementRegistry = customElements,
): Function | undefined {
    return registryTagMap.get(registry)?.get(name);
}

/**
 * Gets the tag map for a specific registry.
 * Used internally by getAllSchemas to iterate over registered tags.
 * @param registry - The custom element registry.
 * @returns The Map of tag names to classes, or undefined if no tags registered.
 * @internal
 */
export function getRegistryTagMap(
    registry: CustomElementRegistry = customElements,
): Map<string, Function> | undefined {
    return registryTagMap.get(registry);
}
