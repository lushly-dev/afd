import { afterEach, describe, expect, it } from "vitest";

import "./violet-tab-panel";
import type { VioletTabPanel } from "./violet-tab-panel";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

describe("violet-tab-panel", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("is registered and renders a content wrapper with a default slot", async () => {
        document.body.innerHTML = "";
        const panel = document.createElement("violet-tab-panel") as VioletTabPanel;
        document.body.append(panel);

        await customElements.whenDefined("violet-tab-panel");
        await nextFrame();

        const content = panel.shadowRoot?.querySelector(".content");
        expect(content?.getAttribute("part")).toBe("root");
        expect(content?.querySelector("slot")).not.toBeNull();
    });

    it("projects slotted content", async () => {
        document.body.innerHTML = "";
        const panel = document.createElement("violet-tab-panel") as VioletTabPanel;
        const paragraph = document.createElement("p");
        paragraph.textContent = "Panel body";
        panel.append(paragraph);
        document.body.append(panel);

        await customElements.whenDefined("violet-tab-panel");
        await nextFrame();

        const slot = panel.shadowRoot?.querySelector("slot") as HTMLSlotElement;
        expect(slot.assignedElements()).toEqual([paragraph]);
    });
});
