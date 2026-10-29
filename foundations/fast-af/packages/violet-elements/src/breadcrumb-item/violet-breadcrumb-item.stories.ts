import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-breadcrumb-item";

type VioletBreadcrumbItemStoryArgs = {
    current: boolean;
};

function renderItem(args: VioletBreadcrumbItemStoryArgs): HTMLElement {
    const item = document.createElement("violet-breadcrumb-item");
    if (args.current) {
        item.setAttribute("current", "");
    } else {
        item.setAttribute("href", "/plans");
    }
    item.textContent = "Plans";
    const list = document.createElement("div");
    list.setAttribute("role", "list");
    list.append(item);
    return list;
}

const meta = {
    title: "Components/Breadcrumb Item",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Individual breadcrumb item that renders as a link or current-page label.",
            },
        },
    },
    argTypes: {
        current: { control: "boolean" },
    },
    render: (args: VioletBreadcrumbItemStoryArgs) => renderItem(args),
} satisfies Meta<VioletBreadcrumbItemStoryArgs>;

export default meta;

type Story = StoryObj<VioletBreadcrumbItemStoryArgs>;

export const Overview: Story = {
    args: {
        current: false,
    },
    play: async ({ canvasElement }) => {
        const item = canvasElement.querySelector("violet-breadcrumb-item");
        const link = item?.shadowRoot?.querySelector("a");
        if (!item || !link) {
            throw new Error("Expected breadcrumb item link to render.");
        }

        await expect(link.getAttribute("href")).toBe("/plans");
    },
};

export const Current: Story = {
    args: {
        current: true,
    },
};
