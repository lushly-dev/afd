import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import "../button/violet-button";
import "./violet-alert";
import type { VioletAlert } from "./violet-alert";

type AlertStoryArgs = Partial<VioletAlert> & {
    onDismiss: ReturnType<typeof fn>;
};

type Story = StoryObj<AlertStoryArgs>;

const meta: Meta<AlertStoryArgs> = {
    title: "Components/Alert",
    component: "violet-alert",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Persistent inline or banner-style message surface for status, warning, and error messaging. It is not modal and only becomes a live region when explicitly configured to announce.",
            },
        },
    },
    args: {
        tone: "default",
        announcement: "off",
        dismissible: false,
        onDismiss: fn(),
    },
    argTypes: {
        tone: {
            control: "select",
            options: ["default", "info", "success", "warning", "danger"],
        },
        announcement: {
            control: "select",
            options: ["off", "polite", "assertive"],
        },
        dismissible: {
            control: "boolean",
        },
        onDismiss: {
            action: "dismiss",
            table: {
                category: "events",
            },
        },
    },
    render: args => {
        const alert = document.createElement("violet-alert") as VioletAlert;
        alert.setAttribute("tone", args.tone ?? "default");
        alert.setAttribute("announcement", args.announcement ?? "off");
        alert.toggleAttribute("dismissible", Boolean(args.dismissible));
        alert.addEventListener("dismiss", () => args.onDismiss?.());
        alert.innerHTML = `
            <span slot="title">Propagation update</span>
            Tray transplant is now the default path for late-spring greens in this plan.
            <span slot="actions">
                <violet-button appearance="secondary">Review changes</violet-button>
            </span>
        `;
        return alert;
    },
};

export default meta;

export const Overview: Story = {
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const alert = canvasElement.querySelector("violet-alert");

        await expect(alert?.getAttribute("announcement")).toBe("off");
        await expect(canvas.getByText("Propagation update")).toBeTruthy();
        await expect(canvas.getByText("Review changes")).toBeTruthy();
    },
};

export const Tones: Story = {
    render: () => {
        const wrap = document.createElement("div");
        wrap.style.display = "grid";
        wrap.style.gap = "12px";
        wrap.innerHTML = `
            <violet-alert tone="default">
                <span slot="title">Heads up</span>
                Crop recommendations updated for this plan.
            </violet-alert>
            <violet-alert tone="info">
                <span slot="title">Review available</span>
                A fresh field summary is ready to read.
            </violet-alert>
            <violet-alert tone="success">
                <span slot="title">Saved</span>
                Irrigation thresholds were applied successfully.
            </violet-alert>
            <violet-alert tone="warning">
                <span slot="title">Check before planting</span>
                Soil temperature is below the preferred transplant range.
            </violet-alert>
            <violet-alert tone="danger">
                <span slot="title">Action blocked</span>
                This bed is locked while an inventory sync is in progress.
            </violet-alert>
        `;
        return wrap;
    },
};

export const Dismissible: Story = {
    args: {
        tone: "warning",
        dismissible: true,
    },
};

export const DismissInteraction: Story = {
    args: {
        tone: "warning",
        dismissible: true,
    },
    play: async ({ canvasElement, args }) => {
        const dismissButton = canvasElement
            .querySelector("violet-alert")
            ?.shadowRoot
            ?.querySelector("violet-icon-button")
            ?.shadowRoot
            ?.querySelector("button") as HTMLButtonElement | null;

        if (!dismissButton) {
            throw new Error("Expected violet-alert to render a dismiss button.");
        }

        await userEvent.click(dismissButton);
        await expect(args.onDismiss).toHaveBeenCalled();
    },
};

export const AssertiveAnnouncement: Story = {
    args: {
        tone: "danger",
        announcement: "assertive",
    },
    play: async ({ canvasElement }) => {
        const alert = canvasElement.querySelector("violet-alert");
        const copy = alert?.shadowRoot?.querySelector(".copy");

        await expect(copy?.getAttribute("role")).toBe("alert");
        await expect(copy?.getAttribute("aria-live")).toBe("assertive");
    },
};
