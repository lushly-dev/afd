import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, fn } from "storybook/test";

import "./violet-approval-card";
import type { VioletApprovalCard, VioletApprovalState } from "./violet-approval-card";

type ApprovalStoryArgs = {
    state: VioletApprovalState;
    summaryText: string;
    detailText: string;
};

const meta = {
    title: "Conversation/Approval Card",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Human-in-the-loop approval surface for sensitive tool actions. Maps to TanStack AI approval-requested state / AI SDK approval flow.",
            },
        },
    },
    argTypes: {
        state: {
            control: "inline-radio",
            options: ["pending", "approved", "denied"],
        },
    },
    render: (args: ApprovalStoryArgs) => {
        const el = document.createElement("violet-approval-card") as VioletApprovalCard;
        el.setAttribute("state", args.state);

        const summary = document.createElement("span");
        summary.slot = "summary";
        summary.textContent = args.summaryText;

        if (args.detailText) {
            const detail = document.createElement("span");
            detail.slot = "detail";
            detail.textContent = args.detailText;
            el.append(summary, detail);
        } else {
            el.append(summary);
        }

        return el;
    },
} satisfies Meta<ApprovalStoryArgs>;

export default meta;

type Story = StoryObj<ApprovalStoryArgs>;

export const Overview: Story = {
    args: {
        state: "pending",
        summaryText: "Place an order for 12 hostas and 6 ferns from GreenLeaf Nursery.",
        detailText: "This will charge $145.80 to your saved payment method and schedule delivery for next Thursday.",
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector("violet-approval-card") as VioletApprovalCard | null;
        const frame = el?.shadowRoot?.querySelector("violet-card") as HTMLElement | null;
        await expect(frame?.getAttribute("aria-label")).toBe("Action requires approval");
    },
};

export const Approved: Story = {
    args: {
        state: "approved",
        summaryText: "Order placed for 12 hostas and 6 ferns.",
        detailText: "",
    },
};

export const Denied: Story = {
    args: {
        state: "denied",
        summaryText: "Delete all records from the plant inventory.",
        detailText: "This would permanently remove 347 plant records.",
    },
};

export const Interactive: Story = {
    args: {
        state: "pending",
        summaryText: "Send an email notification to all 42 team members about the garden maintenance schedule.",
        detailText: "This will send individual emails to each team member. This action cannot be undone.",
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector("violet-approval-card") as VioletApprovalCard | null;
        if (!el) { return; }

        const approveHandler = fn();
        el.addEventListener("approve", approveHandler);

        const approveBtn = el.shadowRoot?.querySelector('[part="approve-button"]') as HTMLElement | null;
        if (approveBtn) {
            await userEvent.click(approveBtn);
        }

        await expect(approveHandler).toHaveBeenCalledTimes(1);
    },
};

export const AllStates: Story = {
    args: {
        state: "pending",
        summaryText: "",
        detailText: "",
    },
    render: () => {
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.flexDirection = "column";
        wrapper.style.gap = "16px";
        wrapper.style.maxInlineSize = "500px";

        const configs: Array<[VioletApprovalState, string, string]> = [
            ["pending", "Update the watering schedule for all raised beds.", "This will modify automated timers for 8 garden zones."],
            ["approved", "Watering schedule updated for all raised beds.", ""],
            ["denied", "Delete the entire compost tracking history.", "This would remove 2 years of composting data."],
        ];

        for (const [state, summaryText, detailText] of configs) {
            const label = document.createElement("span");
            label.style.fontSize = "11px";
            label.style.color = "#6b7280";
            label.textContent = state;

            const el = document.createElement("violet-approval-card") as VioletApprovalCard;
            el.setAttribute("state", state);

            const summary = document.createElement("span");
            summary.slot = "summary";
            summary.textContent = summaryText;
            el.append(summary);

            if (detailText) {
                const detail = document.createElement("span");
                detail.slot = "detail";
                detail.textContent = detailText;
                el.append(detail);
            }

            wrapper.append(label, el);
        }

        return wrapper;
    },
};
