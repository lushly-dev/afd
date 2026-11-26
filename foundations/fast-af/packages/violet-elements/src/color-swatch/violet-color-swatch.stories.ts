import { expect } from "@lushly-dev/specimen/test";
import type { Meta, StoryObj } from "@lushly-dev/specimen/types";

import "./violet-color-swatch.define";

type VioletColorSwatchStoryArgs = {
  value: string;
  shape: "square" | "circle";
  size: "compact" | "natural" | "comfortable";
};

const meta = {
  title: "Components/Color Swatch",
  component: "violet-color-swatch",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Token-driven, non-interactive color swatch with an accessible color description.",
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
                <span style="font: 500 14px/20px var(--violet-font-family-body);">${args.value}</span>
            </div>
        `;
  },
} satisfies Meta<VioletColorSwatchStoryArgs>;

export default meta;

type Story = StoryObj<VioletColorSwatchStoryArgs>;

export const Overview: Story = {
  args: {
    value: "#146ba0",
    shape: "square",
    size: "natural",
  },
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector("violet-color-swatch");
    const swatch = host?.shadowRoot?.querySelector(".swatch");

    expect(swatch?.getAttribute("role")).toBe("img");
    expect(swatch?.getAttribute("aria-label")).toBe("Selected color #146ba0");
  },
};

export const Shapes: Story = {
  render: () => `
        <div style="display:flex;gap:16px;align-items:center;">
            <violet-color-swatch value="#2c5e4b" size="comfortable" label="Mint ink swatch"></violet-color-swatch>
            <violet-color-swatch value="#c42a1a" shape="circle" size="comfortable" label="Red ink swatch"></violet-color-swatch>
            <violet-color-swatch value="#146ba0" shape="circle" size="comfortable" label="Blue ink swatch"></violet-color-swatch>
        </div>
    `,
};
