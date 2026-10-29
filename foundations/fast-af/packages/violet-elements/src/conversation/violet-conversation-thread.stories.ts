import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, waitFor } from "storybook/test";

import "./violet-conversation-thread";
import "./violet-message";
import "./violet-message-text";
import type { VioletConversationThread } from "./violet-conversation-thread";

type ThreadStoryArgs = {
    busy: boolean;
    empty: boolean;
};

function createMessage(role: string, text: string): HTMLElement {
    const msg = document.createElement("violet-message");
    msg.setAttribute("message-role", role);

    const part = document.createElement("violet-message-text");
    part.textContent = text;
    msg.append(part);

    return msg;
}

const meta = {
    title: "Conversation/Thread",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Semantic transcript container with scroll management, auto-scroll behavior, and live region semantics for chat message display.",
            },
        },
    },
    argTypes: {
        busy: { control: "boolean" },
        empty: { control: "boolean" },
    },
} satisfies Meta<ThreadStoryArgs>;

export default meta;

type Story = StoryObj<ThreadStoryArgs>;

export const Overview: Story = {
    args: { busy: false, empty: false },
    render: (args: ThreadStoryArgs) => {
        const thread = document.createElement("violet-conversation-thread") as VioletConversationThread;
        thread.busy = args.busy;
        thread.empty = args.empty;
        thread.style.blockSize = "160px";
        thread.style.border = "1px solid rgba(28, 26, 13, 0.10)";
        thread.style.borderRadius = "8px";

        thread.append(
            createMessage("user", "What plants grow well in partial shade?"),
            createMessage("assistant", "Several plants thrive in partial shade conditions. Hostas, ferns, and astilbe are excellent perennial choices. For annuals, consider impatiens, begonias, and coleus."),
            createMessage("user", "Which of those are deer resistant?"),
            createMessage("assistant", "Ferns and astilbe are generally deer resistant. Hostas, unfortunately, are a favorite of deer. For deer-resistant shade perennials, also consider hellebores, brunnera, and bleeding heart."),
        );

        return thread;
    },
    play: async ({ canvasElement }) => {
        const thread = canvasElement.querySelector("violet-conversation-thread") as VioletConversationThread | null;
        if (!thread) {
            throw new Error("Expected thread to render.");
        }

        const scrollRegion = thread.shadowRoot?.querySelector(".scroll-region") as HTMLElement | null;
        await expect(scrollRegion?.getAttribute("role")).toBe("log");
    },
};

export const Empty: Story = {
    args: { busy: false, empty: true },
    render: (args: ThreadStoryArgs) => {
        const thread = document.createElement("violet-conversation-thread") as VioletConversationThread;
        thread.busy = args.busy;
        thread.empty = args.empty;
        thread.style.blockSize = "300px";
        thread.style.border = "1px solid rgba(28, 26, 13, 0.10)";
        thread.style.borderRadius = "8px";

        const emptyContent = document.createElement("div");
        emptyContent.slot = "empty";
        emptyContent.style.fontSize = "14px";
        const heading = document.createElement("p");
        heading.style.margin = "0 0 8px";
        heading.style.fontWeight = "600";
        heading.textContent = "Start a conversation";
        const sub = document.createElement("p");
        sub.style.margin = "0";
        sub.style.fontSize = "13px";
        sub.textContent = "Ask a question or describe what you need help with.";
        emptyContent.append(heading, sub);
        thread.append(emptyContent);

        return thread;
    },
};

export const Busy: Story = {
    args: { busy: true, empty: false },
    render: (args: ThreadStoryArgs) => {
        const thread = document.createElement("violet-conversation-thread") as VioletConversationThread;
        thread.busy = args.busy;
        thread.style.blockSize = "300px";
        thread.style.border = "1px solid rgba(28, 26, 13, 0.10)";
        thread.style.borderRadius = "8px";

        thread.append(
            createMessage("user", "Generate a weekly meal plan for two people."),
            createMessage("assistant", "I'll create a balanced meal plan for you..."),
        );

        return thread;
    },
    play: async ({ canvasElement }) => {
        const thread = canvasElement.querySelector("violet-conversation-thread") as VioletConversationThread | null;
        const scrollRegion = thread?.shadowRoot?.querySelector(".scroll-region") as HTMLElement | null;

        await waitFor(() => {
            expect(scrollRegion?.getAttribute("aria-busy")).toBe("true");
            expect(scrollRegion?.getAttribute("aria-live")).toBe("off");
        });
    },
};

export const LongConversation: Story = {
    args: { busy: false, empty: false },
    render: () => {
        const thread = document.createElement("violet-conversation-thread") as VioletConversationThread;
        thread.style.blockSize = "400px";
        thread.style.border = "1px solid rgba(28, 26, 13, 0.10)";
        thread.style.borderRadius = "8px";

        const exchanges = [
            ["user", "Tell me about composting."],
            ["assistant", "Composting is the natural process of recycling organic matter into a valuable fertilizer. You can compost fruit scraps, vegetable peels, coffee grounds, eggshells, yard trimmings, and more."],
            ["user", "How do I get started?"],
            ["assistant", "Start with a bin or designated area. Layer green materials (food scraps, fresh grass) with brown materials (dried leaves, cardboard). Keep it moist and turn it regularly."],
            ["user", "How long does it take?"],
            ["assistant", "Hot composting can produce usable compost in 4-8 weeks with regular turning. Cold composting takes 6-12 months but requires less effort."],
            ["user", "What should I avoid adding?"],
            ["assistant", "Avoid meat, dairy, oils, diseased plants, pet waste, and treated wood. These can attract pests, create odors, or introduce harmful substances."],
            ["user", "Can I compost in an apartment?"],
            ["assistant", "Yes! Vermicomposting (worm composting) works great indoors. A small worm bin under the sink can process kitchen scraps quietly and without odor when maintained properly."],
        ];

        for (const [role, text] of exchanges) {
            thread.append(createMessage(role, text));
        }

        return thread;
    },
    play: async ({ canvasElement }) => {
        const thread = canvasElement.querySelector("violet-conversation-thread") as VioletConversationThread | null;
        const scrollRegion = thread?.shadowRoot?.querySelector(".scroll-region") as HTMLElement | null;

        await waitFor(() => {
            expect(scrollRegion?.getAttribute("tabindex")).toBe("0");
        });
    },
};
