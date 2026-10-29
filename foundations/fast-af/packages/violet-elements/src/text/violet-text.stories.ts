import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, within } from "storybook/test";

import "./violet-text";
import type { VioletText } from "./violet-text";

type Story = StoryObj<VioletText>;

const meta: Meta<VioletText> = {
    title: "Components/Text",
    component: "violet-text",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Semantic Violet typography primitive for body copy, labels, captions, and title scales without repeating token styling by hand.",
            },
        },
    },
    args: {
        as: "span",
        variant: "body",
        tone: "default",
        truncate: false,
    },
    argTypes: {
        as: {
            control: "select",
            options: ["span", "p", "small", "strong", "label", "h1", "h2", "h3", "h4"],
        },
        variant: {
            control: "select",
            options: ["body", "label", "caption", "title-sm", "title-md"],
        },
        tone: {
            control: "select",
            options: ["default", "secondary", "muted", "success", "warning", "danger"],
        },
        truncate: {
            control: "boolean",
        },
    },
    render: args => {
        const as = args.as ?? "span";
        const variant = args.variant ?? "body";
        const tone = args.tone ?? "default";
        const truncate = args.truncate ? "truncate" : "";
        return `<violet-text as="${as}" variant="${variant}" tone="${tone}" ${truncate}>Planting plans stay clearer when text hierarchy is calm and consistent.</violet-text>`;
    },
};

export default meta;

export const Overview: Story = {
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(await canvas.findByText(/Planting plans stay clearer/i)).toBeTruthy();
    },
};

export const TypeRamp: Story = {
    render: () => `
        <div style="display:grid;gap:12px;max-width:42rem;">
            <violet-text as="h2" variant="title-md">Spring cultivation planning</violet-text>
            <violet-text as="h3" variant="title-sm">Greenhouse rotation notes</violet-text>
            <violet-text as="p" variant="body">Body text should feel steady, readable, and quiet enough to support denser layout surfaces.</violet-text>
            <violet-text as="label" variant="label">Propagation window</violet-text>
            <violet-text as="small" variant="caption" tone="muted">Supporting captions should stay legible without pulling too much emphasis.</violet-text>
        </div>
    `,
};

export const Tones: Story = {
    render: () => `
        <div style="display:grid;gap:8px;">
            <violet-text tone="default">Default emphasis</violet-text>
            <violet-text tone="secondary">Secondary emphasis</violet-text>
            <violet-text tone="muted">Muted emphasis</violet-text>
            <violet-text tone="success">Healthy irrigation sync</violet-text>
            <violet-text tone="warning">Needs review before launch</violet-text>
            <violet-text tone="danger">Timing conflict detected</violet-text>
        </div>
    `,
};

export const Truncated: Story = {
    args: {
        as: "span",
        truncate: true,
    },
    render: () => `
        <div style="inline-size: 14rem;">
            <violet-text truncate>
                Planting plans with extra long descriptive labels should gracefully truncate inside tighter layouts.
            </violet-text>
        </div>
    `,
};
