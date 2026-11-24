import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-color-picker.define";
import "../theme/violet-theme.define";
import { loadVioletBuiltInTheme } from "../theme/violet-theme-runtime";
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
    picker.value = "#146ba0";
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
    (picker.shadowRoot!.querySelector(".trigger") as HTMLButtonElement).focus();
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

    it("names the trigger by its label and every text it shows", async () => {
        const picker = await renderPicker();
        const trigger = picker.shadowRoot?.querySelector(".trigger");
        const shown = [picker.valueId, picker.metaId].map(id => picker.shadowRoot?.getElementById(id)?.textContent?.trim());

        // The value and the hint beside it are both visible, so both are part of the name (WCAG 2.5.3).
        expect(trigger?.getAttribute("aria-labelledby")?.split(" ").slice(-2)).toEqual([picker.valueId, picker.metaId]);
        expect(shown.every(Boolean)).toBe(true);
    });

    it("submits its selected color through form-associated state", async () => {
        const picker = await renderPicker();
        const form = picker.closest("form") as HTMLFormElement;

        const formData = new FormData(form);
        expect(formData.get("accent-color")).toBe("#146ba0");
    });

    it("exposes AFD Refined default presets and seeds empty sliders from AFD blue ink", async () => {
        const picker = await renderEmptyPicker();

        expect(picker.presets).toEqual([
            "#181b1a",
            "#2c5e4b",
            "#a3ebcd",
            "#146ba0",
            "#c42a1a",
            "#f96e5b",
            "#92400e",
            "#6b7d6e",
        ]);
        expect({ hue: picker.hue, saturation: picker.saturation, lightness: picker.lightness }).toEqual({
            hue: 203,
            saturation: 78,
            lightness: 35,
        });
    });

    it("accepts a valid hex color from the editor input", async () => {
        const picker = await renderPicker();
        const hexInput = picker.shadowRoot?.querySelector(".hex-input") as HTMLInputElement | null;

        expect(hexInput).toBeTruthy();
        hexInput!.value = "#2c5e4b";
        hexInput!.dispatchEvent(new Event("input", { bubbles: true }));
        hexInput!.dispatchEvent(new Event("change", { bubbles: true }));
        await nextFrame();

        expect(picker.value).toBe("#2c5e4b");
    });

    it("applies a suggested swatch preset", async () => {
        const picker = await renderPicker();
        picker.applyPreset("#2c5e4b");
        await nextFrame();

        expect(picker.value).toBe("#2c5e4b");
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

        expect(picker.value).not.toBe("#146ba0");
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
        expect(picker.value).toBe("#146ba0");
        await userEvent.keyboard("0ca");
        expect(input.value).toBe("#1670ca");
        expect(picker.value).toBe("#1670ca");

        await userEvent.clear(input);
        await userEvent.keyboard("#246{Enter}");
        await nextFrame();
        expect(picker.value).toBe("#224466");
        expect(input.value).toBe("#224466");
        expect(events).toEqual([
            { type: "input", value: "#1670ca" },
            { type: "input", value: "#224466" },
            { type: "change", value: "#224466" },
        ]);
    });

    it("does not overwrite a same-frame hex edit on the next animation frame (#2382)", async () => {
        const picker = await renderPicker();
        const input = await openEditor(picker);

        // Enter a valid 6-digit hex (updates `picker.value`) and immediately edit in the same frame.
        input.value = "#1670ca";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        expect(picker.value).toBe("#1670ca");

        input.value = "#24";
        input.dispatchEvent(new Event("input", { bubbles: true }));

        await nextFrame();
        await nextFrame();

        expect(input.value).toBe("#24");

        // Programmatic value updates display the normalized hex value in the field.
        picker.value = "#ABC";
        await nextFrame();
        expect(input.value).toBe("#aabbcc");
    });

    it("emits change once when an edited hex field is committed and blurred", async () => {
        const picker = await renderPicker();
        const events = trackEvents(picker);

        const input = await openEditor(picker);
        await userEvent.keyboard("#2c5e4b{Enter}");
        await userEvent.tab();
        expect(picker.shadowRoot?.activeElement).not.toBe(input);

        expect(events).toEqual([
            { type: "input", value: "#2c5e4b" },
            { type: "change", value: "#2c5e4b" },
        ]);
        expect(picker.value).toBe("#2c5e4b");
    });

    it("does not emit change when a preset matches the current color", async () => {
        const picker = await renderPicker();
        picker.value = "#146BA0";
        await nextFrame();
        const events = trackEvents(picker);

        picker.applyPreset("#146ba0");

        expect(events).toEqual([]);
    });

    it("restores the last selected color after an invalid hex commit", async () => {
        const picker = await renderPicker();
        const input = picker.shadowRoot?.querySelector(".hex-input") as HTMLInputElement;

        input.value = "not a color";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await nextFrame();

        expect(picker.value).toBe("#146ba0");
        expect(input.value).toBe("#146ba0");
    });

    it("restores the initial color and visible hex draft together on form reset", async () => {
        const picker = await renderPicker();
        const form = picker.closest("form") as HTMLFormElement;
        const input = picker.shadowRoot?.querySelector(".hex-input") as HTMLInputElement;

        picker.value = "#2c5e4b";
        await nextFrame();
        form.reset();
        await nextFrame();

        expect(picker.value).toBe("#146ba0");
        expect(input.value).toBe("#146ba0");
        expect(picker.panelTitleText).toBe("Selected color");
        expect(new FormData(form).get("accent-color")).toBe("#146ba0");
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

    it.each(["light", "dark", "high-contrast"])(
        "keeps the hex input resting and focus borders at >= 3:1 in %s (#657)",
        async preset => {
            await loadVioletBuiltInTheme();
            document.body.innerHTML = "";
            const theme = document.createElement("violet-theme");
            theme.setAttribute("preset", preset);
            const picker = document.createElement("violet-color-picker") as VioletColorPicker;
            picker.label = "Accent color";
            picker.value = "#146ba0";
            theme.append(picker);
            document.body.append(theme);
            await customElements.whenDefined("violet-color-picker");
            await nextFrame();
            await nextFrame();

            const parseRgba = (color: string): [number, number, number, number] => {
                const nums = (color.match(/[\d.]+/g) ?? []).map(Number);
                return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0, nums[3] ?? 1];
            };
            const composite = (fg: [number, number, number, number], bg: [number, number, number, number]): [number, number, number] => [
                fg[0] * fg[3] + bg[0] * (1 - fg[3]),
                fg[1] * fg[3] + bg[1] * (1 - fg[3]),
                fg[2] * fg[3] + bg[2] * (1 - fg[3]),
            ];
            const luminance = (rgb: [number, number, number]): number => {
                const [r = 0, g = 0, b = 0] = rgb.map(v => {
                    const c = v / 255;
                    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
                });
                return r * 0.2126 + g * 0.7152 + b * 0.0722;
            };
            const contrast = (fgColor: string, bgColor: string, backdropColor: string): number => {
                const bg = composite(parseRgba(bgColor), parseRgba(backdropColor));
                const fg = composite(parseRgba(fgColor), [bg[0], bg[1], bg[2], 1]);
                const l1 = luminance(fg);
                const l2 = luminance(bg);
                return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            };

            const hexInput = await openEditor(picker);
            const panel = picker.shadowRoot?.querySelector(".panel") as HTMLElement;
            const panelBg = getComputedStyle(panel).backgroundColor;
            hexInput.style.transition = "none";

            // Focused via keyboard openEditor() -> :focus-visible matches.
            expect(hexInput.matches(":focus-visible")).toBe(true);
            const focused = getComputedStyle(hexInput);
            const focusedBorder = focused.borderTopColor;
            expect(contrast(focusedBorder, focused.backgroundColor, panelBg)).toBeGreaterThanOrEqual(3);

            // Blur to check resting border.
            hexInput.blur();
            await nextFrame();
            const resting = getComputedStyle(hexInput);
            const restingBorder = resting.borderTopColor;
            expect(restingBorder).not.toBe(focusedBorder);
            expect(contrast(restingBorder, resting.backgroundColor, panelBg)).toBeGreaterThanOrEqual(3);

            // Hover over resting input.
            await userEvent.hover(hexInput);
            await nextFrame();
            expect(hexInput.matches(":hover")).toBe(true);
            const hovered = getComputedStyle(hexInput);
            expect(contrast(hovered.borderTopColor, hovered.backgroundColor, panelBg)).toBeGreaterThanOrEqual(3);
            await userEvent.unhover(hexInput);
        },
    );
});
