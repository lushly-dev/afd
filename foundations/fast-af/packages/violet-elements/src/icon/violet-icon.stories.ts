import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import { clearVioletIconRegistryForTesting } from "./icon-registry";
import { registerSystemCloseIcon, registerSystemSearchIcon, registerSystemSettingsIcon } from "./generated";
import "./violet-icon";
import type { VioletIcon } from "./violet-icon";

type VioletIconStoryArgs = {
    icon: "system/search" | "system/settings" | "system/close";
    label: string;
    decorative: boolean;
};

function renderIcon(args: VioletIconStoryArgs): HTMLElement {
    clearVioletIconRegistryForTesting();
    registerSystemSearchIcon();
    registerSystemSettingsIcon();
    registerSystemCloseIcon();

    const element = document.createElement("violet-icon") as VioletIcon;
    element.icon = args.icon;
    element.label = args.label;
    element.decorative = args.decorative;
    element.style.setProperty("--violet-icon-size", "20px");
    return element;
}

const meta = {
    title: "Components/Icon",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet icon primitive backed by the internal icon registry.",
            },
        },
    },
    argTypes: {
        icon: {
            control: "inline-radio",
            options: ["system/search", "system/settings", "system/close"],
        },
        decorative: { control: "boolean" },
    },
    render: (args: VioletIconStoryArgs) => renderIcon(args),
} satisfies Meta<VioletIconStoryArgs>;

export default meta;

type Story = StoryObj<VioletIconStoryArgs>;

export const Overview: Story = {
    args: {
        icon: "system/search",
        label: "Search icon",
        decorative: false,
    },
    play: async ({ canvasElement }) => {
        const icon = canvasElement.querySelector("violet-icon") as VioletIcon | null;
        await expect(Boolean(icon)).toBe(true);

        const glyph = icon?.shadowRoot?.querySelector(".glyph") as HTMLElement | null;
        await expect(glyph?.getAttribute("role")).toBe("img");
        await expect(glyph?.getAttribute("aria-label")).toBe("Search icon");
        await expect(Boolean(glyph?.querySelector("svg"))).toBe(true);
        await expect(glyph?.textContent?.includes("[object Object]") ?? false).toBe(false);
    },
};

export const Decorative: Story = {
    args: {
        icon: "system/settings",
        label: "",
        decorative: true,
    },
};
