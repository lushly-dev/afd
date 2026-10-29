import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "./violet-data-grid-reference-picker";
import type { VioletDataGridEditorOption } from "./violet-data-grid";
import type { VioletDataGridReferencePicker } from "./violet-data-grid-reference-picker";

type ReferencePickerStoryArgs = {
  disabled: boolean;
  controlLabel: string;
  placeholder: string;
  selectedValues: string[];
  multiple: boolean;
  allowCreate: boolean;
  options: VioletDataGridEditorOption[];
};

const recordOptions: VioletDataGridEditorOption[] = [
  {
    value: "record-gh-04",
    label: "Greenhouse block 4",
    description: "Propagation house · 18 trays",
    tone: "blue",
    keywords: ["greenhouse", "propagation", "trays"],
  },
  {
    value: "record-cedar-5",
    label: "Cedar bed 5",
    description: "Field beds · North fence",
    tone: "olive",
    keywords: ["field", "north", "cedar"],
  },
  {
    value: "record-packhouse",
    label: "Packhouse queue",
    description: "Operations board · Friday handoff",
    tone: "gold",
    keywords: ["operations", "handoff", "packing"],
  },
  {
    value: "record-retail",
    label: "Retail hold list",
    description: "Merchandising · Weekend launch",
    tone: "teal",
    keywords: ["retail", "launch", "weekend"],
  },
];

function shadowElement<T extends HTMLElement>(element: HTMLElement, selector: string): T {
  const target = element.shadowRoot?.querySelector<T>(selector);
  if (!target) {
    throw new Error(`Expected ${selector} in ${element.localName} shadow root.`);
  }
  return target;
}

function renderReferencePicker(args: ReferencePickerStoryArgs): HTMLElement {
  const element = document.createElement(
    "violet-data-grid-reference-picker",
  ) as VioletDataGridReferencePicker;
  element.placeholder = args.placeholder;
  element.disabled = args.disabled ?? false;
  element.selectedValues = args.selectedValues;
  element.multiple = args.multiple;
  element.allowCreate = args.allowCreate;
  element.options = args.options;
  element.setAttribute("aria-label", args.controlLabel);

  return element;
}

const meta = {
  title: "Components/Data Grid/Reference Picker",
  tags: ["autodocs"],
  args: { disabled: false },
  parameters: {
    docs: {
      description: {
        component:
          "Compact linked-record editor for dense grid cells. It supports one-or-many selected references, secondary metadata in search results, and optional create hooks for host-owned record creation.",
      },
    },
  },
  render: (args: ReferencePickerStoryArgs) => renderReferencePicker(args),
} satisfies Meta<ReferencePickerStoryArgs>;

export default meta;

type Story = StoryObj<ReferencePickerStoryArgs>;

export const Overview: Story = {
  args: {
    controlLabel: "Linked records",
    placeholder: "Link records",
    selectedValues: ["record-gh-04"],
    multiple: true,
    allowCreate: false,
    options: recordOptions,
  },
  play: async ({ canvasElement }) => {
    const element = canvasElement.querySelector(
      "violet-data-grid-reference-picker",
    ) as VioletDataGridReferencePicker | null;

    if (!element) {
      throw new Error("Expected violet-data-grid-reference-picker to render.");
    }

    const trigger = shadowElement<HTMLButtonElement>(element, ".trigger");
    await userEvent.click(trigger);

    await waitFor(() => {
      expect(element.open).toBe(true);
      expect(element.shadowRoot?.querySelector(".panel")?.matches(":popover-open")).toBe(true);
      expect(element.shadowRoot?.activeElement).toBe(element.shadowRoot?.querySelector(".search"));
    });

    const search = shadowElement<HTMLInputElement>(element, ".search");
    await userEvent.type(search, "north");

    await waitFor(() => {
      expect(element.filteredOptions.map((option) => option.value)).toEqual(["record-cedar-5"]);
    });

    const listbox = shadowElement<HTMLElement>(element, "violet-listbox");
    const option = listbox.querySelector<HTMLElement>("violet-option");
    if (!option) {
      throw new Error("Expected a filtered option.");
    }
    await userEvent.click(shadowElement<HTMLElement>(option, ".control"));

    await waitFor(() => {
      expect(element.selectedValues).toEqual(["record-gh-04", "record-cedar-5"]);
      expect(element.filterQuery).toBe("north");
      expect(element.open).toBe(true);
    });

    await userEvent.keyboard("{Escape}");

    await waitFor(() => {
      expect(element.open).toBe(false);
      expect(element.value).toBe('["record-gh-04","record-cedar-5"]');
      expect(element.shadowRoot?.activeElement).toBe(trigger);
    });
  },
};

export const SingleReference: Story = {
  args: {
    controlLabel: "Primary linked record",
    placeholder: "Link one record",
    selectedValues: ["record-gh-04"],
    multiple: false,
    allowCreate: false,
    options: recordOptions,
  },
};

export const CreateRequest: Story = {
  args: {
    controlLabel: "Linked records",
    placeholder: "Link records",
    selectedValues: [],
    multiple: true,
    allowCreate: true,
    options: recordOptions,
  },
  play: async ({ canvasElement }) => {
    const element = canvasElement.querySelector(
      "violet-data-grid-reference-picker",
    ) as VioletDataGridReferencePicker | null;

    if (!element) {
      throw new Error("Expected creatable reference picker to render.");
    }

    const createSpy = { count: 0, query: "" };
    element.addEventListener("create-request", (event: Event) => {
      createSpy.count += 1;
      createSpy.query = (event as CustomEvent<{ query: string }>).detail.query;
    });

    const trigger = shadowElement<HTMLButtonElement>(element, ".trigger");
    await userEvent.click(trigger);

    await waitFor(() => {
      expect(element.open).toBe(true);
      expect(element.shadowRoot?.activeElement).toBe(element.shadowRoot?.querySelector(".search"));
    });

    await waitFor(() => {
      expect(Boolean(element.shadowRoot?.querySelector(".search"))).toBe(true);
    });

    const search = element.shadowRoot?.querySelector(".search") as HTMLInputElement | null;
    if (!search) {
      throw new Error("Expected reference picker search field to render.");
    }

    await userEvent.type(search, "New field packet");

    await waitFor(() => {
      expect(element.hasCreateAction).toBe(true);
    });

    await userEvent.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => {
      expect(createSpy.count).toBe(1);
      expect(createSpy.query).toBe("New field packet");
    });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(element.open).toBe(false));
  },
};

export const Disabled: Story = {
  args: { ...Overview.args, disabled: true },
  play: async ({ canvasElement }) => {
    const element = canvasElement.querySelector(
      "violet-data-grid-reference-picker",
    ) as VioletDataGridReferencePicker;
    const trigger = shadowElement<HTMLButtonElement>(element, ".trigger");
    expect(trigger.disabled).toBe(true);
    await userEvent.click(trigger);
    expect(element.open).toBe(false);
    expect(element.selectedValues).toEqual(["record-gh-04"]);
    expect(element.shadowRoot?.querySelector(".panel")).toBeNull();
  },
};
