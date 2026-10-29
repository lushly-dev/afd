import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-empty-state";
import "../button/violet-button";
import "../image/violet-image";
import "../text/violet-text";
import type { VioletEmptyState } from "./violet-empty-state";

type Story = StoryObj<VioletEmptyState>;

const demoImage = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="540" viewBox="0 0 720 540">
  <rect width="720" height="540" fill="#e6eadb"/>
  <rect x="96" y="84" width="528" height="372" rx="28" fill="#fbf8f0"/>
  <path d="M176 352h368" stroke="#c7d3b4" stroke-width="28" stroke-linecap="round"/>
  <circle cx="252" cy="248" r="52" fill="#aac2a0"/>
  <path d="M230 332c46-58 80-86 120-86s76 24 136 86" fill="none" stroke="#8eb79a" stroke-width="26" stroke-linecap="round"/>
</svg>
`)}`;

const meta: Meta<VioletEmptyState> = {
    title: "Components/Empty State",
    component: "violet-empty-state",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Composable Violet empty-state surface for no-content, no-results, and first-run views. It keeps the copy contract simple while allowing slotted media and actions.",
            },
        },
    },
    args: {
        heading: "No plans yet",
        message: "Create your first crop plan to start scheduling propagation, irrigation, and harvest windows.",
        appearance: "subtle",
        orientation: "vertical",
    },
    argTypes: {
        appearance: {
            control: "select",
            options: ["plain", "subtle", "outline"],
        },
        orientation: {
            control: "select",
            options: ["vertical", "horizontal"],
        },
    },
    render: args => {
        const heading = args.heading ?? "";
        const message = args.message ?? "";
        const appearance = args.appearance ?? "subtle";
        const orientation = args.orientation ?? "vertical";
        return `
            <div style="max-inline-size:32rem;">
                <violet-empty-state heading="${heading}" message="${message}" appearance="${appearance}" orientation="${orientation}">
                    <violet-image slot="media" src="${demoImage}" alt="" decorative ratio="square" style="inline-size:6rem;"></violet-image>
                    <violet-button slot="actions" appearance="primary">Create plan</violet-button>
                    <violet-button slot="actions" appearance="secondary">Import template</violet-button>
                </violet-empty-state>
            </div>
        `;
    },
};

export default meta;

export const Overview: Story = {
    play: async ({ canvasElement }) => {
        const state = canvasElement.querySelector("violet-empty-state");
        await expect(state?.getAttribute("heading")).toBe("No plans yet");
    },
};

export const Outline: Story = {
    args: {
        appearance: "outline",
        heading: "No matching cultivars",
        message: "Try broadening your filters or importing a new seed inventory list.",
    },
};

export const Horizontal: Story = {
    args: {
        orientation: "horizontal",
        appearance: "plain",
        heading: "No assignee selected",
        message: "Assign a grower to keep notifications and approvals moving smoothly.",
    },
    render: args => `
        <div style="max-inline-size:40rem;">
            <violet-empty-state
                heading="${args.heading ?? ""}"
                message="${args.message ?? ""}"
                appearance="${args.appearance ?? "plain"}"
                orientation="horizontal"
            >
                <violet-image slot="media" src="${demoImage}" alt="" decorative ratio="square" style="inline-size:5rem;"></violet-image>
                <violet-button slot="actions" appearance="secondary">Assign owner</violet-button>
            </violet-empty-state>
        </div>
    `,
};

export const CopyOnly: Story = {
    render: () => `
        <div style="max-inline-size:28rem;">
            <violet-empty-state
                heading="No recent notes"
                message="Once the team starts logging greenhouse activity, it will show up here."
                appearance="plain"
            ></violet-empty-state>
        </div>
    `,
};
