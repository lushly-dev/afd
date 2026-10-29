import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-date-range-picker";
import type { VioletDateRangePicker } from "./violet-date-range-picker";

type Story = StoryObj<VioletDateRangePicker>;

const meta: Meta<VioletDateRangePicker> = {
    title: "Components/Date Range Picker",
    component: "violet-date-range-picker",
    tags: ["autodocs"],
    parameters: {
        docs: {
            story: {
                inline: false,
                height: "360px",
            },
            description: {
                component:
                    "Shared-calendar date range picker that keeps canonical start and end ISO dates while presenting one range-selection surface.",
            },
        },
    },
    args: {
        label: "Harvest window",
        supportingText: "Choose the planned harvest period for this crop plan.",
        start: "2026-03-20",
        end: "2026-03-27",
        min: "2026-03-01",
        max: "2026-04-30",
        locale: "en-US",
        required: false,
        invalid: false,
        disabled: false,
        size: "natural",
        errorText: "",
    },
    argTypes: {
        size: { control: "radio", options: ["compact", "natural", "comfortable"] },
    },
    render: args => {
        const label = args.label ? `label="${args.label}"` : "";
        const supporting = args.supportingText ? `supporting-text="${args.supportingText}"` : "";
        const error = args.errorText ? `error-text="${args.errorText}"` : "";
        const start = args.start ? `start="${args.start}"` : "";
        const end = args.end ? `end="${args.end}"` : "";
        const min = args.min ? `min="${args.min}"` : "";
        const max = args.max ? `max="${args.max}"` : "";
        const locale = args.locale ? `locale="${args.locale}"` : "";
        const size = args.size ? `size="${args.size}"` : "";
        const required = args.required ? "required" : "";
        const invalid = args.invalid ? "invalid" : "";
        const disabled = args.disabled ? "disabled" : "";

        return `
            <div style="min-block-size: 22rem; max-inline-size: 24rem;">
                <violet-date-range-picker ${label} ${supporting} ${error} ${start} ${end} ${min} ${max} ${locale} ${size} ${required} ${invalid} ${disabled}></violet-date-range-picker>
            </div>
        `;
    },
};

export default meta;

export const Overview: Story = {
    play: async ({ canvasElement }) => {
        const picker = canvasElement.querySelector("violet-date-range-picker") as VioletDateRangePicker | null;
        await expect(picker?.start).toBe("2026-03-20");
        await expect(picker?.end).toBe("2026-03-27");
    },
};

export const Empty: Story = {
    args: {
        start: "",
        end: "",
    },
};

export const Compact: Story = {
    args: {
        size: "compact",
    },
};

export const Natural: Story = {
    args: {
        size: "natural",
    },
};

export const Comfortable: Story = {
    args: {
        size: "comfortable",
    },
};

export const Invalid: Story = {
    args: {
        start: "",
        end: "",
        required: true,
        invalid: true,
        errorText: "Please choose a harvest window.",
    },
    play: async ({ canvasElement }) => {
        const picker = canvasElement.querySelector("violet-date-range-picker") as VioletDateRangePicker | null;
        await expect(picker?.checkValidity()).toBe(false);
    },
};

export const Disabled: Story = {
    args: {
        disabled: true,
        start: "2026-03-20",
        end: "2026-03-27",
        supportingText: "This range is inherited from the parent greenhouse template.",
    },
};
