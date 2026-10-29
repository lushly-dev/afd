import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "../button/violet-button";
import "./violet-teaching-tip";
import type { VioletTeachingTip, VioletTeachingTipPositioning } from "./violet-teaching-tip";

type VioletTeachingTipStoryArgs = {
    content: string;
    positioning: VioletTeachingTipPositioning;
    noCloseButton: boolean;
    currentStep: number;
    totalSteps: number;
    title: string;
};

function renderTip(args: VioletTeachingTipStoryArgs): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.justifyContent = "center";
    wrapper.style.alignItems = "center";
    wrapper.style.minBlockSize = "200px";

    const tip = document.createElement("violet-teaching-tip") as VioletTeachingTip;
    tip.content = args.content;
    tip.setAttribute("positioning", args.positioning);
    tip.noCloseButton = args.noCloseButton;

    if (args.currentStep && args.totalSteps) {
        tip.setAttribute("current-step", String(args.currentStep));
        tip.setAttribute("total-steps", String(args.totalSteps));
    }

    if (args.title) {
        const title = document.createElement("span");
        title.slot = "title";
        title.textContent = args.title;
        tip.append(title);
    }

    const trigger = document.createElement("violet-button");
    trigger.textContent = "Show Tip";
    trigger.addEventListener("click", () => tip.show());
    tip.append(trigger);

    wrapper.append(tip);
    return wrapper;
}

const meta = {
    title: "Components/Teaching Tip",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Positioned onboarding overlay anchored to a trigger element with title, body content, optional step indicators, and a close button. Uses popover=\"auto\" and CSS Anchor Positioning.",
            },
        },
    },
    argTypes: {
        positioning: {
            control: "inline-radio",
            options: ["above", "below", "before", "after"],
        },
        noCloseButton: { control: "boolean" },
        currentStep: { control: "number" },
        totalSteps: { control: "number" },
    },
    render: (args: VioletTeachingTipStoryArgs) => renderTip(args),
} satisfies Meta<VioletTeachingTipStoryArgs>;

export default meta;

type Story = StoryObj<VioletTeachingTipStoryArgs>;

export const Overview: Story = {
    args: {
        title: "Welcome to the dashboard",
        content: "This is your main workspace. You can customize the layout by dragging panels around.",
        positioning: "below",
        noCloseButton: false,
        currentStep: 0,
        totalSteps: 0,
    },
    play: async ({ canvasElement }) => {
        const tip = canvasElement.querySelector("violet-teaching-tip") as VioletTeachingTip | null;
        const trigger = canvasElement.querySelector("violet-button") as HTMLElement | null;

        if (!tip || !trigger) {
            throw new Error("Expected violet-teaching-tip and trigger to render.");
        }

        const popup = tip.shadowRoot?.querySelector(".tip") as HTMLElement | null;
        if (!popup) {
            throw new Error("Expected tip popup in shadow DOM.");
        }

        await expect(popup.getAttribute("role")).toBe("dialog");
        await expect(popup.getAttribute("popover")).toBe("auto");
        await expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
        await expect(trigger.getAttribute("aria-expanded")).toBe("false");
        await expect(trigger.getAttribute("aria-controls")).toBe(tip.tipId);

        await userEvent.click(trigger);

        await waitFor(() => {
            expect(tip.open).toBe(true);
        });

        // The popup fades in (opacity 0 -> 1). Wait for the transition to finish so the
        // accessibility check that runs after play() measures the settled colours, not a
        // translucent mid-fade frame (which reports a false colour-contrast violation).
        await waitFor(() => {
            expect(getComputedStyle(popup).opacity).toBe("1");
        });

        await expect(trigger.getAttribute("aria-expanded")).toBe("true");
    },
};

