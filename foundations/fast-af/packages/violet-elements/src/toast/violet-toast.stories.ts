import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, fn, userEvent } from "storybook/test";

import "../button/violet-button";
import "./violet-toast";
import type { VioletToast } from "./violet-toast";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

type ToastStoryArgs = Partial<VioletToast> & {
    onDismiss: ReturnType<typeof fn>;
};

type Story = StoryObj<ToastStoryArgs>;

const meta: Meta<ToastStoryArgs> = {
    title: "Components/Toast",
    component: "violet-toast",
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            story: {
                inline: false,
                height: "320px",
            },
            description: {
                component:
                    "Floating transient notification surface for status messages that should stay visible above the application without blocking task flow. Auto-dismiss is disabled when actions are present.",
            },
        },
    },
    args: {
        open: true,
        tone: "success",
        announcement: "polite",
        dismissible: false,
        timeout: "5000",
        onDismiss: fn(),
    },
    argTypes: {
        open: { control: "boolean" },
        tone: { control: "select", options: ["default", "info", "success", "warning", "danger"] },
        announcement: { control: "select", options: ["off", "polite", "assertive"] },
        dismissible: { control: "boolean" },
        timeout: { control: "text" },
        onDismiss: {
            action: "dismiss",
            table: { category: "events" },
        },
    },
    render: args => {
        const toast = document.createElement("violet-toast") as VioletToast;
        toast.toggleAttribute("open", Boolean(args.open));
        toast.setAttribute("tone", args.tone ?? "default");
        toast.setAttribute("announcement", args.announcement ?? "polite");
        toast.toggleAttribute("dismissible", Boolean(args.dismissible));
        toast.setAttribute("timeout", args.timeout ?? "5000");
        toast.addEventListener("dismiss", () => args.onDismiss?.());
        toast.innerHTML = `
            <span slot="title">Propagation synced</span>
            Seed-source defaults were updated for the spring-greens plan.
        `;
        return toast;
    },
};

export default meta;

export const Overview: Story = {
    play: async ({ canvasElement }) => {
        const toast = canvasElement.querySelector("violet-toast");
        const copy = toast?.shadowRoot?.querySelector(".copy");

        await expect(copy?.getAttribute("role")).toBe("status");
        await expect(toast?.hasAttribute("open")).toBe(true);
    },
};

export const Warning: Story = {
    args: {
        tone: "warning",
    },
};

export const WithAction: Story = {
    render: () => {
        const toast = document.createElement("violet-toast") as VioletToast;
        toast.setAttribute("open", "");
        toast.setAttribute("tone", "default");
        toast.setAttribute("timeout", "2500");
        toast.innerHTML = `
            <span slot="title">Review pending</span>
            A new seed-source recommendation is waiting for approval.
            <span slot="actions">
                <violet-button appearance="secondary">Review</violet-button>
            </span>
        `;
        return toast;
    },
    play: async ({ canvasElement }) => {
        const toast = canvasElement.querySelector("violet-toast");
        await expect(toast?.shadowRoot?.querySelector(".actions")?.hasAttribute("hidden")).toBe(false);
    },
};

export const Dismissible: Story = {
    args: {
        dismissible: true,
    },
};

export const DismissInteraction: Story = {
    args: {
        dismissible: true,
    },
    play: async ({ canvasElement, args }) => {
        const toast = canvasElement.querySelector("violet-toast") as VioletToast | null;
        const dismissButton = canvasElement
            .querySelector("violet-toast")
            ?.shadowRoot
            ?.querySelector("violet-icon-button")
            ?.shadowRoot
            ?.querySelector("button") as HTMLButtonElement | null;

        if (!dismissButton) {
            throw new Error("Expected violet-toast to render a dismiss button.");
        }

        await userEvent.click(dismissButton);
        await nextFrame();
        await expect(args.onDismiss).toHaveBeenCalled();
        await expect(toast?.open).toBe(false);
    },
};
