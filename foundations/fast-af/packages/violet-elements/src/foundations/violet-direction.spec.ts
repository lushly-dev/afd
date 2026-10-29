import { afterEach, describe, expect, it } from "vitest";

import "../calendar/violet-calendar";
import "../carousel/violet-carousel";
import "../radio-group/violet-radio-group";
import "../radio/violet-radio";
import "../segment/violet-segment";
import "../segmented-control/violet-segmented-control";
import "../tree-item/violet-tree-item";
import "../tree/violet-tree";
import type { VioletCalendar } from "../calendar/violet-calendar";
import type { VioletCarousel } from "../carousel/violet-carousel";
import type { VioletRadioGroup } from "../radio-group/violet-radio-group";
import type { VioletSegmentedControl } from "../segmented-control/violet-segmented-control";
import { isRtl, logicalArrowKey } from "./violet-direction";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function settle(): Promise<void> {
    await nextFrame();
    await nextFrame();
}

function press(target: EventTarget, key: string): void {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true }));
}

async function mount(markup: string, dir: "ltr" | "rtl"): Promise<HTMLElement> {
    document.body.innerHTML = `<div dir="${dir}">${markup}</div>`;
    await settle();
    return document.body.firstElementChild as HTMLElement;
}

/** Builds a group with already-upgraded children (innerHTML upgrades parents before children). */
async function mountGroup(parentTag: string, childTag: string, values: string[], dir: "ltr" | "rtl"): Promise<HTMLElement> {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    host.setAttribute("dir", dir);
    const parent = document.createElement(parentTag);
    parent.setAttribute("label", "Group");
    parent.setAttribute("value", values[0] ?? "");
    for (const value of values) {
        const child = document.createElement(childTag);
        child.setAttribute("value", value);
        child.textContent = value.toUpperCase();
        parent.append(child);
    }
    host.append(parent);
    document.body.append(host);
    await settle();
    return host;
}

describe("violet-direction helpers", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("detects direction from an ancestor dir attribute", async () => {
        const rtlHost = await mount("<span id='x'></span>", "rtl");
        expect(isRtl(rtlHost.querySelector("#x") as Element)).toBe(true);

        const ltrHost = await mount("<span id='y'></span>", "ltr");
        expect(isRtl(ltrHost.querySelector("#y") as Element)).toBe(false);
    });

    it("swaps horizontal arrows only in RTL", async () => {
        const rtlHost = await mount("<span></span>", "rtl");
        const rtlNode = rtlHost.firstElementChild as Element;
        expect(logicalArrowKey("ArrowLeft", rtlNode)).toBe("ArrowRight");
        expect(logicalArrowKey("ArrowRight", rtlNode)).toBe("ArrowLeft");
        expect(logicalArrowKey("ArrowDown", rtlNode)).toBe("ArrowDown");

        const ltrHost = await mount("<span></span>", "ltr");
        const ltrNode = ltrHost.firstElementChild as Element;
        expect(logicalArrowKey("ArrowLeft", ltrNode)).toBe("ArrowLeft");
        expect(logicalArrowKey("ArrowRight", ltrNode)).toBe("ArrowRight");
    });
});

describe("RTL arrow-key handling", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("radio group: ArrowLeft selects the next radio in RTL and the previous in LTR", async () => {
        const rtl = await mountGroup("violet-radio-group", "violet-radio", ["a", "b", "c"], "rtl");
        const rtlGroup = rtl.querySelector("violet-radio-group") as VioletRadioGroup;
        press(rtlGroup.querySelector("violet-radio[value='a']") as HTMLElement, "ArrowLeft");
        await settle();
        expect(rtlGroup.value).toBe("b");

        press(rtlGroup.querySelector("violet-radio[value='b']") as HTMLElement, "ArrowRight");
        await settle();
        expect(rtlGroup.value).toBe("a");

        const ltr = await mountGroup("violet-radio-group", "violet-radio", ["a", "b", "c"], "ltr");
        const ltrGroup = ltr.querySelector("violet-radio-group") as VioletRadioGroup;
        press(ltrGroup.querySelector("violet-radio[value='a']") as HTMLElement, "ArrowRight");
        await settle();
        expect(ltrGroup.value).toBe("b");
    });

    it("segmented control: ArrowLeft selects the next segment in RTL", async () => {
        const host = await mountGroup("violet-segmented-control", "violet-segment", ["a", "b"], "rtl");
        const control = host.querySelector("violet-segmented-control") as VioletSegmentedControl;
        const first = control.querySelector("violet-segment[value='a']") as HTMLElement;
        first.shadowRoot?.querySelector("button")?.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, composed: true, cancelable: true }),
        );
        await settle();
        expect(control.value).toBe("b");
    });

    it("calendar: ArrowLeft moves to the next day in RTL and the previous day in LTR", async () => {
        const rtl = await mount(`<violet-calendar locale="en-US" value="2026-03-23"></violet-calendar>`, "rtl");
        const rtlCalendar = rtl.querySelector("violet-calendar") as VioletCalendar;
        rtlCalendar.focusedDate = "2026-03-23";
        rtlCalendar.handleGridKeydown(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
        expect(rtlCalendar.focusedDate).toBe("2026-03-24");
        rtlCalendar.handleGridKeydown(new KeyboardEvent("keydown", { key: "ArrowRight" }));
        expect(rtlCalendar.focusedDate).toBe("2026-03-23");

        const ltr = await mount(`<violet-calendar locale="en-US" value="2026-03-23"></violet-calendar>`, "ltr");
        const ltrCalendar = ltr.querySelector("violet-calendar") as VioletCalendar;
        ltrCalendar.focusedDate = "2026-03-23";
        ltrCalendar.handleGridKeydown(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
        expect(ltrCalendar.focusedDate).toBe("2026-03-22");
    });

    const treeMarkup = `
        <violet-tree>
            <violet-tree-item value="operations">
                Operations
                <violet-tree-item value="propagation">Propagation</violet-tree-item>
            </violet-tree-item>
        </violet-tree>`;

    it("tree: ArrowLeft expands and ArrowRight collapses in RTL", async () => {
        const host = await mount(treeMarkup, "rtl");
        const root = host.querySelector("violet-tree-item[value='operations']") as HTMLElement;
        root.focus();

        press(root, "ArrowLeft");
        await settle();
        expect(root.getAttribute("aria-expanded")).toBe("true");

        press(root, "ArrowRight");
        await settle();
        expect(root.getAttribute("aria-expanded")).toBe("false");
    });

    it("tree: ArrowRight still expands in LTR", async () => {
        const host = await mount(treeMarkup, "ltr");
        const root = host.querySelector("violet-tree-item[value='operations']") as HTMLElement;
        root.focus();

        press(root, "ArrowRight");
        await settle();
        expect(root.getAttribute("aria-expanded")).toBe("true");
    });

    it("carousel: ArrowLeft advances in RTL and ArrowRight advances in LTR", async () => {
        const markup = `
            <violet-carousel label="Slides">
                <section data-label="One">One</section>
                <section data-label="Two">Two</section>
                <section data-label="Three">Three</section>
            </violet-carousel>`;

        const rtl = await mount(markup, "rtl");
        const rtlCarousel = rtl.querySelector("violet-carousel") as VioletCarousel;
        rtlCarousel.handleViewportKeydown(new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true }));
        expect(rtlCarousel.activeIndex).toBe(1);

        const ltr = await mount(markup, "ltr");
        const ltrCarousel = ltr.querySelector("violet-carousel") as VioletCarousel;
        ltrCarousel.handleViewportKeydown(new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }));
        expect(ltrCarousel.activeIndex).toBe(1);
    });
});
