import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-spinner";
import type { VioletSpinner } from "./violet-spinner";

type Story = StoryObj<VioletSpinner>;

const meta: Meta<VioletSpinner> = {
    title: "Components/Spinner",
    component: "violet-spinner",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Indeterminate Violet loading spinner for local waiting states. Use the built-in label for accessibility, or mark it decorative when nearby text already communicates the loading meaning.",
            },
        },
    },
    args: {
        label: "Loading crop plan",
        decorative: false,
        size: "md",
    },
    argTypes: {
        label: {
            control: "text",
        },
        decorative: {
            control: "boolean",
        },
        size: {
            control: "select",
            options: ["sm", "md", "lg"],
        },
    },
    render: args => {
        const label = args.label ? `label="${args.label}"` : "";
        const decorative = args.decorative ? "decorative" : "";
        const size = args.size ?? "md";
        return `<violet-spinner size="${size}" ${label} ${decorative}></violet-spinner>`;
    },
};

export default meta;

export const Overview: Story = {
    play: async ({ canvasElement }) => {
        const spinner = canvasElement.querySelector("violet-spinner");
        const part = spinner?.shadowRoot?.querySelector(".spinner");

        await expect(part?.getAttribute("role")).toBe("img");
        await expect(part?.getAttribute("aria-label")).toBe("Loading crop plan");
    },
};

export const Sizes: Story = {
    render: () => `
        <div style="display:flex;gap:16px;align-items:center;">
            <violet-spinner size="sm" label="Loading"></violet-spinner>
            <violet-spinner size="md" label="Loading"></violet-spinner>
            <violet-spinner size="lg" label="Loading"></violet-spinner>
        </div>
    `,
};

export const Decorative: Story = {
    render: () => `<violet-spinner decorative size="sm"></violet-spinner>`,
    play: async ({ canvasElement }) => {
        const spinner = canvasElement.querySelector("violet-spinner");
        const part = spinner?.shadowRoot?.querySelector(".spinner");

        await expect(part?.getAttribute("aria-hidden")).toBe("true");
    },
};

export const InContext: Story = {
    render: () => `
        <div style="display:flex;align-items:center;gap:var(--space-layout-sm);font-family:inherit;font-size:var(--type-body-md-size);line-height:var(--type-body-md-line);color:var(--color-text-secondary);">
            <violet-spinner decorative size="sm"></violet-spinner>
            <span>Syncing row changes…</span>
        </div>
    `,
};
