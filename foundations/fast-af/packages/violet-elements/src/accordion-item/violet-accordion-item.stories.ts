import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "./violet-accordion-item";

type VioletAccordionItemStoryArgs = {
    expanded: boolean;
    disabled: boolean;
};

function renderItem(args: VioletAccordionItemStoryArgs): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.style.maxInlineSize = "42rem";

    const item = document.createElement("violet-accordion-item");
    if (args.expanded) {
        item.setAttribute("expanded", "");
    }
    if (args.disabled) {
        item.setAttribute("disabled", "");
    }

    item.addEventListener("toggle-request", (event: Event) => {
        const detail = (event as CustomEvent<{ expanded: boolean }>).detail;
        item.toggleAttribute("expanded", detail?.expanded ?? !item.hasAttribute("expanded"));
    });

    const heading = document.createElement("span");
    heading.slot = "heading";
    heading.textContent = "Propagation planning";

    item.append(heading, "Coordinate sowing windows, propagation media, and bench allocation before crop launch.");
    wrapper.append(item);
    return wrapper;
}

const meta = {
    title: "Components/Accordion Item",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Standalone accordion item primitive with a slotted heading trigger and expandable panel body.",
            },
        },
    },
    argTypes: {
        expanded: { control: "boolean" },
        disabled: { control: "boolean" },
    },
    render: (args: VioletAccordionItemStoryArgs) => renderItem(args),
} satisfies Meta<VioletAccordionItemStoryArgs>;

export default meta;

type Story = StoryObj<VioletAccordionItemStoryArgs>;

export const Overview: Story = {
    args: {
        expanded: false,
        disabled: false,
    },
    play: async ({ canvasElement }) => {
        const item = canvasElement.querySelector("violet-accordion-item");
        const trigger = item?.shadowRoot?.querySelector(".trigger") as HTMLButtonElement | null;
        if (!item || !trigger) {
            throw new Error("Expected violet-accordion-item to render.");
        }

        await userEvent.click(trigger);

        await waitFor(() => {
            expect(item.hasAttribute("expanded")).toBe(true);
        });
    },
};

export const Expanded: Story = {
    args: {
        expanded: true,
        disabled: false,
    },
};

export const Disabled: Story = {
    args: {
        expanded: false,
        disabled: true,
    },
};
