import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-calendar";
import type { VioletCalendar } from "./violet-calendar";

type Story = StoryObj<VioletCalendar>;

const meta: Meta<VioletCalendar> = {
    title: "Components/Calendar",
    component: "violet-calendar",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Reusable month-grid calendar primitive used by the Violet date picker family. It supports single-date and range selection, keyboard navigation, and locale-aware weekday and month labels.",
            },
        },
    },
    render: args => {
        const selectionMode = args.selectionMode ? `selection-mode="${args.selectionMode}"` : "";
        const locale = args.locale ? `locale="${args.locale}"` : "";
        const value = args.value ? `value="${args.value}"` : "";
        const start = args.start ? `start="${args.start}"` : "";
        const end = args.end ? `end="${args.end}"` : "";
        const min = args.min ? `min="${args.min}"` : "";
        const max = args.max ? `max="${args.max}"` : "";

        return `
            <div style="max-inline-size: 20rem;">
                <violet-calendar ${selectionMode} ${locale} ${value} ${start} ${end} ${min} ${max}></violet-calendar>
            </div>
        `;
    },
};

export default meta;

export const Overview: Story = {
    args: {
        locale: "en-US",
        value: "2026-03-23",
    },
    play: async ({ canvasElement }) => {
        const calendar = canvasElement.querySelector("violet-calendar");
        await expect(calendar?.shadowRoot?.querySelector(".heading")?.textContent?.trim().length).toBeGreaterThan(0);
    },
};

export const RangeSelection: Story = {
    args: {
        selectionMode: "range",
        locale: "en-US",
        start: "2026-03-20",
        end: "2026-03-24",
    },
};

export const Constrained: Story = {
    args: {
        locale: "en-US",
        value: "2026-03-23",
        min: "2026-03-18",
        max: "2026-03-28",
    },
};

export const Disabled: Story = {
    args: {
        locale: "en-US",
        value: "2026-03-23",
        disabled: true,
    },
};
