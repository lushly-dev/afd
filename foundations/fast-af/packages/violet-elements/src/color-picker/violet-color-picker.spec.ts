import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-color-picker";
import type { VioletColorPicker } from "./violet-color-picker";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderPicker(): Promise<VioletColorPicker> {
    document.body.innerHTML = "";
    const form = document.createElement("form");
    const picker = document.createElement("violet-color-picker") as VioletColorPicker;
    picker.label = "Accent color";
    picker.name = "accent-color";
    picker.value = "#c84f3b";
    form.append(picker);
    document.body.append(form);
    await customElements.whenDefined("violet-color-picker");
    await nextFrame();
    return picker;
}

async function renderEmptyPicker(): Promise<VioletColorPicker> {
    document.body.innerHTML = "";
    const picker = document.createElement("violet-color-picker") as VioletColorPicker;
    picker.label = "Accent color";
    picker.name = "accent-color";
    picker.value = "";
    document.body.append(picker);
    await customElements.whenDefined("violet-color-picker");
    await nextFrame();
    return picker;
}

function trackEvents(picker: VioletColorPicker): Array<{ type: string; value: string }> {
    const events: Array<{ type: string; value: string }> = [];
    for (const type of ["input", "change"]) {
        picker.addEventListener(type, event => {
            // Native input events from the hex field are composed; only the picker's own events carry a detail.
            const detail = (event as CustomEvent<{ value: string } | null>).detail;
            if (event.target === picker && detail && typeof detail === "object") {
                events.push({ type, value: detail.value });
            }
        });
    }
    return events;
}

/** Opens the editor from the keyboard; the picker focuses and selects its hex field. */
async function openEditor(picker: VioletColorPicker): Promise<HTMLInputElement> {
    const input = picker.shadowRoot?.querySelector(".hex-input") as HTMLInputElement;
    (picker.shadowRoot?.querySelector(".trigger") as HTMLButtonElement).focus();
    await userEvent.keyboard("{Enter}");
    await nextFrame();
    await nextFrame();
    expect(picker.shadowRoot?.activeElement).toBe(input);
    return input;
}

