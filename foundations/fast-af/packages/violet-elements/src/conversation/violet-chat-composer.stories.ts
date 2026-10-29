import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, fn, userEvent } from "storybook/test";

import "./violet-chat-composer";
import "../button/violet-button";
import type { VioletChatComposer, VioletChatComposerStatus } from "./violet-chat-composer";

type ComposerStoryArgs = {
    status: VioletChatComposerStatus;
    placeholder: string;
    disabled: boolean;
    value: string;
};

const meta = {
    title: "Conversation/Composer",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Prompt input shell with auto-growing textarea, submit/stop toggle, and optional action and footer slots.",
            },
        },
    },
    argTypes: {
        status: {
            control: "select",
            options: ["ready", "submitted", "streaming", "error"],
        },
        placeholder: { control: "text" },
        disabled: { control: "boolean" },
    },
    render: (args: ComposerStoryArgs) => {
        const el = document.createElement("violet-chat-composer") as VioletChatComposer;
        el.setAttribute("status", args.status);
        el.setAttribute("placeholder", args.placeholder);
        el.setAttribute("value", args.value);
        el.disabled = args.disabled;
        el.style.maxInlineSize = "600px";
        return el;
    },
} satisfies Meta<ComposerStoryArgs>;

export default meta;

type Story = StoryObj<ComposerStoryArgs>;

export const Overview: Story = {
    args: {
        status: "ready",
        placeholder: "Send a message\u2026",
        disabled: false,
        value: "Draft a planting note for the north shade bed.",
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector("violet-chat-composer") as VioletChatComposer | null;
        const textarea = el?.shadowRoot?.querySelector("violet-text-area")?.shadowRoot?.querySelector("textarea") as HTMLTextAreaElement | null;
        await expect(textarea).toBeTruthy();
        await expect(textarea?.disabled).toBe(false);
    },
};

export const Streaming: Story = {
    args: {
        status: "streaming",
        placeholder: "Send a message\u2026",
        disabled: false,
        value: "Summarize the latest irrigation recommendations.",
    },
};

export const Submitted: Story = {
    args: {
        status: "submitted",
        placeholder: "Send a message\u2026",
        disabled: false,
        value: "Create a pruning checklist for the fruit trees.",
    },
};

export const Disabled: Story = {
    args: {
        status: "ready",
        placeholder: "Composer is disabled",
        disabled: true,
        value: "This draft is locked while the workspace syncs.",
    },
};

export const WithActions: Story = {
    args: {
        status: "ready",
        placeholder: "Send a message\u2026",
        disabled: false,
        value: "Attach last week's greenhouse sensor export.",
    },
    render: (args: ComposerStoryArgs) => {
        const el = document.createElement("violet-chat-composer") as VioletChatComposer;
        el.setAttribute("status", args.status);
        el.setAttribute("value", args.value);
        el.style.maxInlineSize = "600px";

        const attachBtn = document.createElement("violet-button");
        attachBtn.slot = "actions";
        attachBtn.setAttribute("appearance", "secondary");
        attachBtn.textContent = "Attach file";

        el.append(attachBtn);
        return el;
    },
};

export const WithFooter: Story = {
    args: {
        status: "ready",
        placeholder: "Send a message\u2026",
        disabled: false,
        value: "Compare this week's seedling growth against last week.",
    },
    render: (args: ComposerStoryArgs) => {
        const el = document.createElement("violet-chat-composer") as VioletChatComposer;
        el.setAttribute("status", args.status);
        el.setAttribute("value", args.value);
        el.style.maxInlineSize = "600px";

        const footer = document.createElement("span");
        footer.slot = "footer";
        footer.textContent = "Claude 3.5 Sonnet \u2022 0 tokens";

        el.append(footer);
        return el;
    },
};

export const SubmitInteraction: Story = {
    args: {
        status: "ready",
        placeholder: "Type and press Enter to submit",
        disabled: false,
        value: "",
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector("violet-chat-composer") as VioletChatComposer | null;
        if (!el) { return; }

        const submitHandler = fn();
        el.addEventListener("submit", submitHandler);

        const textarea = el.shadowRoot?.querySelector("violet-text-area")?.shadowRoot?.querySelector("textarea") as HTMLTextAreaElement | null;
        if (!textarea) { return; }

        await userEvent.type(textarea, "Hello world");
        await userEvent.keyboard("{Enter}");

        await expect(submitHandler).toHaveBeenCalledTimes(1);
    },
};