export const WithSteps: Story = {
    args: {
        title: "Create your first project",
        content: "Click the + button in the sidebar to create a new project. You can choose from several templates.",
        positioning: "below",
        noCloseButton: false,
        currentStep: 1,
        totalSteps: 3,
    },
    render: (args: VioletTeachingTipStoryArgs) => {
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.justifyContent = "center";
        wrapper.style.alignItems = "center";
        wrapper.style.minBlockSize = "250px";

        const tip = document.createElement("violet-teaching-tip") as VioletTeachingTip;
        tip.content = args.content;
        tip.setAttribute("positioning", args.positioning);
        tip.setAttribute("current-step", String(args.currentStep));
        tip.setAttribute("total-steps", String(args.totalSteps));

        const title = document.createElement("span");
        title.slot = "title";
        title.textContent = args.title;
        tip.append(title);

        const footer = document.createElement("div");
        footer.slot = "footer";
        footer.style.display = "flex";
        footer.style.gap = "8px";

        const back = document.createElement("violet-button");
        back.setAttribute("appearance", "secondary");
        back.textContent = "Back";
        back.addEventListener("click", () => {
            const step = tip.currentStep;
            if (step > 1) {
                tip.setAttribute("current-step", String(step - 1));
            }
        });

        const next = document.createElement("violet-button");
        next.setAttribute("appearance", "primary");
        next.textContent = "Next";
        next.addEventListener("click", () => {
            const step = tip.currentStep;
            if (step < tip.totalSteps) {
                tip.setAttribute("current-step", String(step + 1));
            } else {
                tip.hide();
            }
        });

        footer.append(back, next);
        tip.append(footer);

        const trigger = document.createElement("violet-button");
        trigger.textContent = "Show Tour";
        trigger.addEventListener("click", () => {
            tip.setAttribute("current-step", "1");
            tip.show();
        });
        tip.append(trigger);

        wrapper.append(tip);
        return wrapper;
    },
};

export const Above: Story = {
    args: {
        title: "Quick action",
        content: "Use this button to quickly add new items to your collection.",
        positioning: "above",
        noCloseButton: false,
        currentStep: 0,
        totalSteps: 0,
    },
};

export const Before: Story = {
    args: {
        title: "Navigation",
        content: "The sidebar contains all your workspaces and recent projects.",
        positioning: "before",
        noCloseButton: false,
        currentStep: 0,
        totalSteps: 0,
    },
};

export const After: Story = {
    args: {
        title: "Settings panel",
        content: "Access your account settings and preferences from this menu.",
        positioning: "after",
        noCloseButton: false,
        currentStep: 0,
        totalSteps: 0,
    },
};

export const NoTitle: Story = {
    args: {
        title: "",
        content: "Click here to get started with your first workflow.",
        positioning: "below",
        noCloseButton: false,
        currentStep: 0,
        totalSteps: 0,
    },
};

export const ContentOnly: Story = {
    args: {
        title: "",
        content: "Tip: You can press Ctrl+K to open the command palette anytime.",
        positioning: "below",
        noCloseButton: true,
        currentStep: 0,
        totalSteps: 0,
    },
    render: (args: VioletTeachingTipStoryArgs) => {
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.justifyContent = "center";
        wrapper.style.alignItems = "center";
        wrapper.style.minBlockSize = "200px";

        const tip = document.createElement("violet-teaching-tip") as VioletTeachingTip;
        tip.content = args.content;
        tip.setAttribute("positioning", args.positioning);
        tip.noCloseButton = true;

        const footer = document.createElement("div");
        footer.slot = "footer";
        const got = document.createElement("violet-button");
        got.setAttribute("appearance", "primary");
        got.textContent = "Got it";
        got.addEventListener("click", () => tip.hide());
        footer.append(got);
        tip.append(footer);

        const trigger = document.createElement("violet-button");
        trigger.textContent = "Show Tip";
        trigger.addEventListener("click", () => tip.show());
        tip.append(trigger);

        wrapper.append(tip);
        return wrapper;
    },
};

export const ExternalAnchor: Story = {
    args: {
        title: "External trigger",
        content: "This teaching tip is positioned from an element outside the component subtree.",
        positioning: "below",
        noCloseButton: false,
        currentStep: 0,
        totalSteps: 0,
    },
    render: (args: VioletTeachingTipStoryArgs) => {
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.justifyContent = "center";
        wrapper.style.alignItems = "center";
        wrapper.style.minBlockSize = "200px";

        const trigger = document.createElement("violet-button");
        trigger.id = "teaching-tip-anchor";
        trigger.textContent = "Open external tip";

        const tip = document.createElement("violet-teaching-tip") as VioletTeachingTip;
        tip.content = args.content;
        tip.positioning = args.positioning;
        tip.anchor = "teaching-tip-anchor";

        const title = document.createElement("span");
        title.slot = "title";
        title.textContent = args.title;
        tip.append(title);

        trigger.addEventListener("click", () => tip.show());

        wrapper.append(trigger, tip);
        return wrapper;
    },
};
