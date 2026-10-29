import { attr } from "@lushly-dev/fast-element/attr.js";
import { declarativeTemplate } from "@lushly-dev/fast-element/declarative.js";
import { FASTElement } from "@lushly-dev/fast-element/fast-element.js";
import { enableHydration, StopHydration } from "@lushly-dev/fast-element/hydration.js";

export const hydrationEvents: string[] = [];
const hydration = enableHydration({
    stopHydration: StopHydration.never,
});

export class HydrationOptionsElement extends FASTElement {
    @attr
    label: string = "Initial";
}

void hydration.whenHydrated("hydration-config-element").then(() => {
    hydrationEvents.push("component-complete");
    (window as any).hydrationCompleted = true;
});

HydrationOptionsElement.define({
    name: "hydration-config-element",
    template: declarativeTemplate(),
});
