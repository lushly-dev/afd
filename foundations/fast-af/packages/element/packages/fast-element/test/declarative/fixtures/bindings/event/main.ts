import { attr } from "@lushly-dev/fast-element/attr.js";
import { declarativeTemplate } from "@lushly-dev/fast-element/declarative.js";
import { FASTElement } from "@lushly-dev/fast-element/fast-element.js";
import { enableHydration } from "@lushly-dev/fast-element/hydration.js";

class TestElement extends FASTElement {
    @attr
    foo: string = "";

    public handleNoArgsClick = (): void => {
        console.log("no args");
    };

    public handleModifyAttributeClick = (): void => {
        this.foo = "modified-by-click";
    };

    public handleDollarEArgClick = (e: MouseEvent): void => {
        console.log(e.type);
    };

    public handleContextArgClick = (c: any): void => {
        console.log(c.event.type);
    };

    public handleMultiArgClick = (e: MouseEvent, c: any): void => {
        console.log(`${e.type},${c.event.type}`);
    };

    public handleContextEventArgClick = (e: MouseEvent): void => {
        console.log(e.type);
    };
}
TestElement.define({
    name: "test-element",
    template: declarativeTemplate(),
});

const hydration = enableHydration();
void hydration.whenHydrated().then(() => {
    (window as any).hydrationCompleted = true;
});
