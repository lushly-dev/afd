import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-divider";
import "../text/violet-text";
import type { VioletDivider } from "./violet-divider";

type Story = StoryObj<VioletDivider>;

const meta: Meta<VioletDivider> = {
    title: "Components/Divider",
    component: "violet-divider",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Lightweight Violet separator for horizontal and vertical structural boundaries. It can stay semantic by default or become decorative when the split is purely visual.",
            },
        },
    },
    args: {
        appearance: "subtle",
        orientation: "horizontal",
        decorative: false,
    },
    argTypes: {
        appearance: {
            control: "select",
            options: ["subtle", "strong"],
        },
        orientation: {
            control: "select",
            options: ["horizontal", "vertical"],
        },
        decorative: {
            control: "boolean",
        },
    },
    render: args => {
        const appearance = args.appearance ?? "subtle";
        const orientation = args.orientation ?? "horizontal";
        const decorative = args.decorative ? "decorative" : "";
        return `<violet-divider appearance="${appearance}" orientation="${orientation}" ${decorative}></violet-divider>`;
    },
};

export default meta;

export const Overview: Story = {
    render: () => `
        <div style="display:grid;gap:12px;max-width:32rem;">
            <violet-text variant="label" as="label">Upcoming work</violet-text>
            <violet-divider></violet-divider>
            <violet-text as="p">Prepare spring seed trays, check propagation media, and confirm irrigation schedules.</violet-text>
        </div>
    `,
    play: async ({ canvasElement }) => {
        const divider = canvasElement.querySelector("violet-divider");
        await expect(divider?.getAttribute("orientation")).toBeNull();
    },
};

export const Strong: Story = {
    args: {
        appearance: "strong",
    },
};

export const Vertical: Story = {
    args: {
        orientation: "vertical",
    },
    render: () => `
        <div style="display:flex;align-items:stretch;gap:12px;block-size:3rem;">
            <violet-text>Overview</violet-text>
            <violet-divider orientation="vertical"></violet-divider>
            <violet-text>Treatments</violet-text>
        </div>
    `,
};

export const Decorative: Story = {
    args: {
        decorative: true,
    },
    play: async ({ canvasElement }) => {
        const divider = canvasElement.querySelector("violet-divider");
        const hr = divider?.shadowRoot?.querySelector("hr");
        await expect(hr?.getAttribute("aria-hidden")).toBe("true");
    },
};
