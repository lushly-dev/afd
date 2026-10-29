import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-date-picker";
import type { VioletDatePicker } from "./violet-date-picker";

type Story = StoryObj<VioletDatePicker>;

const meta: Meta<VioletDatePicker> = {
    title: "Components/Date Picker",
    component: "violet-date-picker",
    tags: ["autodocs"],
    parameters: {
        docs: {
            story: {
                inline: false,
                height: "360px",
            },
            description: {
                component:
                    "Locale-aware date field composed from the Violet field shell and shared calendar primitive. It preserves ISO date values while using a calendar popup for selection.",
            },
        },
    },
    args: {
        label: "Planting date",
        supportingText: "Choose when this plan should begin.",
        value: "2026-03-23",
        min: "2026-03-01",
        max: "2026-04-15",
        locale: "en-US",
        name: "planting-date",
        required: false,
        invalid: false,
        disabled: false,
        size: "natural",
        errorText: "",
    },
    argTypes: {
        label: { control: "text" },
        supportingText: { control: "text", name: "supporting-text" },
        errorText: { control: "text", name: "error-text" },
        value: { control: "text" },
        min: { control: "text" },
        max: { control: "text" },
        locale: { control: "text" },
        name: { control: "text" },
        size: { control: "radio", options: ["compact", "natural", "comfortable"] },
        required: { control: "boolean" },
        invalid: { control: "boolean" },
        disabled: { control: "boolean" },
    },
    render: args => {
        const label = args.label ? `label="${args.label}"` : "";
        const supporting = args.supportingText ? `supporting-text="${args.supportingText}"` : "";
        const error = args.errorText ? `error-text="${args.errorText}"` : "";
        const value = args.value ? `value="${args.value}"` : "";
        const min = args.min ? `min="${args.min}"` : "";
        const max = args.max ? `max="${args.max}"` : "";
        const locale = args.locale ? `locale="${args.locale}"` : "";
        const name = args.name ? `name="${args.name}"` : "";
        const size = args.size ? `size="${args.size}"` : "";
        const required = args.required ? "required" : "";
        const invalid = args.invalid ? "invalid" : "";
        const disabled = args.disabled ? "disabled" : "";

        return `
            <form style="min-block-size: 20rem; max-inline-size: 20rem;">
                <violet-date-picker ${label} ${supporting} ${error} ${value} ${min} ${max} ${locale} ${name} ${size} ${required} ${invalid} ${disabled}></violet-date-picker>
            </form>
        `;
    },
};

export default meta;

export const Overview: Story = {
    play: async ({ canvasElement }) => {
        const form = canvasElement.querySelector("form");
        const picker = canvasElement.querySelector("violet-date-picker") as VioletDatePicker | null;
        const input = picker?.shadowRoot?.querySelector('input[type="date"]') as HTMLInputElement | null;

        await expect(input?.value).toBe("2026-03-23");
        await expect(picker?.checkValidity()).toBe(true);

        const formData = new FormData(form as HTMLFormElement);
        await expect(formData.get("planting-date")).toBe("2026-03-23");
    },
};

export const Empty: Story = {
    args: {
        value: "",
        supportingText: "Choose a harvest start date.",
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
        value: "",
        required: true,
        invalid: true,
        errorText: "Please choose a date.",
    },
    play: async ({ canvasElement }) => {
        const picker = canvasElement.querySelector("violet-date-picker") as VioletDatePicker | null;
        await expect(picker?.checkValidity()).toBe(false);
    },
};

export const Disabled: Story = {
    args: {
        disabled: true,
        value: "2026-03-23",
        supportingText: "Date editing is inherited from the parent plan.",
    },
};
