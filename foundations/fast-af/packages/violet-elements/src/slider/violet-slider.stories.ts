import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, waitFor } from "storybook/test";

import "./violet-slider";
import type { VioletSlider, VioletSliderOrientation } from "./violet-slider";

type VioletSliderStoryArgs = {
    label: string;
    supportingText: string;
    errorText: string;
    valueText: string;
    value: string;
    min: string;
    max: string;
    step: string;
    name: string;
    required: boolean;
    disabled: boolean;
    invalid: boolean;
    showFill: boolean;
    showTicks: boolean;
    orientation: VioletSliderOrientation;
};

function renderSlider(args: VioletSliderStoryArgs): HTMLFormElement {
    const form = document.createElement("form");
    form.style.display = "contents";

    const slider = document.createElement("violet-slider") as VioletSlider;
    slider.label = args.label;
    slider.supportingText = args.supportingText;
    slider.errorText = args.errorText;
    slider.valueText = args.valueText;
    slider.value = args.value;
    slider.min = args.min;
    slider.max = args.max;
    slider.step = args.step;
    slider.name = args.name;
    slider.required = args.required;
    slider.disabled = args.disabled;
    slider.invalid = args.invalid;
    slider.showFill = args.showFill;
    slider.showTicks = args.showTicks;
    slider.orientation = args.orientation;
    form.append(slider);
    return form;
}

const meta = {
    title: "Components/Slider",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet slider built as a native-first range input with custom Violet track, fill, and thumb styling.",
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
        showFill: { control: "boolean" },
        showTicks: { control: "boolean" },
    },
    render: (args: VioletSliderStoryArgs) => renderSlider(args),
} satisfies Meta<VioletSliderStoryArgs>;

export default meta;

type Story = StoryObj<VioletSliderStoryArgs>;

export const Overview: Story = {
    args: {
        label: "Moisture threshold",
        supportingText: "Adjust the irrigation trigger point for this bed block.",
        errorText: "",
        valueText: "",
        value: "42",
        min: "0",
        max: "100",
        step: "1",
        name: "moisture-threshold",
        required: false,
        disabled: false,
        invalid: false,
        showFill: false,
        showTicks: false,
        orientation: "horizontal",
    },
    play: async ({ canvasElement }) => {
        const form = canvasElement.querySelector("form");
        const slider = canvasElement.querySelector("violet-slider") as VioletSlider | null;
        const input = slider?.shadowRoot?.querySelector('input[type="range"]') as HTMLInputElement | null;

        if (!form || !slider || !input) {
            throw new Error("Expected violet-slider to render inside a form with a native range input.");
        }

        const nextValue = String(Number(input.value) + 1);
        input.value = nextValue;
        input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

        await waitFor(() => {
            expect(slider.value).toBe(nextValue);
        });

        await expect(slider.form).toBe(form);
        await expect(slider.name).toBe("moisture-threshold");
        await expect(slider.checkValidity()).toBe(true);

        const formData = new FormData(form);
        await expect(formData.get("moisture-threshold")).toBe(nextValue);
    },
};

export const Stepped: Story = {
    args: {
        label: "Fan speed",
        supportingText: "Snap to fixed operating levels for the propagation room.",
        errorText: "",
        valueText: "medium",
        value: "2",
        min: "0",
        max: "4",
        step: "1",
        name: "fan-speed",
        required: false,
        disabled: false,
        invalid: false,
        showFill: false,
        showTicks: true,
        orientation: "horizontal",
    },
};

export const Vertical: Story = {
    args: {
        label: "Vent opening",
        supportingText: "Use a vertical slider when the control is paired with a narrow settings rail.",
        errorText: "",
        valueText: "",
        value: "60",
        min: "0",
        max: "100",
        step: "5",
        name: "vent-opening",
        required: false,
        disabled: false,
        invalid: false,
        showFill: false,
        showTicks: false,
        orientation: "vertical",
    },
};

export const Invalid: Story = {
    args: {
        label: "Shade cloth level",
        supportingText: "The selected level is outside the approved operating range for this bay.",
        errorText: "Choose a value within the approved range.",
        valueText: "",
        value: "85",
        min: "0",
        max: "100",
        step: "5",
        name: "shade-cloth",
        required: false,
        disabled: false,
        invalid: true,
        showFill: false,
        showTicks: false,
        orientation: "horizontal",
    },
    play: async ({ canvasElement }) => {
        const slider = canvasElement.querySelector("violet-slider") as VioletSlider | null;
        if (!slider) {
            throw new Error("Expected invalid violet-slider to render.");
        }

        await expect(slider.checkValidity()).toBe(false);
    },
};

export const Disabled: Story = {
    args: {
        label: "Nutrient dosing",
        supportingText: "This slider is locked while the irrigation program is inherited from the greenhouse template.",
        errorText: "",
        valueText: "",
        value: "25",
        min: "0",
        max: "100",
        step: "1",
        name: "nutrient-dosing",
        required: false,
        disabled: true,
        invalid: false,
        showFill: false,
        showTicks: false,
        orientation: "horizontal",
    },
};

export const WithFill: Story = {
    args: {
        label: "Soil saturation",
        supportingText: "Shows the filled track from zero to the current value.",
        errorText: "",
        valueText: "",
        value: "65",
        min: "0",
        max: "100",
        step: "1",
        name: "soil-saturation",
        required: false,
        disabled: false,
        invalid: false,
        showFill: true,
        showTicks: false,
        orientation: "horizontal",
    },
};
