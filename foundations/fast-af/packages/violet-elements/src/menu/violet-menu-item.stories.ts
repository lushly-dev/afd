import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import { clearVioletIconRegistryForTesting } from "../icon/icon-registry";
import { registerSystemSearchIcon, registerSystemSettingsIcon } from "../icon/generated";
import "../icon/violet-icon";
import "./violet-menu-item";
import type { VioletMenuItem } from "./violet-menu-item";

type VioletMenuItemStoryArgs = {
    label: string;
    disabled: boolean;
    icon: string;
    after: string;
};

function renderMenuItem(args: VioletMenuItemStoryArgs): HTMLElement {
    clearVioletIconRegistryForTesting();
    registerSystemSearchIcon();
    registerSystemSettingsIcon();

    const item = document.createElement("violet-menu-item") as VioletMenuItem;
    if (args.disabled) {
        item.disabled = true;
    }

    if (args.icon) {
        const icon = document.createElement("violet-icon");
        icon.setAttribute("slot", "before");
        icon.setAttribute("icon", args.icon);
        icon.setAttribute("decorative", "");
        item.append(icon);
    }

    item.append(document.createTextNode(args.label));

    if (args.after) {
        const after = document.createElement("span");
        after.slot = "after";
        after.style.color = "#52525b";
        after.style.fontSize = "12px";
        after.textContent = args.after;
        item.append(after);
    }

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.append(item);
    return menu;
}

const meta = {
    title: "Components/Menu Item",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Individual menu item primitive with leading/trailing slots and disabled state.",
            },
        },
    },
    argTypes: {
        label: { control: "text" },
        disabled: { control: "boolean" },
        icon: { control: "text" },
        after: { control: "text" },
    },
    render: (args: VioletMenuItemStoryArgs) => renderMenuItem(args),
} satisfies Meta<VioletMenuItemStoryArgs>;

export default meta;

type Story = StoryObj<VioletMenuItemStoryArgs>;

export const Overview: Story = {
    args: {
        label: "Search records",
        disabled: false,
        icon: "system/search",
        after: "",
    },
    play: async ({ canvasElement }) => {
        const item = canvasElement.querySelector("violet-menu-item") as VioletMenuItem | null;
        if (!item) {
            throw new Error("Expected violet-menu-item to render.");
        }

        const control = item.shadowRoot?.querySelector("[role='menuitem']");
        await expect(control).not.toBeNull();
        await expect(control?.getAttribute("aria-disabled")).toBe("false");
    },
};

export const WithShortcut: Story = {
    args: {
        label: "Settings",
        disabled: false,
        icon: "system/settings",
        after: "\u2318,",
    },
};

export const Disabled: Story = {
    args: {
        label: "Unavailable action",
        disabled: true,
        icon: "system/settings",
        after: "",
    },
};

export const PlainText: Story = {
    args: {
        label: "Simple action",
        disabled: false,
        icon: "",
        after: "",
    },
};
