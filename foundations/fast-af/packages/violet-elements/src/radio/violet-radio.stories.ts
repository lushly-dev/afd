import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent } from "storybook/test";

import "./violet-radio";
import type { VioletRadio } from "./violet-radio";

type VioletRadioStoryArgs = {
    checked: boolean;
    disabled: boolean;
    inline: boolean;
    invalid: boolean;
    ariaLabel: string;
    label: string;
    supporting: string;
    name: string;
    value: string;
};

function renderRadio(args: VioletRadioStoryArgs): HTMLElement {
    const element = document.createElement("violet-radio") as VioletRadio;
    element.checked = args.checked;
    element.disabled = args.disabled;
    element.inline = args.inline;
    element.invalid = args.invalid;
    element.name = args.name;
    element.value = args.value;

    if (args.ariaLabel) {
        element.setAttribute("aria-label", args.ariaLabel);
    }

    if (args.label) {
        element.textContent = args.label;
    }

    if (args.supporting) {
        const supporting = document.createElement("span");
        supporting.slot = "supporting";
        supporting.textContent = args.supporting;
        element.append(supporting);
    }

    return element;
}

const meta = {
    title: "Components/Radio",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet radio primitive with compact inline mode and optional supporting text.",
            },
        },
    },
    argTypes: {
        checked: { control: "boolean" },
        disabled: { control: "boolean" },
        inline: { control: "boolean" },
        invalid: { control: "boolean" },
    },
    render: (args: VioletRadioStoryArgs) => renderRadio(args),
} satisfies Meta<VioletRadioStoryArgs>;

export default meta;

type Story = StoryObj<VioletRadioStoryArgs>;

export const Overview: Story = {
    args: {
        checked: false,
        disabled: false,
        inline: false,
        invalid: false,
        ariaLabel: "",
        label: "Broadcast sowing",
        supporting: "Best when the tray should stay in a dense sowing pattern.",
        name: "sowingMethod",
        value: "broadcast",
    },
    play: async ({ canvasElement }) => {
        const radio = canvasElement.querySelector("violet-radio") as VioletRadio | null;
        const control = radio?.shadowRoot?.querySelector(".root") as HTMLElement | null;

        if (!radio || !control) {
            throw new Error("Expected violet-radio to render.");
        }

        await expect(radio.checked).toBe(false);
        await userEvent.click(control);
        await expect(radio.checked).toBe(true);
    },
};

export const Checked: Story = {
    args: {
        checked: true,
        disabled: false,
        inline: false,
        invalid: false,
        ariaLabel: "",
        label: "Direct seed",
        supporting: "Use when the crop should stay in its final bed.",
        name: "sowingMethod",
        value: "direct",
    },
};

export const KeyboardActivation: Story = {
    args: {
        checked: false,
        disabled: false,
        inline: false,
        invalid: false,
        ariaLabel: "",
        label: "Direct seed",
        supporting: "Use Space or Enter to choose this option.",
        name: "sowingMethod",
        value: "direct",
    },
    play: async ({ canvasElement }) => {
        const radio = canvasElement.querySelector("violet-radio") as VioletRadio | null;

        if (!radio) {
            throw new Error("Expected violet-radio to render.");
        }

        radio.focus();
        await expect(document.activeElement).toBe(radio);

        radio.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
        await expect(radio.checked).toBe(true);

        radio.checked = false;
        radio.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: " " }));
        await expect(radio.checked).toBe(true);
    },
};

export const Disabled: Story = {
    args: {
        checked: false,
        disabled: true,
        inline: false,
        invalid: false,
        ariaLabel: "",
        label: "Tray transplant",
        supporting: "Unavailable while this batch is already committed to field.",
        name: "sowingMethod",
        value: "transplant",
    },
};

export const Invalid: Story = {
    args: {
        checked: false,
        disabled: false,
        inline: false,
        invalid: true,
        ariaLabel: "",
        label: "Tray transplant",
        supporting: "Show invalid treatment when a required group needs attention.",
        name: "sowingMethod",
        value: "transplant",
    },
};

export const Inline: Story = {
    args: {
        checked: true,
        disabled: false,
        inline: true,
        invalid: false,
        ariaLabel: "Compact direct seed option",
        label: "",
        supporting: "",
        name: "sowingMethod",
        value: "direct",
    },
    play: async ({ canvasElement }) => {
        const radio = canvasElement.querySelector("violet-radio") as VioletRadio | null;
        await expect(radio?.shadowRoot?.querySelector(".content")?.hasAttribute("hidden")).toBe(true);
        await expect(radio?.getAttribute("aria-label")).toBe("Compact direct seed option");
    },
};

export const InlineGridDensity: Story = {
    args: {
        checked: true,
        disabled: false,
        inline: true,
        invalid: false,
        ariaLabel: "Grid direct seed option",
        label: "",
        supporting: "",
        name: "gridSowingMethod",
        value: "direct",
    },
    render: (args: VioletRadioStoryArgs) => {
        const frame = document.createElement("div");
        frame.style.display = "inline-grid";
        frame.style.inlineSize = "1rem";
        frame.style.blockSize = "1rem";
        frame.style.lineHeight = "0";
        frame.style.setProperty("--violet-radio-inline-target-size", "1rem");
        frame.style.setProperty("--violet-radio-inline-gap", "0");
        frame.append(renderRadio(args));
        return frame;
    },
    play: async ({ canvasElement }) => {
        const radio = canvasElement.querySelector("violet-radio") as VioletRadio | null;
        await expect(radio?.inline).toBe(true);
        await expect(radio?.shadowRoot?.querySelector(".content")?.hasAttribute("hidden")).toBe(true);
        await expect(radio?.getAttribute("aria-label")).toBe("Grid direct seed option");
    },
};
