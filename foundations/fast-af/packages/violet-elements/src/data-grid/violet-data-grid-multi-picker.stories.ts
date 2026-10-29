import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "./violet-data-grid-multi-picker";
import type { VioletDataGridEditorOption } from "./violet-data-grid";
import type { VioletDataGridMultiPicker } from "./violet-data-grid-multi-picker";

type MultiPickerStoryArgs = {
  disabled: boolean;
  controlLabel: string;
  placeholder: string;
  selectedValues: string[];
  options: VioletDataGridEditorOption[];
};

const tagOptions: VioletDataGridEditorOption[] = [
  {
    value: "Priority Crop",
    label: "Priority Crop",
    tone: "gold",
    keywords: ["important", "primary"],
  },
  { value: "Field Trial", label: "Field Trial", tone: "blue", keywords: ["experiment", "test"] },
  {
    value: "Needs Support",
    label: "Needs Support",
    tone: "teal",
    keywords: ["trellis", "support"],
  },
  { value: "Direct Seed", label: "Direct Seed", tone: "olive", keywords: ["seed", "sowing"] },
];

function shadowElement<T extends HTMLElement>(element: HTMLElement, selector: string): T {
  const target = element.shadowRoot?.querySelector<T>(selector);
  if (!target) {
    throw new Error(`Expected ${selector} in ${element.localName} shadow root.`);
  }
  return target;
}

function renderMultiPicker(args: MultiPickerStoryArgs): HTMLElement {
  const element = document.createElement(
    "violet-data-grid-multi-picker",
  ) as VioletDataGridMultiPicker;
  element.placeholder = args.placeholder;
  element.disabled = args.disabled ?? false;
  element.selectedValues = args.selectedValues;
  element.options = args.options;
  element.setAttribute("aria-label", args.controlLabel);

  return element;
}

const meta = {
  title: "Components/Data Grid/Multi Picker",
  tags: ["autodocs"],
  args: { disabled: false },
  parameters: {
    docs: {
      description: {
        component:
          "Compact grid-native multi-select editor that keeps pending selection changes live while the panel is open and commits them when the interaction closes.",
      },
    },
  },
  render: (args: MultiPickerStoryArgs) => renderMultiPicker(args),
} satisfies Meta<MultiPickerStoryArgs>;

export default meta;

type Story = StoryObj<MultiPickerStoryArgs>;

export const Overview: Story = {
  args: {
    controlLabel: "Cultivation tags",
    placeholder: "Add tags",
    selectedValues: ["Priority Crop"],
    options: tagOptions,
  },
  play: async ({ canvasElement }) => {
    const element = canvasElement.querySelector(
      "violet-data-grid-multi-picker",
    ) as VioletDataGridMultiPicker | null;

    if (!element) {
      throw new Error("Expected violet-data-grid-multi-picker to render.");
    }

    const trigger = shadowElement<HTMLButtonElement>(element, ".trigger");
    await userEvent.click(trigger);

    await waitFor(() => {
      expect(element.open).toBe(true);
      expect(element.shadowRoot?.querySelector(".panel")?.matches(":popover-open")).toBe(true);
      expect(element.shadowRoot?.activeElement).toBe(element.shadowRoot?.querySelector(".search"));
    });

    const search = shadowElement<HTMLInputElement>(element, ".search");
    await userEvent.type(search, "support");
    await waitFor(() =>
      expect(element.filteredOptions.map((option) => option.value)).toEqual(["Needs Support"]),
    );
    const listbox = shadowElement<HTMLElement>(element, "violet-listbox");
    const option = listbox.querySelector<HTMLElement>("violet-option");
    if (!option) {
      throw new Error("Expected a filtered option.");
    }
    await userEvent.click(shadowElement<HTMLElement>(option, ".control"));

    await waitFor(() => {
      expect(element.selectedValues).toEqual(["Priority Crop", "Needs Support"]);
      expect(element.filterQuery).toBe("support");
      expect(element.open).toBe(true);
    });

    await userEvent.keyboard("{Escape}");

    await waitFor(() => {
      expect(element.open).toBe(false);
      expect(element.value).toBe('["Priority Crop","Needs Support"]');
      expect(element.shadowRoot?.activeElement).toBe(trigger);
    });
  },
};

export const EmptyState: Story = {
  args: {
    controlLabel: "Cultivation tags",
    placeholder: "Add tags",
    selectedValues: [],
    options: tagOptions,
  },
};

export const Overflow: Story = {
  args: {
    controlLabel: "Cultivation tags",
    placeholder: "Add tags",
    selectedValues: ["Priority Crop", "Field Trial", "Needs Support", "Direct Seed"],
    options: tagOptions,
  },
};

export const Disabled: Story = {
  args: { ...Overview.args, disabled: true },
  play: async ({ canvasElement }) => {
    const element = canvasElement.querySelector(
      "violet-data-grid-multi-picker",
    ) as VioletDataGridMultiPicker;
    const trigger = shadowElement<HTMLButtonElement>(element, ".trigger");
    expect(trigger.disabled).toBe(true);
    await userEvent.click(trigger);
    expect(element.open).toBe(false);
    expect(element.selectedValues).toEqual(["Priority Crop"]);
    expect(element.shadowRoot?.querySelector(".panel")).toBeNull();
  },
};
