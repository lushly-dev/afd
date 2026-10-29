import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "../option-group/violet-option-group";
import "../option/violet-option";
import "./violet-listbox";
import type { VioletListbox } from "./violet-listbox";

type VioletListboxStoryArgs = {
    selectionFollowsFocus: boolean;
    disabled: boolean;
    multiple: boolean;
};

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

function renderListbox(args: VioletListboxStoryArgs): HTMLElement {
    const listbox = document.createElement("violet-listbox") as VioletListbox;
    listbox.label = "Propagation method";
    listbox.selectionFollowsFocus = args.selectionFollowsFocus;
    listbox.disabled = args.disabled;
    listbox.multiple = args.multiple;

    if (args.multiple) {
        listbox.selectedValues = ["direct"];
    } else {
        listbox.value = "direct";
    }

    listbox.append(
        createOption("Broadcast sowing", "broadcast", "Fast coverage over larger beds."),
        createOption("Direct seed", "direct", "Best when row spacing matters."),
        createOption("Tray transplant", "transplant", "More control before planting."),
        createOption("Hydroponic", "hydroponic", "Not available in soil beds.", true)
    );

    return listbox;
}

const meta = {
    title: "Components/Listbox",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet listbox primitive with active option management, typeahead, and optional selection-follows-focus behavior.",
            },
        },
    },
    argTypes: {
        selectionFollowsFocus: { control: "boolean" },
        disabled: { control: "boolean" },
        multiple: { control: "boolean" },
    },
    render: (args: VioletListboxStoryArgs) => renderListbox(args),
} satisfies Meta<VioletListboxStoryArgs>;

export default meta;

type Story = StoryObj<VioletListboxStoryArgs>;

export const Overview: Story = {
    args: {
        selectionFollowsFocus: false,
        disabled: false,
        multiple: false,
    },
    play: async ({ canvasElement }) => {
        const listbox = canvasElement.querySelector("violet-listbox") as VioletListbox | null;
        if (!listbox) {
            throw new Error("Expected violet-listbox to render.");
        }

        const control = listbox.shadowRoot?.querySelector('[role="listbox"]') as HTMLElement | null;
        if (!control) {
            throw new Error("Expected listbox control to render.");
        }

        control.focus();
        await userEvent.keyboard("{ArrowDown}");

        await waitFor(() => {
            expect(listbox.activeValue).toBe("transplant");
        });

        await userEvent.keyboard("{Enter}");

        await waitFor(() => {
            expect(listbox.value).toBe("transplant");
        });
    },
};

export const SelectionFollowsFocus: Story = {
    args: {
        selectionFollowsFocus: true,
        disabled: false,
        multiple: false,
    },
};

export const MultipleSelection: Story = {
    args: {
        selectionFollowsFocus: false,
        disabled: false,
        multiple: true,
    },
    play: async ({ canvasElement }) => {
        const listbox = canvasElement.querySelector("violet-listbox") as VioletListbox | null;
        const control = listbox?.shadowRoot?.querySelector('[role="listbox"]') as HTMLElement | null;

        if (!listbox || !control) {
            throw new Error("Expected multiselect violet-listbox to render.");
        }

        await expect(control.getAttribute("aria-multiselectable")).toBe("true");

        control.focus();
        control.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
        control.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

        await waitFor(() => {
            expect(listbox.selectedValues).toEqual(["direct", "transplant"]);
        });
    },
};

export const GroupedOptions: Story = {
    args: {
        selectionFollowsFocus: false,
        disabled: false,
        multiple: false,
    },
    render: () => {
        const listbox = document.createElement("violet-listbox") as VioletListbox;
        listbox.label = "Seed source";
        listbox.value = "regional";
        listbox.append(
            createGroup("Current suppliers", [
                { label: "Regional catalog", value: "regional", description: "Preferred for weekly reorders." },
                { label: "Local co-op", value: "coop", description: "Best for regional seed stock." },
            ]),
            createGroup(
                "Archived suppliers",
                [
                    { label: "Legacy inventory", value: "legacy", description: "Carryover lots from last year." },
                    { label: "Overflow greenhouse", value: "overflow", description: "Unavailable this cycle." },
                ],
                true
            )
        );
        return listbox;
    },
    play: async ({ canvasElement }) => {
        const listbox = canvasElement.querySelector("violet-listbox") as VioletListbox | null;
        if (!listbox) {
            throw new Error("Expected grouped violet-listbox to render.");
        }

        await waitFor(() => {
            expect(listbox.querySelectorAll("violet-option-group").length).toBe(2);
            expect(listbox.querySelectorAll("violet-option-group[disabled]").length).toBe(1);
            expect(listbox.querySelectorAll("violet-option").length).toBe(4);
        });
    },
};

export const Disabled: Story = {
    args: {
        selectionFollowsFocus: false,
        disabled: true,
        multiple: false,
    },
};
