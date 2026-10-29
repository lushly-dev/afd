import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-progress";
import type { VioletProgress } from "./violet-progress";

type Story = StoryObj<VioletProgress>;

const meta: Meta<VioletProgress> = {
    title: "Components/Progress",
    component: "violet-progress",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Native-first linear progress indicator built on the HTML progress element. It supports determinate and indeterminate loading without custom ARIA recreation.",
            },
        },
    },
    args: {
        label: "Uploading field imagery",
        value: "48",
        max: "100",
        valueText: "",
    },
    argTypes: {
        label: { control: "text" },
        value: { control: "text" },
        max: { control: "text" },
        valueText: { control: "text", name: "value-text" },
    },
    render: args => {
        const label = args.label ? `label="${args.label}"` : "";
        const value = args.value !== undefined ? `value="${args.value}"` : "";
        const max = args.max ? `max="${args.max}"` : "";
        const valueText = args.valueText ? `value-text="${args.valueText}"` : "";

        return `<violet-progress ${label} ${value} ${max} ${valueText}></violet-progress>`;
    },
};

export default meta;

export const Overview: Story = {
    play: async ({ canvasElement }) => {
        const progress = canvasElement.querySelector("violet-progress");
        const native = progress?.shadowRoot?.querySelector("progress");

        await expect(native?.getAttribute("aria-label")).toBe("Uploading field imagery");
        await expect(progress?.shadowRoot?.querySelector(".value-label")?.textContent?.trim()).toBe("48%");
    },
};

export const Indeterminate: Story = {
    args: {
        label: "Loading crop summary",
        value: "",
    },
    play: async ({ canvasElement }) => {
        const progress = canvasElement.querySelector("violet-progress");
        const native = progress?.shadowRoot?.querySelector("progress");

        await expect(native?.hasAttribute("value")).toBe(false);
    },
};

export const CustomValueText: Story = {
    args: {
        label: "Irrigation capacity",
        value: "2",
        max: "4",
        valueText: "Half capacity",
    },
};
