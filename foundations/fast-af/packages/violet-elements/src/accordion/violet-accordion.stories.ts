import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "../accordion-item/violet-accordion-item";
import "./violet-accordion";
import type { VioletAccordion } from "./violet-accordion";

type VioletAccordionStoryArgs = {
    expandMode: "single" | "multi";
};

function renderAccordion(args: VioletAccordionStoryArgs): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.style.maxInlineSize = "42rem";

    const accordion = document.createElement("violet-accordion") as VioletAccordion;
    accordion.expandMode = args.expandMode;

    const sections = [
        {
            heading: "Propagation planning",
            body: "Coordinate sowing windows, propagation media, and bench allocation before crop launch.",
            expanded: true,
        },
        {
            heading: "Irrigation notes",
            body: "Track moisture thresholds, emitter checks, and seasonal watering adjustments.",
        },
        {
            heading: "Harvest timing",
            body: "Capture expected maturity, target harvest dates, and handoff notes for fulfillment.",
        },
    ];

    for (const section of sections) {
        const item = document.createElement("violet-accordion-item");
        if (section.expanded) {
            item.setAttribute("expanded", "");
        }

        const heading = document.createElement("span");
        heading.slot = "heading";
        heading.textContent = section.heading;
        item.append(heading);
        item.append(section.body);
        accordion.append(item);
    }

    wrapper.append(accordion);
    return wrapper;
}

const meta = {
    title: "Components/Accordion",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Grouped disclosure control built from `violet-accordion` and `violet-accordion-item`, with APG-style heading buttons and single or multi expand modes.",
            },
        },
    },
    argTypes: {
        expandMode: {
            control: "inline-radio",
            options: ["single", "multi"],
        },
    },
    render: (args: VioletAccordionStoryArgs) => renderAccordion(args),
} satisfies Meta<VioletAccordionStoryArgs>;

export default meta;

type Story = StoryObj<VioletAccordionStoryArgs>;

export const Overview: Story = {
    args: {
        expandMode: "multi",
    },
    play: async ({ canvasElement }) => {
        const accordion = canvasElement.querySelector("violet-accordion") as VioletAccordion | null;
        const items = canvasElement.querySelectorAll("violet-accordion-item");
        if (!accordion || items.length < 2) {
            throw new Error("Expected violet-accordion to render with items.");
        }

        const secondButton = items[1]?.shadowRoot?.querySelector(".trigger") as HTMLButtonElement | null;
        if (!secondButton) {
            throw new Error("Expected accordion trigger button.");
        }

        await expect(items[0]?.hasAttribute("expanded")).toBe(true);
        await userEvent.click(secondButton);

        await waitFor(() => {
            expect(items[1]?.hasAttribute("expanded")).toBe(true);
        });
    },
};

export const SingleExpand: Story = {
    args: {
        expandMode: "single",
    },
    play: async ({ canvasElement }) => {
        const items = canvasElement.querySelectorAll("violet-accordion-item");
        const secondButton = items[1]?.shadowRoot?.querySelector(".trigger") as HTMLButtonElement | null;
        if (!secondButton) {
            throw new Error("Expected accordion trigger button.");
        }

        await userEvent.click(secondButton);

        await waitFor(() => {
            expect(items[0]?.hasAttribute("expanded")).toBe(false);
            expect(items[1]?.hasAttribute("expanded")).toBe(true);
        });
    },
};

export const WithDisabledItem: Story = {
    args: {
        expandMode: "multi",
    },
    render: () => {
        const accordion = document.createElement("violet-accordion");

        const active = document.createElement("violet-accordion-item");
        active.setAttribute("expanded", "");
        const activeHeading = document.createElement("span");
        activeHeading.slot = "heading";
        activeHeading.textContent = "Active section";
        active.append(activeHeading, "This section is currently expanded.");

        const disabled = document.createElement("violet-accordion-item");
        disabled.setAttribute("disabled", "");
        const disabledHeading = document.createElement("span");
        disabledHeading.slot = "heading";
        disabledHeading.textContent = "Disabled section";
        disabled.append(disabledHeading, "This body should remain unavailable.");

        accordion.append(active, disabled);
        return accordion;
    },
};
