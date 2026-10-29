import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-source-citation";
import type { VioletSourceCitation, VioletSourceCitationType } from "./violet-source-citation";

type CitationStoryArgs = {
    type: VioletSourceCitationType;
    href: string;
    sourceTitle: string;
    index: string;
    mediaType: string;
};

const meta = {
    title: "Conversation/Source Citation",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Inline or footnote-style source reference. Maps to AI SDK SourceUrlUIPart and SourceDocumentUIPart.",
            },
        },
    },
    argTypes: {
        type: {
            control: "inline-radio",
            options: ["url", "document"],
        },
        index: { control: "text" },
    },
    render: (args: CitationStoryArgs) => {
        const el = document.createElement("violet-source-citation") as VioletSourceCitation;
        el.setAttribute("type", args.type);
        if (args.href) { el.setAttribute("href", args.href); }
        if (args.sourceTitle) { el.setAttribute("source-title", args.sourceTitle); }
        if (args.index) { el.setAttribute("index", args.index); }
        if (args.mediaType) { el.setAttribute("media-type", args.mediaType); }
        return el;
    },
} satisfies Meta<CitationStoryArgs>;

export default meta;

type Story = StoryObj<CitationStoryArgs>;

export const Overview: Story = {
    args: {
        type: "url",
        href: "https://example.com/shade-gardening-guide",
        sourceTitle: "Complete Guide to Shade Gardening",
        index: "1",
        mediaType: "",
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector("violet-source-citation") as VioletSourceCitation | null;
        const link = el?.shadowRoot?.querySelector(".link") as HTMLAnchorElement | null;
        await expect(link?.getAttribute("target")).toBe("_blank");
    },
};

export const DocumentSource: Story = {
    args: {
        type: "document",
        href: "",
        sourceTitle: "USDA Plant Hardiness Zone Map",
        index: "2",
        mediaType: "application/pdf",
    },
};

export const UrlWithoutTitle: Story = {
    args: {
        type: "url",
        href: "https://plants.usda.gov/home/plantProfile?symbol=HOST4",
        sourceTitle: "",
        index: "3",
        mediaType: "",
    },
};

export const NoBadge: Story = {
    args: {
        type: "url",
        href: "https://example.com/composting-basics",
        sourceTitle: "Composting Basics for Beginners",
        index: "",
        mediaType: "",
    },
};

export const CitationList: Story = {
    args: {
        type: "url",
        href: "",
        sourceTitle: "",
        index: "",
        mediaType: "",
    },
    render: () => {
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.flexDirection = "column";
        wrapper.style.gap = "8px";

        const sources = [
            { type: "url", href: "https://example.com/shade-plants", title: "Top 10 Shade Plants", index: "1" },
            { type: "url", href: "https://example.com/soil-guide", title: "Understanding Your Soil", index: "2" },
            { type: "document", href: "", title: "Garden Planning Worksheet.pdf", index: "3" },
        ];

        for (const src of sources) {
            const el = document.createElement("violet-source-citation") as VioletSourceCitation;
            el.setAttribute("type", src.type);
            if (src.href) { el.setAttribute("href", src.href); }
            el.setAttribute("source-title", src.title);
            el.setAttribute("index", src.index);
            wrapper.append(el);
        }

        return wrapper;
    },
};
