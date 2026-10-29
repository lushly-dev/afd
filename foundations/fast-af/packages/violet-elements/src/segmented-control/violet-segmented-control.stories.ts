import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "../segment/violet-segment";
import "./violet-segmented-control";
import type { VioletSegment } from "../segment/violet-segment";
import type { VioletSegmentedControl } from "./violet-segmented-control";

type VioletSegmentedControlStoryArgs = {
    value: string;
};

function renderSegmentedControl(args: VioletSegmentedControlStoryArgs): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.style.maxInlineSize = "32rem";

    const form = document.createElement("form");
    const control = document.createElement("violet-segmented-control") as VioletSegmentedControl;
    control.label = "Propagation view";
    control.supportingText = "Choose the working perspective for this crop plan.";
    control.value = args.value;
    control.name = "propagation-view";

    const options = [
        { label: "Overview", value: "overview" },
        { label: "Planting", value: "planting" },
        { label: "Irrigation", value: "irrigation" },
    ];

    for (const option of options) {
        const segment = document.createElement("violet-segment") as VioletSegment;
        segment.value = option.value;
        segment.textContent = option.label;
        control.append(segment);
    }

    form.append(control);
    wrapper.append(form);
    return wrapper;
}

const meta = {
    title: "Components/Segmented Control",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Single-selection segmented choice group built from `violet-segmented-control` and `violet-segment`.",
            },
        },
    },
    argTypes: {
        value: { control: "text" },
    },
    render: (args: VioletSegmentedControlStoryArgs) => renderSegmentedControl(args),
} satisfies Meta<VioletSegmentedControlStoryArgs>;

export default meta;

type Story = StoryObj<VioletSegmentedControlStoryArgs>;

export const Overview: Story = {
    args: {
        value: "overview",
    },
    play: async ({ canvasElement }) => {
        const control = canvasElement.querySelector("violet-segmented-control") as VioletSegmentedControl | null;
        const form = canvasElement.querySelector("form");
        const segments = canvasElement.querySelectorAll("violet-segment");
        const secondButton = segments[1]?.shadowRoot?.querySelector(".button") as HTMLButtonElement | null;
        if (!control || !secondButton || !form) {
            throw new Error("Expected violet-segmented-control to render.");
        }

        await userEvent.click(secondButton);

        await waitFor(() => {
            expect(control.value).toBe("planting");
            expect((segments[1] as VioletSegment | undefined)?.checked).toBe(true);
        });

        const formData = new FormData(form);
        await expect(formData.get("propagation-view")).toBe("planting");
        await expect(control.checkValidity()).toBe(true);
    },
};

export const Invalid: Story = {
    args: {
        value: "",
    },
    render: () => {
        const control = document.createElement("violet-segmented-control") as VioletSegmentedControl;
        control.label = "Propagation view";
        control.required = true;
        control.invalid = true;
        control.errorText = "Choose a view before continuing.";

        for (const option of [
            { label: "Overview", value: "overview" },
            { label: "Planting", value: "planting" },
        ]) {
            const segment = document.createElement("violet-segment") as VioletSegment;
            segment.value = option.value;
            segment.textContent = option.label;
            control.append(segment);
        }

        return control;
    },
};

export const Disabled: Story = {
    args: {
        value: "overview",
    },
    render: () => {
        const control = document.createElement("violet-segmented-control") as VioletSegmentedControl;
        control.label = "Propagation view";
        control.value = "overview";
        control.disabled = true;

        for (const option of [
            { label: "Overview", value: "overview" },
            { label: "Planting", value: "planting" },
        ]) {
            const segment = document.createElement("violet-segment") as VioletSegment;
            segment.value = option.value;
            segment.textContent = option.label;
            control.append(segment);
        }

        return control;
    },
};

/**
 * Disabling the segment that holds the Tab stop moves it to the next enabled segment, and enabling it
 * again moves it back, so the group always keeps one Tab stop while a segment is enabled.
 */
export const DisabledSegmentTabStop: Story = {
    args: {
        value: "",
    },
    play: async ({ canvasElement }) => {
        const segments = Array.from(canvasElement.querySelectorAll("violet-segment")) as VioletSegment[];
        const tabIndexes = () =>
            segments.map(segment => segment.shadowRoot?.querySelector(".button")?.getAttribute("tabindex"));
        if (segments.length < 2) {
            throw new Error("Expected violet-segment items to render.");
        }

        await waitFor(() => expect(tabIndexes()).toEqual(["0", "-1", "-1"]));

        segments[0].disabled = true;
        await waitFor(() => expect(tabIndexes()).toEqual(["-1", "0", "-1"]));

        segments[0].disabled = false;
        await waitFor(() => expect(tabIndexes()).toEqual(["0", "-1", "-1"]));
    },
};
