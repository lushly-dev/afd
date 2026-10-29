import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "./violet-data-grid-pill-select";
import type { VioletDataGridEditorOption } from "./violet-data-grid";
import type { VioletDataGridPillSelect } from "./violet-data-grid-pill-select";

type PillSelectStoryArgs = {
    value: string;
    controlLabel: string;
    placeholder: string;
    options: VioletDataGridEditorOption[];
};

function renderPillSelect(args: PillSelectStoryArgs): HTMLElement {
    const element = document.createElement("violet-data-grid-pill-select") as VioletDataGridPillSelect;
    element.value = args.value;
    element.placeholder = args.placeholder;
    element.options = args.options;
    element.controlLabel = args.controlLabel;

    return element;
}

const toneOptions: VioletDataGridEditorOption[] = [
    { value: "Direct Cover", label: "Direct Cover", tone: "olive", keywords: ["cover crop", "direct"] },
    { value: "Transplant Cover", label: "Transplant Cover", tone: "blue", keywords: ["cover crop", "transplant"] },
    { value: "Direct Outside", label: "Direct Outside", tone: "green", keywords: ["field", "direct"] },
    { value: "Fall Cover", label: "Fall Cover", tone: "gold", keywords: ["autumn", "cover"] },
];

const meta = {
    title: "Components/Data Grid/Pill Select",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Compact grid-native single-select editor that renders the current value as a pill and opens a searchable option list for fast spreadsheet editing.",
            },
        },
    },
    render: (args: PillSelectStoryArgs) => renderPillSelect(args),
} satisfies Meta<PillSelectStoryArgs>;

export default meta;

type Story = StoryObj<PillSelectStoryArgs>;

export const Overview: Story = {
    args: {
        value: "Direct Cover",
        controlLabel: "Planting method",
        placeholder: "Choose a method",
        options: toneOptions,
    },
    play: async ({ canvasElement }) => {
        const element = canvasElement.querySelector("violet-data-grid-pill-select") as VioletDataGridPillSelect | null;

        if (!element) {
            throw new Error("Expected violet-data-grid-pill-select to render.");
        }

        const shadow = element.shadowRoot;
        const trigger = shadow?.querySelector(".trigger") as HTMLButtonElement | null;

        if (!shadow || !trigger) {
            throw new Error("Expected pill select trigger to render.");
        }

        await userEvent.click(trigger);

        await waitFor(() => {
            expect(element.open).toBe(true);
        });

        const search = await waitFor(() => {
            const input = shadow.querySelector<HTMLInputElement>(".search");
            expect(input).not.toBeNull();
            return input as HTMLInputElement;
        });
        await userEvent.type(search, "outside");

        await waitFor(() => {
            expect(element.filteredOptions.map(option => option.value)).toEqual(["Direct Outside"]);
        });

        const option = shadow.querySelector<HTMLButtonElement>('.option[data-option-value="Direct Outside"]');
        if (!option) {
            throw new Error("Expected filtered Direct Outside option to render.");
        }
        await userEvent.click(option);

        await waitFor(() => {
            expect(element.value).toBe("Direct Outside");
            expect(element.open).toBe(false);
        });
    },
};

export const KeyboardNavigation: Story = {
    args: {
        value: "Direct Cover",
        controlLabel: "Planting method",
        placeholder: "Choose a method",
        options: toneOptions,
    },
    play: async ({ canvasElement }) => {
        const element = canvasElement.querySelector("violet-data-grid-pill-select") as VioletDataGridPillSelect | null;

        if (!element) {
            throw new Error("Expected violet-data-grid-pill-select to render.");
        }

        const shadow = element.shadowRoot;
        const trigger = shadow?.querySelector(".trigger") as HTMLButtonElement | null;

        if (!shadow || !trigger) {
            throw new Error("Expected pill select trigger to render.");
        }

        await userEvent.click(trigger);

        await waitFor(() => {
            expect(element.open).toBe(true);
        });

        const search = await waitFor(() => {
            const input = shadow.querySelector<HTMLInputElement>(".search");
            expect(input).not.toBeNull();
            return input as HTMLInputElement;
        });
        search.focus();
        await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");

        await waitFor(() => {
            expect(element.value).toBe("Transplant Cover");
            expect(element.open).toBe(false);
        });
    },
};

export const EmptyState: Story = {
    args: {
        value: "",
        controlLabel: "Planting method",
        placeholder: "Choose a method",
        options: toneOptions,
    },
};

export const Invalid: Story = {
    args: {
        value: "Direct Cover",
        controlLabel: "Planting method",
        placeholder: "Choose a method",
        options: toneOptions,
    },
    play: async ({ canvasElement }) => {
        const element = canvasElement.querySelector("violet-data-grid-pill-select") as VioletDataGridPillSelect | null;

        if (!element) {
            throw new Error("Expected violet-data-grid-pill-select to render.");
        }

        const shadow = element.shadowRoot;
        const trigger = shadow?.querySelector<HTMLButtonElement>(".trigger");

        if (!shadow || !trigger) {
            throw new Error("Expected pill select trigger to render.");
        }

        trigger.focus();
        element.errorText = "Choose a supported planting method.";
        element.invalid = true;

        await waitFor(() => {
            expect(shadow.activeElement).toBe(trigger);
            expect(trigger.getAttribute("aria-invalid")).toBe("true");
            const messageId = trigger.getAttribute("aria-errormessage");
            expect(messageId).toBeTruthy();
            expect(shadow.getElementById(messageId ?? "")?.textContent).toContain(
                "Choose a supported planting method."
            );
            expect(element.getAttribute("aria-errormessage")).toBeNull();
        });

        element.invalid = false;

        await waitFor(() => {
            expect(trigger.hasAttribute("aria-invalid")).toBe(false);
            expect(trigger.hasAttribute("aria-errormessage")).toBe(false);
            expect(shadow.querySelector('[part="error-text"]')).toBeNull();
        });
    },
};
