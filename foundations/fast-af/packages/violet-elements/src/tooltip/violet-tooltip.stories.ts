import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, waitFor } from "storybook/test";

import "./violet-tooltip";
import type { VioletTooltip, VioletTooltipPositioning } from "./violet-tooltip";

type VioletTooltipStoryArgs = {
    content: string;
    positioning: VioletTooltipPositioning;
    delay: number;
};

function renderTooltip(args: VioletTooltipStoryArgs): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.justifyContent = "center";
    wrapper.style.alignItems = "center";
    wrapper.style.minBlockSize = "120px";

    const tooltip = document.createElement("violet-tooltip") as VioletTooltip;
    tooltip.content = args.content;
    tooltip.setAttribute("positioning", args.positioning);
    tooltip.delay = args.delay;

    const trigger = document.createElement("button");
    trigger.textContent = "Hover me";
    trigger.style.padding = "8px 16px";
    trigger.style.cursor = "pointer";
    tooltip.append(trigger);

    wrapper.append(tooltip);
    return wrapper;
}

const meta = {
    title: "Components/Tooltip",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet tooltip using popover=\"hint\" and CSS Anchor Positioning. Wraps a trigger element and shows supplemental text on hover or focus.",
            },
        },
    },
    argTypes: {
        positioning: {
            control: "inline-radio",
            options: ["above", "below", "before", "after"],
        },
        delay: { control: "number" },
    },
    render: (args: VioletTooltipStoryArgs) => renderTooltip(args),
} satisfies Meta<VioletTooltipStoryArgs>;

export default meta;

type Story = StoryObj<VioletTooltipStoryArgs>;

export const Overview: Story = {
    args: {
        content: "This is a helpful tooltip with supplemental information.",
        positioning: "above",
        delay: 250,
    },
    play: async ({ canvasElement }) => {
        const tooltip = canvasElement.querySelector("violet-tooltip") as VioletTooltip | null;
        const trigger = canvasElement.querySelector("button") as HTMLButtonElement | null;

        if (!tooltip || !trigger) {
            throw new Error("Expected violet-tooltip and trigger to render.");
        }

        const popup = tooltip.shadowRoot?.querySelector(".tooltip") as HTMLElement | null;
        if (!popup) {
            throw new Error("Expected tooltip popup in shadow DOM.");
        }

        await expect(popup.getAttribute("role")).toBe("tooltip");
        await expect(popup.getAttribute("popover")).toBe("hint");
        await expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.tooltipId);
    },
};

export const Below: Story = {
    args: {
        content: "Tooltip positioned below the trigger element.",
        positioning: "below",
        delay: 250,
    },
};

export const Before: Story = {
    args: {
        content: "Tooltip to the left.",
        positioning: "before",
        delay: 250,
    },
};

export const After: Story = {
    args: {
        content: "Tooltip to the right.",
        positioning: "after",
        delay: 250,
    },
};

export const NoDelay: Story = {
    args: {
        content: "This tooltip appears instantly with no delay.",
        positioning: "above",
        delay: 0,
    },
};

export const LongContent: Story = {
    args: {
        content: "This is a longer tooltip message that demonstrates how the tooltip handles wrapping text content. It should respect the max-width constraint and wrap naturally.",
        positioning: "above",
        delay: 250,
    },
};

export const RichContent: Story = {
    args: {
        content: "",
        positioning: "above",
        delay: 250,
    },
    render: (args: VioletTooltipStoryArgs) => {
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.justifyContent = "center";
        wrapper.style.alignItems = "center";
        wrapper.style.minBlockSize = "120px";

        const tooltip = document.createElement("violet-tooltip") as VioletTooltip;
        tooltip.setAttribute("positioning", args.positioning);
        tooltip.delay = args.delay;

        const trigger = document.createElement("button");
        trigger.textContent = "Hover for rich tooltip";
        trigger.style.padding = "8px 16px";
        trigger.style.cursor = "pointer";
        tooltip.append(trigger);

        const content = document.createElement("span");
        content.slot = "content";
        const strong = document.createElement("strong");
        strong.textContent = "Keyboard shortcut: ";
        const kbd = document.createElement("kbd");
        kbd.textContent = "Ctrl+S";
        kbd.style.padding = "2px 4px";
        kbd.style.borderRadius = "3px";
        kbd.style.fontSize = "11px";
        kbd.style.border = "1px solid rgba(28, 26, 13, 0.18)";
        kbd.style.background = "rgba(28, 26, 13, 0.05)";
        content.append(strong, kbd);
        tooltip.append(content);

        wrapper.append(tooltip);
        return wrapper;
    },
};

export const AllPositions: Story = {
    args: {
        content: "Tooltip",
        positioning: "above",
        delay: 100,
    },
    render: () => {
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.flexWrap = "wrap";
        wrapper.style.gap = "32px";
        wrapper.style.padding = "80px";
        wrapper.style.justifyContent = "center";
        wrapper.style.alignItems = "center";

        for (const pos of ["above", "below", "before", "after"] as const) {
            const tooltip = document.createElement("violet-tooltip") as VioletTooltip;
            tooltip.content = `Positioned ${pos}`;
            tooltip.setAttribute("positioning", pos);
            tooltip.delay = 100;

            const trigger = document.createElement("button");
            trigger.textContent = pos;
            trigger.style.padding = "8px 20px";
            trigger.style.cursor = "pointer";
            tooltip.append(trigger);

            wrapper.append(tooltip);
        }

        return wrapper;
    },
};

export const FocusTrigger: Story = {
    args: {
        content: "This tooltip appears on keyboard focus too.",
        positioning: "above",
        delay: 0,
    },
    play: async ({ canvasElement }) => {
        const tooltip = canvasElement.querySelector("violet-tooltip") as VioletTooltip | null;
        const trigger = canvasElement.querySelector("button") as HTMLButtonElement | null;

        if (!tooltip || !trigger) {
            throw new Error("Expected violet-tooltip and trigger to render.");
        }

        trigger.focus();

        await waitFor(() => {
            expect(tooltip.open).toBe(true);
        });

        trigger.blur();

        await waitFor(() => {
            expect(tooltip.open).toBe(false);
        });
    },
};
