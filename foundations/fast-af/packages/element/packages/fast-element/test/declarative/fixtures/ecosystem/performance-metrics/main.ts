import { attr } from "@lushly-dev/fast-element/attr.js";
import { declarativeTemplate } from "@lushly-dev/fast-element/declarative.js";
import { FASTElement } from "@lushly-dev/fast-element/fast-element.js";
import { enableHydration } from "@lushly-dev/fast-element/hydration.js";
import { volatile } from "@lushly-dev/fast-element/volatile.js";

performance.mark("hydration:started");
const hydration = enableHydration();
void hydration.whenHydrated().then(() => {
    performance.measure("hydration:complete", "hydration:started");
    (window as any).hydrationCompleted = true;
});

class FastCard extends FASTElement {
    @attr({ attribute: "defer-delay" })
    deferDelay!: number;

    @volatile
    get displayDelay(): string {
        return `${(this.deferDelay ?? 0).toString()}ms`;
    }
}

FastCard.define({
    name: "fast-card",
    template: declarativeTemplate(),
});
