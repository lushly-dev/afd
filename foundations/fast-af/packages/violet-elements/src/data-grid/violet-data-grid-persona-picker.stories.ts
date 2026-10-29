import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, waitFor } from "storybook/test";

import "./violet-data-grid-persona-picker";
import type { VioletDataGridEditorOption } from "./violet-data-grid";
import type { VioletDataGridPersonaPicker } from "./violet-data-grid-persona-picker";

type PersonaPickerStoryArgs = {
  controlLabel: string;
  placeholder: string;
  selectedValues: string[];
  multiple: boolean;
  options: VioletDataGridEditorOption[];
  disabled?: boolean;
};

const assigneeOptions: VioletDataGridEditorOption[] = [
  {
    value: "user-lydia-bauer",
    label: "Lydia Bauer",
    description: "Propagation lead",
    initials: "LB",
  },
  {
    value: "user-morgan-snow",
    label: "Morgan Snow",
    description: "Operations handoff",
    initials: "MS",
  },
  {
    value: "user-katri-athokas",
    label: "Katri Athokas",
    description: "Field planning",
    initials: "KA",
  },
  {
    value: "user-omar-diaz",
    label: "Omar Diaz",
    description: "Retail launch",
    initials: "OD",
  },
];

function renderPersonaPicker(args: PersonaPickerStoryArgs): HTMLElement {
  const element = document.createElement(
    "violet-data-grid-persona-picker",
  ) as VioletDataGridPersonaPicker;
  element.placeholder = args.placeholder;
  element.selectedValues = args.selectedValues;
  element.multiple = args.multiple;
  element.options = args.options;
  element.disabled = args.disabled ?? false;
  element.setAttribute("aria-label", args.controlLabel);

  return element;
}

const meta = {
  title: "Components/Data Grid/Persona Picker",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Compact grid-native assignee picker that composes `violet-persona` for dense avatar stacks in-cell and searchable assignment rows in the picker panel.",
      },
    },
  },
  render: (args: PersonaPickerStoryArgs) => renderPersonaPicker(args),
} satisfies Meta<PersonaPickerStoryArgs>;

export default meta;

type Story = StoryObj<PersonaPickerStoryArgs>;

export const Overview: Story = {
  args: {
    controlLabel: "Assignees",
    placeholder: "Assign people",
    selectedValues: ["user-lydia-bauer"],
    multiple: true,
    options: assigneeOptions,
  },
  play: async ({ canvasElement }) => {
    const element = canvasElement.querySelector(
      "violet-data-grid-persona-picker",
    ) as VioletDataGridPersonaPicker | null;

    if (!element) {
      throw new Error("Expected violet-data-grid-persona-picker to render.");
    }

    element.handleTriggerClick();

    await waitFor(() => {
      expect(element.open).toBe(true);
    });

    await waitFor(() => expect(element.shadowRoot?.querySelector(".search")).not.toBeNull());
    const search = element.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
    search.value = "operations";
    search.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

    await waitFor(() => {
      expect(element.filteredOptions.map((option) => option.value)).toEqual(["user-morgan-snow"]);
    });

    element.toggleOption("user-morgan-snow");

    await waitFor(() => {
      expect(element.selectedValues).toEqual(["user-lydia-bauer", "user-morgan-snow"]);
    });

    element.handleTriggerClick();

    await waitFor(() => {
      expect(element.open).toBe(false);
      expect(element.value).toBe('["user-lydia-bauer","user-morgan-snow"]');
    });
  },
};

export const SingleAssignee: Story = {
  args: {
    controlLabel: "Primary assignee",
    placeholder: "Assign one person",
    selectedValues: ["user-lydia-bauer"],
    multiple: false,
    options: assigneeOptions,
  },
};

export const Overflow: Story = {
  args: {
    controlLabel: "Assignees",
    placeholder: "Assign people",
    selectedValues: [
      "user-lydia-bauer",
      "user-morgan-snow",
      "user-katri-athokas",
      "user-omar-diaz",
    ],
    multiple: true,
    options: assigneeOptions,
  },
};

export const Disabled: Story = {
  args: { ...Overview.args, disabled: true },
  play: async ({ canvasElement }) => {
    const element = canvasElement.querySelector(
      "violet-data-grid-persona-picker",
    ) as VioletDataGridPersonaPicker;
    expect(element.shadowRoot?.querySelector<HTMLButtonElement>(".trigger")?.disabled).toBe(true);
    element.handleTriggerClick();
    expect(element.open).toBe(false);
  },
};
