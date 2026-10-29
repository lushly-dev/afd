import { afterEach, describe, expect, it } from "vitest";

import "../button/violet-button";
import "./violet-popover";
import type { VioletPopover } from "./violet-popover";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderPopover(template: string): Promise<VioletPopover> {
    document.body.innerHTML = template;
    await customElements.whenDefined("violet-popover");
    await nextFrame();
    return document.querySelector("violet-popover") as VioletPopover;
}

describe("violet-popover", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("toggles open from the slotted trigger", async () => {
        const popover = await renderPopover(`
            <violet-popover>
                <button slot="trigger" type="button">Open</button>
                <div>Details</div>
            </violet-popover>
        `);

        (popover.querySelector('[slot="trigger"]') as HTMLButtonElement | null)?.click();
        await nextFrame();

        expect(popover.open).toBe(true);
        expect(popover.shadowRoot?.querySelector(".surface")?.matches(":popover-open")).toBe(true);
    });

    it("can be controlled through the open attribute", async () => {
        const popover = await renderPopover(`
            <violet-popover open>
                <button slot="trigger" type="button">Open</button>
                <div>Details</div>
            </violet-popover>
        `);

        expect(popover.open).toBe(true);
        expect(popover.shadowRoot?.querySelector(".surface")?.matches(":popover-open")).toBe(true);
    });

    it("supports an external anchor trigger by id", async () => {
        const popover = await renderPopover(`
            <button id="outside-anchor" type="button">Anchor</button>
            <violet-popover anchor="outside-anchor">
                <div>Details</div>
            </violet-popover>
        `);

        (document.getElementById("outside-anchor") as HTMLButtonElement | null)?.click();
        await nextFrame();

        expect(popover.open).toBe(true);
    });
});
