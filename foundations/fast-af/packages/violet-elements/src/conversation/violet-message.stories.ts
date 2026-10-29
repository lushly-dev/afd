import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-message";
import "./violet-message-text";
import type { VioletMessage, VioletMessageRole, VioletMessageTone } from "./violet-message";

type MessageStoryArgs = {
    messageRole: VioletMessageRole;
    tone: VioletMessageTone;
    streaming: boolean;
    text: string;
};

function renderMessage(args: MessageStoryArgs): HTMLElement {
    const msg = document.createElement("violet-message") as VioletMessage;
    msg.setAttribute("message-role", args.messageRole);
    msg.setAttribute("tone", args.tone);
    msg.streaming = args.streaming;

    const part = document.createElement("violet-message-text");
    part.textContent = args.text;
    msg.append(part);

    return msg;
}

const meta = {
    title: "Conversation/Message",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Message surface with role-based styling (user/assistant/system) and tone variants. Message parts (text, tool cards, media) are slotted into the body.",
            },
        },
    },
    argTypes: {
        messageRole: {
            control: "inline-radio",
            options: ["user", "assistant", "system"],
        },
        tone: {
            control: "inline-radio",
            options: ["default", "muted", "error", "success"],
        },
        streaming: { control: "boolean" },
    },
    render: (args: MessageStoryArgs) => renderMessage(args),
} satisfies Meta<MessageStoryArgs>;

export default meta;

type Story = StoryObj<MessageStoryArgs>;

export const Overview: Story = {
    args: {
        messageRole: "assistant",
        tone: "default",
        streaming: false,
        text: "Hostas, ferns, and astilbe are excellent choices for partial shade gardens. They require minimal maintenance and provide beautiful foliage throughout the growing season.",
    },
    play: async ({ canvasElement }) => {
        const msg = canvasElement.querySelector("violet-message") as VioletMessage | null;
        const article = msg?.shadowRoot?.querySelector("article");
        await expect(article?.getAttribute("aria-label")).toBe("assistant message");
    },
};

export const UserMessage: Story = {
    args: {
        messageRole: "user",
        tone: "default",
        streaming: false,
        text: "What plants grow well in partial shade?",
    },
};

export const SystemMessage: Story = {
    args: {
        messageRole: "system",
        tone: "default",
        streaming: false,
        text: "Conversation started. The assistant has access to your garden profile.",
    },
};

export const ErrorTone: Story = {
    args: {
        messageRole: "assistant",
        tone: "error",
        streaming: false,
        text: "I encountered an error while processing your request. Please try again.",
    },
};

export const SuccessTone: Story = {
    args: {
        messageRole: "assistant",
        tone: "success",
        streaming: false,
        text: "Your watering schedule has been updated successfully.",
    },
};

export const Streaming: Story = {
    args: {
        messageRole: "assistant",
        tone: "default",
        streaming: true,
        text: "I'm looking into the best shade-tolerant plants for your region...",
    },
    render: (args: MessageStoryArgs) => {
        const msg = document.createElement("violet-message") as VioletMessage;
        msg.setAttribute("message-role", args.messageRole);
        msg.streaming = true;

        const part = document.createElement("violet-message-text");
        part.setAttribute("state", "streaming");
        part.textContent = args.text;
        msg.append(part);

        return msg;
    },
};

export const WithAvatar: Story = {
    args: {
        messageRole: "assistant",
        tone: "default",
        streaming: false,
        text: "Here are some recommendations based on your garden's soil type and sun exposure.",
    },
    render: (args: MessageStoryArgs) => {
        const msg = document.createElement("violet-message") as VioletMessage;
        msg.setAttribute("message-role", args.messageRole);

        const avatar = document.createElement("div");
        avatar.slot = "avatar";
        avatar.style.inlineSize = "32px";
        avatar.style.blockSize = "32px";
        avatar.style.borderRadius = "9999px";
        avatar.style.background = "linear-gradient(135deg, #c84f3b, #bd4a37)";
        avatar.style.display = "flex";
        avatar.style.alignItems = "center";
        avatar.style.justifyContent = "center";
        avatar.style.color = "#fff";
        avatar.style.fontSize = "14px";
        avatar.style.fontWeight = "600";
        avatar.textContent = "A";

        const part = document.createElement("violet-message-text");
        part.textContent = args.text;
        msg.append(avatar, part);

        return msg;
    },
};

export const WithMeta: Story = {
    args: {
        messageRole: "assistant",
        tone: "default",
        streaming: false,
        text: "Based on the soil analysis, I recommend adding composted pine bark to increase acidity in your blueberry bed.",
    },
    render: (args: MessageStoryArgs) => {
        const msg = document.createElement("violet-message") as VioletMessage;
        msg.setAttribute("message-role", args.messageRole);

        const meta = document.createElement("span");
        meta.slot = "meta";
        meta.textContent = "Claude 3.5 Sonnet \u2022 2:34 PM";

        const part = document.createElement("violet-message-text");
        part.textContent = args.text;
        msg.append(meta, part);

        return msg;
    },
};

export const AllRoles: Story = {
    args: {
        messageRole: "assistant",
        tone: "default",
        streaming: false,
        text: "",
    },
    render: () => {
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.flexDirection = "column";
        wrapper.style.gap = "12px";
        wrapper.style.maxInlineSize = "600px";

        wrapper.append(
            renderMessage({ messageRole: "system", tone: "default", streaming: false, text: "Session started." }),
            renderMessage({ messageRole: "user", tone: "default", streaming: false, text: "What is composting?" }),
            renderMessage({ messageRole: "assistant", tone: "default", streaming: false, text: "Composting is the natural process of recycling organic matter, such as food scraps and yard waste, into a nutrient-rich soil amendment." }),
            renderMessage({ messageRole: "user", tone: "default", streaming: false, text: "How long does it take?" }),
            renderMessage({ messageRole: "assistant", tone: "default", streaming: false, text: "Hot composting can produce usable compost in 4-8 weeks. Cold composting takes 6-12 months but requires less effort." }),
        );

        return wrapper;
    },
};
