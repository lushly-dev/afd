import { declarativeTemplate } from "@lushly-dev/fast-element/declarative.js";
import { FASTElement } from "@lushly-dev/fast-element/fast-element.js";
import { enableHydration } from "@lushly-dev/fast-element/hydration.js";

class TestElement extends FASTElement {
    public video: HTMLVideoElement | null = null;
}
TestElement.define({
    name: "test-element",
    template: declarativeTemplate(),
});

const hydration = enableHydration();
void hydration.whenHydrated().then(() => {
    (window as any).hydrationCompleted = true;
});
