import { afterEach, describe, expect, it, vi } from "vitest";

import "./violet-alert";
import type { VioletAlert } from "./violet-alert";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderAlert(
    template = `
        <violet-alert tone="warning">
            <span slot="title">Check before planting</span>
            Soil temperature is below the preferred transplant range.
            <span slot="actions">Review changes</span>
        </violet-alert>
    `
): Promise<VioletAlert> {
    document.body.innerHTML = template;
    await customElements.whenDefined("violet-alert");
    await nextFrame();
    return document.querySelector("violet-alert") as VioletAlert;
}

describe("violet-alert", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("renders title and actions from slots", async () => {
        const alert = await renderAlert();
        const titleSlot = alert.shadowRoot?.querySelector('slot[name="title"]') as HTMLSlotElement | null;
        const actionsSlot = alert.shadowRoot?.querySelector('slot[name="actions"]') as HTMLSlotElement | null;
        const titleText = titleSlot?.assignedNodes({ flatten: true }).map(node => node.textContent ?? "").join("").trim();
        const actionsText = actionsSlot?.assignedNodes({ flatten: true }).map(node => node.textContent ?? "").join("").trim();

        expect(titleText).toBe("Check before planting");
        expect(actionsText?.includes("Review changes")).toBe(true);
    });

    it("maps assertive announcement to alert semantics", async () => {
        const alert = await renderAlert(`<violet-alert announcement="assertive">Immediate attention needed.</violet-alert>`);
        const copy = alert.shadowRoot?.querySelector(".copy");

        expect(copy?.getAttribute("role")).toBe("alert");
        expect(copy?.getAttribute("aria-live")).toBe("assertive");
    });

    it("emits dismiss when the dismiss button is activated", async () => {
        const alert = await renderAlert(`<violet-alert dismissible>Saved successfully.</violet-alert>`);
        const handler = vi.fn();
        const dismissButton = alert.shadowRoot
            ?.querySelector("violet-icon-button")
            ?.shadowRoot
            ?.querySelector("button") as HTMLButtonElement | null;

        alert.addEventListener("dismiss", handler);
        dismissButton?.click();

        expect(handler).toHaveBeenCalledTimes(1);
    });
});
