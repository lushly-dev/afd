import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-tool-call-card";
import type { VioletToolCallCard, VioletToolCallState } from "./violet-tool-call-card";

type ToolCallStoryArgs = {
    toolName: string;
    state: VioletToolCallState;
};

const meta = {
    title: "Conversation/Tool Call Card",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Renders a tool invocation through its TanStack AI lifecycle states. Maps to TanStack AI ToolCallPart / AI SDK ToolUIPart.",
            },
        },
    },
    argTypes: {
        state: {
            control: "select",
            options: [
                "pending",
                "approval-requested",
                "executing",
                "output-available",
                "output-error",
                "cancelled",
            ],
        },
    },
    render: (args: ToolCallStoryArgs) => {
        const el = document.createElement("violet-tool-call-card") as VioletToolCallCard;
        el.setAttribute("tool-name", args.toolName);
        el.setAttribute("state", args.state);
        return el;
    },
} satisfies Meta<ToolCallStoryArgs>;

export default meta;

type Story = StoryObj<ToolCallStoryArgs>;

export const Overview: Story = {
    args: {
        toolName: "searchPlants",
        state: "pending",
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector("violet-tool-call-card") as VioletToolCallCard | null;
        const root = el?.shadowRoot?.querySelector("violet-card") as HTMLElement | null;
        await expect(root?.getAttribute("role")).toBe("region");
    },
};

export const Running: Story = {
    args: {
        toolName: "analyzeSoil",
        state: "executing",
    },
    render: (args: ToolCallStoryArgs) => {
        const el = document.createElement("violet-tool-call-card") as VioletToolCallCard;
        el.setAttribute("tool-name", args.toolName);
        el.setAttribute("state", args.state);

        const summary = document.createElement("span");
        summary.slot = "summary";
        summary.textContent = "Analyzing soil composition for pH, nitrogen, and phosphorus levels.";
        el.append(summary);

        return el;
    },
};

export const Complete: Story = {
    args: {
        toolName: "getWeather",
        state: "output-available",
    },
    render: (args: ToolCallStoryArgs) => {
        const el = document.createElement("violet-tool-call-card") as VioletToolCallCard;
        el.setAttribute("tool-name", args.toolName);
        el.setAttribute("state", args.state);

        const summary = document.createElement("span");
        summary.slot = "summary";
        summary.textContent = "Retrieved weather forecast for Portland, OR.";

        const output = document.createElement("div");
        output.slot = "output";
        output.textContent = "72\u00B0F, partly cloudy, 20% chance of rain.";

        el.append(summary, output);
        return el;
    },
};

export const ErrorState: Story = {
    args: {
        toolName: "fetchInventory",
        state: "output-error",
    },
    render: (args: ToolCallStoryArgs) => {
        const el = document.createElement("violet-tool-call-card") as VioletToolCallCard;
        el.setAttribute("tool-name", args.toolName);
        el.setAttribute("state", args.state);

        const output = document.createElement("span");
        output.slot = "output";
        output.textContent = "Connection timeout: inventory service unavailable.";
        el.append(output);

        return el;
    },
};

export const ApprovalNeeded: Story = {
    args: {
        toolName: "placeOrder",
        state: "approval-requested",
    },
    render: (args: ToolCallStoryArgs) => {
        const el = document.createElement("violet-tool-call-card") as VioletToolCallCard;
        el.setAttribute("tool-name", args.toolName);
        el.setAttribute("state", args.state);

        const summary = document.createElement("span");
        summary.slot = "summary";
        summary.textContent = "Ready to place an order for 12 hostas and 6 ferns.";
        el.append(summary);

        return el;
    },
};

export const Denied: Story = {
    args: {
        toolName: "deleteRecords",
        state: "cancelled",
    },
};

export const AllStates: Story = {
    args: {
        toolName: "",
        state: "pending",
    },
    render: () => {
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.flexDirection = "column";
        wrapper.style.gap = "12px";
        wrapper.style.maxInlineSize = "500px";

        const states: Array<[VioletToolCallState, string]> = [
            ["pending", "searchDatabase"],
            ["approval-requested", "placeOrder"],
            ["executing", "analyzeSoil"],
            ["output-available", "getWeather"],
            ["output-error", "fetchInventory"],
            ["cancelled", "deleteRecords"],
        ];

        for (const [state, name] of states) {
            const el = document.createElement("violet-tool-call-card") as VioletToolCallCard;
            el.setAttribute("tool-name", name);
            el.setAttribute("state", state);
            wrapper.append(el);
        }

        return wrapper;
    },
};
