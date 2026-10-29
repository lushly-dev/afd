import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, waitFor } from "storybook/test";

import "../option-group/violet-option-group";
import "../option/violet-option";
import "./violet-combobox";
import type { VioletCombobox } from "./violet-combobox";

type VioletComboboxStoryArgs = {
    invalid: boolean;
    required: boolean;
    disabled: boolean;
    placeholder: string;
};

function createStorySurface(): HTMLDivElement {
    const surface = document.createElement("div");
    surface.style.minBlockSize = "16rem";
    surface.style.paddingBlockEnd = "9rem";
    surface.style.boxSizing = "border-box";
    return surface;
}

function createOption(label: string, value: string, description = ""): HTMLElement {
    const option = document.createElement("violet-option");
    option.setAttribute("value", value);
    option.textContent = label;

    if (description) {
        const extra = document.createElement("span");
        extra.slot = "description";
        extra.textContent = description;
        option.append(extra);
    }

    return option;
}

function createGroup(
    label: string,
    options: Array<{ label: string; value: string; description?: string }>,
    disabled = false
): HTMLElement {
    const group = document.createElement("violet-option-group");
    group.setAttribute("label", label);

    if (disabled) {
        group.setAttribute("disabled", "");
    }

    for (const option of options) {
        group.append(createOption(option.label, option.value, option.description ?? ""));
    }

    return group;
}

function renderCombobox(args: VioletComboboxStoryArgs): HTMLElement {
    const form = document.createElement("form");

    const combobox = document.createElement("violet-combobox") as VioletCombobox;
    combobox.label = "Seed source";
    combobox.placeholder = args.placeholder;
    combobox.supportingText = "Filter sources before committing one.";
    combobox.errorText = "Please choose a seed source.";
    combobox.required = args.required;
    combobox.invalid = args.invalid;
    combobox.disabled = args.disabled;
    combobox.name = "seed-source";

    combobox.append(
        createOption("Regional catalog", "regional", "Fastest to reorder."),
        createOption("Local co-op", "coop", "Strong spring availability."),
        createOption("Greenhouse reserve", "reserve", "Best for backup stock."),
        createOption("Legacy inventory", "legacy", "Older carryover seed lots.")
    );

    form.append(combobox);
    const surface = createStorySurface();
    surface.append(form);
    return surface;
}

const meta = {
    title: "Components/Combobox",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet combobox with editable input, popup listbox suggestions, filtering, and form-associated committed value semantics.",
            },
            story: {
                inline: false,
                height: "320px",
            },
        },
    },
    argTypes: {
        invalid: { control: "boolean" },
        required: { control: "boolean" },
        disabled: { control: "boolean" },
        placeholder: { control: "text" },
    },
    render: (args: VioletComboboxStoryArgs) => renderCombobox(args),
} satisfies Meta<VioletComboboxStoryArgs>;

export default meta;

type Story = StoryObj<VioletComboboxStoryArgs>;

export const Overview: Story = {
    args: {
        invalid: false,
        required: false,
        disabled: false,
        placeholder: "Search sources",
    },
    play: async ({ canvasElement }) => {
        const form = canvasElement.querySelector("form");
        const combobox = canvasElement.querySelector("violet-combobox") as VioletCombobox | null;
        if (!combobox || !form) {
            throw new Error("Expected violet-combobox to render.");
        }

        const input = combobox.shadowRoot?.querySelector('input[role="combobox"]') as HTMLInputElement | null;
        if (!input) {
            throw new Error("Expected combobox input to render.");
        }

        input.focus();
        input.value = "coop";
        input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

        await waitFor(() => {
            expect(combobox.open).toBe(true);
            expect(combobox.visibleOptions.length).toBe(1);
        });

        combobox.selectValue("coop");

        await waitFor(() => {
            expect(combobox.selectedOptionValue).toBe("coop");
            expect(combobox.value).toBe("Local co-op");
            expect(input.value).toBe("Local co-op");
        });

        await expect(combobox.form).toBe(form);
        await expect(combobox.checkValidity()).toBe(true);

        const formData = new FormData(form);
        await expect(formData.get("seed-source")).toBe("coop");

        form.reset();
        combobox.formResetCallback();

        await waitFor(() => {
            expect(combobox.selectedOptionValue).toBe("");
            expect(combobox.value).toBe("");
            expect(combobox.open).toBe(false);
            expect(input.value).toBe("");
        });
    },
};

export const Invalid: Story = {
    args: {
        invalid: true,
        required: true,
        disabled: false,
        placeholder: "Find a source",
    },
    play: async ({ canvasElement }) => {
        const combobox = canvasElement.querySelector("violet-combobox") as VioletCombobox | null;
        if (!combobox) {
            throw new Error("Expected invalid violet-combobox to render.");
        }

        await expect(combobox.checkValidity()).toBe(false);
    },
};

export const Disabled: Story = {
    args: {
        invalid: false,
        required: false,
        disabled: true,
        placeholder: "Find a source",
    },
};

export const GroupedOptions: Story = {
    args: {
        invalid: false,
        required: false,
        disabled: false,
        placeholder: "Find a source",
    },
    render: (args: VioletComboboxStoryArgs) => {
        const form = document.createElement("form");

        const combobox = document.createElement("violet-combobox") as VioletCombobox;
        combobox.label = "Seed source";
        combobox.placeholder = args.placeholder;
        combobox.supportingText = "Filter grouped source options before selecting one.";
        combobox.append(
            createGroup("Current suppliers", [
                { label: "Regional catalog", value: "regional", description: "Fastest to reorder." },
                { label: "Local co-op", value: "coop", description: "Strong spring availability." },
            ]),
            createGroup(
                "Archived suppliers",
                [
                    { label: "Legacy inventory", value: "legacy", description: "Older carryover lots." },
                    { label: "Overflow greenhouse", value: "overflow", description: "Unavailable this season." },
                ],
                true
            )
        );

        form.append(combobox);
        const surface = createStorySurface();
        surface.append(form);
        return surface;
    },
    play: async ({ canvasElement }) => {
        const combobox = canvasElement.querySelector("violet-combobox") as VioletCombobox | null;
        const input = combobox?.shadowRoot?.querySelector('input[role="combobox"]') as HTMLInputElement | null;

        if (!combobox || !input) {
            throw new Error("Expected grouped violet-combobox to render.");
        }

        input.focus();

        await waitFor(() => {
            expect(combobox.open).toBe(true);
            expect(combobox.querySelectorAll("violet-option-group").length).toBe(2);
            expect(combobox.querySelectorAll("violet-option-group[disabled]").length).toBe(1);
        });
    },
};
