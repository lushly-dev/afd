import { expect, test } from "@playwright/test";

test.describe("Agent Definition Schema", () => {
    test("extracts properties, slots, CSS properties, and CEM data", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module.
            const api = await import("/main.js");
            const {
                ElementStyles,
                FASTElement,
                attr,
                disableDefinitionSchema,
                enableDefinitionSchema,
                getComponentSchema,
                getSchema,
                html,
                toCustomElementsManifest,
                toPascalCase,
                uniqueElementName,
            } = api;

            disableDefinitionSchema();
            const disable = enableDefinitionSchema();

            class SchemaElement extends FASTElement {}

            attr(SchemaElement.prototype, "label");
            attr({ mode: "boolean" })(SchemaElement.prototype, "disabled");

            const name = uniqueElementName();
            await SchemaElement.define({
                name,
                template: html`
                    <slot></slot>
                    <slot name="header" data-description="Header area"></slot>
                `,
                styles: new ElementStyles([
                    ":host { --schema-color: blue; --schema-size: 16px; }",
                ]),
            });

            const schema = getSchema(name);
            const directSchema = getComponentSchema(SchemaElement);
            const manifest = toCustomElementsManifest();
            const declaration = manifest.modules.find(
                (module: any) => module.path === `${name}.js`,
            )?.declarations[0];

            disable();

            return {
                schema,
                sameStoredSchema: directSchema.name === schema?.name,
                declaration,
                expectedClassName: toPascalCase(name),
            };
        });

        expect(result.schema?.properties).toEqual([
            { attribute: "label", name: "label", type: "string" },
            { attribute: "disabled", name: "disabled", type: "boolean" },
        ]);
        expect(result.schema?.slots).toEqual([
            { name: "" },
            { description: "Header area", name: "header" },
        ]);
        expect(result.schema?.cssProperties).toEqual([
            { default: "blue", name: "--schema-color" },
            { default: "16px", name: "--schema-size" },
        ]);
        expect(result.sameStoredSchema).toBe(true);
        expect(result.declaration.name).toBe(result.expectedClassName);
        expect(result.declaration.members).toHaveLength(2);
        expect(result.declaration.slots).toHaveLength(2);
        expect(result.declaration.cssProperties).toHaveLength(2);
    });

    test("refreshes schema after an async template resolver completes", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module.
            const {
                FASTElement,
                disableDefinitionSchema,
                enableDefinitionSchema,
                getSchema,
                html,
                uniqueElementName,
            } = await import("/main.js");

            disableDefinitionSchema();
            const disable = enableDefinitionSchema();

            class AsyncSchemaElement extends FASTElement {}

            const name = uniqueElementName();
            await AsyncSchemaElement.define({
                name,
                template: async () => html`<slot name="resolved"></slot>`,
            });

            const schema = getSchema(name);
            disable();
            return schema;
        });

        expect(result?.slots).toEqual([{ name: "resolved" }]);
    });

    test("tracks tag mappings independently per custom element registry", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module.
            const {
                FASTElement,
                definitionSchemaExtension,
                getAllSchemas,
                getSchema,
                uniqueElementName,
            } = await import("/main.js");

            const definitions = new Map<string, CustomElementConstructor>();
            const registry = {
                define(name: string, type: CustomElementConstructor) {
                    definitions.set(name, type);
                },
                get(name: string) {
                    return definitions.get(name);
                },
            } as CustomElementRegistry;

            class RegistrySchemaElement extends FASTElement {}

            const name = uniqueElementName();
            await RegistrySchemaElement.define({ name, registry }, [
                definitionSchemaExtension,
            ]);

            return {
                customHasSchema: getSchema(name, registry) !== undefined,
                globalHasSchema: getSchema(name) !== undefined,
                customSchemaCount: getAllSchemas(registry).size,
            };
        });

        expect(result).toEqual({
            customHasSchema: true,
            globalHasSchema: false,
            customSchemaCount: 1,
        });
    });

    test("reports additive and breaking schema changes", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module.
            const { diffSchemas } = await import("/main.js");
            const before = {
                name: "diff-element",
                properties: [
                    { name: "stable", type: "string" },
                    { name: "removed", type: "boolean" },
                ],
                events: [{ name: "change" }],
                slots: [{ name: "" }],
                cssProperties: [],
            };
            const after = {
                ...before,
                properties: [
                    { name: "stable", type: "number" },
                    { name: "added", type: "string" },
                ],
                events: [],
                slots: [{ name: "" }, { name: "header" }],
            };

            return diffSchemas(before as any, after as any);
        });

        expect(result.breaking).toBe(true);
        expect(result.added.properties.map(item => item.name)).toEqual(["added"]);
        expect(result.added.slots.map(item => item.name)).toEqual(["header"]);
        expect(result.removed.properties.map(item => item.name)).toEqual(["removed"]);
        expect(result.removed.events.map(item => item.name)).toEqual(["change"]);
        expect(result.changed.properties).toHaveLength(1);
    });

    test("fails explicitly for unknown tags and classes", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module.
            const { getComponentSchema, getSchemaOrThrow } = await import("/main.js");

            let tagError = "";
            let classError = "";

            try {
                getSchemaOrThrow("missing-definition-schema");
            } catch (error) {
                tagError = (error as Error).message;
            }

            try {
                getComponentSchema(class UnknownElement {});
            } catch (error) {
                classError = (error as Error).message;
            }

            return { classError, tagError };
        });

        expect(result.tagError).toContain("No schema found");
        expect(result.classError).toContain("not a registered FASTElement");
    });
});
