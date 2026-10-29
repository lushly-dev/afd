import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, fn, userEvent } from "storybook/test";

import "./violet-chat-suggestions";
import type { VioletChatSuggestions } from "./violet-chat-suggestions";

type SuggestionsStoryArgs = {
    orientation: "horizontal" | "vertical";
};

function createChips(texts: string[]): HTMLElement[] {
    return texts.map(text => {
        const chip = document.createElement("span");
        chip.textContent = text;
        return chip;
    });
}

const meta = {
    title: "Conversation/Suggestions",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Prompt starter chip row. Children are rendered as clickable suggestion chips with keyboard navigation.",
            },
        },
    },
    argTypes: {
        orientation: {
            control: "inline-radio",
            options: ["horizontal", "vertical"],
        },
    },
    render: (args: SuggestionsStoryArgs) => {
        const el = document.createElement("violet-chat-suggestions") as VioletChatSuggestions;
        el.setAttribute("orientation", args.orientation);
        el.append(...createChips([
            "What plants grow in shade?",
            "Help me plan a garden",
            "Composting basics",
            "Watering schedule tips",
        ]));
        return el;
    },
} satisfies Meta<SuggestionsStoryArgs>;

export default meta;

type Story = StoryObj<SuggestionsStoryArgs>;

export const Overview: Story = {
    args: {
        orientation: "horizontal",
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector("violet-chat-suggestions") as VioletChatSuggestions | null;
        const root = el?.shadowRoot?.querySelector(".root") as HTMLElement | null;
        await expect(root?.getAttribute("role")).toBe("group");
    },
};

export const Vertical: Story = {
    args: {
        orientation: "vertical",
    },
};

export const ClickInteraction: Story = {
    args: {
        orientation: "horizontal",
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector("violet-chat-suggestions") as VioletChatSuggestions | null;
        if (!el) { return; }

        const selectHandler = fn();
        el.addEventListener("select", selectHandler);

        const firstChip = el.children[0] as HTMLElement;
        if (firstChip) {
            await userEvent.click(firstChip);
        }

        await expect(selectHandler).toHaveBeenCalledTimes(1);
    },
};

export const FewSuggestions: Story = {
    args: {
        orientation: "horizontal",
    },
    render: (args: SuggestionsStoryArgs) => {
        const el = document.createElement("violet-chat-suggestions") as VioletChatSuggestions;
        el.setAttribute("orientation", args.orientation);
        el.append(...createChips([
            "Get started",
            "Show examples",
        ]));
        return el;
    },
};

export const ManySuggestions: Story = {
    args: {
        orientation: "horizontal",
    },
    render: (args: SuggestionsStoryArgs) => {
        const wrapper = document.createElement("div");
        wrapper.style.maxInlineSize = "400px";

        const el = document.createElement("violet-chat-suggestions") as VioletChatSuggestions;
        el.setAttribute("orientation", args.orientation);
        el.append(...createChips([
            "Shade plants",
            "Sun plants",
            "Indoor herbs",
            "Raised beds",
            "Container gardening",
            "Soil testing",
            "Pest control",
            "Composting",
        ]));

        wrapper.append(el);
        return wrapper;
    },
};
