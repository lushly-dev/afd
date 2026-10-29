import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-time-picker";
import type { VioletTimePicker } from "./violet-time-picker";

type Story = StoryObj<VioletTimePicker>;

const meta: Meta<VioletTimePicker> = {
    title: "Components/Time Picker",
    component: "violet-time-picker",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Violet time picker built on the native time input to preserve strong keyboard, validation, and form behavior while matching the Violet field system.",
            },
        },
    },
    args: {
        label: "Start time",
        supportingText: "Choose when this automation should begin each day.",
        value: "09:30",
        name: "start-time",
        min: "06:00",
        max: "21:00",
        step: "60",
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
        const value = args.value ? `value="${args.value}"` : "";
        const name = args.name ? `name="${args.name}"` : "";
        const min = args.min ? `min="${args.min}"` : "";
        const max = args.max ? `max="${args.max}"` : "";
        const step = args.step ? `step="${args.step}"` : "";
        const size = args.size ? `size="${args.size}"` : "";
        const required = args.required ? "required" : "";
        const invalid = args.invalid ? "invalid" : "";
        const disabled = args.disabled ? "disabled" : "";

        return `
            <form style="max-inline-size: 20rem;">
                <violet-time-picker ${label} ${supporting} ${error} ${value} ${name} ${min} ${max} ${step} ${size} ${required} ${invalid} ${disabled}></violet-time-picker>
            </form>
        `;
    },
};

export default meta;

export const Overview: Story = {
    play: async ({ canvasElement }) => {
        const form = canvasElement.querySelector("form") as HTMLFormElement | null;
        const picker = canvasElement.querySelector("violet-time-picker") as VioletTimePicker | null;
        const input = picker?.shadowRoot?.querySelector('input[type="time"]') as HTMLInputElement | null;

        await expect(input?.value).toBe("09:30");
        await expect(picker?.checkValidity()).toBe(true);

        const formData = new FormData(form as HTMLFormElement);
        await expect(formData.get("start-time")).toBe("09:30");
    },
};

export const Seconds: Story = {
    args: {
        label: "Fog cycle",
        value: "00:00:30",
        name: "fog-cycle",
        step: "1",
        min: "",
        max: "",
        supportingText: "Second-level granularity for short cycle timing.",
    },
};

export const Invalid: Story = {
    args: {
        value: "",
        required: true,
        invalid: true,
        errorText: "Please choose a time.",
    },
    play: async ({ canvasElement }) => {
        const picker = canvasElement.querySelector("violet-time-picker") as VioletTimePicker | null;
        await expect(picker?.checkValidity()).toBe(false);
    },
};

export const Disabled: Story = {
    args: {
        disabled: true,
        value: "09:30",
        supportingText: "This schedule is inherited from the greenhouse template.",
    },
};
