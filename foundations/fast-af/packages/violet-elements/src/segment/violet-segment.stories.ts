import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "./violet-segment";
import type { VioletSegment } from "./violet-segment";

type VioletSegmentStoryArgs = {
    checked: boolean;
    disabled: boolean;
};

function renderSegment(args: VioletSegmentStoryArgs): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.style.maxInlineSize = "12rem";

    const segment = document.createElement("violet-segment") as VioletSegment;
    segment.value = "overview";
    if (args.checked) {
        segment.setAttribute("checked", "");
    }
    if (args.disabled) {
        segment.setAttribute("disabled", "");
    }
    segment.textContent = "Overview";
    wrapper.append(segment);
    return wrapper;
}

const meta = {
    title: "Components/Segment",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Compact single-selection segment item used inside `violet-segmented-control`.",
            },
        },
    },
    argTypes: {
        checked: { control: "boolean" },
        disabled: { control: "boolean" },
    },
    render: (args: VioletSegmentStoryArgs) => renderSegment(args),
} satisfies Meta<VioletSegmentStoryArgs>;

export default meta;

type Story = StoryObj<VioletSegmentStoryArgs>;

export const Overview: Story = {
    args: {
        checked: false,
        disabled: false,
    },
    play: async ({ canvasElement }) => {
        const segment = canvasElement.querySelector("violet-segment");
        const button = segment?.shadowRoot?.querySelector(".button") as HTMLButtonElement | null;
        if (!segment || !button) {
            throw new Error("Expected violet-segment to render.");
        }

        segment.addEventListener("select-request", (event: Event) => {
            const detail = (event as CustomEvent<{ value: string }>).detail;
            segment.toggleAttribute("checked", detail?.value === (segment as VioletSegment).value);
        }, { once: true });

        await userEvent.click(button);

        await waitFor(() => {
            expect(segment.hasAttribute("checked")).toBe(true);
        });
    },
};

export const Checked: Story = {
    args: {
        checked: true,
        disabled: false,
    },
};

export const Disabled: Story = {
    args: {
        checked: false,
        disabled: true,
    },
};
