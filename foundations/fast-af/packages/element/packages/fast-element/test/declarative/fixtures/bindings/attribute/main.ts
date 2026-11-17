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

class TestElementNullable extends FASTElement {
    @observable nullableHref: string | null = null;
    @observable missingRole: string | undefined = undefined;
    @observable nullableTabIndex: number | null = null;
    @observable emptyHref: string = "";
    @observable isDisabled: boolean = false;
    @observable nullableValue: string | null = null;
}
TestElementNullable.define({
    name: "test-element-nullable",
    template: declarativeTemplate(),
});

const hydration = enableHydration();
void hydration.whenHydrated().then(() => {
    (window as any).hydrationCompleted = true;
});
