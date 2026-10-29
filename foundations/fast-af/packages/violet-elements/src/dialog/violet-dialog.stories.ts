import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "../button/violet-button";
import "../text-field/violet-text-field";
import "./violet-dialog";
import type { VioletDialog, VioletDialogType } from "./violet-dialog";

type VioletDialogStoryArgs = {
    type: VioletDialogType;
    padding: "none" | "small" | "medium" | "large";
    noCloseButton: boolean;
    noBackdrop: boolean;
    title: string;
    body: string;
    showFooter: boolean;
};

function createTriggerButton(label: string, dialog: HTMLElement): HTMLElement {
    const btn = document.createElement("violet-button");
    btn.textContent = label;
    btn.addEventListener("click", () => {
        (dialog as VioletDialog).show();
    });
    return btn;
}

function renderDialog(args: VioletDialogStoryArgs): HTMLElement {
    const wrapper = document.createElement("div");

    const element = document.createElement("violet-dialog") as VioletDialog;
    element.setAttribute("type", args.type);
    element.setAttribute("padding", args.padding);
    element.noCloseButton = args.noCloseButton;
    element.noBackdrop = args.noBackdrop;

    if (args.title) {
        const title = document.createElement("span");
        title.slot = "title";
        title.textContent = args.title;
        element.append(title);
    }

    const body = document.createElement("p");
    body.style.margin = "0";
    body.textContent = args.body;
    element.append(body);

    if (args.showFooter) {
        const footer = document.createElement("div");
        footer.slot = "footer";
        footer.style.display = "flex";
        footer.style.gap = "8px";
        footer.style.justifyContent = "flex-end";

        const cancel = document.createElement("violet-button");
        cancel.setAttribute("appearance", "secondary");
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => element.hide());

        const confirm = document.createElement("violet-button");
        confirm.setAttribute("appearance", "primary");
        confirm.textContent = "Confirm";
        confirm.addEventListener("click", () => element.hide("confirmed"));

        footer.append(cancel, confirm);
        element.append(footer);
    }

    const trigger = createTriggerButton("Open Dialog", element);

    wrapper.append(trigger, element);
    return wrapper;
}

const meta = {
    title: "Components/Dialog",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet dialog surface built on native <dialog> with modal/non-modal/alert types, CSS animations, adjustable padding, and header/footer slots.",
            },
        },
    },
    argTypes: {
        type: {
            control: "inline-radio",
            options: ["modal", "non-modal", "alert"],
        },
        padding: {
            control: "inline-radio",
            options: ["none", "small", "medium", "large"],
        },
        noCloseButton: { control: "boolean" },
        noBackdrop: { control: "boolean" },
        showFooter: { control: "boolean" },
    },
    render: (args: VioletDialogStoryArgs) => renderDialog(args),
} satisfies Meta<VioletDialogStoryArgs>;

export default meta;

type Story = StoryObj<VioletDialogStoryArgs>;

export const Overview: Story = {
    args: {
        type: "modal",
        padding: "medium",
        noCloseButton: false,
        noBackdrop: false,
        title: "Confirm Action",
        body: "Are you sure you want to proceed? This action can be undone later from the settings panel.",
        showFooter: true,
    },
    play: async ({ canvasElement }) => {
        const trigger = canvasElement.querySelector("violet-button") as HTMLElement | null;
        const element = canvasElement.querySelector("violet-dialog") as VioletDialog | null;

        if (!trigger || !element) {
            throw new Error("Expected violet-dialog and trigger button to render.");
        }

        const dialog = element.shadowRoot?.querySelector("dialog") as HTMLDialogElement | null;
        if (!dialog) {
            throw new Error("Expected native dialog in shadow DOM.");
        }

        await expect(dialog.open).toBe(false);

        await userEvent.click(trigger);

        await waitFor(() => {
            expect(dialog.open).toBe(true);
            expect(element.open).toBe(true);
        });

        const closeBtn = element.shadowRoot?.querySelector(".close-button") as HTMLButtonElement | null;
        if (closeBtn) {
            await userEvent.click(closeBtn);
        }

        await waitFor(() => {
            expect(dialog.open).toBe(false);
            expect(element.open).toBe(false);
        });
    },
};

export const Alert: Story = {
    args: {
        type: "alert",
        padding: "medium",
        noCloseButton: true,
        noBackdrop: false,
        title: "Unsaved Changes",
        body: "You have unsaved changes that will be lost if you leave this page. Please save or discard your changes before continuing.",
        showFooter: true,
    },
    render: (args: VioletDialogStoryArgs) => {
        const wrapper = document.createElement("div");

        const element = document.createElement("violet-dialog") as VioletDialog;
        element.setAttribute("type", "alert");
        element.setAttribute("padding", args.padding);
        element.noCloseButton = true;

        const title = document.createElement("span");
        title.slot = "title";
        title.textContent = args.title;
        element.append(title);

        const body = document.createElement("p");
        body.style.margin = "0";
        body.textContent = args.body;
        element.append(body);

        const footer = document.createElement("div");
        footer.slot = "footer";
        footer.style.display = "flex";
        footer.style.gap = "8px";
        footer.style.justifyContent = "flex-end";

        const discard = document.createElement("violet-button");
        discard.setAttribute("appearance", "secondary");
        discard.textContent = "Discard";
        discard.addEventListener("click", () => element.hide("discarded"));

        const save = document.createElement("violet-button");
        save.setAttribute("appearance", "primary");
        save.textContent = "Save Changes";
        save.addEventListener("click", () => element.hide("saved"));

        footer.append(discard, save);
        element.append(footer);

        const trigger = createTriggerButton("Open Alert Dialog", element);
        wrapper.append(trigger, element);
        return wrapper;
    },
    play: async ({ canvasElement }) => {
        const trigger = canvasElement.querySelector("violet-button") as HTMLElement | null;
        const element = canvasElement.querySelector("violet-dialog") as VioletDialog | null;

        if (!trigger || !element) {
            throw new Error("Expected violet-dialog and trigger button to render.");
        }

        await userEvent.click(trigger);

        await waitFor(() => {
            const dialog = element.shadowRoot?.querySelector("dialog") as HTMLDialogElement | null;
            expect(dialog?.getAttribute("role")).toBe("alertdialog");
            expect(dialog?.getAttribute("closedby")).toBe("none");
        });

        element.hide();
    },
};

