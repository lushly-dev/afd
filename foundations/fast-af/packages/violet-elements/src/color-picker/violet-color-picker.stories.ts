import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "./violet-color-picker";
import type { VioletColorPicker } from "./violet-color-picker";

type VioletColorPickerStoryArgs = {
    value: string;
    size: "compact" | "natural" | "comfortable";
    disabled: boolean;
    required: boolean;
};

function renderPicker(args: VioletColorPickerStoryArgs): HTMLElement {
    const surface = document.createElement("div");
    surface.style.maxInlineSize = "22rem";
    surface.style.paddingBlockEnd = "16rem";

    const form = document.createElement("form");
    const picker = document.createElement("violet-color-picker") as VioletColorPicker;
    picker.label = "Accent color";
    picker.supportingText = "Choose a color for farm map highlights.";
    picker.errorText = "Select a color before continuing.";
    picker.name = "accent-color";
    picker.value = args.value;
    picker.size = args.size;
    picker.disabled = args.disabled;
    picker.required = args.required;

    form.append(picker);
    surface.append(form);
    return surface;
}

const meta = {
    title: "Components/Color Picker",
    tags: ["autodocs"],
    parameters: {
        docs: {
            story: {
                inline: false,
                height: "480px",
            },
            description: {
                component:
                    "Token-driven Violet color picker with a swatch trigger, textual hex value, suggested presets, and HSL channel controls in a popover panel.",
            },
        },
    },
    argTypes: {
        value: { control: "text" },
        size: {
            control: "radio",
            options: ["compact", "natural", "comfortable"],
        },
        disabled: { control: "boolean" },
        required: { control: "boolean" },
    },
    render: (args: VioletColorPickerStoryArgs) => renderPicker(args),
} satisfies Meta<VioletColorPickerStoryArgs>;

export default meta;

type Story = StoryObj<VioletColorPickerStoryArgs>;

async function openPickerForReview(canvasElement: HTMLElement): Promise<VioletColorPicker> {
    const picker = canvasElement.querySelector("violet-color-picker") as VioletColorPicker | null;

    if (!picker) {
        throw new Error("Expected violet-color-picker to render.");
    }

    const trigger = picker.shadowRoot?.querySelector(".trigger") as HTMLButtonElement | null;
    const panel = picker.shadowRoot?.querySelector(".panel") as HTMLElement | null;

    if (!trigger || !panel) {
        throw new Error("Expected color picker trigger and panel to render.");
    }

    await userEvent.click(trigger);

    await waitFor(() => {
        expect(picker.open).toBe(true);
        expect(getComputedStyle(panel).opacity).toBe("1");
    });

    return picker;
}

export const Overview: Story = {
    args: {
        value: "#c84f3b",
        size: "natural",
        disabled: false,
        required: false,
    },
    play: async ({ canvasElement }) => {
        const picker = await openPickerForReview(canvasElement);
        const form = picker.closest("form");

        if (!form) {
            throw new Error("Expected color picker to render inside a form.");
        }

        expect(new FormData(form).get("accent-color")).toBe("#c84f3b");
        expect(picker.checkValidity()).toBe(true);
    },
};

export const Disabled: Story = {
    args: {
        value: "#c84f3b",
        size: "natural",
        disabled: true,
        required: false,
    },
    play: async ({ canvasElement }) => {
        const picker = canvasElement.querySelector("violet-color-picker") as VioletColorPicker | null;
        const trigger = picker?.shadowRoot?.querySelector(".trigger") as HTMLButtonElement | null;

        expect(picker?.disabled).toBe(true);
        expect(trigger?.disabled).toBe(true);
    },
};

export const Empty: Story = {
    args: {
        value: "",
        size: "natural",
        disabled: false,
        required: false,
    },
    play: async ({ canvasElement }) => {
        await openPickerForReview(canvasElement);
    },
};

export const Invalid: Story = {
    args: {
        value: "",
        size: "natural",
        disabled: false,
        required: true,
    },
    play: async ({ canvasElement }) => {
        const picker = await openPickerForReview(canvasElement);
        expect(picker.checkValidity()).toBe(false);
    },
};

export const HexInteraction: Story = {
    args: {
        value: "#c84f3b",
        size: "natural",
        disabled: false,
        required: false,
    },
    play: async ({ canvasElement }) => {
        const picker = await openPickerForReview(canvasElement);
        const hexInput = picker.shadowRoot?.querySelector(".hex-input") as HTMLInputElement | null;

        if (!hexInput) {
            throw new Error("Expected color picker hex input to render.");
        }
        hexInput.focus();
        hexInput.select();
        await userEvent.keyboard("#244635");
        hexInput.dispatchEvent(new Event("change", { bubbles: true }));

        await waitFor(() => {
            expect(picker.value).toBe("#244635");
        });
    },
};

/**
 * Focusing and leaving the hex field without an edit emits neither `input` nor `change`, and keeps the
 * author's value as set, even when its case differs from the normalized lowercase hex.
 */
export const HexBlurWithoutEdit: Story = {
    args: {
        value: "#1670CA",
        size: "natural",
        disabled: false,
        required: false,
    },
    play: async ({ canvasElement }) => {
        const picker = await openPickerForReview(canvasElement);
        const hexInput = picker.shadowRoot?.querySelector(".hex-input") as HTMLInputElement | null;
        const events: string[] = [];
        picker.addEventListener("change", event => {
            if (event.target === picker) {
                events.push("change");
            }
        });

        if (!hexInput) {
            throw new Error("Expected color picker hex input to render.");
        }
        hexInput.focus();
        await userEvent.tab();

        await waitFor(() => {
            expect(picker.shadowRoot?.activeElement).not.toBe(hexInput);
        });
        await expect(events).toEqual([]);
        await expect(picker.value).toBe("#1670CA");
    },
};
