import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import { clearVioletIconRegistryForTesting } from "../icon/icon-registry";
import {
    registerSystemCloseIcon,
    registerSystemSearchIcon,
    registerSystemSettingsIcon,
    registerSystemSortAscendingIcon,
    registerSystemSortDescendingIcon,
} from "../icon/generated";
import "../icon/violet-icon";
import "./violet-menu";
import "./violet-menu-item";
import "../button/violet-button";
import type { VioletMenu } from "./violet-menu";
import type { VioletMenuItem } from "./violet-menu-item";

type VioletMenuStoryArgs = {
    label: string;
    disabled: boolean;
    triggerLabel: string;
    items: { label: string; disabled?: boolean; icon?: string; after?: string }[];
    withSeparator: boolean;
};

function registerIcons(): void {
    clearVioletIconRegistryForTesting();
    registerSystemSearchIcon();
    registerSystemSettingsIcon();
    registerSystemCloseIcon();
    registerSystemSortAscendingIcon();
    registerSystemSortDescendingIcon();
}

function renderMenu(args: VioletMenuStoryArgs): HTMLElement {
    registerIcons();

    const menu = document.createElement("violet-menu") as VioletMenu;

    if (args.label) {
        menu.setAttribute("label", args.label);
    }

    // Trigger button
    const trigger = document.createElement("violet-button");
    trigger.setAttribute("slot", "trigger");
    trigger.setAttribute("appearance", "secondary");
    trigger.textContent = args.triggerLabel;
    menu.append(trigger);

    // Menu items
    for (let i = 0; i < args.items.length; i++) {
        const itemDef = args.items[i]!;

        if (args.withSeparator && i === args.items.length - 1 && args.items.length > 1) {
            const separator = document.createElement("hr");
            menu.append(separator);
        }

        const item = document.createElement("violet-menu-item") as VioletMenuItem;
        if (itemDef.disabled) {
            item.setAttribute("disabled", "");
        }

        if (itemDef.icon) {
            const icon = document.createElement("violet-icon");
            icon.setAttribute("slot", "before");
            icon.setAttribute("icon", itemDef.icon);
            icon.setAttribute("decorative", "");
            item.append(icon);
        }

        const label = document.createTextNode(itemDef.label);
        item.append(label);

        if (itemDef.after) {
            const after = document.createElement("span");
            after.slot = "after";
            after.style.opacity = "0.5";
            after.style.fontSize = "12px";
            after.textContent = itemDef.after;
            item.append(after);
        }

        menu.append(item);
    }

    return menu;
}

const meta = {
    title: "Components/Menu",
    tags: ["autodocs"],
    parameters: {
        docs: {
            story: {
                inline: false,
                height: "280px",
            },
            description: {
                component:
                    "Reusable Violet menu primitive. Combines a trigger button with a floating action menu panel. " +
                    "Uses the native HTML Popover API for light dismiss, JS-based anchor positioning, " +
                    "and full WAI-ARIA APG Menu Button keyboard navigation.",
            },
        },
    },
    argTypes: {
        label: { control: "text" },
        triggerLabel: { control: "text" },
        disabled: { control: "boolean" },
        withSeparator: { control: "boolean" },
    },
    render: (args: VioletMenuStoryArgs) => renderMenu(args),
} satisfies Meta<VioletMenuStoryArgs>;

export default meta;

type Story = StoryObj<VioletMenuStoryArgs>;

/* ------------------------------------------------------------------ */
/*  Stories                                                           */
/* ------------------------------------------------------------------ */

export const Overview: Story = {
    args: {
        label: "Table actions",
        triggerLabel: "Actions",
        disabled: false,
        withSeparator: true,
        items: [
            { label: "Search records", icon: "system/search" },
            { label: "Sort ascending", icon: "system/sort-ascending" },
            { label: "Sort descending", icon: "system/sort-descending", disabled: true },
            { label: "Remove column", icon: "system/close" },
        ],
    },
    play: async ({ canvasElement }) => {
        const menu = canvasElement.querySelector("violet-menu") as VioletMenu | null;
        const trigger = canvasElement.querySelector("[slot='trigger']") as HTMLElement | null;

        if (!menu || !trigger) {
            throw new Error("Expected violet-menu and trigger to render.");
        }

        // Trigger should have correct ARIA
        await waitFor(() => {
            expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
            expect(trigger.getAttribute("aria-expanded")).toBe("false");
            expect(trigger.getAttribute("aria-controls")).toBe(menu.panelId);
        });

        // Click trigger to open
        await userEvent.click(trigger);

        await waitFor(() => {
            expect(menu.open).toBe(true);
            expect(trigger.getAttribute("aria-expanded")).toBe("true");
        });

        // Panel should have correct role
        const panel = menu.shadowRoot?.querySelector("[role='menu']") as HTMLElement | null;
        await expect(panel).not.toBeNull();

        // Items should be rendered
        const items = canvasElement.querySelectorAll("violet-menu-item");
        await expect(items.length).toBe(4);

        // Third item should be disabled
        await expect(items[2]?.hasAttribute("disabled")).toBe(true);

        // Each item with an icon should render a violet-icon in the before slot
        const firstIcon = items[0]?.querySelector("violet-icon");
        await expect(firstIcon).not.toBeNull();
        await expect(firstIcon?.getAttribute("icon")).toBe("system/search");

        // Close the menu (keyboard close is tested in KeyboardNavigation story)
        menu.hide();
    },
};

