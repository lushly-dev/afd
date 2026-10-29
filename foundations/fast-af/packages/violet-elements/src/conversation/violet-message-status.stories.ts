import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-message-status";
import type { VioletMessageStatus, VioletMessageStatusType } from "./violet-message-status";

type StatusStoryArgs = {
    status: VioletMessageStatusType;
};

const meta = {
    title: "Conversation/Message Status",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Compact status indicator for showing chat state between messages. Maps to TanStack AI / AI SDK streaming status values.",
            },
        },
    },
    argTypes: {
        status: {
            control: "inline-radio",
            options: ["submitted", "streaming", "error", "cancelled", "retrying"],
        },
    },
    render: (args: StatusStoryArgs) => {
        const el = document.createElement("violet-message-status") as VioletMessageStatus;
        el.setAttribute("status", args.status);
        return el;
    },
} satisfies Meta<StatusStoryArgs>;

export default meta;

type Story = StoryObj<StatusStoryArgs>;

export const Overview: Story = {
    args: { status: "submitted" },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector("violet-message-status") as VioletMessageStatus | null;
        const root = el?.shadowRoot?.querySelector(".root") as HTMLElement | null;
        await expect(root?.getAttribute("role")).toBe("status");
    },
};

export const Streaming: Story = {
    args: { status: "streaming" },
};

export const ErrorStatus: Story = {
    args: { status: "error" },
};

export const Cancelled: Story = {
    args: { status: "cancelled" },
};

export const Retrying: Story = {
    args: { status: "retrying" },
};

export const CustomText: Story = {
    args: { status: "streaming" },
    render: (args: StatusStoryArgs) => {
        const el = document.createElement("violet-message-status") as VioletMessageStatus;
        el.setAttribute("status", args.status);
        el.textContent = "Generating meal plan...";
        return el;
    },
};

export const AllStatuses: Story = {
    args: { status: "streaming" },
    render: () => {
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.flexDirection = "column";
        wrapper.style.gap = "16px";

        for (const status of ["submitted", "streaming", "error", "cancelled", "retrying"] as const) {
            const row = document.createElement("div");
            const label = document.createElement("span");
            label.style.fontSize = "11px";
            label.style.color = "#6b7280";
            label.style.display = "block";
            label.style.marginBlockEnd = "4px";
            label.textContent = status;

            const el = document.createElement("violet-message-status") as VioletMessageStatus;
            el.setAttribute("status", status);

            row.append(label, el);
            wrapper.append(row);
        }

        return wrapper;
    },
};
