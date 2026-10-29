import { attr } from "@lushly-dev/fast-element/attr.js";
import { declarativeTemplate } from "@lushly-dev/fast-element/declarative.js";
import { FASTElement } from "@lushly-dev/fast-element/fast-element.js";
import { enableHydration } from "@lushly-dev/fast-element/hydration.js";
import { observable } from "@lushly-dev/fast-element/observable.js";

class TestElement extends FASTElement {
    @attr
    type: string = "radio";
}
TestElement.define({
    name: "test-element",
    template: declarativeTemplate(),
});

class TestElementProperty extends FASTElement {
    @observable
    isEnabled: boolean = false;
}
TestElementProperty.define({
    name: "test-element-property",
    template: declarativeTemplate(),
});

class TestElementExpression extends FASTElement {
    @attr({ attribute: "active-group" })
    activeGroup: string = "";

    @attr({ attribute: "current-group" })
    currentGroup: string = "";
}
TestElementExpression.define({
    name: "test-element-expression",
    template: declarativeTemplate(),
});

const hydration = enableHydration();
void hydration.whenHydrated().then(() => {
    (window as any).hydrationCompleted = true;
});
