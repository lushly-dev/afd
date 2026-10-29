import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "../breadcrumb-item/violet-breadcrumb-item";
import "./violet-breadcrumb";

function renderBreadcrumb(): HTMLElement {
    const breadcrumb = document.createElement("violet-breadcrumb") as HTMLElement & { label: string };
    breadcrumb.label = "Crop plan path";

    const items = [
        { label: "Plans", href: "/plans" },
        { label: "Propagation", href: "/plans/propagation" },
        { label: "Spring greens", href: "" },
    ];

    for (const itemDef of items) {
        const item = document.createElement("violet-breadcrumb-item");
        if (itemDef.href) {
            item.setAttribute("href", itemDef.href);
        } else {
            item.setAttribute("current", "");
        }
        item.textContent = itemDef.label;
        breadcrumb.append(item);
    }

    return breadcrumb;
}

const meta = {
    title: "Components/Breadcrumb",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Labeled breadcrumb navigation built from `violet-breadcrumb` and `violet-breadcrumb-item`.",
            },
        },
    },
    render: () => renderBreadcrumb(),
} satisfies Meta;

export default meta;

type Story = StoryObj;

export const Overview: Story = {
    play: async ({ canvasElement }) => {
        const breadcrumb = canvasElement.querySelector("violet-breadcrumb");
        const items = canvasElement.querySelectorAll("violet-breadcrumb-item");
        if (!breadcrumb || items.length !== 3) {
            throw new Error("Expected breadcrumb items to render.");
        }

        const nav = breadcrumb.shadowRoot?.querySelector("nav");
        const current = items[2]?.shadowRoot?.querySelector("[aria-current='page']");

        await expect(nav?.getAttribute("aria-label")).toBe("Crop plan path");
        await expect(current).not.toBeNull();
    },
};
