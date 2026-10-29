import { afterEach, describe, expect, it } from "vitest";

import "./violet-tab";
import type { VioletTab } from "./violet-tab";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

async function renderTab(label = "Overview", configure?: (tab: VioletTab) => void): Promise<VioletTab> {
    document.body.innerHTML = "";

    const tab = document.createElement("violet-tab") as VioletTab;
    tab.textContent = label;
    configure?.(tab);
    document.body.append(tab);

    await customElements.whenDefined("violet-tab");
    await nextFrame();

    return tab;
}

describe("violet-tab", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("is enabled by default", async () => {
        const tab = await renderTab();

        // `disabled` has no constructor default, so it starts out undefined rather than false.
        expect(tab.disabled).toBeFalsy();
        expect(tab.effectiveDisabled).toBe(false);
    });

    it("maps the disabled attribute to the property and back", async () => {
        const tab = await renderTab("Overview", el => {
            el.setAttribute("disabled", "");
        });

        expect(tab.disabled).toBe(true);
        expect(tab.effectiveDisabled).toBe(true);

        tab.disabled = false;
        await nextFrame();

        expect(tab.hasAttribute("disabled")).toBe(false);
        expect(tab.effectiveDisabled).toBe(false);
    });

    it("is effectively disabled when its tabs container disables it", async () => {
        const tab = await renderTab();

        tab.setDisabledFromTabs(true);

        expect(tab.disabled).toBeFalsy();
        expect(tab.effectiveDisabled).toBe(true);

        tab.setDisabledFromTabs(false);

        expect(tab.effectiveDisabled).toBe(false);
    });

    it("stays effectively disabled from its own attribute when the container re-enables", async () => {
        const tab = await renderTab("Overview", el => {
            el.disabled = true;
        });

        tab.setDisabledFromTabs(false);

        expect(tab.effectiveDisabled).toBe(true);
    });

    it("writes presentation data attributes from its tabs container", async () => {
        const tab = await renderTab();

        tab.syncPresentation("closed", "vertical");

        expect(tab.getAttribute("data-appearance")).toBe("closed");
        expect(tab.getAttribute("data-orientation")).toBe("vertical");

        tab.syncPresentation("open", "horizontal");

        expect(tab.getAttribute("data-appearance")).toBe("open");
        expect(tab.getAttribute("data-orientation")).toBe("horizontal");
    });

    it("projects its label and renders a decorative indicator", async () => {
        const tab = await renderTab("Overview");
        const slot = tab.shadowRoot?.querySelector("slot") as HTMLSlotElement;
        const indicator = tab.shadowRoot?.querySelector(".indicator");

        expect(slot.assignedNodes()[0]?.textContent).toBe("Overview");
        expect(indicator?.getAttribute("aria-hidden")).toBe("true");
    });
});
