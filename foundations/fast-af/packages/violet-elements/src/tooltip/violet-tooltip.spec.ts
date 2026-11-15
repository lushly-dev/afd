import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-tooltip";
import type { VioletTooltip } from "./violet-tooltip";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderTooltip(template: string): Promise<VioletTooltip> {
    document.body.innerHTML = template;
    await customElements.whenDefined("violet-tooltip");
    await nextFrame();
    return document.querySelector("violet-tooltip") as VioletTooltip;
}

describe("violet-tooltip", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("shows again on hover after Escape closes it", async () => {
        const tooltip = await renderTooltip(`
            <violet-tooltip content="Helpful details" delay="10">
                <button type="button">Trigger</button>
            </violet-tooltip>
        `);
        const trigger = tooltip.querySelector("button") as HTMLButtonElement;
        const popup = tooltip.shadowRoot?.querySelector(".tooltip") as HTMLElement;

        trigger.focus();
        await nextFrame();
        expect(tooltip.open).toBe(true);
        expect(popup.matches(":popover-open")).toBe(true);

        await userEvent.keyboard("{Escape}");
        await nextFrame();
        expect(popup.matches(":popover-open")).toBe(false);
        expect(tooltip.open).toBe(false);

        // The tooltip listens on its anchor wrapper, and mouseenter does not bubble.
        tooltip.shadowRoot?.querySelector(".anchor")?.dispatchEvent(new MouseEvent("mouseenter"));
        await new Promise(resolve => setTimeout(resolve, 60));
        await nextFrame();
        expect(tooltip.open).toBe(true);
        expect(popup.matches(":popover-open")).toBe(true);
    });

    it("wires aria-describedby to a slotted trigger", async () => {
        const tooltip = await renderTooltip(`
            <violet-tooltip content="Helpful details">
                <button type="button">Trigger</button>
            </violet-tooltip>
        `);

        const trigger = tooltip.querySelector("button");
        expect(trigger?.getAttribute("aria-describedby")).toBe(tooltip.tooltipId);
    });

    it("supports an external anchor trigger by id", async () => {
        const tooltip = await renderTooltip(`
            <button id="outside-anchor" type="button">Anchor</button>
            <violet-tooltip anchor="outside-anchor" content="Helpful details"></violet-tooltip>
        `);

        const anchor = document.getElementById("outside-anchor") as HTMLButtonElement | null;
        anchor?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        await nextFrame();

        expect(anchor?.style.getPropertyValue("anchor-name")).toBe("--violet-tooltip-anchor");
        expect(anchor?.getAttribute("aria-describedby")).toBe(tooltip.tooltipId);
        expect(tooltip.open).toBe(true);
    });
});
