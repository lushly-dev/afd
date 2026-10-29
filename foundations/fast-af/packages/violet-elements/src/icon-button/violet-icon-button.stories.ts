import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent } from "storybook/test";

import { clearVioletIconRegistryForTesting } from "../icon/icon-registry";
import { registerSystemCloseIcon, registerSystemSearchIcon, registerSystemSettingsIcon } from "../icon/generated";
import "../icon/violet-icon";
import "./violet-icon-button";
import type { VioletIconButton } from "./violet-icon-button";

type VioletIconButtonStoryArgs = {
    appearance: "primary" | "secondary" | "quiet" | "transparent";
    disabled: boolean;
    label: string;
    iconName: "system/search" | "system/settings" | "system/close";
};

function renderIconButton(args: VioletIconButtonStoryArgs): HTMLElement {
    clearVioletIconRegistryForTesting();
    registerSystemSearchIcon();
    registerSystemSettingsIcon();
    registerSystemCloseIcon();

    const element = document.createElement("violet-icon-button") as VioletIconButton;
    element.appearance = args.appearance;
    element.disabled = args.disabled;
    element.label = args.label;

    const icon = document.createElement("violet-icon");
    icon.setAttribute("icon", args.iconName);
    icon.setAttribute("decorative", "");
    element.append(icon);

    return element;
}

const meta = {
    title: "Components/Icon Button",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet icon-only button primitive for toolbar and utility actions.",
            },
        },
    },
    argTypes: {
        appearance: {
            control: "inline-radio",
            options: ["primary", "secondary", "quiet", "transparent"],
        },
        disabled: { control: "boolean" },
        label: { control: "text" },
        iconName: {
            control: "inline-radio",
            options: ["system/search", "system/settings", "system/close"],
        },
    },
    render: (args: VioletIconButtonStoryArgs) => renderIconButton(args),
} satisfies Meta<VioletIconButtonStoryArgs>;

export default meta;

type Story = StoryObj<VioletIconButtonStoryArgs>;

export const Overview: Story = {
    args: {
        appearance: "secondary",
        disabled: false,
        label: "Settings",
        iconName: "system/settings",
    },
    play: async ({ canvasElement }) => {
        const button = canvasElement.querySelector("violet-icon-button") as VioletIconButton | null;
        await expect(Boolean(button)).toBe(true);

        const control = button?.shadowRoot?.querySelector("button") as HTMLButtonElement | null;

        if (!control) {
            throw new Error("Expected violet-icon-button control to render.");
        }

        await expect(control.dataset.appearance).toBe("secondary");
        await expect(control.getAttribute("aria-label")).toBe("Settings");
        await expect(Boolean(button?.querySelector("violet-icon"))).toBe(true);
        await userEvent.click(control);
    },
};

export const Primary: Story = {
    args: {
        appearance: "primary",
        disabled: false,
        label: "Pin item",
        iconName: "system/search",
    },
};

export const Transparent: Story = {
    args: {
        appearance: "transparent",
        disabled: false,
        label: "Close panel",
        iconName: "system/close",
    },
};

export const QuietDisabled: Story = {
    args: {
        appearance: "quiet",
        disabled: true,
        label: "Archive item",
        iconName: "system/search",
    },
};
