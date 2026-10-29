import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "../radio/violet-radio";
import type { VioletRadio } from "../radio/violet-radio";
import "./violet-radio-group";
import type { VioletRadioGroup, VioletRadioGroupOrientation } from "./violet-radio-group";

type VioletRadioGroupStoryArgs = {
    label: string;
    supportingText: string;
    value: string;
    name: string;
    disabled: boolean;
    invalid: boolean;
    required: boolean;
    orientation: VioletRadioGroupOrientation;
};

const defaultOptions = [
    {
        label: "Broadcast sowing",
        supporting: "Dense sowing for baby leaf or nursery staging.",
        value: "broadcast",
    },
    {
        label: "Direct seed",
        supporting: "Seed directly into the finished bed.",
        value: "direct",
    },
    {
        label: "Tray transplant",
        supporting: "Raise in trays first, then move into the block.",
        value: "transplant",
    },
];

function createRadio(option: { label: string; supporting: string; value: string }, selectedValue: string): VioletRadio {
    const radio = document.createElement("violet-radio") as VioletRadio;
    radio.value = option.value;
    radio.checked = option.value === selectedValue;
    radio.textContent = option.label;

    if (option.supporting) {
        const supporting = document.createElement("span");
        supporting.slot = "supporting";
        supporting.textContent = option.supporting;
        radio.append(supporting);
    }

    return radio;
}

function renderRadioGroup(args: VioletRadioGroupStoryArgs): HTMLElement {
    const element = document.createElement("violet-radio-group") as VioletRadioGroup;
    element.label = args.label;
    element.supportingText = args.supportingText;
    element.value = args.value;
    element.name = args.name;
    element.disabled = args.disabled;
    element.invalid = args.invalid;
    element.required = args.required;
    element.orientation = args.orientation;

    defaultOptions.forEach(option => {
        element.append(createRadio(option, args.value));
    });

    return element;
}

const meta = {
    title: "Components/Radio Group",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet radio group with roving keyboard selection and form association.",
            },
        },
    },
    argTypes: {
        disabled: { control: "boolean" },
        invalid: { control: "boolean" },
        required: { control: "boolean" },
        orientation: {
            control: "inline-radio",
            options: ["vertical", "horizontal"],
        },
    },
    render: (args: VioletRadioGroupStoryArgs) => renderRadioGroup(args),
} satisfies Meta<VioletRadioGroupStoryArgs>;

export default meta;

type Story = StoryObj<VioletRadioGroupStoryArgs>;

export const Overview: Story = {
    args: {
        label: "Sowing method",
        supportingText: "Choose the default propagation path for this crop plan.",
        value: "",
        name: "sowingMethod",
        disabled: false,
        invalid: false,
        required: true,
        orientation: "vertical",
    },
    play: async ({ canvasElement }) => {
        const group = canvasElement.querySelector("violet-radio-group") as VioletRadioGroup | null;
        const radios = Array.from(canvasElement.querySelectorAll("violet-radio")) as VioletRadio[];

        if (!group || radios.length < 2) {
            throw new Error("Expected violet-radio-group to render with options.");
        }

        await expect(group.checkValidity()).toBe(false);

        const secondRadioControl = radios[1]?.shadowRoot?.querySelector(".root") as HTMLElement | null;
        if (!secondRadioControl) {
            throw new Error("Expected violet-radio option to render an interactive control.");
        }

        await userEvent.click(secondRadioControl);

        await waitFor(() => {
            expect(group.value).toBe("direct");
            expect(radios[1]?.checked).toBe(true);
            expect(group.checkValidity()).toBe(true);
        });

        const form = document.createElement("form");
        form.append(group);

        await waitFor(() => {
            const formData = new FormData(form);
            expect(formData.get("sowingMethod")).toBe("direct");
        });
    },
};

export const Horizontal: Story = {
    args: {
        label: "Sowing method",
        supportingText: "Use horizontal layout when options need to sit in a tighter row.",
        value: "direct",
        name: "sowingMethod",
        disabled: false,
        invalid: false,
        required: false,
        orientation: "horizontal",
    },
};

export const Invalid: Story = {
    args: {
        label: "Sowing method",
        supportingText: "Use invalid state when a server-side rule rejects the selection.",
        value: "",
        name: "sowingMethod",
        disabled: false,
        invalid: true,
        required: false,
        orientation: "vertical",
    },
};

export const Disabled: Story = {
    args: {
        label: "Sowing method",
        supportingText: "Selection is locked while the cultivation plan is publishing.",
        value: "broadcast",
        name: "sowingMethod",
        disabled: true,
        invalid: false,
        required: false,
        orientation: "vertical",
    },
};
