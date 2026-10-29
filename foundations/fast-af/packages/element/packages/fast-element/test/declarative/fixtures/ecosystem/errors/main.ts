import { enableDebug } from "@lushly-dev/fast-element/debug.js";
import { declarativeTemplate } from "@lushly-dev/fast-element/declarative.js";
import { FASTElement } from "@lushly-dev/fast-element/fast-element.js";

enableDebug();

class TestElementNoTemplate extends FASTElement {}
TestElementNoTemplate.define({
    name: "test-element-no-template",
    template: declarativeTemplate(),
});

class TestElementMultipleTemplates extends FASTElement {}
TestElementMultipleTemplates.define({
    name: "test-element-multiple-templates",
    template: declarativeTemplate(),
});
