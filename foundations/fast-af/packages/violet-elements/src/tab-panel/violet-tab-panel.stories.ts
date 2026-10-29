import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-tab-panel";
import type { VioletTabPanel } from "./violet-tab-panel";

type VioletTabPanelStoryArgs = {
    heading: string;
    body: string;
};

function renderPanel(args: VioletTabPanelStoryArgs): VioletTabPanel {
    const panel = document.createElement("violet-tab-panel") as VioletTabPanel;
    panel.setAttribute("role", "tabpanel");
    panel.tabIndex = 0;
    panel.innerHTML = `
        <div style="display:grid;gap:12px;">
            <h3 style="margin:0;font:600 1rem/1.2 Montserrat, 'Segoe UI', sans-serif;">${args.heading}</h3>
            <p style="margin:0;">${args.body}</p>
        </div>
    `;
    return panel;
}

const meta = {
    title: "Components/Tab Panel",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Primitive Violet tab panel surface paired to a tab inside violet-tabs.",
            },
        },
    },
    argTypes: {
        heading: { control: "text" },
        body: { control: "text" },
    },
    render: (args: VioletTabPanelStoryArgs) => renderPanel(args),
} satisfies Meta<VioletTabPanelStoryArgs>;

export default meta;

type Story = StoryObj<VioletTabPanelStoryArgs>;

export const Overview: Story = {
    args: {
        heading: "Crop plan overview",
        body: "Capture current crop status, succession timing, and operating notes for the selected bed block.",
    },
    play: async ({ canvasElement }) => {
        const panel = canvasElement.querySelector("violet-tab-panel");
        await expect(panel?.getAttribute("role")).toBe("tabpanel");
        await expect(panel?.textContent).toContain("Crop plan overview");
    },
};
