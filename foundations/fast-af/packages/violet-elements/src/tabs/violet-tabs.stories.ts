import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, waitFor } from "storybook/test";

import "../tab-panel/violet-tab-panel";
import type { VioletTabPanel } from "../tab-panel/violet-tab-panel";
import "../tab/violet-tab";
import type { VioletTab } from "../tab/violet-tab";
import "./violet-tabs";
import type { VioletTabs, VioletTabsAppearance, VioletTabsOrientation } from "./violet-tabs";

type VioletTabsStoryArgs = {
    appearance: VioletTabsAppearance;
    orientation: VioletTabsOrientation;
    activeid: string;
    disabled: boolean;
};

const defaultTabData = [
    {
        label: "Overview",
        body: "Capture the current crop plan, status, and key bed-level metadata.",
    },
    {
        label: "Planting",
        body: "Track sowing method, transplant timing, and propagation defaults for this block.",
    },
    {
        label: "Irrigation",
        body: "Configure moisture thresholds, automation windows, and alert routing.",
    },
];

function renderTabs(args: VioletTabsStoryArgs): HTMLElement {
    const tabs = document.createElement("violet-tabs") as VioletTabs;
    tabs.appearance = args.appearance;
    tabs.orientation = args.orientation;
    tabs.disabled = args.disabled;

    defaultTabData.forEach((entry, index) => {
        const tab = document.createElement("violet-tab") as VioletTab;
        tab.textContent = entry.label;
        tab.disabled = args.disabled ? false : index === 2 && args.orientation === "vertical";
        tabs.append(tab);

        const panel = document.createElement("violet-tab-panel") as VioletTabPanel;
        panel.innerHTML = `
            <h3 style="margin:0;font:600 1rem/1.2 Montserrat, 'Segoe UI', sans-serif;">${entry.label}</h3>
            <p style="margin:0;">${entry.body}</p>
        `;
        tabs.append(panel);
    });

    if (args.activeid) {
        tabs.activeid = args.activeid;
    }

    return tabs;
}

const meta = {
    title: "Components/Tabs",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet tabs with automatic activation, paired panels, and open, closed, or mixed tabrail presentations.",
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
        disabled: { control: "boolean" },
    },
    render: (args: VioletTabsStoryArgs) => renderTabs(args),
} satisfies Meta<VioletTabsStoryArgs>;

export default meta;

type Story = StoryObj<VioletTabsStoryArgs>;

export const Overview: Story = {
    args: {
        appearance: "open",
        orientation: "horizontal",
        activeid: "",
        disabled: false,
    },
    play: async ({ canvasElement }) => {
        const tabs = canvasElement.querySelector("violet-tabs") as VioletTabs | null;
        const tabElements = Array.from(canvasElement.querySelectorAll("violet-tab")) as VioletTab[];
        const panels = Array.from(canvasElement.querySelectorAll("violet-tab-panel")) as VioletTabPanel[];

        if (!tabs || tabElements.length < 2 || panels.length < 2) {
            throw new Error("Expected violet-tabs to render tab and panel pairs.");
        }

        tabElements[0]?.focus();
        tabElements[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

        await waitFor(() => {
            expect(tabs.activeid).toBe(tabElements[1]?.id);
            expect(tabElements[1]?.getAttribute("aria-selected")).toBe("true");
            expect(panels[1]?.hidden).toBe(false);
            expect(panels[0]?.hidden).toBe(true);
        });
    },
};

export const Closed: Story = {
    args: {
        appearance: "closed",
        orientation: "horizontal",
        activeid: "",
        disabled: false,
    },
};

export const Mixed: Story = {
    args: {
        appearance: "mixed",
        orientation: "horizontal",
        activeid: "",
        disabled: false,
    },
    play: async ({ canvasElement }) => {
        const tabElements = Array.from(canvasElement.querySelectorAll("violet-tab")) as VioletTab[];
        if (tabElements.length < 2) {
            throw new Error("Expected mixed violet-tabs to render.");
        }

        await expect(tabElements[0]?.getAttribute("data-appearance")).toBe("mixed");
        await expect(tabElements[1]?.getAttribute("data-appearance")).toBe("open");
    },
};

export const Vertical: Story = {
    args: {
        appearance: "open",
        orientation: "vertical",
        activeid: "",
        disabled: false,
    },
};

export const Disabled: Story = {
    args: {
        appearance: "closed",
        orientation: "horizontal",
        activeid: "",
        disabled: true,
    },
};
