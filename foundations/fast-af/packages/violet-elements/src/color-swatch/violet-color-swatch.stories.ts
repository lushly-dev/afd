import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-color-swatch";

type VioletColorSwatchStoryArgs = {
    value: string;
    shape: "square" | "circle";
    size: "compact" | "natural" | "comfortable";
};

const meta = {
    title: "Components/Color Swatch",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Token-driven, non-interactive color swatch with an accessible color description.",
            },
        },
    },
    argTypes: {
        value: { control: "color" },
        shape: {
            control: "radio",
            options: ["square", "circle"],
        },
        size: {
            control: "radio",
            options: ["compact", "natural", "comfortable"],
        },
    },
    render: (args: VioletColorSwatchStoryArgs) => {
        return `
            <div style="display:flex;align-items:center;gap:12px;">
                <violet-color-swatch
                    value="${args.value}"
                    shape="${args.shape}"
                    size="${args.size}"
                    label="Selected color ${args.value}"
                ></violet-color-swatch>
                <span style="font: 500 14px/20px Montserrat, 'Segoe UI', sans-serif;">${args.value}</span>
            </div>
        `;
    },
} satisfies Meta<VioletColorSwatchStoryArgs>;

export default meta;

type Story = StoryObj<VioletColorSwatchStoryArgs>;

export const Overview: Story = {
    args: {
        value: "#c84f3b",
        shape: "square",
        size: "natural",
    },
    play: async ({ canvasElement }) => {
        const host = canvasElement.querySelector("violet-color-swatch");
        const swatch = host?.shadowRoot?.querySelector(".swatch");

        expect(swatch?.getAttribute("role")).toBe("img");
        expect(swatch?.getAttribute("aria-label")).toBe("Selected color #c84f3b");
    },
};

export const Shapes: Story = {
    render: () => `
        <div style="display:flex;gap:16px;align-items:center;">
            <violet-color-swatch value="#244635" size="comfortable" label="Evergreen swatch"></violet-color-swatch>
            <violet-color-swatch value="#c84f3b" shape="circle" size="comfortable" label="Coral swatch"></violet-color-swatch>
            <violet-color-swatch value="#d2b062" shape="circle" size="comfortable" label="Ochre swatch"></violet-color-swatch>
        </div>
    `,
};
