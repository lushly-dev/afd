import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-message-text";
import type { VioletMessageText, VioletMessageTextState } from "./violet-message-text";

type TextStoryArgs = {
    state: VioletMessageTextState;
    text: string;
};

const meta = {
    title: "Conversation/Message Text",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Text part renderer with streaming cursor support. Maps to TanStack AI TextPart / AI SDK TextUIPart.",
            },
        },
    },
    argTypes: {
        state: {
            control: "inline-radio",
            options: ["done", "streaming"],
        },
    },
    render: (args: TextStoryArgs) => {
        const el = document.createElement("violet-message-text") as VioletMessageText;
        el.setAttribute("state", args.state);
        el.textContent = args.text;
        return el;
    },
} satisfies Meta<TextStoryArgs>;

export default meta;

type Story = StoryObj<TextStoryArgs>;

export const Overview: Story = {
    args: {
        state: "done",
        text: "Composting is the natural process of recycling organic matter into a valuable fertilizer that can enrich soil and reduce waste.",
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector("violet-message-text") as VioletMessageText | null;
        const cursor = el?.shadowRoot?.querySelector(".cursor") as HTMLElement | null;
        await expect(cursor?.hidden).toBe(true);
    },
};

export const Streaming: Story = {
    args: {
        state: "streaming",
        text: "I'm analyzing your garden's soil composition to recommend the best amendments for your raised beds...",
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector("violet-message-text") as VioletMessageText | null;
        const cursor = el?.shadowRoot?.querySelector(".cursor") as HTMLElement | null;
        await expect(cursor?.hidden).toBe(false);
    },
};

export const Multiline: Story = {
    args: {
        state: "done",
        text: "Here are the steps to get started:\n\n1. Choose a location for your compost bin\n2. Layer green and brown materials\n3. Keep the pile moist but not soggy\n4. Turn it every 1-2 weeks\n5. Harvest when it looks like dark, crumbly soil",
    },
};

export const ShortText: Story = {
    args: {
        state: "done",
        text: "Got it!",
    },
};
