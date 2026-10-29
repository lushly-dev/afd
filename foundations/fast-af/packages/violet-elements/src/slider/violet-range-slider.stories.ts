import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, waitFor } from "storybook/test";

import "./violet-range-slider";
import type { VioletRangeSlider, VioletRangeSliderOrientation } from "./violet-range-slider";

type VioletRangeSliderStoryArgs = {
    label: string;
    supportingText: string;
    errorText: string;
    valueStart: string;
    valueEnd: string;
    min: string;
    max: string;
    step: string;
    name: string;
    labelStart: string;
    labelEnd: string;
    required: boolean;
    disabled: boolean;
    invalid: boolean;
    showTicks: boolean;
    orientation: VioletRangeSliderOrientation;
};

function renderSlider(args: VioletRangeSliderStoryArgs): HTMLFormElement {
    const form = document.createElement("form");
    form.style.display = "contents";

    const slider = document.createElement("violet-range-slider") as VioletRangeSlider;
    slider.label = args.label;
    slider.supportingText = args.supportingText;
    slider.errorText = args.errorText;
    slider.valueStart = args.valueStart;
    slider.valueEnd = args.valueEnd;
    slider.min = args.min;
    slider.max = args.max;
    slider.step = args.step;
    slider.name = args.name;
    slider.labelStart = args.labelStart;
    slider.labelEnd = args.labelEnd;
    slider.required = args.required;
    slider.disabled = args.disabled;
    slider.invalid = args.invalid;
    slider.showTicks = args.showTicks;
    slider.orientation = args.orientation;
    form.append(slider);
    return form;
}

const meta = {
    title: "Components/Range Slider",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet range slider built as a dual-thumb native-first range input with custom Violet track, fill, and thumb styling.",
            },
        },
    },
    argTypes: {
        orientation: {
            control: "inline-radio",
            options: ["horizontal", "vertical"],
        },
        disabled: { control: "boolean" },
        invalid: { control: "boolean" },
        showTicks: { control: "boolean" },
    },
    render: (args: VioletRangeSliderStoryArgs) => renderSlider(args),
} satisfies Meta<VioletRangeSliderStoryArgs>;

export default meta;

type Story = StoryObj<VioletRangeSliderStoryArgs>;

export const Overview: Story = {
    args: {
        label: "Temperature range",
        supportingText: "Set the minimum and maximum temperature thresholds for this zone.",
        errorText: "",
        valueStart: "30",
        valueEnd: "70",
        min: "0",
        max: "100",
        step: "1",
        name: "temperature",
        labelStart: "Minimum",
        labelEnd: "Maximum",
        required: false,
        disabled: false,
        invalid: false,
        showTicks: false,
        orientation: "horizontal",
    },
    play: async ({ canvasElement }) => {
        const form = canvasElement.querySelector("form");
        const slider = canvasElement.querySelector("violet-range-slider") as VioletRangeSlider | null;
        const inputStart = slider?.shadowRoot?.querySelector(".input-start") as HTMLInputElement | null;
        const inputEnd = slider?.shadowRoot?.querySelector(".input-end") as HTMLInputElement | null;

        if (!form || !slider || !inputStart || !inputEnd) {
            throw new Error("Expected violet-range-slider to render inside a form with two native range inputs.");
        }

        // Bump the start thumb by 1
        const nextStartValue = String(Number(inputStart.value) + 1);
        inputStart.value = nextStartValue;
        inputStart.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        inputStart.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

        await waitFor(() => {
            expect(slider.valueStart).toBe(nextStartValue);
        });

        await expect(slider.form).toBe(form);
        await expect(slider.name).toBe("temperature");
        await expect(slider.checkValidity()).toBe(true);

        const formData = new FormData(form);
        await expect(formData.get("temperature-start")).toBe(nextStartValue);
        await expect(formData.get("temperature-end")).toBe(slider.valueEnd);
    },
};

export const Stepped: Story = {
    args: {
        label: "Humidity band",
        supportingText: "Snap to 10% increments for the humidity control band.",
        errorText: "",
        valueStart: "30",
        valueEnd: "70",
        min: "0",
        max: "100",
        step: "10",
        name: "humidity-band",
        labelStart: "Low",
        labelEnd: "High",
        required: false,
        disabled: false,
        invalid: false,
        showTicks: true,
        orientation: "horizontal",
    },
};

export const Vertical: Story = {
    args: {
        label: "Water level",
        supportingText: "Use a vertical slider when the control is paired with a narrow settings rail.",
        errorText: "",
        valueStart: "20",
        valueEnd: "80",
        min: "0",
        max: "100",
        step: "5",
        name: "water-level",
        labelStart: "Low",
        labelEnd: "High",
        required: false,
        disabled: false,
        invalid: false,
        showTicks: false,
        orientation: "vertical",
    },
};

export const Invalid: Story = {
    args: {
        label: "pH range",
        supportingText: "The selected range is outside the approved operating limits.",
        errorText: "Choose a range within the approved limits.",
        valueStart: "10",
        valueEnd: "90",
        min: "0",
        max: "100",
        step: "1",
        name: "ph-range",
        labelStart: "Low",
        labelEnd: "High",
        required: false,
        disabled: false,
        invalid: true,
        showTicks: false,
        orientation: "horizontal",
    },
    play: async ({ canvasElement }) => {
        const slider = canvasElement.querySelector("violet-range-slider") as VioletRangeSlider | null;
        if (!slider) {
            throw new Error("Expected invalid violet-range-slider to render.");
        }

        await expect(slider.checkValidity()).toBe(false);
    },
};

export const Disabled: Story = {
    args: {
        label: "Nutrient concentration",
        supportingText: "This slider is locked while the fertigation program is inherited from the greenhouse template.",
        errorText: "",
        valueStart: "25",
        valueEnd: "75",
        min: "0",
        max: "100",
        step: "1",
        name: "nutrient-concentration",
        labelStart: "Minimum",
        labelEnd: "Maximum",
        required: false,
        disabled: true,
        invalid: false,
        showTicks: false,
        orientation: "horizontal",
    },
};
