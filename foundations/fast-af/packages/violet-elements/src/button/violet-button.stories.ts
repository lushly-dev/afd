import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent } from "storybook/test";

import { clearVioletIconRegistryForTesting } from "../icon/icon-registry";
import { registerSystemCloseIcon, registerSystemSearchIcon, registerSystemSettingsIcon } from "../icon/generated";
import "../icon/violet-icon";
import "./violet-button";
import type { VioletButton } from "./violet-button";

type VioletButtonStoryArgs = {
    appearance: "primary" | "secondary" | "quiet" | "transparent" | "danger";
    disabled: boolean;
    label: string;
    before: "" | "system/search" | "system/settings" | "system/close";
    after: "" | "system/search" | "system/settings" | "system/close";
};

function renderButton(args: VioletButtonStoryArgs): HTMLElement {
    clearVioletIconRegistryForTesting();
    registerSystemSearchIcon();
    registerSystemSettingsIcon();
    registerSystemCloseIcon();

    const element = document.createElement("violet-button") as VioletButton;
    element.appearance = args.appearance;
    element.disabled = args.disabled;
    element.replaceChildren();

    if (args.before) {
        const before = document.createElement("violet-icon");
        before.slot = "before";
        before.setAttribute("icon", args.before);
        before.setAttribute("decorative", "");
        element.append(before);
    }

    element.append(document.createTextNode(args.label));

    if (args.after) {
        const after = document.createElement("violet-icon");
        after.slot = "after";
        after.setAttribute("icon", args.after);
        after.setAttribute("decorative", "");
        element.append(after);
    }

    return element;
}

const meta = {
    title: "Components/Button",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet action button primitive for primary, secondary, quiet, transparent, and danger action emphasis.",
            },
        },
    },
    argTypes: {
        appearance: {
            control: "inline-radio",
            options: ["primary", "secondary", "quiet", "transparent", "danger"],
        },
        disabled: { control: "boolean" },
        before: {
            control: "inline-radio",
            options: ["", "system/search", "system/settings", "system/close"],
        },
        after: {
            control: "inline-radio",
            options: ["", "system/search", "system/settings", "system/close"],
        },
    },
    render: (args: VioletButtonStoryArgs) => renderButton(args),
} satisfies Meta<VioletButtonStoryArgs>;

export default meta;

type Story = StoryObj<VioletButtonStoryArgs>;

export const Overview: Story = {
    args: {
        appearance: "primary",
        disabled: false,
        label: "Save bed plan",
        before: "",
        after: "",
    },
    play: async ({ canvasElement }) => {
        const button = canvasElement.querySelector("violet-button") as VioletButton | null;
        await expect(Boolean(button)).toBe(true);

        const control = button?.shadowRoot?.querySelector("button") as HTMLButtonElement | null;
        await expect(button?.textContent ?? "").toContain("Save bed plan");
        await expect(control?.dataset.appearance).toBe("primary");

        if (!control) {
            throw new Error("Expected violet-button control to render.");
        }

        await userEvent.click(control);
    },
};

export const Secondary: Story = {
    args: {
        appearance: "secondary",
        disabled: false,
        label: "Secondary action",
        before: "",
        after: "",
    },
};

export const QuietDisabled: Story = {
    args: {
        appearance: "quiet",
        disabled: true,
        label: "Quiet action",
        before: "",
        after: "",
    },
};

export const Transparent: Story = {
    args: {
        appearance: "transparent",
        disabled: false,
        label: "View details",
        before: "",
        after: "",
    },
};

export const Danger: Story = {
    args: {
        appearance: "danger",
        disabled: false,
        label: "Delete bed",
        before: "",
        after: "",
    },
    play: async ({ canvasElement }) => {
        const control = canvasElement.querySelector("violet-button")?.shadowRoot?.querySelector("button");
        await expect(control?.dataset.appearance).toBe("danger");
    },
};

export const WithSlots: Story = {
    args: {
        appearance: "secondary",
        disabled: false,
        label: "Manage filters",
        before: "system/search",
        after: "system/close",
    },
};
