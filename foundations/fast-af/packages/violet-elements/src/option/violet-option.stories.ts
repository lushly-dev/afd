import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-option";
import type { VioletOption } from "./violet-option";

type VioletOptionStoryArgs = {
    selected: boolean;
    active: boolean;
    disabled: boolean;
    label: string;
    description: string;
};

function renderOption(args: VioletOptionStoryArgs): HTMLElement {
    const option = document.createElement("violet-option") as VioletOption;
    option.value = args.label.toLowerCase().replace(/\s+/g, "-");
    option.label = args.label;
    option.selected = args.selected;
    option.active = args.active;
    option.disabled = args.disabled;
    option.textContent = args.label;

    if (args.description) {
        const description = document.createElement("span");
        description.slot = "description";
        description.textContent = args.description;
        option.append(description);
    }

    const listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    listbox.setAttribute("aria-label", "Sowing methods");
    listbox.append(option);
    return listbox;
}

const meta = {
    title: "Components/Option",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet option row for listbox-like selection surfaces, with selected, active, disabled, and optional description states.",
            },
        },
    },
    argTypes: {
        selected: { control: "boolean" },
        active: { control: "boolean" },
        disabled: { control: "boolean" },
        label: { control: "text" },
        description: { control: "text" },
    },
    render: (args: VioletOptionStoryArgs) => renderOption(args),
} satisfies Meta<VioletOptionStoryArgs>;

export default meta;

type Story = StoryObj<VioletOptionStoryArgs>;

export const Overview: Story = {
    args: {
        selected: false,
        active: true,
        disabled: false,
        label: "Direct sowing",
        description: "Best for fast field prep and broad coverage.",
    },
    play: async ({ canvasElement }) => {
        const option = canvasElement.querySelector("violet-option") as VioletOption | null;
        const control = option?.shadowRoot?.querySelector('[part="control"]') as HTMLElement | null;

        if (!option || !control) {
            throw new Error("Expected violet-option to render.");
        }

        await expect(option.getAttribute("role")).toBe("option");
        await expect(option.getAttribute("aria-selected")).toBe("false");
        await expect(option.getAttribute("aria-disabled")).toBe("false");
        await expect(option.textContent).toContain("Direct sowing");
    },
};

export const Selected: Story = {
    args: {
        selected: true,
        active: true,
        disabled: false,
        label: "Broadcast sowing",
        description: "Used when broad bed coverage matters most.",
    },
};

export const Disabled: Story = {
    args: {
        selected: false,
        active: false,
        disabled: true,
        label: "Hydroponic setup",
        description: "Temporarily unavailable for this season.",
    },
};
