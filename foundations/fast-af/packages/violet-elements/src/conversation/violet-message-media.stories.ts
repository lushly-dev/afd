import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-message-media";
import type { VioletMessageMedia } from "./violet-message-media";

type MediaStoryArgs = {
    src: string;
    mediaType: string;
    filename: string;
    alt: string;
    allowedOrigins?: string;
};

// Inline SVG so these stories never depend (a failed remote image now falls back to the file row) on the network.
const GARDEN_IMAGE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#8fbf8f"/></svg>')}`;

const meta = {
    title: "Conversation/Message Media",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Renders file/image/audio/video attachments. Maps to AI SDK FileUIPart and TanStack AI ImagePart/AudioPart/VideoPart/DocumentPart.",
            },
        },
    },
    argTypes: {
        src: { control: "text" },
        mediaType: { control: "text" },
        filename: { control: "text" },
        alt: { control: "text" },
        allowedOrigins: { control: "text" },
    },
    render: (args: MediaStoryArgs) => {
        const el = document.createElement("violet-message-media") as VioletMessageMedia;
        el.setAttribute("src", args.src);
        el.setAttribute("media-type", args.mediaType);
        if (args.filename) { el.setAttribute("filename", args.filename); }
        if (args.alt) { el.setAttribute("alt", args.alt); }
        if (args.allowedOrigins) { el.setAttribute("allowed-origins", args.allowedOrigins); }
        return el;
    },
} satisfies Meta<MediaStoryArgs>;

export default meta;

type Story = StoryObj<MediaStoryArgs>;

export const Overview: Story = {
    args: {
        src: GARDEN_IMAGE,
        mediaType: "image/svg+xml",
        filename: "garden-layout.svg",
        alt: "A garden layout showing raised beds with shade-tolerant plants",
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector("violet-message-media") as VioletMessageMedia | null;
        const img = el?.shadowRoot?.querySelector("img");
        await expect(img).toBeTruthy();
    },
};

/** A blocked remote image degrades to the file row; nothing is requested. */
export const BlockedRemoteSource: Story = {
    args: {
        src: "https://tracker.example.invalid/pixel.png",
        mediaType: "image/png",
        filename: "tracker.png",
        alt: "",
        allowedOrigins: "https://cdn.example.com",
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector("violet-message-media") as VioletMessageMedia | null;
        await expect(el?.shadowRoot?.querySelector("img")).toBeNull();
        await expect(el?.shadowRoot?.querySelector('[part="filename"]')?.textContent?.trim()).toBe("tracker.png");
    },
};

/** Local (data:) sources always load, even under a policy. */
export const AllowedLocalSource: Story = {
    args: {
        src: GARDEN_IMAGE,
        mediaType: "image/svg+xml",
        filename: "garden.svg",
        alt: "A green garden bed",
        allowedOrigins: "https://cdn.example.com",
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector("violet-message-media") as VioletMessageMedia | null;
        await expect(el?.shadowRoot?.querySelector("img")).toBeTruthy();
    },
};

export const GenericFile: Story = {
    args: {
        src: "https://example.com/files/garden-plan.pdf",
        mediaType: "application/pdf",
        filename: "garden-plan-2024.pdf",
        alt: "",
    },
};

export const AudioFile: Story = {
    args: {
        src: "https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3",
        mediaType: "audio/mpeg",
        filename: "bird-sounds.mp3",
        alt: "",
    },
};

export const MultipleMedia: Story = {
    args: {
        src: "",
        mediaType: "",
        filename: "",
        alt: "",
    },
    render: () => {
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.flexDirection = "column";
        wrapper.style.gap = "12px";
        wrapper.style.maxInlineSize = "400px";

        const items = [
            { src: "https://picsum.photos/seed/fern/400/250", type: "image/jpeg", name: "fern-detail.jpg", alt: "Close-up of a fern frond" },
            { src: "https://example.com/soil-report.pdf", type: "application/pdf", name: "soil-analysis-report.pdf", alt: "" },
            { src: "https://example.com/data.csv", type: "text/csv", name: "plant-inventory.csv", alt: "" },
        ];

        for (const item of items) {
            const el = document.createElement("violet-message-media") as VioletMessageMedia;
            el.setAttribute("src", item.src);
            el.setAttribute("media-type", item.type);
            el.setAttribute("filename", item.name);
            if (item.alt) { el.setAttribute("alt", item.alt); }
            wrapper.append(el);
        }

        return wrapper;
    },
};
