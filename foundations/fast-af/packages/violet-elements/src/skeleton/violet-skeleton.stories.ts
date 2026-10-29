import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-skeleton";
import "../card/violet-card";
import type { VioletSkeleton } from "./violet-skeleton";

type Story = StoryObj<VioletSkeleton>;

const meta: Meta<VioletSkeleton> = {
    title: "Components/Skeleton",
    component: "violet-skeleton",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Decorative Violet loading placeholder for text, avatars, cards, and quiet content-loading states. It should be paired with higher-level loading semantics rather than announced on its own.",
            },
        },
    },
    args: {
        shape: "rect",
        size: "md",
        lines: "1",
        animated: true,
    },
    argTypes: {
        shape: {
            control: "select",
            options: ["rect", "circle", "text"],
        },
        size: {
            control: "select",
            options: ["sm", "md", "lg"],
        },
        lines: {
            control: "text",
        },
        animated: {
            control: "boolean",
        },
    },
    render: args => {
        const shape = args.shape ?? "rect";
        const size = args.size ?? "md";
        const lines = args.lines ?? "1";
        const animated = args.animated ? "animated" : "";
        return `<div style="max-inline-size:20rem;"><violet-skeleton shape="${shape}" size="${size}" lines="${lines}" ${animated}></violet-skeleton></div>`;
    },
};

export default meta;

export const Overview: Story = {
    play: async ({ canvasElement }) => {
        const skeleton = canvasElement.querySelector("violet-skeleton");
        await expect(skeleton?.getAttribute("aria-hidden")).toBe("true");
    },
};

export const TextLines: Story = {
    render: () => `<div style="max-inline-size:20rem;"><violet-skeleton shape="text" lines="4"></violet-skeleton></div>`,
};

export const AvatarAndCopy: Story = {
    render: () => `
        <violet-card padding="medium" appearance="outline" style="inline-size:22rem;">
            <div style="display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:start;">
                <violet-skeleton shape="circle" size="lg"></violet-skeleton>
                <div style="display:grid;gap:8px;">
                    <violet-skeleton shape="rect" size="md" style="inline-size:8rem;"></violet-skeleton>
                    <violet-skeleton shape="text" lines="3"></violet-skeleton>
                </div>
            </div>
        </violet-card>
    `,
};

export const Static: Story = {
    args: {
        animated: false,
        shape: "text",
        lines: "3",
    },
};
