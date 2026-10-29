import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "../card/violet-card";
import "../text/violet-text";
import "./violet-carousel";
import type { VioletCarousel } from "./violet-carousel";

type VioletCarouselStoryArgs = {
    appearance: "framed" | "plain";
    label: string;
    activeIndex: number;
    slidesPerView: number;
    loop: boolean;
};

const slideData = [
    {
        label: "Propagation dashboard",
        title: "Propagation dashboard",
        body: "Track sowing method, tray count, and current greenhouse staffing in one quick review panel.",
        tone: "rgba(222, 234, 223, 0.95)",
    },
    {
        label: "Watering reminders",
        title: "Watering reminders",
        body: "Coordinate moisture checks, next irrigation windows, and exception alerts for the active block.",
        tone: "rgba(226, 238, 247, 0.95)",
    },
    {
        label: "Harvest prep",
        title: "Harvest prep",
        body: "Keep cut lists, pack-out tasks, and fulfillment notes aligned before the crew starts its pass.",
        tone: "rgba(248, 238, 224, 0.95)",
    },
];

function renderSlide(entry: (typeof slideData)[number]): string {
    return `
        <violet-card
            appearance="filled"
            padding="large"
            style="--violet-card-background:${entry.tone}; min-block-size: 16rem; block-size: 100%;"
            data-label="${entry.label}"
        >
            <violet-text as="h3" variant="title-sm">${entry.title}</violet-text>
            <violet-text as="p" variant="body" tone="secondary" style="display:block; margin-block-start:12px;">
                ${entry.body}
            </violet-text>
        </violet-card>
    `;
}

function renderCarousel(args: VioletCarouselStoryArgs): string {
    return `
        <div style="max-inline-size: 34rem;">
            <violet-carousel
                label="${args.label}"
                appearance="${args.appearance}"
                active-index="${args.activeIndex}"
                slides-per-view="${args.slidesPerView}"
                ${args.loop ? "loop" : ""}
            >
                ${slideData.map(renderSlide).join("")}
            </violet-carousel>
        </div>
    `;
}

const meta = {
    title: "Components/Carousel",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Slot-based Violet carousel for paging arbitrary content one slide at a time with generated previous/next controls and pager dots.",
            },
        },
    },
    argTypes: {
        activeIndex: {
            control: { type: "range", min: 0, max: 2, step: 1 },
            name: "active-index",
        },
        appearance: {
            control: "inline-radio",
            options: ["framed", "plain"],
        },
        slidesPerView: {
            control: { type: "range", min: 1, max: 3, step: 1 },
            name: "slides-per-view",
        },
        loop: {
            control: "boolean",
        },
    },
    render: (args: VioletCarouselStoryArgs) => renderCarousel(args),
} satisfies Meta<VioletCarouselStoryArgs>;

export default meta;

type Story = StoryObj<VioletCarouselStoryArgs>;

export const Overview: Story = {
    args: {
        label: "Field operations carousel",
        appearance: "framed",
        activeIndex: 0,
        slidesPerView: 1,
        loop: false,
    },
    play: async ({ canvasElement }) => {
        const carousel = canvasElement.querySelector("violet-carousel") as VioletCarousel | null;
        const nextButton = carousel?.shadowRoot?.querySelector("[part='next-button']") as HTMLElement | null;

        if (!carousel || !nextButton) {
            throw new Error("Expected violet-carousel to render navigation controls.");
        }

        nextButton.click();

        await waitFor(() => {
            expect(carousel.activeIndex).toBe(1);
        });
    },
};

export const Looping: Story = {
    args: {
        label: "Looping harvest carousel",
        appearance: "framed",
        activeIndex: 2,
        slidesPerView: 1,
        loop: true,
    },
    play: async ({ canvasElement }) => {
        const carousel = canvasElement.querySelector("violet-carousel") as VioletCarousel | null;
        const nextButton = carousel?.shadowRoot?.querySelector("[part='next-button']") as HTMLElement | null;

        if (!carousel || !nextButton) {
            throw new Error("Expected looping violet-carousel to render.");
        }

        nextButton.click();

        await waitFor(() => {
            expect(carousel.activeIndex).toBe(0);
        });
    },
};

export const KeyboardNavigation: Story = {
    args: {
        label: "Keyboard carousel",
        appearance: "framed",
        activeIndex: 0,
        slidesPerView: 1,
        loop: false,
    },
    play: async ({ canvasElement }) => {
        const carousel = canvasElement.querySelector("violet-carousel") as VioletCarousel | null;
        const viewport = carousel?.shadowRoot?.querySelector("[part='viewport']") as HTMLElement | null;

        if (!carousel || !viewport) {
            throw new Error("Expected violet-carousel viewport to render.");
        }

        viewport.focus();
        await userEvent.keyboard("{ArrowRight}");

        await waitFor(() => {
            expect(carousel.activeIndex).toBe(1);
        });
    },
};

export const PaginationDots: Story = {
    args: {
        label: "Pager carousel",
        appearance: "framed",
        activeIndex: 0,
        slidesPerView: 1,
        loop: false,
    },
    play: async ({ canvasElement }) => {
        const carousel = canvasElement.querySelector("violet-carousel") as VioletCarousel | null;
        const dots = Array.from(carousel?.shadowRoot?.querySelectorAll(".dot") ?? []) as HTMLButtonElement[];

        if (!carousel || dots.length < 3) {
            throw new Error("Expected violet-carousel pager dots to render.");
        }

        dots[2]?.click();

        await waitFor(() => {
            expect(carousel.activeIndex).toBe(2);
            const currentDots = carousel.shadowRoot?.querySelectorAll(".dot");
            expect(currentDots?.[2]?.getAttribute("aria-pressed")).toBe("true");
        });
    },
};

export const CardStrip: Story = {
    args: {
        label: "Card strip carousel",
        appearance: "plain",
        activeIndex: 0,
        slidesPerView: 2,
        loop: false,
    },
};
