import type { FASTElementDefinition } from "../components/fast-definitions.js";
import type { ElementStyles } from "../styles/element-styles.js";
import type { ElementViewTemplate } from "../templating/template.js";
import { getCommandMetadata } from "../command/command.js";
import type {
    CommandSchema,
    ComponentSchema,
    CSSPropertySchema,
    PropertySchema,
    PropertyType,
    SlotSchema,
} from "./types.js";

/**
 * Maps attribute mode to PropertyType.
 * @param mode - The attribute mode ('boolean', 'reflect', 'fromView').
 * @returns The corresponding PropertyType.
 */
function modeToPropertyType(mode: string): PropertyType {
    switch (mode) {
        case "boolean":
            return "boolean";
        default:
            return "string";
    }
}

/**
 * Extracts property schemas from a FASTElementDefinition's attributes.
 * @param definition - The FASTElementDefinition to extract properties from.
 * @returns An array of PropertySchema objects.
 */
export function extractProperties(definition: FASTElementDefinition): PropertySchema[] {
    const properties: PropertySchema[] = [];
    const attributes = definition.attributes;

    for (const attr of attributes) {
        const property: PropertySchema = {
            name: attr.name,
            type: modeToPropertyType(attr.mode),
            attribute: attr.attribute,
        };

        properties.push(property);
    }

    return properties;
}

/**
 * Extracts slot schemas from a template.
 * Returns empty array in SSR environments where document is undefined.
 * @param template - The ElementViewTemplate to extract slots from.
 * @returns An array of SlotSchema objects.
 */
export function extractSlots(template: ElementViewTemplate | undefined): SlotSchema[] {
    // Guard: Return empty array in SSR environment
    if (typeof document === "undefined" || !template) {
        return [];
    }

    const slots: SlotSchema[] = [];

    try {
        // Create a temporary host element to extract template content
        const tempHost = document.createElement("div");
        const view = template.create(tempHost);
        view.appendTo(tempHost);

        for (const slotElement of Array.from(tempHost.querySelectorAll("slot"))) {
            const name = slotElement.getAttribute("name") ?? "";
            const description = slotElement.getAttribute("data-description") ?? undefined;

            slots.push({
                name,
                description,
            });
        }

        view.dispose();
    } catch {
        // If template extraction fails, return empty array
        return [];
    }

    return slots;
}

/**
 * Regex pattern to match CSS custom properties.
 * Matches: --property-name: value;
 */
const cssPropertyRegex = /(--[\w-]+):\s*([^;]+)/g;

/**
 * Extracts CSS custom property schemas from styles.
 * Uses naive regex extraction (v1); will upgrade to CSSTree in v2.
 * @param styles - The ElementStyles to extract CSS properties from.
 * @returns An array of CSSPropertySchema objects.
 */
export function extractCSSProperties(
    styles: ElementStyles | undefined,
): CSSPropertySchema[] {
    if (!styles) {
        return [];
    }

    const cssProperties: CSSPropertySchema[] = [];
    const seenProperties = new Set<string>();

    for (const style of styles.styles) {
        let cssText: string | undefined;

        if (typeof style === "string") {
            cssText = style;
        } else if (
            typeof CSSStyleSheet !== "undefined" &&
            style instanceof CSSStyleSheet
        ) {
            // Extract text from CSSStyleSheet rules
            try {
                const rules = style.cssRules;
                const textParts: string[] = [];
                for (let i = 0; i < rules.length; i++) {
                    textParts.push(rules[i].cssText);
                }
                cssText = textParts.join("\n");
            } catch {
                // CSSStyleSheet may not be accessible in some environments
                continue;
            }
        }

        if (cssText) {
            let match: RegExpExecArray | null;
            // Reset regex lastIndex for each new string
            cssPropertyRegex.lastIndex = 0;

            while ((match = cssPropertyRegex.exec(cssText)) !== null) {
                const name = match[1];
                const defaultValue = match[2].trim();

                // Avoid duplicates
                if (!seenProperties.has(name)) {
                    seenProperties.add(name);
                    cssProperties.push({
                        name,
                        default: defaultValue,
                    });
                }
            }
        }
    }

    return cssProperties;
}

/**
 * Extracts command schemas from a component class via `command` metadata.
 * @param type - The class constructor to extract commands from.
 * @returns An array of CommandSchema objects.
 */
export function extractCommands(type: Function): CommandSchema[] {
    const metadata = getCommandMetadata(type);

    return metadata.map(meta => ({
        id: meta.id,
        methodName: meta.methodName,
        label: meta.label,
        icon: meta.icon,
        description: meta.description,
        category: meta.category,
        keybinding: meta.keybinding,
        parameters: meta.parameters,
        when: meta.when,
        hidden: meta.hidden,
    }));
}

/**
 * Builds a complete ComponentSchema from a FASTElementDefinition.
 * Combines property, slot, CSS property, and command extraction.
 * @param definition - The FASTElementDefinition to build a schema from.
 * @param type - The class constructor for the component.
 * @returns A complete ComponentSchema object.
 */
export function buildSchema(
    definition: FASTElementDefinition,
    type: Function,
): ComponentSchema {
    const properties = extractProperties(definition);
    const slots = extractSlots(definition.template);
    const cssProperties = extractCSSProperties(definition.styles);
    const commands = extractCommands(type);

    return {
        name: definition.name,
        version: undefined, // Phase 2: Extract from decorator or package.json
        description: undefined, // Phase 2: Extract from JSDoc
        properties,
        events: [], // Phase 2: Extract from JSDoc or decorator
        slots,
        cssProperties,
        commands,
    };
}
