import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-reasoning-block";
import type { VioletReasoningBlock, VioletReasoningState } from "./violet-reasoning-block";

type ReasoningStoryArgs = {
    expanded: boolean;
    state: VioletReasoningState;
    label: string;
    text: string;
};

const meta = {
    title: "Conversation/Reasoning Block",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Collapsible thinking/reasoning region for displaying model chain-of-thought content. Maps to TanStack AI ThinkingPart / AI SDK ReasoningUIPart.",
            },
        },
    },
    argTypes: {
        expanded: { control: "boolean" },
        state: {
            control: "inline-radio",
            options: ["done", "streaming"],
        },
        label: { control: "text" },
    },
    render: (args: ReasoningStoryArgs) => {
        const el = document.createElement("violet-reasoning-block") as VioletReasoningBlock;
        el.expanded = args.expanded;
        el.setAttribute("state", args.state);
        el.label = args.label;
        el.textContent = args.text;
        return el;
    },
} satisfies Meta<ReasoningStoryArgs>;

export default meta;

type Story = StoryObj<ReasoningStoryArgs>;

export const Overview: Story = {
    args: {
        expanded: false,
        state: "done",
        label: "Thinking",
        text: "The user is asking about shade-tolerant plants. I should consider their USDA hardiness zone and soil type. Let me think about which perennials would work best for partial shade conditions with well-drained soil...",
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector("violet-reasoning-block") as VioletReasoningBlock | null;
        const toggle = el?.shadowRoot?.querySelector(".toggle") as HTMLButtonElement | null;
        await expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    },
};

export const Expanded: Story = {
    args: {
        expanded: true,
        state: "done",
        label: "Thinking",
        text: "The user is asking about shade-tolerant plants. I should consider their USDA hardiness zone and soil type. Let me think about which perennials would work best for partial shade conditions with well-drained soil.\n\nI know hostas are popular but deer eat them. Ferns and astilbe are more deer-resistant options. Brunnera and bleeding heart are also good candidates.",
    },
};

export const Streaming: Story = {
    args: {
        expanded: true,
        state: "streaming",
        label: "Thinking",
        text: "Let me analyze the soil composition data. The pH level is 6.2, which is slightly acidic. This is good for most shade plants but I should check if...",
    },
};

export const CustomLabel: Story = {
    args: {
        expanded: false,
        state: "done",
        label: "Chain of thought",
        text: "Analyzing the query to determine the best approach for answering this question about garden maintenance schedules.",
    },
};
