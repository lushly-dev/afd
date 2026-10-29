import { getClassByTag, getRegistryTagMap, getSchemaByClass } from "./storage.js";
import type { ComponentSchema, SchemaDiff } from "./types.js";

/**
 * Retrieves the schema for a custom element by its tag name.
 * @param name - The custom element tag name.
 * @param registry - The custom element registry (defaults to global customElements).
 * @returns The component schema if found, undefined otherwise.
 * @public
 */
export function getSchema(
    name: string,
    registry: CustomElementRegistry = customElements,
): ComponentSchema | undefined {
    const cls = getClassByTag(name, registry);
    if (!cls) return undefined;
    const schema = getSchemaByClass(cls);
    if (!schema) return undefined;
    // Clone with actual tag name (may differ per registration)
    return { ...schema, name };
}

/**
 * Retrieves the schema for a custom element by its tag name, throwing if not found.
 * @param name - The custom element tag name.
 * @param registry - The custom element registry (defaults to global customElements).
 * @returns The component schema.
 * @throws TypeError if no schema is found for the element.
 * @public
 */
export function getSchemaOrThrow(
    name: string,
    registry: CustomElementRegistry = customElements,
): ComponentSchema {
    const schema = getSchema(name, registry);
    if (!schema) {
        throw new TypeError(`No schema found for element: ${name}`);
    }
    return schema;
}

/**
 * Retrieves the schema for a FASTElement class directly.
 * @param cls - The FASTElement class constructor.
 * @returns The component schema.
 * @throws TypeError if the class is not a registered FASTElement.
 * @public
 */
export function getComponentSchema(cls: Function): ComponentSchema {
    const schema = getSchemaByClass(cls);
    if (!schema) {
        throw new TypeError(`Class is not a registered FASTElement`);
    }
    return schema;
}

/**
 * Retrieves all registered component schemas for a given registry.
 * @param registry - The custom element registry (defaults to global customElements).
 * @returns A Map of tag names to component schemas.
 * @public
 */
export function getAllSchemas(
    registry: CustomElementRegistry = customElements,
): Map<string, ComponentSchema> {
    const result = new Map<string, ComponentSchema>();
    const tagMap = getRegistryTagMap(registry);

    if (tagMap) {
        for (const [name, cls] of tagMap) {
            const schema = getSchemaByClass(cls);
            if (schema) {
                result.set(name, { ...schema, name });
            }
        }
    }

    return result;
}

/**
 * Compares two component schemas and returns the differences.
 * Used to detect breaking changes between versions.
 * @param a - The original schema (before).
 * @param b - The new schema (after).
 * @returns A SchemaDiff object describing the changes.
 * @public
 */
export function diffSchemas(a: ComponentSchema, b: ComponentSchema): SchemaDiff {
    const added: SchemaDiff["added"] = { properties: [], events: [], slots: [] };
    const removed: SchemaDiff["removed"] = { properties: [], events: [], slots: [] };
    const changed: SchemaDiff["changed"] = { properties: [], events: [] };

    // Compare properties by name
    const aProps = new Map(a.properties.map(p => [p.name, p]));
    const bProps = new Map(b.properties.map(p => [p.name, p]));

    for (const [name, prop] of bProps) {
        if (!aProps.has(name)) {
            added.properties.push(prop);
        } else if (JSON.stringify(aProps.get(name)) !== JSON.stringify(prop)) {
            changed.properties.push({ before: aProps.get(name)!, after: prop });
        }
    }

    for (const [name, prop] of aProps) {
        if (!bProps.has(name)) {
            removed.properties.push(prop);
        }
    }

    // Compare events by name
    const aEvents = new Map(a.events.map(e => [e.name, e]));
    const bEvents = new Map(b.events.map(e => [e.name, e]));

    for (const [name, event] of bEvents) {
        if (!aEvents.has(name)) {
            added.events.push(event);
        } else if (JSON.stringify(aEvents.get(name)) !== JSON.stringify(event)) {
            changed.events.push({ before: aEvents.get(name)!, after: event });
        }
    }

    for (const [name, event] of aEvents) {
        if (!bEvents.has(name)) {
            removed.events.push(event);
        }
    }

    // Compare slots by name
    const aSlots = new Map(a.slots.map(s => [s.name, s]));
    const bSlots = new Map(b.slots.map(s => [s.name, s]));

    for (const [name, slot] of bSlots) {
        if (!aSlots.has(name)) {
            added.slots.push(slot);
        }
    }

    for (const [name, slot] of aSlots) {
        if (!bSlots.has(name)) {
            removed.slots.push(slot);
        }
    }

    // Breaking changes: removed properties/events, or changed properties
    const breaking =
        removed.properties.length > 0 ||
        removed.events.length > 0 ||
        changed.properties.length > 0;

    return { added, removed, changed, breaking };
}
