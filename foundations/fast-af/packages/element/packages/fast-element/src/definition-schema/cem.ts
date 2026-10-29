import type { ComponentSchema } from "./types.js";
import { getRegistryTagMap, getSchemaByClass } from "./storage.js";

/**
 * Custom Elements Manifest 2.1.0 root structure.
 * @public
 */
export interface CustomElementsManifest {
    schemaVersion: "2.1.0";
    modules: ManifestModule[];
}

/**
 * A JavaScript module containing custom element declarations.
 * @public
 */
export interface ManifestModule {
    kind: "javascript-module";
    path: string;
    declarations: ManifestDeclaration[];
}

/**
 * A custom element class declaration.
 * @public
 */
export interface ManifestDeclaration {
    kind: "class";
    customElement: true;
    name: string;
    tagName: string;
    description?: string;
    members: Array<{ kind: "field"; name: string; type: { text: string } }>;
    events: Array<{ name: string; type: { text: string } }>;
    slots: Array<{ name: string; description?: string }>;
    cssProperties: Array<{ name: string; default?: string }>;
}

/**
 * Converts a kebab-case string to PascalCase.
 * @param str - The kebab-case string to convert.
 * @returns The PascalCase version of the string.
 * @example
 * toPascalCase('my-button') // 'MyButton'
 * toPascalCase('my-cool-element') // 'MyCoolElement'
 * @public
 */
export function toPascalCase(str: string): string {
    return str
        .split("-")
        .map(s => s.charAt(0).toUpperCase() + s.slice(1))
        .join("");
}

/**
 * Converts a ComponentSchema to a ManifestDeclaration.
 * @param name - The tag name of the component.
 * @param schema - The component schema to convert.
 * @returns The manifest declaration.
 */
function toManifestDeclaration(
    name: string,
    schema: ComponentSchema,
): ManifestDeclaration {
    const declaration: ManifestDeclaration = {
        kind: "class",
        customElement: true,
        name: toPascalCase(name),
        tagName: name,
        members: schema.properties.map(p => ({
            kind: "field" as const,
            name: p.name,
            type: { text: p.type },
        })),
        events: schema.events.map(e => ({
            name: e.name,
            type: { text: "CustomEvent" },
        })),
        slots: schema.slots.map(s => ({
            name: s.name,
            description: s.description,
        })),
        cssProperties: schema.cssProperties.map(c => ({
            name: c.name,
            default: c.default,
        })),
    };

    if (schema.description) {
        declaration.description = schema.description;
    }

    return declaration;
}

/**
 * Generates a Custom Elements Manifest (CEM 2.1.0) from registered schemas.
 *
 * @param registry - The custom element registry to export from (defaults to global customElements).
 * @returns A Custom Elements Manifest object conforming to CEM 2.1.0 schema.
 *
 * @remarks
 * The manifest groups each component into its own module with a synthesized path
 * based on the tag name (e.g., `my-button.js`). This is suitable for documentation
 * and tooling purposes but may not reflect actual file paths.
 *
 * @example
 * ```typescript
 * const manifest = toCustomElementsManifest();
 * console.log(JSON.stringify(manifest, null, 2));
 * ```
 * @public
 */
export function toCustomElementsManifest(
    registry?: CustomElementRegistry,
): CustomElementsManifest {
    const tagMap = getRegistryTagMap(registry);
    const modules: ManifestModule[] = [];

    if (tagMap) {
        for (const [name, cls] of tagMap) {
            const schema = getSchemaByClass(cls);
            if (schema) {
                modules.push({
                    kind: "javascript-module",
                    path: `${name}.js`,
                    declarations: [toManifestDeclaration(name, schema)],
                });
            }
        }
    }

    return {
        schemaVersion: "2.1.0",
        modules,
    };
}
