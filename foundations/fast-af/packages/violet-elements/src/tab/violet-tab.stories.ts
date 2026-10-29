import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-tab";
import type { VioletTab } from "./violet-tab";

type VioletTabStoryArgs = {
    appearance: "open" | "closed" | "mixed";
    orientation: "horizontal" | "vertical";
    selected: boolean;
    disabled: boolean;
    label: string;
};

function renderTab(args: VioletTabStoryArgs): HTMLElement {
    const tab = document.createElement("violet-tab") as VioletTab;
    tab.textContent = args.label;
    tab.disabled = args.disabled;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", args.selected ? "true" : "false");
    tab.setAttribute("aria-disabled", args.disabled ? "true" : "false");
    tab.tabIndex = args.selected && !args.disabled ? 0 : -1;
    tab.syncPresentation(args.appearance, args.orientation);
    const tablist = document.createElement("div");
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-orientation", args.orientation);
    tablist.append(tab);
    return tablist;
}

const meta = {
    title: "Components/Tab",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Primitive Violet tab surface used inside violet-tabs for open, closed, and mixed visual treatments.",
            },
        },
    },
    argTypes: {
        appearance: {
            control: "inline-radio",
            options: ["open", "closed", "mixed"],
        },
        orientation: {
            control: "inline-radio",
            options: ["horizontal", "vertical"],
        },
        selected: { control: "boolean" },
        disabled: { control: "boolean" },
        label: { control: "text" },
    },
    render: (args: VioletTabStoryArgs) => renderTab(args),
} satisfies Meta<VioletTabStoryArgs>;

export default meta;

type Story = StoryObj<VioletTabStoryArgs>;

export const Overview: Story = {
    args: {
        appearance: "open",
        orientation: "horizontal",
        selected: true,
        disabled: false,
        label: "Overview",
    },
    play: async ({ canvasElement }) => {
        const tab = canvasElement.querySelector("violet-tab");
        await expect(tab?.getAttribute("aria-selected")).toBe("true");
        await expect(tab?.getAttribute("data-appearance")).toBe("open");
    },
};

export const Closed: Story = {
    args: {
        appearance: "closed",
        orientation: "horizontal",
        selected: true,
        disabled: false,
        label: "Planting",
    },
};

export const Vertical: Story = {
    args: {
        appearance: "open",
        orientation: "vertical",
        selected: true,
        disabled: false,
        label: "Irrigation controls",
    },
};

export const Disabled: Story = {
    args: {
        appearance: "mixed",
        orientation: "horizontal",
        selected: false,
        disabled: true,
        label: "Automation",
    },
};
