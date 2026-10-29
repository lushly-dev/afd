import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "../option-group/violet-option-group";
import "../option/violet-option";
import "./violet-select";
import type { VioletSelect } from "./violet-select";

type VioletSelectStoryArgs = {
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

function createOption(label: string, value: string, description = "", disabled = false): HTMLElement {
    const option = document.createElement("violet-option");
    option.setAttribute("value", value);
    option.textContent = label;

    if (description) {
        const extra = document.createElement("span");
        extra.slot = "description";
        extra.textContent = description;
        option.append(extra);
    }

    if (disabled) {
        option.setAttribute("disabled", "");
    }

    return option;
}

function createGroup(
    label: string,
    options: Array<{ label: string; value: string; description?: string; disabled?: boolean }>,
    disabled = false
): HTMLElement {
    const group = document.createElement("violet-option-group");
    group.setAttribute("label", label);
    if (disabled) {
        group.setAttribute("disabled", "");
    }

    for (const option of options) {
        group.append(createOption(option.label, option.value, option.description ?? "", option.disabled ?? false));
    }

    return group;
}

function renderSelect(args: VioletSelectStoryArgs): HTMLElement {
    const form = document.createElement("form");

    const select = document.createElement("violet-select") as VioletSelect;
    select.label = "Propagation path";
    select.placeholder = args.placeholder;
    select.supportingText = "Choose the default path for this crop plan.";
    select.errorText = "Please choose a propagation path.";
    select.required = args.required;
    select.invalid = args.invalid;
    select.disabled = args.disabled;
    select.name = "propagation-path";
    select.value = "direct";

    select.append(
        createOption("Broadcast sowing", "broadcast", "Quick coverage for open beds."),
        createOption("Direct seed", "direct", "Most common field workflow."),
        createOption("Tray transplant", "transplant", "Best for controlled starts."),
        createOption("Hydroponic", "hydroponic", "Unavailable for this field.", true)
    );

    form.append(select);
    const surface = createStorySurface();
    surface.append(form);
    return surface;
}

const meta = {
    title: "Components/Select",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet single-select field with a popup listbox surface, form association, and supporting/error text.",
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
    render: (args: VioletSelectStoryArgs) => renderSelect(args),
} satisfies Meta<VioletSelectStoryArgs>;

export default meta;

type Story = StoryObj<VioletSelectStoryArgs>;

export const Overview: Story = {
    args: {
        invalid: false,
        required: false,
        disabled: false,
        placeholder: "Select an option",
    },
    play: async ({ canvasElement }) => {
        const form = canvasElement.querySelector("form");
        const select = canvasElement.querySelector("violet-select") as VioletSelect | null;
        if (!select || !form) {
            throw new Error("Expected violet-select to render.");
        }

        const trigger = select.shadowRoot?.querySelector(".trigger") as HTMLButtonElement | null;
        if (!trigger) {
            throw new Error("Expected select trigger to render.");
        }

        await userEvent.click(trigger);

        await waitFor(() => {
            expect(select.open).toBe(true);
        });

        await waitFor(() => {
            const listbox = select.shadowRoot?.querySelector('[role="listbox"]') as HTMLElement | null;
            expect(listbox).not.toBeNull();
        });

        const listbox = select.shadowRoot?.querySelector('[role="listbox"]') as HTMLElement | null;
        if (!listbox) {
            throw new Error("Expected select listbox to render after opening.");
        }
        listbox.focus();
        await userEvent.keyboard("{ArrowDown}{Enter}");

        await waitFor(() => {
            expect(select.value).toBe("transplant");
            expect(select.open).toBe(false);
        });

        await expect(select.form).toBe(form);
        await expect(select.checkValidity()).toBe(true);

        const formData = new FormData(form);
        await expect(formData.get("propagation-path")).toBe("transplant");

        form.reset();

        await waitFor(() => {
            expect(select.value).toBe("direct");
            expect(select.open).toBe(false);
        });
    },
};

export const Invalid: Story = {
    args: {
        invalid: true,
        required: true,
        disabled: false,
        placeholder: "Select a path",
    },
    play: async ({ canvasElement }) => {
        const select = canvasElement.querySelector("violet-select") as VioletSelect | null;
        if (!select) {
            throw new Error("Expected invalid violet-select to render.");
        }

        await expect(select.checkValidity()).toBe(false);
    },
};

export const Disabled: Story = {
    args: {
        invalid: false,
        required: false,
        disabled: true,
        placeholder: "Select a path",
    },
};

export const GroupedOptions: Story = {
    args: {
        invalid: false,
        required: false,
        disabled: false,
        placeholder: "Select a source",
    },
    render: (args: VioletSelectStoryArgs) => {
        const form = document.createElement("form");

        const select = document.createElement("violet-select") as VioletSelect;
        select.label = "Seed source";
        select.placeholder = args.placeholder;
        select.supportingText = "Choose a preferred source before creating the order.";
        select.value = "regional";
        select.append(
            createGroup("Current suppliers", [
                { label: "Regional catalog", value: "regional", description: "Preferred for weekly replenishment." },
                { label: "Local co-op", value: "coop", description: "Good for regional seed stock." },
            ]),
            createGroup(
                "Archived suppliers",
                [
                    { label: "Legacy inventory", value: "legacy", description: "Carryover lots from last year." },
                    { label: "Overflow greenhouse", value: "overflow", description: "Unavailable for current planning." },
                ],
                true
            )
        );

        form.append(select);
        const surface = createStorySurface();
        surface.append(form);
        return surface;
    },
    play: async ({ canvasElement }) => {
        const select = canvasElement.querySelector("violet-select") as VioletSelect | null;
        const trigger = select?.shadowRoot?.querySelector(".trigger") as HTMLButtonElement | null;

        if (!select || !trigger) {
            throw new Error("Expected grouped violet-select to render.");
        }

        await userEvent.click(trigger);

        await waitFor(() => {
            expect(select.open).toBe(true);
            expect(select.querySelectorAll("violet-option-group").length).toBe(2);
            expect(select.querySelectorAll("violet-option-group[disabled]").length).toBe(1);
        });
    },
};
