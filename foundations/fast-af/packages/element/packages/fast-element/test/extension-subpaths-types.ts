import type { ScopedShadowRootInit } from "@lushly-dev/fast-element/scoped.js";
import {
    disableDefinitionSchema,
    enableDefinitionSchema,
} from "@lushly-dev/fast-element/definition-schema.js";
import type {
    ComponentSchema,
    SchemaDiff,
} from "@lushly-dev/fast-element/definition-schema.js";
import { attributeMap } from "@lushly-dev/fast-element/attribute-map.js";
import { deepMerge } from "@lushly-dev/fast-element/declarative-utilities.js";
import { declarativeTemplate } from "@lushly-dev/fast-element/declarative.js";
import { enableHydration } from "@lushly-dev/fast-element/hydration.js";
import { observerMap } from "@lushly-dev/fast-element/observer-map.js";
import { Schema } from "@lushly-dev/fast-element/schema.js";
import { ensureScopedRegistrySupport } from "@lushly-dev/fast-element/scoped.js";

const componentSchema = {} as ComponentSchema;
const schemaDiff = {} as SchemaDiff;
const shadowOptions: ScopedShadowRootInit = {
    mode: "open",
    customElementRegistry: new CustomElementRegistry(),
};
const disable = enableDefinitionSchema();
const schema = new Schema("replacement-subpath-types");
const hydration = enableHydration();
const scopedSupport: Promise<void> = ensureScopedRegistrySupport();

void componentSchema;
void schemaDiff;
void shadowOptions;
void attributeMap;
void declarativeTemplate;
void deepMerge;
void hydration;
void observerMap;
void schema;
void scopedSupport;
disable();
disableDefinitionSchema();
