import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, waitFor } from "storybook/test";

import "./violet-card";
import type { VioletCard, VioletCardAppearance, VioletCardOrientation, VioletCardPadding } from "./violet-card";

type VioletCardStoryArgs = {
    padding: VioletCardPadding;
    appearance: VioletCardAppearance;
    interactive: boolean;
    orientation: VioletCardOrientation;
};

function renderCard(args: VioletCardStoryArgs, content?: (card: HTMLElement) => void): HTMLElement {
    const element = document.createElement("violet-card") as VioletCard;
    element.setAttribute("padding", args.padding);
    element.setAttribute("appearance", args.appearance);
    element.interactive = args.interactive;
    element.setAttribute("orientation", args.orientation);
    element.style.maxInlineSize = "360px";

    if (content) {
        content(element);
    } else {
        const p = document.createElement("p");
        p.style.margin = "0";
        p.textContent = "Card body content goes here. This is a basic Violet card surface.";
        element.append(p);
    }

    return element;
}

const meta = {
    title: "Components/Card",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet card surface with optional padding, appearance variants, header/footer slots, and interactive mode.",
            },
        },
    },
    argTypes: {
        padding: {
            control: "inline-radio",
            options: ["none", "small", "medium", "large"],
        },
        appearance: {
            control: "inline-radio",
            options: ["filled", "outline", "subtle"],
        },
        interactive: { control: "boolean" },
        orientation: {
            control: "inline-radio",
            options: ["vertical", "horizontal"],
        },
    },
    render: (args: VioletCardStoryArgs) => renderCard(args),
} satisfies Meta<VioletCardStoryArgs>;

export default meta;

type Story = StoryObj<VioletCardStoryArgs>;

export const Overview: Story = {
    args: {
        padding: "medium",
        appearance: "filled",
        interactive: false,
        orientation: "vertical",
    },
    render: (args: VioletCardStoryArgs) =>
        renderCard(args, card => {
            const header = document.createElement("div");
            header.slot = "header";
            const h3 = document.createElement("h3");
            h3.style.margin = "0";
            h3.style.fontSize = "14px";
            h3.style.fontWeight = "600";
            h3.textContent = "Card Title";
            header.append(h3);

            const body = document.createElement("p");
            body.style.margin = "0";
            body.textContent = "Card body content with comfortable padding on all sections.";

            const footer = document.createElement("div");
            footer.slot = "footer";
            footer.style.display = "flex";
            footer.style.gap = "8px";
            const btn = document.createElement("button");
            btn.textContent = "Action";
            footer.append(btn);

            card.append(header, body, footer);
        }),
    play: async ({ canvasElement }) => {
        const element = canvasElement.querySelector("violet-card") as VioletCard | null;
        const root = element?.shadowRoot?.querySelector(".root") as HTMLElement | null;

        if (!element || !root) {
            throw new Error("Expected violet-card to render.");
        }

        await expect(root.getAttribute("part")).toBe("root");

        await waitFor(() => {
            const header = element.shadowRoot?.querySelector(".header") as HTMLElement | null;
            expect(header?.hidden).toBe(false);
        });
    },
};

export const NoPadding: Story = {
    args: {
        padding: "none",
        appearance: "filled",
        interactive: false,
        orientation: "vertical",
    },
    render: (args: VioletCardStoryArgs) =>
        renderCard(args, card => {
            const img = document.createElement("img");
            img.src = "https://picsum.photos/seed/violet-no-pad/400/200";
            img.alt = "Full-bleed image with no padding";
            img.style.display = "block";
            img.style.inlineSize = "100%";
            img.style.blockSize = "180px";
            img.style.objectFit = "cover";
            card.append(img);
        }),
    play: async ({ canvasElement }) => {
        const element = canvasElement.querySelector("violet-card") as VioletCard | null;
        const body = element?.shadowRoot?.querySelector(".body") as HTMLElement | null;

        if (!element || !body) {
            throw new Error("Expected violet-card to render.");
        }

        await waitFor(() => {
            const computed = getComputedStyle(body);
            expect(computed.padding).toBe("0px");
        });
    },
};

