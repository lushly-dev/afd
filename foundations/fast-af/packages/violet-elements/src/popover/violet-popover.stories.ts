import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "../button/violet-button";
import "./violet-popover";
import type { VioletPopover } from "./violet-popover";

type Story = StoryObj<VioletPopover>;

const meta: Meta<VioletPopover> = {
    title: "Components/Popover",
    component: "violet-popover",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Generic anchored floating surface built on the native Popover API. Use it for arbitrary popup content; layer menu, tooltip, and other richer semantics on top.",
            },
        },
    },
    args: {
        open: false,
        positioning: "below",
        anchor: "",
    },
    argTypes: {
        open: { control: "boolean" },
        positioning: { control: "select", options: ["above", "below", "before", "after"] },
        anchor: { control: "text" },
    },
    render: args => `
        <violet-popover ${args.open ? "open" : ""} positioning="${args.positioning ?? "below"}" ${args.anchor ? `anchor="${args.anchor}"` : ""}>
            <violet-button slot="trigger" appearance="secondary">Open details</violet-button>
            <div style="display:grid;gap:var(--space-stack-xs);">
                <strong style="margin:0;">Propagation details</strong>
                <p style="margin:0;">Seeded trays are staged for transplanting next week.</p>
            </div>
        </violet-popover>
    `,
};

export default meta;

export const Overview: Story = {
    play: async ({ canvasElement }) => {
        const popover = canvasElement.querySelector("violet-popover") as VioletPopover | null;
        const trigger = popover?.querySelector('[slot="trigger"]') as HTMLElement | null;

        if (!popover || !trigger) {
            throw new Error("Expected violet-popover and its trigger to render.");
        }
        const surface = popover.shadowRoot?.querySelector(".surface") as HTMLElement | null;
        if (!surface) {
            throw new Error("Expected violet-popover surface to render.");
        }

        await userEvent.click(trigger);
        await waitFor(() => {
            expect(popover.open).toBe(true);
            expect(surface.matches(":popover-open")).toBe(true);
            expect(getComputedStyle(surface).opacity).toBe("1");
        });
    },
};

export const ExternalAnchor: Story = {
    render: () => `
        <div style="display:flex;align-items:center;gap:var(--space-layout-sm);">
            <violet-button id="popover-anchor" appearance="secondary">Anchor outside</violet-button>
            <violet-popover anchor="popover-anchor" positioning="after">
                <div style="display:grid;gap:var(--space-stack-xs);">
                    <strong style="margin:0;">Field note</strong>
                    <p style="margin:0;">This panel is anchored to an external trigger element.</p>
                </div>
            </violet-popover>
        </div>
    `,
};
