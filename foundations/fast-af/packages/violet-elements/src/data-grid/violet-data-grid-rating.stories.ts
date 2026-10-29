import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "./violet-data-grid-rating";
import type { VioletDataGridRating } from "./violet-data-grid-rating";

type RatingStoryArgs = {
    controlLabel: string;
    rating: number | null;
    max: number;
    readonly: boolean;
    disabled: boolean;
};

function renderRating(args: RatingStoryArgs): HTMLElement {
    const element = document.createElement("violet-data-grid-rating") as VioletDataGridRating;
    element.max = args.max;
    element.rating = args.rating;
    element.readonly = args.readonly;
    element.disabled = args.disabled;
    element.setAttribute("aria-label", args.controlLabel);

    return element;
}

const meta = {
    title: "Components/Data Grid/Rating",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Inline grid-native rating editor that renders dense star values, supports keyboard stepping, and commits each interaction immediately.",
            },
        },
    },
    render: (args: RatingStoryArgs) => renderRating(args),
} satisfies Meta<RatingStoryArgs>;

export default meta;

type Story = StoryObj<RatingStoryArgs>;

export const Overview: Story = {
    args: {
        controlLabel: "Harvest confidence rating",
        rating: 2,
        max: 5,
        readonly: false,
        disabled: false,
    },
    play: async ({ canvasElement }) => {
        const element = canvasElement.querySelector("violet-data-grid-rating") as VioletDataGridRating | null;

        if (!element) {
            throw new Error("Expected violet-data-grid-rating to render.");
        }

        const control = element.shadowRoot?.querySelector<HTMLElement>(".control");
        const star = element.shadowRoot?.querySelector<HTMLElement>('.star[data-index="4"]');
        if (!control || !star) throw new Error("Expected the rendered rating control and stars.");
        await userEvent.click(star);

        await waitFor(() => {
            expect(element.rating).toBe(4);
            expect(element.value).toBe("4");
            expect(control.getAttribute("aria-valuenow")).toBe("4");
        });
        control.focus();
        await userEvent.keyboard("{ArrowLeft}{Home}{End}{Delete}");
        await waitFor(() => {
            expect(element.rating).toBeNull();
            expect(control.getAttribute("aria-valuetext")).toBe("No rating, out of 5");
        });
    },
};

export const Empty: Story = {
    args: {
        controlLabel: "Harvest confidence rating",
        rating: null,
        max: 5,
        readonly: false,
        disabled: false,
    },
};

export const Readonly: Story = {
    args: {
        controlLabel: "Harvest confidence rating",
        rating: 3,
        max: 5,
        readonly: true,
        disabled: false,
    },
    play: async ({ canvasElement }) => {
        const element = canvasElement.querySelector("violet-data-grid-rating") as VioletDataGridRating | null;
        if (!element) throw new Error("Expected the readonly rating display.");
        await waitFor(() => {
            const display = element.shadowRoot?.querySelector(".control");
            expect(display?.getAttribute("role")).toBe("img");
            expect(display?.getAttribute("aria-label")).toBe("Harvest confidence rating: 3 of 5");
            expect(display?.hasAttribute("tabindex")).toBe(false);
        });
        const star = element.shadowRoot?.querySelector<HTMLElement>('.star[data-index="1"]');
        if (!star) throw new Error("Expected readonly stars.");
        await userEvent.click(star);
        expect(element.rating).toBe(3);
    },
};

export const Disabled: Story = {
    args: {
        controlLabel: "Harvest confidence rating",
        rating: 3,
        max: 5,
        readonly: false,
        disabled: true,
    },
};

export const DenseScale: Story = {
    args: {
        controlLabel: "Risk score",
        rating: 6,
        max: 8,
        readonly: false,
        disabled: false,
    },
};
