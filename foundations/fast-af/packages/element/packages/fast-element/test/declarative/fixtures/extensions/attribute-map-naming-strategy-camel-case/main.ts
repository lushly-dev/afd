import { attr } from "@lushly-dev/fast-element/attr.js";
import { declarativeTemplate } from "@lushly-dev/fast-element/declarative.js";
import { FASTElement } from "@lushly-dev/fast-element/fast-element.js";
import { enableHydration } from "@lushly-dev/fast-element/hydration.js";

class TestCamelCase extends FASTElement {
    @attr({ attribute: "foo-bar" })
    fooBar: string = "";
}
TestCamelCase.define({
    name: "test-camel-case",
    template: declarativeTemplate(),
});

class TestCamelCaseMulti extends FASTElement {
    @attr({ attribute: "my-custom-prop" })
    myCustomProp: string = "";
}
TestCamelCaseMulti.define({
    name: "test-camel-case-multi",
    template: declarativeTemplate(),
});

class TestCamelCaseNoDash extends FASTElement {
    @attr
    label: string = "";
}
TestCamelCaseNoDash.define({
    name: "test-camel-case-no-dash",
    template: declarativeTemplate(),
});

const hydration = enableHydration();
void hydration.whenHydrated().then(() => {
    (window as any).hydrationCompleted = true;
});
