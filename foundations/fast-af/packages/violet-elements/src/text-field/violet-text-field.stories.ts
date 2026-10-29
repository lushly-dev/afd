import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import { clearVioletIconRegistryForTesting } from "../icon/icon-registry";
import { registerSystemCloseIcon, registerSystemSearchIcon, registerSystemSettingsIcon } from "../icon/generated";
import "../icon/violet-icon";
import "./violet-text-field";
import type { VioletTextField } from "./violet-text-field";

type VioletTextFieldStoryArgs = {
    label: string;
    placeholder: string;
    value: string;
    supportingText: string;
    invalid: boolean;
    disabled: boolean;
    readonly: boolean;
    name: string;
    required: boolean;
    type: "text" | "search" | "email" | "url" | "password" | "tel";
    before: "" | "system/search" | "system/settings" | "system/close";
};

function renderTextField(args: VioletTextFieldStoryArgs): HTMLElement {
    clearVioletIconRegistryForTesting();
    registerSystemSearchIcon();
    registerSystemSettingsIcon();
    registerSystemCloseIcon();

    const element = document.createElement("violet-text-field") as VioletTextField;
    element.label = args.label;
    element.placeholder = args.placeholder;
    element.value = args.value;
    element.supportingText = args.supportingText;
    element.invalid = args.invalid;
    element.disabled = args.disabled;
    element.readonly = args.readonly;
    element.name = args.name;
    element.required = args.required;
    element.type = args.type;

    if (args.before) {
        const before = document.createElement("violet-icon");
        before.slot = "before";
        before.setAttribute("icon", args.before);
        before.setAttribute("decorative", "");
        element.append(before);
    }

    return element;
}

const meta = {
    title: "Components/Text Field",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet single-line field primitive with built-in label and supporting text.",
            },
        },
    },
    argTypes: {
        invalid: { control: "boolean" },
        disabled: { control: "boolean" },
        readonly: { control: "boolean" },
        required: { control: "boolean" },
        type: {
            control: "inline-radio",
            options: ["text", "search", "email", "url", "password", "tel"],
        },
        before: {
            control: "inline-radio",
            options: ["", "system/search", "system/settings", "system/close"],
        },
    },
    render: (args: VioletTextFieldStoryArgs) => renderTextField(args),
} satisfies Meta<VioletTextFieldStoryArgs>;

export default meta;

type Story = StoryObj<VioletTextFieldStoryArgs>;

export const Overview: Story = {
    args: {
        label: "Plant name",
        placeholder: "Search cultivated rows",
        value: "",
        supportingText: "Use this for quick filtering or manual entry.",
        invalid: false,
        disabled: false,
        readonly: false,
        name: "plantName",
        required: true,
        type: "search",
        before: "system/search",
    },
    play: async ({ canvasElement, args }) => {
        const field = canvasElement.querySelector("violet-text-field") as VioletTextField | null;
        await expect(Boolean(field)).toBe(true);

        const input = field?.shadowRoot?.querySelector("input") as HTMLInputElement | null;
        await expect(input?.placeholder).toContain("Search cultivated rows");

        if (!input || !field) {
            throw new Error("Expected violet-text-field to render.");
        }

        await expect(input.required).toBe(true);
        await expect(input.name).toBe("plantName");
        await expect(field.checkValidity()).toBe(false);
        await expect(Boolean(field.querySelector('[slot="before"] violet-icon, [slot="before"]'))).toBe(true);

        await userEvent.type(input, "roma");
        await expect(field.value).toContain("roma");
        await expect(field.checkValidity()).toBe(true);

        const form = document.createElement("form");
        form.hidden = true;
        canvasElement.append(form);

        try {
            const mirror = renderTextField({ ...args, value: field.value }) as VioletTextField;
            form.append(mirror);

            await waitFor(() => {
                const formData = new FormData(form);
                expect(formData.get("plantName")).toBe("roma");
            });
        } finally {
            form.remove();
        }
    },
};

export const Invalid: Story = {
    args: {
        label: "Quantity",
        placeholder: "Enter quantity",
        value: "",
        supportingText: "Required before checkout can continue.",
        invalid: true,
        disabled: false,
        readonly: false,
        name: "quantity",
        required: true,
        type: "text",
        before: "",
    },
};

export const Readonly: Story = {
    args: {
        label: "Variety",
        placeholder: "",
        value: "Midnight Roma",
        supportingText: "Readonly fields should still preserve label and value clarity.",
        invalid: false,
        disabled: false,
        readonly: true,
        name: "variety",
        required: false,
        type: "text",
        before: "",
    },
};

export const Disabled: Story = {
    args: {
        label: "Plant name",
        placeholder: "Unavailable while sync is running",
        value: "",
        supportingText: "Disabled fields should stay visibly unavailable without losing structure.",
        invalid: false,
        disabled: true,
        readonly: false,
        name: "plantName",
        required: false,
        type: "search",
        before: "",
    },
};

export const Password: Story = {
    args: {
        label: "Account password",
        placeholder: "Enter your password",
        value: "",
        supportingText: "Password fields should preserve the same structure and density model.",
        invalid: false,
        disabled: false,
        readonly: false,
        name: "accountPassword",
        required: true,
        type: "password",
        before: "",
    },
};

export const Telephone: Story = {
    args: {
        label: "Contact number",
        placeholder: "Add a callback number",
        value: "",
        supportingText: "Telephone is useful for native keypad and autofill semantics.",
        invalid: false,
        disabled: false,
        readonly: false,
        name: "contactNumber",
        required: false,
        type: "tel",
        before: "",
    },
};
