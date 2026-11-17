import { attr } from "@lushly-dev/fast-element/attr.js";
import { declarativeTemplate } from "@lushly-dev/fast-element/declarative.js";
import { DOM, DOMAspect } from "@lushly-dev/fast-element/dom.js";
import { DOMPolicy } from "@lushly-dev/fast-element/dom-policy.js";
import { FASTElement } from "@lushly-dev/fast-element/fast-element.js";
import { enableHydration } from "@lushly-dev/fast-element/hydration.js";

const trustedHTML = "<p>Hello world</p>";
const createHTML = (value: string) => value;

DOM.setPolicy(
    DOMPolicy.create({
        trustedType: globalThis.trustedTypes?.createPolicy("content-binding-fixture", {
            createHTML,
        }) ?? { createHTML },
        guards: {
            elements: {
                div: {
                    [DOMAspect.property]: {
                        innerHTML(_tagName, _aspect, _aspectName, sink) {
                            return (target, name, value, ...rest) => {
                                if (value !== trustedHTML) {
                                    throw new Error(
                                        "Only the content fixture's static HTML is allowed.",
                                    );
                                }

                                sink(target, name, value, ...rest);
                            };
                        },
                    },
                },
            },
        },
    }),
);

class TestElement extends FASTElement {
    @attr
    text: string = "Hello";
}
TestElement.define({
    name: "test-element",
    template: declarativeTemplate(),
});

class TestElementUnescaped extends FASTElement {
    public html = trustedHTML;
}
TestElementUnescaped.define({
    name: "test-element-unescaped",
    template: declarativeTemplate(),
});

const hydration = enableHydration();
void hydration.whenHydrated().then(() => {
    (window as any).hydrationCompleted = true;
});
