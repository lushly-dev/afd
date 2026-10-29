import { afterEach, describe, expect, it } from "vitest";

import "./violet-divider";
import type { VioletDivider } from "./violet-divider";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderDivider(): Promise<VioletDivider> {
    document.body.innerHTML = "";
    const divider = document.createElement("violet-divider") as VioletDivider;
    document.body.append(divider);
    await customElements.whenDefined("violet-divider");
    await nextFrame();
    return divider;
}

describe("violet-divider", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("renders a horizontal hr by default", async () => {
        const divider = await renderDivider();
        expect(divider.shadowRoot?.querySelector("hr")).toBeTruthy();
    });

    it("renders a vertical separator when requested", async () => {
        const divider = await renderDivider();
        divider.orientation = "vertical";
        await nextFrame();

        const separator = divider.shadowRoot?.querySelector('[role="separator"]');
        expect(separator?.getAttribute("aria-orientation")).toBe("vertical");
    });
});