export const WithHeaderFooter: Story = {
    args: {
        padding: "medium",
        appearance: "filled",
        interactive: false,
        orientation: "vertical",
    },
    render: (args: VioletCardStoryArgs) =>
        renderCard(args, card => {
            const header = document.createElement("div");
            header.slot = "header";
            header.textContent = "Header Section";

            const body = document.createElement("p");
            body.style.margin = "0";
            body.textContent = "Body content between header and footer separators.";

            const footer = document.createElement("div");
            footer.slot = "footer";
            footer.textContent = "Footer Section";

            card.append(header, body, footer);
        }),
};

export const Outline: Story = {
    args: {
        padding: "medium",
        appearance: "outline",
        interactive: false,
        orientation: "vertical",
    },
    render: (args: VioletCardStoryArgs) =>
        renderCard(args, card => {
            const p = document.createElement("p");
            p.style.margin = "0";
            p.textContent = "Outline variant — visible border, no shadow, transparent background.";
            card.append(p);
        }),
};

export const Subtle: Story = {
    args: {
        padding: "medium",
        appearance: "subtle",
        interactive: false,
        orientation: "vertical",
    },
    render: (args: VioletCardStoryArgs) =>
        renderCard(args, card => {
            const p = document.createElement("p");
            p.style.margin = "0";
            p.textContent = "Subtle variant — soft background, no border, no shadow.";
            card.append(p);
        }),
};

export const Interactive: Story = {
    args: {
        padding: "medium",
        appearance: "filled",
        interactive: true,
        orientation: "vertical",
    },
    render: (args: VioletCardStoryArgs) =>
        renderCard(args, card => {
            const p = document.createElement("p");
            p.style.margin = "0";
            p.textContent = "Interactive card — hover for lift effect, tab for focus ring.";
            card.append(p);
        }),
    play: async ({ canvasElement }) => {
        const element = canvasElement.querySelector("violet-card") as VioletCard | null;

        if (!element) {
            throw new Error("Expected violet-card to render.");
        }

        await waitFor(() => {
            expect(element.getAttribute("tabindex")).toBe("0");
            expect(element.getAttribute("role")).toBe("group");
        });
    },
};

export const Horizontal: Story = {
    args: {
        padding: "none",
        appearance: "filled",
        interactive: false,
        orientation: "horizontal",
    },
    render: (args: VioletCardStoryArgs) => {
        const element = document.createElement("violet-card") as VioletCard;
        element.setAttribute("padding", args.padding);
        element.setAttribute("appearance", args.appearance);
        element.setAttribute("orientation", args.orientation);
        element.style.maxInlineSize = "420px";

        const img = document.createElement("img");
        img.src = "https://picsum.photos/seed/violet-card/160/160";
        img.alt = "Sample thumbnail";
        img.style.inlineSize = "160px";
        img.style.blockSize = "160px";
        img.style.objectFit = "cover";
        img.style.flexShrink = "0";
        img.style.display = "block";

        const content = document.createElement("div");
        content.style.padding = "16px";
        content.style.display = "flex";
        content.style.flexDirection = "column";
        content.style.justifyContent = "center";
        content.style.gap = "4px";
        const h3 = document.createElement("h3");
        h3.style.margin = "0";
        h3.style.fontSize = "14px";
        h3.style.fontWeight = "600";
        h3.textContent = "Article Title";
        const p = document.createElement("p");
        p.style.margin = "0";
        p.style.fontSize = "13px";
        p.style.color = "#414651";
        p.textContent = "A horizontal card with a thumbnail image beside the content area.";
        content.append(h3, p);

        element.append(img, content);
        return element;
    },
};

export const AllAppearances: Story = {
    args: {
        padding: "medium",
        appearance: "filled",
        interactive: false,
        orientation: "vertical",
    },
    render: () => {
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.gap = "16px";
        wrapper.style.flexWrap = "wrap";

        for (const appearance of ["filled", "outline", "subtle"] as const) {
            const card = document.createElement("violet-card") as VioletCard;
            card.setAttribute("padding", "medium");
            card.setAttribute("appearance", appearance);
            card.style.inlineSize = "200px";

            const p = document.createElement("p");
            p.style.margin = "0";
            p.style.fontSize = "13px";
            p.textContent = `${appearance.charAt(0).toUpperCase()}${appearance.slice(1)} appearance`;
            card.append(p);

            wrapper.append(card);
        }

        return wrapper;
    },
};
