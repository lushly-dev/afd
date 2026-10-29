import { afterEach, describe, expect, it } from "vitest";

import "../button/violet-button";
import "./violet-teaching-tip";
import type { VioletTeachingTip } from "./violet-teaching-tip";
import { registerSystemSearchIcon } from "../icon/generated/icons/system-search";
import { resolveVioletIcon } from "../icon/icon-registry";
import type { VioletIcon } from "../icon/violet-icon";

registerSystemSearchIcon();

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function expectCloseGlyph(button: Element | null | undefined): Promise<void> {
    const icon = button?.querySelector("violet-icon") as VioletIcon | null | undefined;
    expect(icon).toBeTruthy();
    expect(icon?.icon).toBe("system/close");

    const closeSvg = resolveVioletIcon("system/close")?.svg ?? "";
    const searchSvg = resolveVioletIcon("system/search")?.svg ?? "";
    expect(closeSvg).not.toBe("");
    expect(searchSvg).not.toBe("");

    await nextFrame();
    const rendered = icon?.shadowRoot?.querySelector(".glyph svg");
    const expected = new DOMParser().parseFromString(closeSvg, "image/svg+xml").documentElement;
    expect(rendered).not.toBeNull();
    const paths = (root: Element | null | undefined) =>
        Array.from(root?.querySelectorAll("path") ?? []).map(path => path.getAttribute("d"));
    expect(paths(rendered)).toEqual(paths(expected));
    expect(paths(rendered).length).toBeGreaterThan(0);
    expect(rendered?.querySelector("circle")).toBeNull();
}


async function renderTeachingTip(template: string): Promise<VioletTeachingTip> {
    document.body.innerHTML = template;
    await customElements.whenDefined("violet-teaching-tip");
    await nextFrame();
    return document.querySelector("violet-teaching-tip") as VioletTeachingTip;
}

describe("violet-teaching-tip", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("syncs dialog trigger aria to a slotted trigger", async () => {
        const tip = await renderTeachingTip(`
            <violet-teaching-tip>
                <button type="button">Show tip</button>
                <span slot="title">Title</span>
            </violet-teaching-tip>
        `);

        const trigger = tip.querySelector("button");
        expect(trigger?.getAttribute("aria-haspopup")).toBe("dialog");
        expect(trigger?.getAttribute("aria-expanded")).toBe("false");
        expect(trigger?.getAttribute("aria-controls")).toBe(tip.tipId);

        tip.show();
        await nextFrame();

        expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    });

    it("supports an external anchor by id", async () => {
        const tip = await renderTeachingTip(`
            <button id="outside-tip-anchor" type="button">Anchor</button>
            <violet-teaching-tip anchor="outside-tip-anchor">
                <span slot="title">Title</span>
            </violet-teaching-tip>
        `);

        const anchor = document.getElementById("outside-tip-anchor") as HTMLButtonElement | null;

        expect(anchor?.style.getPropertyValue("anchor-name")).toBe("--violet-teaching-tip-anchor");
        expect(anchor?.getAttribute("aria-haspopup")).toBe("dialog");
        expect(anchor?.getAttribute("aria-controls")).toBe(tip.tipId);
    });

    it("renders the close glyph through the icon attribute with search also registered", async () => {
        const tip = await renderTeachingTip(`
            <violet-teaching-tip><span slot="title">Title</span></violet-teaching-tip>
        `);

        await expectCloseGlyph(tip.shadowRoot?.querySelector('[part="close-button"]'));
    });
});
