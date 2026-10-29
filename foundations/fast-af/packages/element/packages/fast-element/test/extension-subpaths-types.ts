import { FASTElement } from "@lushly-dev/fast-element";
import type { TrustEmitOptions } from "@lushly-dev/fast-element";
import {
    CommandRegistry,
    confirmDialogTagName,
    defineConfirmDialog,
} from "@lushly-dev/fast-element/command.js";
import type {
    CommandRegistryAPI,
    ComponentSchema,
    DefinitionJSONSchema,
    JSONSchema as CommandJSONSchema,
} from "@lushly-dev/fast-element/command.js";
import {
    disableDefinitionSchema,
    enableDefinitionSchema,
    toCustomElementsManifest,
} from "@lushly-dev/fast-element/definition-schema.js";
import type {
    CustomElementsManifest,
    ManifestDeclaration,
    ManifestModule,
} from "@lushly-dev/fast-element/definition-schema.js";
import { attributeMap } from "@lushly-dev/fast-element/attribute-map.js";
import { deepMerge } from "@lushly-dev/fast-element/declarative-utilities.js";
import { declarativeTemplate } from "@lushly-dev/fast-element/declarative.js";
import { enableHydration } from "@lushly-dev/fast-element/hydration.js";
import { observerMap } from "@lushly-dev/fast-element/observer-map.js";
import { Schema } from "@lushly-dev/fast-element/schema.js";
import { ScopedRegistryMixin } from "@lushly-dev/fast-element/scoped.js";

const registry: CommandRegistryAPI = CommandRegistry;
const commandSchema: CommandJSONSchema = { type: "object" };
const definitionSchema: DefinitionJSONSchema = { type: "object" };
const componentSchema = {} as ComponentSchema;
const trustOptions: TrustEmitOptions = { confidence: 1, reasoning: "verified" };
const manifest: CustomElementsManifest = toCustomElementsManifest();
const moduleEntry = {} as ManifestModule;
const declaration = {} as ManifestDeclaration;
const disable = enableDefinitionSchema();
const schema = new Schema("replacement-subpath-types");
const hydration = enableHydration();

class ScopedElement extends ScopedRegistryMixin(FASTElement) {}

void registry;
void commandSchema;
void definitionSchema;
void componentSchema;
void trustOptions;
void manifest;
void moduleEntry;
void declaration;
void attributeMap;
void confirmDialogTagName;
void declarativeTemplate;
void deepMerge;
void defineConfirmDialog;
void hydration;
void observerMap;
void schema;
void ScopedElement;
disable();
disableDefinitionSchema();
