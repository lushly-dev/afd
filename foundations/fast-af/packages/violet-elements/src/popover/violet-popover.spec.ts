import { afterEach, describe, expect, it, vi } from "vitest";

import "../button/violet-button.define";
import "./violet-popover.define";
import type { VioletPopover } from "./violet-popover";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
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
    await vi.waitFor(() => expect(popover.open).toBe(true));

    expect(popover.shadowRoot?.querySelector(".surface")?.matches(":popover-open")).toBe(true);
  });

  it("can be controlled through the open attribute", async () => {
    const popover = await renderPopover(`
            <violet-popover open>
                <button slot="trigger" type="button">Open</button>
                <div>Details</div>
            </violet-popover>
        `);

    await vi.waitFor(() => expect(popover.open).toBe(true));
    expect(popover.shadowRoot?.querySelector(".surface")?.matches(":popover-open")).toBe(true);
  });

  it("supports an external anchor trigger by id", async () => {
    const popover = await renderPopover(`
            <button id="outside-anchor" type="button" style="anchor-name:--author-anchor;">Anchor</button>
            <violet-popover anchor="outside-anchor">
                <div>Details</div>
            </violet-popover>
        `);

    const anchor = document.getElementById("outside-anchor") as HTMLButtonElement | null;
    expect(popover.anchorName).toMatch(/^--violet-popover-anchor-\d+$/);
    // External anchors use JS geometry positioning and must not overwrite an author anchor-name.
    expect(anchor?.style.getPropertyValue("anchor-name")).toBe("--author-anchor");

    anchor?.click();
    await vi.waitFor(() => expect(popover.open).toBe(true));
  });

  it("positions two externally anchored popovers at exact gaps without clobbering author anchor names", async () => {
    document.body.innerHTML = `
            <button id="anchor-left" type="button" style="position:fixed;top:40px;left:24px;width:60px;height:30px;anchor-name:--custom-left;">Left</button>
            <button id="anchor-right" type="button" style="position:fixed;top:40px;left:260px;width:60px;height:30px;">Right</button>
            <violet-popover id="pop-left" anchor="anchor-left" positioning="below" style="--violet-popover-min-inline-size:80px;--violet-popover-gap:8px;"><div>Left panel</div></violet-popover>
            <violet-popover id="pop-right" anchor="anchor-right" positioning="below" style="--violet-popover-min-inline-size:80px;--violet-popover-gap:8px;"><div>Right panel</div></violet-popover>
        `;
    await customElements.whenDefined("violet-popover");
    await nextFrame();

    const btnLeft = document.getElementById("anchor-left") as HTMLButtonElement;
    const btnRight = document.getElementById("anchor-right") as HTMLButtonElement;
    const popLeft = document.getElementById("pop-left") as VioletPopover;
    const popRight = document.getElementById("pop-right") as VioletPopover;
    const surfaceLeft = popLeft.shadowRoot?.querySelector(".surface") as HTMLElement;
    const surfaceRight = popRight.shadowRoot?.querySelector(".surface") as HTMLElement;

    expect(popLeft.anchorName).not.toBe(popRight.anchorName);
    expect(btnLeft.style.getPropertyValue("anchor-name")).toBe("--custom-left");
    expect(btnRight.style.getPropertyValue("anchor-name")).toBe("");

    popLeft.show();
    await vi.waitFor(() => expect(popLeft.open).toBe(true));
    await nextFrame();
    const leftAnchorRect = btnLeft.getBoundingClientRect();
    const leftRect = surfaceLeft.getBoundingClientRect();

    popRight.show();
    await vi.waitFor(() => expect(popRight.open).toBe(true));
    await nextFrame();
    const rightRect = surfaceRight.getBoundingClientRect();

    // Each popover resolves to its own trigger with an exact 8px gap (no 16px double margin).
    expect(rightRect.left).toBeGreaterThan(leftRect.left + 150);
    expect(Math.abs(leftRect.top - (leftAnchorRect.bottom + 8))).toBeLessThanOrEqual(2);
  });

  it("repositions an open popover when switching between internal and external anchors", async () => {
    document.body.innerHTML = `
            <button id="far-anchor" type="button" style="position:fixed;top:40px;left:280px;width:60px;height:30px;">Far</button>
            <violet-popover id="switch-pop" positioning="below" style="position:fixed;top:40px;left:20px;--violet-popover-min-inline-size:80px;">
                <button slot="trigger" type="button" style="width:60px;height:30px;">Internal</button>
                <div>Body</div>
            </violet-popover>
        `;
    await customElements.whenDefined("violet-popover");
    await nextFrame();

    const pop = document.getElementById("switch-pop") as VioletPopover;
    const surface = pop.shadowRoot?.querySelector(".surface") as HTMLElement;
    pop.show();
    await vi.waitFor(() => expect(pop.open).toBe(true));
    await nextFrame();
    const internalRect = surface.getBoundingClientRect();

    pop.anchor = "far-anchor";
    await nextFrame();
    await nextFrame();
    const externalRect = surface.getBoundingClientRect();
    expect(externalRect.left).toBeGreaterThan(internalRect.left + 150);

    pop.anchor = "";
    await nextFrame();
    await nextFrame();
    const restoredRect = surface.getBoundingClientRect();
    expect(restoredRect.left).toBeLessThan(externalRect.left - 150);
  });
});
