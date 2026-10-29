import { attr } from "@lushly-dev/fast-element/attr.js";
import { declarativeTemplate } from "@lushly-dev/fast-element/declarative.js";
import { FASTElement } from "@lushly-dev/fast-element/fast-element.js";
import { enableHydration } from "@lushly-dev/fast-element/hydration.js";

class CodeDisplay extends FASTElement {
    @attr
    greeting: string = "Hello";
}
CodeDisplay.define({
    name: "code-display",
    template: declarativeTemplate(),
});

(window as any).__hydrationErrors = [];
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
    (window as any).__hydrationErrors.push(
        args.map(a => (typeof a === "string" ? a : String(a))).join(" "),
    );
    originalConsoleError.apply(console, args);
};

const hydration = enableHydration();
void hydration.whenHydrated().then(() => {
    (window as any).hydrationCompleted = true;
});
