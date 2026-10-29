import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, within } from "storybook/test";

import "../tree/violet-tree";
import "./violet-tree-item";

const meta = {
    title: "Components/Tree Item",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Focusable Violet tree item used within `violet-tree` for branch and leaf rows, including selected and disabled states.",
            },
        },
    },
    render: () => `
        <div style="max-inline-size: 28rem;">
            <violet-tree label="Tree item states" appearance="plain">
                <violet-tree-item value="overview" selected>Overview</violet-tree-item>
                <violet-tree-item value="operations" expanded>
                    Operations
                    <violet-tree-item value="propagation">Propagation</violet-tree-item>
                    <violet-tree-item value="irrigation" disabled>Irrigation</violet-tree-item>
                </violet-tree-item>
            </violet-tree>
        </div>
    `,
} satisfies Meta;

export default meta;

type Story = StoryObj;

export const Overview: Story = {
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const treeItems = canvasElement.querySelectorAll("violet-tree-item");

        await expect(treeItems.length).toBeGreaterThan(0);
        await expect(treeItems[0]?.getAttribute("selected")).toBe("");
        await expect(treeItems[3]?.getAttribute("disabled")).toBe("");
        await expect(canvas.getByText("Overview")).toBeVisible();
    },
};

export const Selected: Story = {
    name: "Selected",
    render: () => `
        <div style="max-inline-size: 28rem;">
            <violet-tree label="Selected tree item" appearance="plain">
                <violet-tree-item value="overview" selected>Overview</violet-tree-item>
                <violet-tree-item value="analytics">Analytics</violet-tree-item>
            </violet-tree>
        </div>
    `,
};

export const Disabled: Story = {
    name: "Disabled",
    render: () => `
        <div style="max-inline-size: 28rem;">
            <violet-tree label="Disabled tree item" appearance="plain">
                <violet-tree-item value="workspace" expanded>
                    Workspace
                    <violet-tree-item value="analytics" disabled>Analytics</violet-tree-item>
                </violet-tree-item>
            </violet-tree>
        </div>
    `,
};
