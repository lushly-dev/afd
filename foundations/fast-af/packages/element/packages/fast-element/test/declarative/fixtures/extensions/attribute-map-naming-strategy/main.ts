import { attributeMap } from "@lushly-dev/fast-element/attribute-map.js";
import { declarativeTemplate } from "@lushly-dev/fast-element/declarative.js";
import { FASTElement } from "@lushly-dev/fast-element/fast-element.js";

class NamingStrategyTestElement extends FASTElement {}

NamingStrategyTestElement.define(
    {
        name: "naming-strategy-test",
        template: declarativeTemplate(),
    },
    [
        attributeMap({
            "attribute-name-strategy": "camelCase",
        }),
    ],
);

class NamingStrategyNoDashTestElement extends FASTElement {}

NamingStrategyNoDashTestElement.define(
    {
        name: "naming-strategy-no-dash-test",
        template: declarativeTemplate(),
    },
    [
        attributeMap({
            "attribute-name-strategy": "camelCase",
        }),
    ],
);
