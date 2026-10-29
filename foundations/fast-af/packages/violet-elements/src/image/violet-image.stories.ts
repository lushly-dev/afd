import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-image";
import "../text/violet-text";
import type { VioletImage } from "./violet-image";

type Story = StoryObj<VioletImage>;

const demoImage = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720">
  <rect width="960" height="720" fill="#ddeadf"/>
  <rect x="90" y="90" width="780" height="540" rx="36" fill="#f7f3ea"/>
  <circle cx="300" cy="280" r="92" fill="#9fc4ac"/>
  <path d="M190 540c70-110 126-168 172-168 58 0 102 56 168 130 36 42 84 64 146 64h104v64H190z" fill="#8eb79a"/>
</svg>
`)}`;

const meta: Meta<VioletImage> = {
    title: "Components/Image",
    component: "violet-image",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Native-first Violet image primitive with controlled aspect ratio, object-fit behavior, and fallback handling for decorative or informative media.",
            },
        },
    },
    args: {
        src: demoImage,
        alt: "Greenhouse planting trays in a light-filled growing room",
        fit: "cover",
        ratio: "landscape",
        shape: "rounded",
        loading: "lazy",
        decorative: false,
    },
    argTypes: {
        fit: {
            control: "select",
            options: ["cover", "contain", "fill"],
        },
        ratio: {
            control: "select",
            options: ["auto", "square", "landscape", "portrait", "video"],
        },
        shape: {
            control: "select",
            options: ["square", "rounded", "circle"],
        },
        loading: {
            control: "select",
            options: ["eager", "lazy"],
        },
        decorative: {
            control: "boolean",
        },
    },
    render: args => {
        const src = args.src ?? "";
        const alt = args.alt ?? "";
        const fit = args.fit ?? "cover";
        const ratio = args.ratio ?? "landscape";
        const shape = args.shape ?? "rounded";
        const loading = args.loading ?? "lazy";
        const decorative = args.decorative ? "decorative" : "";

        return `<div style="max-inline-size: 20rem;"><violet-image src="${src}" alt="${alt}" fit="${fit}" ratio="${ratio}" shape="${shape}" loading="${loading}" ${decorative}></violet-image></div>`;
    },
};

export default meta;

export const Overview: Story = {
    play: async ({ canvasElement }) => {
        const image = canvasElement.querySelector("violet-image");
        const media = image?.shadowRoot?.querySelector("img");
        await expect(media?.getAttribute("src")).toContain("data:image/svg+xml");
    },
};

export const ShapesAndRatios: Story = {
    render: () => `
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,12rem));gap:16px;">
            <violet-image src="${demoImage}" alt="Propagation trays" ratio="square" shape="square"></violet-image>
            <violet-image src="${demoImage}" alt="Propagation trays" ratio="portrait" shape="rounded"></violet-image>
            <violet-image src="${demoImage}" alt="Propagation trays" ratio="square" shape="circle"></violet-image>
        </div>
    `,
};

export const ContainFit: Story = {
    render: () => `
        <div style="max-inline-size: 16rem;">
            <violet-image src="${demoImage}" alt="Propagation trays" ratio="video" fit="contain"></violet-image>
        </div>
    `,
};

export const Fallback: Story = {
    render: () => `
        <div style="max-inline-size: 16rem;">
            <violet-image alt="Fallback planting image" ratio="landscape">
                <violet-text slot="fallback" variant="caption">Image unavailable</violet-text>
            </violet-image>
        </div>
    `,
};

export const ErrorFallback: Story = {
    render: () => `
        <div style="max-inline-size: 16rem;">
            <violet-image src="https://invalid.invalid/missing-image.jpg" alt="Fallback planting image" ratio="landscape">
                <violet-text slot="fallback" variant="caption" tone="muted">Image unavailable</violet-text>
            </violet-image>
        </div>
    `,
};

export const Decorative: Story = {
    args: {
        decorative: true,
        alt: "",
    },
    play: async ({ canvasElement }) => {
        const image = canvasElement.querySelector("violet-image");
        const root = image?.shadowRoot?.querySelector(".root");
        await expect(root?.getAttribute("aria-hidden")).toBe("true");
    },
};
