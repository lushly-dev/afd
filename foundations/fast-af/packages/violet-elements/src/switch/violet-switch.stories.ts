import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "./violet-switch";
import type { VioletSwitch } from "./violet-switch";

type VioletSwitchStoryArgs = {
    checked: boolean;
    disabled: boolean;
    inline: boolean;
    invalid: boolean;
    ariaLabel: string;
    label: string;
    supporting: string;
    name: string;
    value: string;
    required: boolean;
};

function renderSwitch(args: VioletSwitchStoryArgs): HTMLElement {
    const element = document.createElement("violet-switch") as VioletSwitch;
    element.checked = args.checked;
    element.disabled = args.disabled;
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
    title: "Components/Switch",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet switch primitive with binary on/off semantics, inline mode, and optional supporting text.",
            },
        },
    },
    argTypes: {
        checked: { control: "boolean" },
        disabled: { control: "boolean" },
        inline: { control: "boolean" },
        invalid: { control: "boolean" },
        required: { control: "boolean" },
    },
    render: (args: VioletSwitchStoryArgs) => renderSwitch(args),
} satisfies Meta<VioletSwitchStoryArgs>;

export default meta;

type Story = StoryObj<VioletSwitchStoryArgs>;

export const Overview: Story = {
    args: {
        checked: false,
        disabled: false,
        inline: false,
        invalid: false,
        ariaLabel: "",
        label: "Enable irrigation alerts",
        supporting: "Turns on weather-driven watering notifications for this bed.",
        name: "irrigationAlerts",
        value: "enabled",
        required: true,
    },
    play: async ({ canvasElement }) => {
        const element = canvasElement.querySelector("violet-switch") as VioletSwitch | null;
        const input = element?.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        const track = element?.shadowRoot?.querySelector(".track") as HTMLLabelElement | null;

        if (!element || !input || !track) {
            throw new Error("Expected violet-switch to render.");
        }

        await expect(input.getAttribute("role")).toBe("switch");
        await expect(input.checked).toBe(false);
        await expect(element.checkValidity()).toBe(false);

        await userEvent.click(track);

        await waitFor(() => {
            expect(element.checked).toBe(true);
            expect(element.checkValidity()).toBe(true);
        });

        const form = document.createElement("form");
        form.append(element);
        await waitFor(() => {
            const formData = new FormData(form);
            expect(formData.get("irrigationAlerts")).toBe("enabled");
        });
    },
};

export const Checked: Story = {
    args: {
        checked: true,
        disabled: false,
        inline: false,
        invalid: false,
        ariaLabel: "",
        label: "Auto-approve tray restocks",
        supporting: "Keeps replenishment requests moving without manual review.",
        name: "trayRestocks",
        value: "enabled",
        required: false,
    },
};

export const Disabled: Story = {
    args: {
        checked: false,
        disabled: true,
        inline: false,
        invalid: false,
        ariaLabel: "",
        label: "Enable harvest sync",
        supporting: "Unavailable while the field audit is in progress.",
        name: "harvestSync",
        value: "enabled",
        required: false,
    },
};

export const Invalid: Story = {
    args: {
        checked: false,
        disabled: false,
        inline: false,
        invalid: true,
        ariaLabel: "",
        label: "Share bed availability",
        supporting: "Present invalid styling for explicit review states.",
        name: "shareBedAvailability",
        value: "enabled",
        required: false,
    },
};

export const Inline: Story = {
    args: {
        checked: true,
        disabled: false,
        inline: true,
        invalid: false,
        ariaLabel: "Compact irrigation alerts switch",
        label: "",
        supporting: "",
        name: "compactIrrigationAlerts",
        value: "enabled",
        required: false,
    },
    play: async ({ canvasElement }) => {
        const element = canvasElement.querySelector("violet-switch") as VioletSwitch | null;
        const input = element?.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;

        if (!element || !input) {
            throw new Error("Expected inline violet-switch to render.");
        }

        await expect(element.shadowRoot?.querySelector(".content")?.hasAttribute("hidden")).toBe(true);
        await expect(input.getAttribute("aria-label")).toBe("Compact irrigation alerts switch");
    },
};
