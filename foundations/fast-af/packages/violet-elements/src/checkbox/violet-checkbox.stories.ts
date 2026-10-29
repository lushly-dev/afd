import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "./violet-checkbox";
import type { VioletCheckbox } from "./violet-checkbox";

type VioletCheckboxStoryArgs = {
    checked: boolean;
    disabled: boolean;
    indeterminate: boolean;
    inline: boolean;
    invalid: boolean;
    ariaLabel: string;
    label: string;
    supporting: string;
    name: string;
    value: string;
    required: boolean;
};

function renderCheckbox(args: VioletCheckboxStoryArgs): HTMLElement {
    const element = document.createElement("violet-checkbox") as VioletCheckbox;
    element.checked = args.checked;
    element.disabled = args.disabled;
    element.indeterminate = args.indeterminate;
    element.inline = args.inline;
    element.invalid = args.invalid;
    element.name = args.name;
    element.value = args.value;
    element.required = args.required;

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
    title: "Components/Checkbox",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet checkbox primitive with label and optional supporting text.",
            },
        },
    },
    argTypes: {
        checked: { control: "boolean" },
        disabled: { control: "boolean" },
        indeterminate: { control: "boolean" },
        inline: { control: "boolean" },
        invalid: { control: "boolean" },
        required: { control: "boolean" },
    },
    render: (args: VioletCheckboxStoryArgs) => renderCheckbox(args),
} satisfies Meta<VioletCheckboxStoryArgs>;

export default meta;

type Story = StoryObj<VioletCheckboxStoryArgs>;

export const Overview: Story = {
    args: {
        checked: false,
        disabled: false,
        indeterminate: false,
        inline: false,
        invalid: false,
        ariaLabel: "",
        label: "Include seedling inventory",
        supporting: "Keeps tray counts in the current plan.",
        name: "includeSeedlingInventory",
        value: "yes",
        required: true,
    },
    play: async ({ canvasElement }) => {
        const checkbox = canvasElement.querySelector("violet-checkbox") as VioletCheckbox | null;
        await expect(Boolean(checkbox)).toBe(true);

        const input = checkbox?.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        await expect(input?.checked).toBe(false);
        await expect(input?.indeterminate).toBe(false);

        if (!input || !checkbox) {
            throw new Error("Expected violet-checkbox to render.");
        }

        await expect(input.required).toBe(true);
        await expect(input.name).toBe("includeSeedlingInventory");
        await expect(input.value).toBe("yes");
        await expect(checkbox.checkValidity()).toBe(false);

        await userEvent.click(input);
        await expect(checkbox.checked).toBe(true);
        await expect(checkbox.checkValidity()).toBe(true);

        const form = document.createElement("form");
        form.append(checkbox);
        await waitFor(() => {
            const formData = new FormData(form);
            expect(formData.get("includeSeedlingInventory")).toBe("yes");
        });
    },
};

export const Invalid: Story = {
    args: {
        checked: false,
        disabled: false,
        indeterminate: false,
        inline: false,
        invalid: true,
        ariaLabel: "",
        label: "Accept crop rotation warning",
        supporting: "Acknowledge before continuing.",
        name: "acceptRotationWarning",
        value: "yes",
        required: false,
    },
};

export const Checked: Story = {
    args: {
        checked: true,
        disabled: false,
        indeterminate: false,
        inline: false,
        invalid: false,
        ariaLabel: "",
        label: "Track seed lot",
        supporting: "Selection persists when the lot is already assigned.",
        name: "trackSeedLot",
        value: "yes",
        required: false,
    },
};

export const Disabled: Story = {
    args: {
        checked: false,
        disabled: true,
        indeterminate: false,
        inline: false,
        invalid: false,
        ariaLabel: "",
        label: "Track seed lot",
        supporting: "Disabled while this batch is locked for review.",
        name: "trackSeedLot",
        value: "yes",
        required: false,
    },
};

export const IndeterminateInline: Story = {
    args: {
        checked: false,
        disabled: false,
        indeterminate: true,
        inline: true,
        invalid: false,
        ariaLabel: "Select all plants",
        label: "",
        supporting: "",
        name: "selectAllPlants",
        value: "yes",
        required: false,
    },
    play: async ({ canvasElement }) => {
        const checkbox = canvasElement.querySelector("violet-checkbox") as VioletCheckbox | null;
        const input = checkbox?.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;

        if (!checkbox || !input) {
            throw new Error("Expected inline indeterminate checkbox to render.");
        }

        await expect(input.indeterminate).toBe(true);
        await expect(input.getAttribute("aria-label")).toBe("Select all plants");
        await expect(checkbox.shadowRoot?.querySelector(".content")?.hasAttribute("hidden")).toBe(true);
    },
};
