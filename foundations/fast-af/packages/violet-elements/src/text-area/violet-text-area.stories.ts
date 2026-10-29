import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import { clearVioletIconRegistryForTesting } from "../icon/icon-registry";
import { registerSystemCloseIcon, registerSystemSearchIcon, registerSystemSettingsIcon } from "../icon/generated";
import "../icon/violet-icon";
import "./violet-text-area";
import type { VioletTextArea } from "./violet-text-area";

type VioletTextAreaStoryArgs = {
    label: string;
    placeholder: string;
    value: string;
    supportingText: string;
    rows: number;
    invalid: boolean;
    disabled: boolean;
    readonly: boolean;
    name: string;
    required: boolean;
    before: "" | "system/search" | "system/settings" | "system/close";
};

function renderTextArea(args: VioletTextAreaStoryArgs): HTMLElement {
    clearVioletIconRegistryForTesting();
    registerSystemSearchIcon();
    registerSystemSettingsIcon();
    registerSystemCloseIcon();

    const element = document.createElement("violet-text-area") as VioletTextArea;
    element.label = args.label;
    element.placeholder = args.placeholder;
    element.value = args.value;
    element.supportingText = args.supportingText;
    element.rows = args.rows;
    element.invalid = args.invalid;
    element.disabled = args.disabled;
    element.readonly = args.readonly;
    element.name = args.name;
    element.required = args.required;

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
    title: "Components/Text Area",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet multiline text area primitive with built-in label and supporting text.",
            },
        },
    },
    argTypes: {
        rows: { control: "number" },
        invalid: { control: "boolean" },
        disabled: { control: "boolean" },
        readonly: { control: "boolean" },
        required: { control: "boolean" },
        before: {
            control: "inline-radio",
            options: ["", "system/search", "system/settings", "system/close"],
        },
    },
    render: (args: VioletTextAreaStoryArgs) => renderTextArea(args),
} satisfies Meta<VioletTextAreaStoryArgs>;

export default meta;

type Story = StoryObj<VioletTextAreaStoryArgs>;

export const Overview: Story = {
    args: {
        label: "Planting notes",
        placeholder: "Add observations for this bed...",
        value: "",
        supportingText: "Keep the most recent field notes with the current plan.",
        rows: 4,
        invalid: false,
        disabled: false,
        readonly: false,
        name: "plantingNotes",
        required: true,
        before: "",
    },
    play: async ({ canvasElement, args }) => {
        const area = canvasElement.querySelector("violet-text-area") as VioletTextArea | null;
        await expect(Boolean(area)).toBe(true);

        const control = area?.shadowRoot?.querySelector("textarea") as HTMLTextAreaElement | null;
        await expect(control?.placeholder).toContain("Add observations");

        if (!control || !area) {
            throw new Error("Expected violet-text-area to render.");
        }

        await expect(control.required).toBe(true);
        await expect(control.name).toBe("plantingNotes");
        await expect(area.checkValidity()).toBe(false);

        if (args.before) {
            await expect(Boolean(area.querySelector('[slot="before"]'))).toBe(true);
        }

        await userEvent.type(control, "Needs another week before transplant.");
        await expect(area.value).toContain("transplant");
        await expect(area.checkValidity()).toBe(true);

        const form = document.createElement("form");
        form.hidden = true;
        canvasElement.append(form);

        try {
            const mirror = renderTextArea({ ...args, value: area.value }) as VioletTextArea;
            form.append(mirror);

            await waitFor(() => {
                const formData = new FormData(form);
                expect(formData.get("plantingNotes")).toContain("transplant");
            });
        } finally {
            form.remove();
        }
    },
};

export const Invalid: Story = {
    args: {
        label: "Harvest notes",
        placeholder: "Describe the issue...",
        value: "",
        supportingText: "Required before submitting the crop review.",
        rows: 5,
        invalid: true,
        disabled: false,
        readonly: false,
        name: "harvestNotes",
        required: true,
        before: "",
    },
};

export const Readonly: Story = {
    args: {
        label: "Planting notes",
        placeholder: "",
        value: "Mulched after irrigation and covered overnight.",
        supportingText: "Readonly areas should remain legible and structurally calm.",
        rows: 4,
        invalid: false,
        disabled: false,
        readonly: true,
        name: "plantingNotes",
        required: false,
        before: "",
    },
};

export const Disabled: Story = {
    args: {
        label: "Harvest notes",
        placeholder: "Unavailable while sync is running",
        value: "",
        supportingText: "Disabled areas should still show their footprint in a dense form.",
        rows: 5,
        invalid: false,
        disabled: true,
        readonly: false,
        name: "harvestNotes",
        required: false,
        before: "",
    },
};

export const WithLeadingAffordance: Story = {
    args: {
        label: "Field journal",
        placeholder: "Capture the latest observation...",
        value: "",
        supportingText: "Leading content can frame the entry purpose without replacing the label.",
        rows: 4,
        invalid: false,
        disabled: false,
        readonly: false,
        name: "fieldJournal",
        required: false,
        before: "system/search",
    },
};