export const WithShortcuts: Story = {
    args: {
        label: "View options",
        triggerLabel: "View",
        disabled: false,
        withSeparator: true,
        items: [
            { label: "Search", icon: "system/search", after: "\u2318F" },
            { label: "Sort ascending", icon: "system/sort-ascending", after: "\u2318\u2191" },
            { label: "Sort descending", icon: "system/sort-descending", after: "\u2318\u2193" },
            { label: "Settings", icon: "system/settings" },
        ],
    },
};

export const SimpleActions: Story = {
    args: {
        label: "Row actions",
        triggerLabel: "More",
        disabled: false,
        withSeparator: false,
        items: [
            { label: "View details" },
            { label: "Edit settings", icon: "system/settings" },
            { label: "Search related", icon: "system/search" },
            { label: "Remove", icon: "system/close" },
        ],
    },
};

export const KeyboardNavigation: Story = {
    args: {
        label: "Navigation test",
        triggerLabel: "Open menu",
        disabled: false,
        withSeparator: false,
        items: [
            { label: "Alpha", icon: "system/search" },
            { label: "Bravo", icon: "system/settings" },
            { label: "Charlie", icon: "system/sort-ascending" },
            { label: "Delta", icon: "system/close" },
        ],
    },
    play: async ({ canvasElement }) => {
        const menu = canvasElement.querySelector("violet-menu") as VioletMenu | null;
        const trigger = canvasElement.querySelector("[slot='trigger']") as HTMLElement | null;

        if (!menu || !trigger) {
            throw new Error("Expected violet-menu and trigger to render.");
        }

        // Open with Down arrow on trigger
        trigger.focus();
        await userEvent.keyboard("{ArrowDown}");

        await waitFor(() => {
            expect(menu.open).toBe(true);
        });

        // Navigate with arrow keys
        const items = canvasElement.querySelectorAll("violet-menu-item");

        // First item should be focused after open
        await waitFor(() => {
            const control = items[0]?.shadowRoot?.querySelector("[role='menuitem']");
            expect(document.activeElement === items[0] || control === items[0]?.shadowRoot?.activeElement).toBe(true);
        });

        // Arrow down to second item
        await userEvent.keyboard("{ArrowDown}");

        await waitFor(() => {
            const control = items[1]?.shadowRoot?.querySelector("[role='menuitem']");
            expect(control === items[1]?.shadowRoot?.activeElement).toBe(true);
        });

        // End key to last item
        await userEvent.keyboard("{End}");

        await waitFor(() => {
            const control = items[3]?.shadowRoot?.querySelector("[role='menuitem']");
            expect(control === items[3]?.shadowRoot?.activeElement).toBe(true);
        });

        // Home key to first item
        await userEvent.keyboard("{Home}");

        await waitFor(() => {
            const control = items[0]?.shadowRoot?.querySelector("[role='menuitem']");
            expect(control === items[0]?.shadowRoot?.activeElement).toBe(true);
        });

        // Close with Escape
        await userEvent.keyboard("{Escape}");

        await waitFor(() => {
            expect(menu.open).toBe(false);
        });
    },
};

export const DisabledItems: Story = {
    args: {
        label: "Mixed availability",
        triggerLabel: "Options",
        disabled: false,
        withSeparator: false,
        items: [
            { label: "Search", icon: "system/search" },
            { label: "Settings", icon: "system/settings", disabled: true },
            { label: "Sort", icon: "system/sort-ascending" },
            { label: "Close", icon: "system/close", disabled: true },
        ],
    },
};
