import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "../listbox/violet-listbox";
import "../option/violet-option";
import "./violet-option-group";
import type { VioletListbox } from "../listbox/violet-listbox";
import type { VioletOptionGroup } from "./violet-option-group";

type VioletOptionGroupStoryArgs = {
    label: string;
    disabled: boolean;
};

function createOption(label: string, value: string): HTMLElement {
    const option = document.createElement("violet-option");
    option.setAttribute("value", value);
    option.textContent = label;
    return option;
}

function renderGroup(args: VioletOptionGroupStoryArgs): HTMLElement {
    const listbox = document.createElement("violet-listbox") as VioletListbox;
    listbox.label = "Seed source";
    listbox.value = "regional";

    const group = document.createElement("violet-option-group") as VioletOptionGroup;
    group.label = args.label;
    group.disabled = args.disabled;
    group.append(createOption("Regional catalog", "regional"), createOption("Local co-op", "coop"));

    listbox.append(group);
    return listbox;
}

const meta = {
    title: "Components/Option Group",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Reusable Violet option group for grouped listbox, select, and combobox collections.",
            },
        },
    },
    argTypes: {
        label: { control: "text" },
        disabled: { control: "boolean" },
    },
    render: (args: VioletOptionGroupStoryArgs) => renderGroup(args),
} satisfies Meta<VioletOptionGroupStoryArgs>;

export default meta;

type Story = StoryObj<VioletOptionGroupStoryArgs>;

export const Overview: Story = {
    args: {
        label: "Current suppliers",
        disabled: false,
    },
    play: async ({ canvasElement }) => {
        const group = canvasElement.querySelector("violet-option-group") as VioletOptionGroup | null;
        await expect(group?.label).toBe("Current suppliers");
        await expect(group?.querySelectorAll("violet-option").length).toBe(2);
    },
};

export const Disabled: Story = {
    args: {
        label: "Archived suppliers",
        disabled: true,
    },
};