export const NonModal: Story = {
    args: {
        type: "non-modal",
        padding: "medium",
        noCloseButton: false,
        noBackdrop: false,
        title: "Quick Settings",
        body: "This is a non-modal dialog. You can still interact with the page behind it. Click outside to dismiss.",
        showFooter: false,
    },
};

export const NoCloseButton: Story = {
    args: {
        type: "modal",
        padding: "medium",
        noCloseButton: true,
        noBackdrop: false,
        title: "Terms of Service",
        body: "Please read and accept the terms of service to continue using this application.",
        showFooter: true,
    },
};

export const LongContent: Story = {
    args: {
        type: "modal",
        padding: "medium",
        noCloseButton: false,
        noBackdrop: false,
        title: "Privacy Policy",
        body: "",
        showFooter: true,
    },
    render: (args: VioletDialogStoryArgs) => {
        const wrapper = document.createElement("div");

        const element = document.createElement("violet-dialog") as VioletDialog;
        element.setAttribute("type", args.type);
        element.setAttribute("padding", args.padding);

        const title = document.createElement("span");
        title.slot = "title";
        title.textContent = "Privacy Policy";
        element.append(title);

        for (let i = 0; i < 10; i++) {
            const p = document.createElement("p");
            p.textContent = `Section ${i + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.`;
            element.append(p);
        }

        const footer = document.createElement("div");
        footer.slot = "footer";
        const btn = document.createElement("violet-button");
        btn.setAttribute("appearance", "primary");
        btn.textContent = "I Accept";
        btn.addEventListener("click", () => element.hide("accepted"));
        footer.append(btn);
        element.append(footer);

        const trigger = createTriggerButton("Open Long Dialog", element);
        wrapper.append(trigger, element);
        return wrapper;
    },
};

export const FormDialog: Story = {
    args: {
        type: "modal",
        padding: "medium",
        noCloseButton: false,
        noBackdrop: false,
        title: "Rename Item",
        body: "",
        showFooter: false,
    },
    render: () => {
        const wrapper = document.createElement("div");
        const output = document.createElement("p");
        output.style.marginBlockStart = "12px";
        output.style.fontSize = "13px";
        output.style.color = "#414651";
        output.textContent = "Return value: (none)";

        const element = document.createElement("violet-dialog") as VioletDialog;
        element.setAttribute("type", "modal");
        element.setAttribute("padding", "medium");

        const title = document.createElement("span");
        title.slot = "title";
        title.textContent = "Rename Item";
        element.append(title);

        const form = document.createElement("form");
        form.method = "dialog";
        form.style.display = "flex";
        form.style.flexDirection = "column";
        form.style.gap = "12px";

        const field = document.createElement("violet-text-field");
        field.setAttribute("value", "My Document");
        field.setAttribute("label", "New name");

        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.gap = "8px";
        actions.style.justifyContent = "flex-end";

        const cancelBtn = document.createElement("violet-button");
        cancelBtn.setAttribute("appearance", "secondary");
        cancelBtn.setAttribute("type", "button");
        cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", () => element.hide());

        const saveBtn = document.createElement("violet-button");
        saveBtn.setAttribute("appearance", "primary");
        saveBtn.setAttribute("type", "submit");
        saveBtn.setAttribute("value", "save");
        saveBtn.textContent = "Save";
        actions.append(cancelBtn, saveBtn);

        form.append(field, actions);
        element.append(form);

        element.addEventListener("open-change", (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (!detail.open) {
                output.textContent = `Return value: "${element.returnValue || "(none)"}"`;
            }
        });

        const trigger = createTriggerButton("Open Form Dialog", element);
        wrapper.append(trigger, element, output);
        return wrapper;
    },
};

export const CustomWidth: Story = {
    args: {
        type: "modal",
        padding: "medium",
        noCloseButton: false,
        noBackdrop: false,
        title: "Wide Dialog",
        body: "This dialog uses a custom width of 800px via --violet-dialog-width.",
        showFooter: true,
    },
    render: (args: VioletDialogStoryArgs) => {
        const result = renderDialog(args);
        const element = result.querySelector("violet-dialog") as VioletDialog;
        element.style.setProperty("--violet-dialog-width", "800px");
        return result;
    },
};
