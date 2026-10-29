import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, fn, userEvent } from "storybook/test";

import "../button/violet-button";
import "./violet-snackbar";
import type { VioletSnackbar } from "./violet-snackbar";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

type SnackbarStoryArgs = Partial<VioletSnackbar> & {
    onDismiss: ReturnType<typeof fn>;
};

type Story = StoryObj<SnackbarStoryArgs>;

const meta: Meta<SnackbarStoryArgs> = {
    title: "Components/Snackbar",
    component: "violet-snackbar",
    tags: ["autodocs"],
    parameters: {
        layout: "fullscreen",
        docs: {
            story: {
                inline: false,
                height: "280px",
            },
            description: {
                component:
                    "Compact transient feedback surface for short status text with an optional single action. It stays lightweight and disables auto-dismiss when an action is present.",
            },
        },
    },
    args: {
        open: true,
        tone: "default",
        announcement: "polite",
        dismissible: false,
        timeout: "6000",
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
        const snackbar = document.createElement("violet-snackbar") as VioletSnackbar;
        snackbar.toggleAttribute("open", Boolean(args.open));
        snackbar.setAttribute("tone", args.tone ?? "default");
        snackbar.setAttribute("announcement", args.announcement ?? "polite");
        snackbar.toggleAttribute("dismissible", Boolean(args.dismissible));
        snackbar.setAttribute("timeout", args.timeout ?? "6000");
        snackbar.addEventListener("dismiss", () => args.onDismiss?.());
        snackbar.textContent = "Row changes synced.";
        return snackbar;
    },
};

export default meta;

export const Overview: Story = {
    play: async ({ canvasElement }) => {
        const snackbar = canvasElement.querySelector("violet-snackbar");
        const messageCopy = snackbar?.shadowRoot?.querySelector(".message-copy");

        await expect(messageCopy?.getAttribute("role")).toBe("status");
        await expect(snackbar?.hasAttribute("open")).toBe(true);
    },
};

export const WithAction: Story = {
    render: () => {
        const snackbar = document.createElement("violet-snackbar") as VioletSnackbar;
        snackbar.setAttribute("open", "");
        snackbar.setAttribute("timeout", "2500");
        snackbar.innerHTML = `
            Row changes synced.
            <span slot="action">
                <violet-button appearance="transparent">Undo</violet-button>
            </span>
        `;
        return snackbar;
    },
    play: async ({ canvasElement }) => {
        const snackbar = canvasElement.querySelector("violet-snackbar");
        await expect(snackbar?.shadowRoot?.querySelector(".action")?.hasAttribute("hidden")).toBe(false);
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
        const snackbar = canvasElement.querySelector("violet-snackbar") as VioletSnackbar | null;
        const dismissButton = canvasElement
            .querySelector("violet-snackbar")
            ?.shadowRoot
            ?.querySelector("violet-icon-button")
            ?.shadowRoot
            ?.querySelector("button") as HTMLButtonElement | null;

        if (!dismissButton) {
            throw new Error("Expected violet-snackbar to render a dismiss button.");
        }

        await userEvent.click(dismissButton);
        await nextFrame();
        await expect(args.onDismiss).toHaveBeenCalled();
        await expect(snackbar?.open).toBe(false);
    },
};

export const Warning: Story = {
    args: {
        tone: "warning",
        dismissible: true,
    },
};
