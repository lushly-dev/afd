/**
 * Component introspection commands for FAST elements.
 * Pure runtime introspection - no Creator dependencies.
 *
 * @remarks
 * These commands expose FAST component metadata to AI agents and command palettes.
 * Task 9 will add fast.component.getAPI to this file.
 */

import { CommandRegistry } from "./registry.js";
import { success, failure } from "./types.js";
import { createWeakReference } from "./weak-ref.js";
import { getAllSchemas, getSchema } from "../definition-schema/api.js";
import type { ComponentSchema } from "../definition-schema/types.js";

/**
 * Component list result item.
 * @public
 */
export interface ComponentInfo {
    /** The custom element tag name */
    name: string;
    /** The constructor function name */
    constructor: string;
    /** Whether the element is defined in the platform registry */
    isDefined: boolean;
}

/**
 * Component API result from fast.component.getAPI.
 * @public
 */
export interface ComponentAPIInfo {
    /** The custom element tag name */
    name: string;
    /** Properties exposed by the component */
    properties: ComponentSchema["properties"];
    /** Events emitted by the component */
    events: ComponentSchema["events"];
    /** Slots available in the component */
    slots: ComponentSchema["slots"];
    /** CSS custom properties (design tokens) */
    cssProperties: ComponentSchema["cssProperties"];
    /** Commands exposed by the component */
    commands?: ComponentSchema["commands"];
}

/**
 * Register fast.component.* commands with the CommandRegistry.
 * Called during fast-element initialization.
 *
 * @remarks
 * These commands provide runtime introspection of registered FAST elements.
 * They have no dependencies on Creator or design-to-code packages.
 *
 * @public
 */
export function registerComponentCommands(): void {
    // fast.component.list
    CommandRegistry.register("fast.component.list", {
        id: "fast.component.list",
        label: "List all registered FAST components",
        description:
            "Returns a list of all FAST elements registered with FASTElementDefinition, " +
            "including their tag names and constructor information.",
        category: "FAST",
        execute: async () => {
            if (typeof customElements === "undefined") {
                return success([]);
            }

            const components = Array.from(getAllSchemas(), ([name]) => {
                const elementClass = customElements.get(name);

                return {
                    name,
                    constructor: elementClass?.name ?? "Unknown",
                    isDefined: elementClass !== void 0,
                } satisfies ComponentInfo;
            });

            return success(components);
        },
        canExecute: true,
        when: true,
        expose: { palette: true, agent: true, mcp: true, cli: true },
        source:
            typeof document !== "undefined"
                ? createWeakReference(document.body)
                : createWeakReference({} as HTMLElement),
    });

    // fast.component.getAPI
    CommandRegistry.register("fast.component.getAPI", {
        id: "fast.component.getAPI",
        label: "Get component API schema",
        description:
            "Returns the full API schema for a FAST component including properties, events, slots, " +
            "and CSS custom properties. Data is extracted directly from ElementDefinition.",
        category: "FAST",
        execute: async (args: { name: string }) => {
            const { name } = args ?? {};

            if (!name) {
                return failure({
                    code: "INVALID_PARAMETERS",
                    message: "Component name is required",
                    suggestion:
                        "Provide a valid custom element tag name (e.g., 'fast-button')",
                    retryable: false,
                });
            }

            // Try to get the schema for this component
            const schema = getSchema(name);

            if (!schema) {
                return failure({
                    code: "NOT_FOUND",
                    message: `Component '${name}' not found in registry`,
                    suggestion:
                        "Ensure the component is registered and defined. Use fast.component.list to see available components.",
                    retryable: false,
                });
            }

            const apiInfo: ComponentAPIInfo = {
                name: schema.name,
                properties: schema.properties,
                events: schema.events,
                slots: schema.slots,
                cssProperties: schema.cssProperties,
                commands: schema.commands,
            };

            // confidence: 1.0 because data comes directly from ElementDefinition source
            return success(apiInfo, { confidence: 1.0 });
        },
        canExecute: true,
        when: true,
        expose: { palette: true, agent: true, mcp: true, cli: true },
        source:
            typeof document !== "undefined"
                ? createWeakReference(document.body)
                : createWeakReference({} as HTMLElement),
    });
}
