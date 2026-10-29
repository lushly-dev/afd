import { attributeMap } from "@lushly-dev/fast-element/attribute-map.js";
import { declarativeTemplate } from "@lushly-dev/fast-element/declarative.js";
import { FASTElement } from "@lushly-dev/fast-element/fast-element.js";
import { observerMap } from "@lushly-dev/fast-element/observer-map.js";

class ConfigObserverMapTestElement extends FASTElement {
    public data: any = {
        message: "hello",
        nested: {
            value: 42,
        },
    };

    public updateMessage() {
        this.data.message = "updated";
    }

    public updateNestedValue() {
        this.data.nested.value = 99;
    }
}

ConfigObserverMapTestElement.define(
    {
        name: "config-observer-map-test-element",
        template: declarativeTemplate(),
    },
    [
        observerMap({
            properties: {
                data: true,
            },
        }),
    ],
);

class ConfigAttributeMapTestElement extends FASTElement {
    public setLabel() {
        (this as any).label = "new-label";
    }
}

ConfigAttributeMapTestElement.define(
    {
        name: "config-attribute-map-test-element",
        template: declarativeTemplate(),
    },
    [
        attributeMap({
            "attribute-name-strategy": "none",
        }),
    ],
);
