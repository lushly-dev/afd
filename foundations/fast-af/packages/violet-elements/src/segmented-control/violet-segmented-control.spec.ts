import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "../button/violet-button";
import "../segment/violet-segment";
import "./violet-segmented-control";
import type { VioletSegmentedControl } from "./violet-segmented-control";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderControl(): Promise<VioletSegmentedControl> {
    document.body.innerHTML = `
        <violet-segmented-control value="overview">
            <violet-segment value="overview">Overview</violet-segment>
            <violet-segment value="planting">Planting</violet-segment>
            <violet-segment value="irrigation">Irrigation</violet-segment>
        </violet-segmented-control>
    `;
    await customElements.whenDefined("violet-segmented-control");
    await nextFrame();
    return document.querySelector("violet-segmented-control") as VioletSegmentedControl;
}

async function renderBetweenButtons(controlMarkup: string): Promise<VioletSegmentedControl> {
    document.body.innerHTML = `
        <button id="before">Before</button>
        ${controlMarkup}
        <button id="after">After</button>
    `;
    await customElements.whenDefined("violet-segmented-control");
    await nextFrame();
    return document.querySelector("violet-segmented-control") as VioletSegmentedControl;
}

function trackChanges(control: VioletSegmentedControl): string[] {
    const values: string[] = [];
    control.addEventListener("change", () => values.push(control.value));
    return values;
}

