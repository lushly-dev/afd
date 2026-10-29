import { afterEach, describe, expect, it } from "vitest";

import "./violet-slider";
import type { VioletSlider } from "./violet-slider";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

async function renderSlider(options: {
    value?: string;
    min?: string;
    max?: string;
    step?: string;
    orientation?: "horizontal" | "vertical";
    invalid?: boolean;
} = {}): Promise<VioletSlider> {
    document.body.innerHTML = "";

    const slider = document.createElement("violet-slider") as VioletSlider;
    slider.label = "Moisture threshold";
    slider.supportingText = "Adjust irrigation automation.";
    slider.value = options.value ?? "50";
    slider.min = options.min ?? "0";
    slider.max = options.max ?? "100";
    slider.step = options.step ?? "5";
    slider.orientation = options.orientation ?? "horizontal";
    slider.invalid = options.invalid ?? false;

    document.body.append(slider);

    await customElements.whenDefined("violet-slider");
    await nextFrame();

    return slider;
}

describe("violet-slider", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("normalizes programmatic values against min, max, and step", async () => {
        const slider = await renderSlider({
            value: "43",
            min: "10",
            max: "90",
            step: "10",
        });

        expect(slider.value).toBe("40");
        expect(slider.controlStyle).toContain("--_slider-percent");
    });

    it("updates value from the native range input and emits commit state", async () => {
        const slider = await renderSlider();
        const input = slider.shadowRoot?.querySelector('input[type="range"]') as HTMLInputElement | null;

        input!.value = "70";
        input?.dispatchEvent(new Event("input", { bubbles: true }));
        await nextFrame();

        expect(slider.value).toBe("70");

        input!.value = "80";
        input?.dispatchEvent(new Event("change", { bubbles: true }));
        await nextFrame();

        expect(slider.value).toBe("80");
    });

    it("wires vertical orientation and visible error semantics to the native input", async () => {
        const slider = await renderSlider({
            orientation: "vertical",
            invalid: true,
        });

        const input = slider.shadowRoot?.querySelector('input[type="range"]') as HTMLInputElement | null;

        expect(input?.getAttribute("aria-orientation")).toBe("vertical");
        expect(input?.getAttribute("aria-invalid")).toBe("true");
        expect(input?.getAttribute("aria-describedby")).toContain("supporting");
        expect(input?.getAttribute("aria-describedby")).toContain("error");
    });
});
