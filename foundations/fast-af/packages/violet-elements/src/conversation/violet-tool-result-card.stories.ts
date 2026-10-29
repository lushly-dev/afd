import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent } from "storybook/test";

import "./violet-tool-result-card";
import type { VioletToolResultCard, VioletToolResultState } from "./violet-tool-result-card";

type ResultStoryArgs = {
    state: VioletToolResultState;
    expanded: boolean;
};

const meta = {
    title: "Conversation/Tool Result Card",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Renders tool execution output with a collapsible detail view. Maps to TanStack AI ToolResultPart.",
            },
        },
    },
    argTypes: {
        state: {
            control: "inline-radio",
            options: ["pending", "executing", "output-available", "output-error"],
        },
        expanded: { control: "boolean" },
    },
    render: (args: ResultStoryArgs) => {
        const el = document.createElement("violet-tool-result-card") as VioletToolResultCard;
        el.setAttribute("state", args.state);
        el.expanded = args.expanded;

        const summary = document.createElement("span");
        summary.slot = "summary";
        summary.textContent = args.state === "output-error"
            ? "Failed to retrieve weather data"
            : args.state === "output-available"
                ? "Weather data retrieved successfully"
                : args.state === "executing"
                    ? "Querying weather service"
                    : "Waiting for weather service";

        const body = document.createElement("div");
        body.textContent = args.state === "output-error"
            ? "Error: Connection timeout after 30s. The weather service did not respond."
            : args.state === "output-available"
                ? "Temperature: 72\u00B0F\nConditions: Partly cloudy\nHumidity: 45%\nWind: 8 mph NW"
                : "No output is available yet.";

        el.append(summary, body);
        return el;
    },
} satisfies Meta<ResultStoryArgs>;

export default meta;

type Story = StoryObj<ResultStoryArgs>;

export const Overview: Story = {
    args: {
        state: "output-available",
        expanded: false,
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector("violet-tool-result-card") as VioletToolResultCard | null;
        const summary = el?.shadowRoot?.querySelector(".summary") as HTMLElement | null;
        await expect(summary?.getAttribute("aria-expanded")).toBe("false");

        if (summary) {
            await userEvent.click(summary);
        }
        await expect(el?.expanded).toBe(true);
    },
};

export const Expanded: Story = {
    args: {
        state: "output-available",
        expanded: true,
    },
};

export const ErrorResult: Story = {
    args: {
        state: "output-error",
        expanded: true,
    },
};

export const WithFooter: Story = {
    args: {
        state: "output-available",
        expanded: true,
    },
    render: (args: ResultStoryArgs) => {
        const el = document.createElement("violet-tool-result-card") as VioletToolResultCard;
        el.setAttribute("state", args.state);
        el.expanded = args.expanded;

        const summary = document.createElement("span");
        summary.slot = "summary";
        summary.textContent = "Plant database query completed";

        const body = document.createElement("div");
        body.textContent = "Found 24 shade-tolerant perennials matching your criteria.";

        const footer = document.createElement("span");
        footer.slot = "footer";
        footer.textContent = "Source: USDA Plants Database \u2022 Cached 2m ago";

        el.append(summary, body, footer);
        return el;
    },
};
