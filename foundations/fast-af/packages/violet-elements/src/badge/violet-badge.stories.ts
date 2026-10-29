import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, within } from "storybook/test";

import "./violet-badge";
import type { VioletBadge } from "./violet-badge";

type Story = StoryObj<VioletBadge>;

const meta: Meta<VioletBadge> = {
    title: "Components/Badge",
    component: "violet-badge",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Compact Violet badge for short status, count, and category labels. It stays semantically quiet by default and can be marked decorative when nearby text already carries the meaning.",
            },
        },
    },
    args: {
        appearance: "filled",
        color: "neutral",
        size: "md",
        decorative: false,
        icon: "",
        label: "",
    },
    argTypes: {
        appearance: {
            control: "select",
            options: ["filled", "outline", "subtle"],
        },
        color: {
            control: "select",
            options: ["neutral", "accent", "success", "warning", "danger"],
        },
        size: {
            control: "select",
            options: ["sm", "md", "lg"],
        },
        decorative: {
            control: "boolean",
        },
        icon: {
            control: "text",
        },
        label: {
            control: "text",
        },
    },
    render: args => {
        const appearance = args.appearance ?? "filled";
        const color = args.color ?? "neutral";
        const size = args.size ?? "md";
        const decorative = args.decorative ? "decorative" : "";
        const icon = args.icon ? `icon="${args.icon}"` : "";
        const label = args.label ? `label="${args.label}"` : "";

        return `<violet-badge appearance="${appearance}" color="${color}" size="${size}" ${decorative} ${icon} ${label}>Field ready</violet-badge>`;
    },
};

export default meta;

export const Overview: Story = {
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const badge = canvasElement.querySelector("violet-badge");

        await expect(badge?.getAttribute("appearance")).toBe("filled");
        await expect(badge?.textContent?.trim()).toBe("Field ready");
        await expect(await canvas.findByText("Field ready")).toBeTruthy();
    },
};

export const SemanticColors: Story = {
    render: () => `
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;">
            <violet-badge color="neutral">Neutral</violet-badge>
            <violet-badge color="accent">Selected</violet-badge>
            <violet-badge color="success">Synced</violet-badge>
            <violet-badge color="warning">Needs review</violet-badge>
            <violet-badge color="danger">Blocked</violet-badge>
        </div>
    `,
};

export const Appearances: Story = {
    render: () => `
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;">
            <violet-badge appearance="filled" color="accent">Filled</violet-badge>
            <violet-badge appearance="outline" color="accent">Outline</violet-badge>
            <violet-badge appearance="subtle" color="accent">Subtle</violet-badge>
        </div>
    `,
};

export const Sizes: Story = {
    render: () => `
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;">
            <violet-badge size="sm">2 new</violet-badge>
            <violet-badge size="md">2 new</violet-badge>
            <violet-badge size="lg">2 new</violet-badge>
        </div>
    `,
};

export const WithIcon: Story = {
    args: {
        color: "success",
        icon: "system/check",
    },
    render: args => {
        const icon = args.icon ? `icon="${args.icon}"` : "";
        return `<violet-badge color="success" ${icon}>Saved</violet-badge>`;
    },
};

export const IconOnly: Story = {
    args: {
        color: "accent",
        icon: "system/check",
        label: "Saved",
    },
    render: args => {
        const icon = args.icon ? `icon="${args.icon}"` : "";
        const label = args.label ? `label="${args.label}"` : "";
        return `<violet-badge color="accent" ${icon} ${label}></violet-badge>`;
    },
};

export const Decorative: Story = {
    args: {
        decorative: true,
        color: "warning",
    },
    render: () => `<violet-badge decorative color="warning">Trial</violet-badge>`,
    play: async ({ canvasElement }) => {
        const badge = canvasElement.querySelector("violet-badge");
        await expect(badge?.getAttribute("aria-hidden")).toBe("true");
    },
};