describe("violet-color-picker", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("submits its selected color through form-associated state", async () => {
        const picker = await renderPicker();
        const form = picker.closest("form") as HTMLFormElement;

        const formData = new FormData(form);
        expect(formData.get("accent-color")).toBe("#c84f3b");
    });

    it("accepts a valid hex color from the editor input", async () => {
        const picker = await renderPicker();
        const hexInput = picker.shadowRoot?.querySelector(".hex-input") as HTMLInputElement | null;

        expect(hexInput).toBeTruthy();
        hexInput!.value = "#244635";
        hexInput!.dispatchEvent(new Event("input", { bubbles: true }));
        hexInput!.dispatchEvent(new Event("change", { bubbles: true }));
        await nextFrame();

        expect(picker.value).toBe("#244635");
    });

    it("applies a suggested swatch preset", async () => {
        const picker = await renderPicker();
        picker.applyPreset("#244635");
        await nextFrame();

        expect(picker.value).toBe("#244635");
    });

    it("keeps the hex field in sync when channel sliders change the color", async () => {
        const picker = await renderPicker();
        const hueInput = picker.shadowRoot?.querySelector(`#${picker.hueInputId}`) as HTMLInputElement | null;
        const hexInput = picker.shadowRoot?.querySelector(".hex-input") as HTMLInputElement | null;

        expect(hueInput).toBeTruthy();
        expect(hexInput).toBeTruthy();

        hueInput!.value = "120";
        hueInput!.dispatchEvent(new Event("input", { bubbles: true }));
        await nextFrame();

        expect(picker.value).not.toBe("#c84f3b");
        expect(hexInput!.value).toBe(picker.value);
    });

    it("treats an empty required field as invalid", async () => {
        const picker = await renderPicker();
        picker.required = true;
        picker.value = "";
        await nextFrame();

        expect(picker.checkValidity()).toBe(false);
    });

    it("keeps empty state visually empty until a color is selected", async () => {
        const picker = await renderEmptyPicker();

        expect(picker.value).toBe("");
        expect(picker.hexDraft).toBe("");
        expect(picker.currentSelectedColor).toBe("");
        expect(picker.panelTitleText).toBe("No color selected");
    });

    it("keeps an empty editor empty after closing and reopening", async () => {
        const picker = await renderEmptyPicker();
        const input = picker.shadowRoot?.querySelector(".hex-input") as HTMLInputElement;

        picker.toggleOpen();
        await nextFrame();
        await nextFrame();
        input.value = "not a color";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        picker.close();
        await nextFrame();
        await nextFrame();
        picker.toggleOpen();
        await nextFrame();
        await nextFrame();

        expect(picker.open).toBe(true);
        expect(picker.value).toBe("");
        expect(input.value).toBe("");
    });

    it("emits nothing when the hex field is focused and blurred without an edit", async () => {
        const picker = await renderPicker();
        picker.value = "#1670CA";
        await nextFrame();
        const events = trackEvents(picker);

        const input = await openEditor(picker);
        await userEvent.tab();
        expect(picker.shadowRoot?.activeElement).not.toBe(input);

        expect(events).toEqual([]);
        expect(picker.value).toBe("#1670CA");
    });

    it("emits nothing when the hex field is retyped with the same color in another case", async () => {
        const picker = await renderPicker();
        picker.value = "#1670CA";
        await nextFrame();
        const events = trackEvents(picker);

        await openEditor(picker);
        await userEvent.keyboard("#1670CA{Enter}");
        await userEvent.tab();

        // The draft only matches the current color once all six digits are typed, so nothing is emitted.
        expect(events).toEqual([]);
        expect(picker.value).toBe("#1670CA");
    });

    it("previews a typed color at six digits and expands shorthand on commit", async () => {
        const picker = await renderPicker();
        const events = trackEvents(picker);

        const input = await openEditor(picker);
        await userEvent.keyboard("#167");
        expect(input.value).toBe("#167");
        expect(picker.value).toBe("#c84f3b");
        await userEvent.keyboard("0ca");
        expect(input.value).toBe("#1670ca");
        expect(picker.value).toBe("#1670ca");

        input.select();
        await userEvent.keyboard("#246{Enter}");
        expect(picker.value).toBe("#224466");
        expect(input.value).toBe("#224466");
        expect(events).toEqual([
            { type: "input", value: "#1670ca" },
            { type: "input", value: "#224466" },
            { type: "change", value: "#224466" },
        ]);
    });

    it("emits change once when an edited hex field is committed and blurred", async () => {
        const picker = await renderPicker();
        const events = trackEvents(picker);

        const input = await openEditor(picker);
        await userEvent.keyboard("#244635{Enter}");
        await userEvent.tab();
        expect(picker.shadowRoot?.activeElement).not.toBe(input);

        expect(events).toEqual([
            { type: "input", value: "#244635" },
            { type: "change", value: "#244635" },
        ]);
        expect(picker.value).toBe("#244635");
    });

    it("does not emit change when a preset matches the current color", async () => {
        const picker = await renderPicker();
        picker.value = "#C84F3B";
        await nextFrame();
        const events = trackEvents(picker);

        picker.applyPreset("#c84f3b");

        expect(events).toEqual([]);
    });

    it("restores the last selected color after an invalid hex commit", async () => {
        const picker = await renderPicker();
        const input = picker.shadowRoot?.querySelector(".hex-input") as HTMLInputElement;

        input.value = "not a color";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await nextFrame();

        expect(picker.value).toBe("#c84f3b");
        expect(input.value).toBe("#c84f3b");
    });

    it("resets the selected color and visible hex draft together", async () => {
        const picker = await renderPicker();
        const form = picker.closest("form") as HTMLFormElement;
        const input = picker.shadowRoot?.querySelector(".hex-input") as HTMLInputElement;

        form.reset();
        await nextFrame();

        expect(picker.value).toBe("");
        expect(input.value).toBe("");
        expect(picker.panelTitleText).toBe("No color selected");
        expect(new FormData(form).get("accent-color")).toBeNull();
    });

    describe("closed panel", () => {
        it("is not laid out and ignores pointer events while closed", async () => {
            const picker = await renderPicker();
            const panel = picker.shadowRoot?.querySelector(".panel") as HTMLElement;
            const trigger = picker.shadowRoot?.querySelector(".trigger") as HTMLElement;

            expect(panel.matches(":popover-open")).toBe(false);
            expect(getComputedStyle(panel).display).toBe("none");
            expect(panel.getBoundingClientRect().width).toBe(0);

            // Whatever sits at the trigger's centre must not be the panel.
            const rect = trigger.getBoundingClientRect();
            const hit = picker.shadowRoot?.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            expect(panel.contains(hit as Node)).toBe(false);
        });

        it("opens from a real pointer click on the trigger and lays out the panel", async () => {
            const picker = await renderPicker();
            const panel = picker.shadowRoot?.querySelector(".panel") as HTMLElement;
            const trigger = picker.shadowRoot?.querySelector(".trigger") as HTMLElement;

            await userEvent.click(trigger);
            await nextFrame();
            await nextFrame();

            expect(picker.open).toBe(true);
            expect(getComputedStyle(panel).display).toBe("grid");
        });

        it("keeps the open/close transition on opacity and display", async () => {
            const picker = await renderPicker();
            const panel = picker.shadowRoot?.querySelector(".panel") as HTMLElement;
            const style = getComputedStyle(panel);

            expect(style.transitionProperty).toContain("opacity");
            expect(style.transitionProperty).toContain("display");
            expect(style.transitionBehavior).toContain("allow-discrete");
        });
    });
});
