import { attr } from "@lushly-dev/fast-element/attr.js";
import { attributeMap } from "@lushly-dev/fast-element/attribute-map.js";
import { declarativeTemplate } from "@lushly-dev/fast-element/declarative.js";
import { FASTElement } from "@lushly-dev/fast-element/fast-element.js";

class AttributeMapTestElement extends FASTElement {
    public setFoo() {
        (this as any).foo = "hello";
    }

    public setFooBar() {
        (this as any).fooBar = "world";
    }

    public setMultiple() {
        (this as any).foo = "updated";
        (this as any).fooBar = "also-updated";
    }
}

AttributeMapTestElement.define(
    {
        name: "attribute-map-test-element",
        template: declarativeTemplate(),
    },
    [attributeMap()],
);

class AttributeMapWithExistingAttrElement extends FASTElement {
    @attr
    foo: string = "original";
}

AttributeMapWithExistingAttrElement.define(
    {
        name: "attribute-map-existing-attr-test-element",
        template: declarativeTemplate(),
    },
    [attributeMap()],
);