describe("violet-segmented-control", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("selects a segment on click", async () => {
        const control = await renderControl();
        const segments = control.querySelectorAll("violet-segment");

        (segments[1]?.shadowRoot?.querySelector(".button") as HTMLButtonElement | null)?.click();
        await nextFrame();

        expect(control.value).toBe("planting");
        expect(segments[1]?.hasAttribute("checked")).toBe(true);
    });

    it("moves selection with arrow keys", async () => {
        const control = await renderControl();
        const segments = control.querySelectorAll("violet-segment");
        const firstButton = segments[0]?.shadowRoot?.querySelector(".button") as HTMLButtonElement | null;

        firstButton?.focus();
        firstButton?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true }));
        await nextFrame();

        expect(control.value).toBe("planting");
        expect(segments[1]?.hasAttribute("checked")).toBe(true);
    });

    it("emits change when arrow, Home and End keys move the selection", async () => {
        const control = await renderControl();
        const changes = trackChanges(control);
        control.querySelector("violet-segment")?.focus();

        await userEvent.keyboard("{ArrowRight}");
        await userEvent.keyboard("{ArrowRight}");
        await userEvent.keyboard("{ArrowLeft}");
        await userEvent.keyboard("{End}");
        await userEvent.keyboard("{Home}");
        await userEvent.keyboard("{ArrowUp}");

        expect(changes).toEqual(["planting", "irrigation", "planting", "irrigation", "overview", "irrigation"]);
        expect(control.value).toBe("irrigation");
        expect(document.activeElement).toBe(control.querySelectorAll("violet-segment")[2]);
    });

    it("does not emit change when a key leaves the selection where it was", async () => {
        const control = await renderControl();
        const changes = trackChanges(control);
        control.querySelector("violet-segment")?.focus();

        await userEvent.keyboard("{Home}");

        expect(changes).toEqual([]);
        expect(control.value).toBe("overview");
    });

    it("is a single Tab stop on the checked segment", async () => {
        const control = await renderBetweenButtons(`
            <violet-segmented-control value="planting">
                <violet-segment value="overview">Overview</violet-segment>
                <violet-segment value="planting">Planting</violet-segment>
                <violet-segment value="irrigation">Irrigation</violet-segment>
            </violet-segmented-control>
        `);
        const segments = control.querySelectorAll("violet-segment");
        (document.getElementById("before") as HTMLButtonElement).focus();

        await userEvent.tab();
        expect(document.activeElement).toBe(segments[1]);

        await userEvent.tab();
        expect(document.activeElement?.id).toBe("after");

        await userEvent.tab({ shift: true });
        expect(document.activeElement).toBe(segments[1]);

        await userEvent.tab({ shift: true });
        expect(document.activeElement?.id).toBe("before");
    });

    it("puts the Tab stop on the first enabled segment when none is checked", async () => {
        const control = await renderBetweenButtons(`
            <violet-segmented-control>
                <violet-segment value="overview" disabled>Overview</violet-segment>
                <violet-segment value="planting">Planting</violet-segment>
                <violet-segment value="irrigation">Irrigation</violet-segment>
            </violet-segmented-control>
        `);
        (document.getElementById("before") as HTMLButtonElement).focus();

        await userEvent.tab();
        expect(document.activeElement).toBe(control.querySelectorAll("violet-segment")[1]);

        await userEvent.tab();
        expect(document.activeElement?.id).toBe("after");
    });

    it("moves the Tab stop with the selection", async () => {
        const control = await renderBetweenButtons(`
            <violet-segmented-control value="overview">
                <violet-segment value="overview">Overview</violet-segment>
                <violet-segment value="planting">Planting</violet-segment>
                <violet-segment value="irrigation">Irrigation</violet-segment>
            </violet-segmented-control>
        `);
        const segments = control.querySelectorAll("violet-segment");
        (document.getElementById("before") as HTMLButtonElement).focus();

        await userEvent.tab();
        await userEvent.keyboard("{End}");
        await userEvent.tab();
        expect(document.activeElement?.id).toBe("after");

        await userEvent.tab({ shift: true });
        expect(document.activeElement).toBe(segments[2]);

        control.value = "overview";
        await nextFrame();
        (document.getElementById("before") as HTMLButtonElement).focus();
        await userEvent.tab();
        expect(document.activeElement).toBe(segments[0]);
    });

    it("moves the Tab stop when the segment holding it is disabled or re-enabled", async () => {
        const control = await renderBetweenButtons(`
            <violet-segmented-control>
                <violet-segment value="overview">Overview</violet-segment>
                <violet-segment value="planting">Planting</violet-segment>
                <violet-segment value="irrigation">Irrigation</violet-segment>
            </violet-segmented-control>
        `);
        const segments = control.querySelectorAll("violet-segment");
        const before = document.getElementById("before") as HTMLButtonElement;

        segments[0].disabled = true;
        await nextFrame();
        before.focus();
        await userEvent.tab();
        expect(document.activeElement).toBe(segments[1]);
        await userEvent.tab();
        expect(document.activeElement?.id).toBe("after");

        segments[0].removeAttribute("disabled");
        await nextFrame();
        before.focus();
        await userEvent.tab();
        expect(document.activeElement).toBe(segments[0]);
        await userEvent.tab();
        expect(document.activeElement?.id).toBe("after");
    });

    it("moves the Tab stop off a checked segment that becomes disabled and back when it is enabled", async () => {
        const control = await renderBetweenButtons(`
            <violet-segmented-control value="irrigation">
                <violet-segment value="overview" disabled>Overview</violet-segment>
                <violet-segment value="planting">Planting</violet-segment>
                <violet-segment value="irrigation">Irrigation</violet-segment>
            </violet-segmented-control>
        `);
        const segments = control.querySelectorAll("violet-segment");
        const before = document.getElementById("before") as HTMLButtonElement;

        segments[2].setAttribute("disabled", "");
        await nextFrame();
        before.focus();
        await userEvent.tab();
        expect(document.activeElement).toBe(segments[1]);

        segments[2].disabled = false;
        await nextFrame();
        before.focus();
        await userEvent.tab();
        expect(document.activeElement).toBe(segments[2]);
        await userEvent.tab();
        expect(document.activeElement?.id).toBe("after");
    });

    it("keeps no Tab stop while every segment is disabled and recovers one when a segment is enabled", async () => {
        const control = await renderBetweenButtons(`
            <violet-segmented-control>
                <violet-segment value="overview">Overview</violet-segment>
                <violet-segment value="planting">Planting</violet-segment>
            </violet-segmented-control>
        `);
        const segments = control.querySelectorAll("violet-segment");
        const before = document.getElementById("before") as HTMLButtonElement;

        segments[0].disabled = true;
        segments[1].disabled = true;
        await nextFrame();
        before.focus();
        await userEvent.tab();
        expect(document.activeElement?.id).toBe("after");

        segments[1].disabled = false;
        await nextFrame();
        before.focus();
        await userEvent.tab();
        expect(document.activeElement).toBe(segments[1]);
    });

    describe("segment sizing", () => {
        it("pads each segment horizontally and matches a button's height at every target size", async () => {
            for (const target of ["24px", "32px", "44px"]) {
                document.body.innerHTML = `
                    <div style="display:flex;align-items:flex-start;gap:8px;--violet-target-size:${target}">
                        <violet-button appearance="secondary">Day</violet-button>
                        <violet-segmented-control value="a">
                            <violet-segment value="a">Day</violet-segment>
                            <violet-segment value="b">Week</violet-segment>
                        </violet-segmented-control>
                    </div>
                `;
                await customElements.whenDefined("violet-segment");
                await nextFrame();

                const button = document.querySelector("violet-button") as HTMLElement;
                const group = document.querySelector("violet-segmented-control") as HTMLElement;
                const segment = document.querySelector("violet-segment") as HTMLElement;
                const inner = segment.shadowRoot?.querySelector(".button") as HTMLElement;

                const style = getComputedStyle(inner);
                expect(Number.parseFloat(style.paddingLeft)).toBeGreaterThan(0);
                expect(Number.parseFloat(style.paddingRight)).toBeGreaterThan(0);
                expect(Number.isNaN(Number.parseFloat(style.minHeight))).toBe(false);
                expect(Number.parseFloat(style.minHeight)).toBe(Number.parseFloat(target) - 6);
                expect(group.getBoundingClientRect().height).toBeCloseTo(button.getBoundingClientRect().height, 0);
            }
        });
    });
});
