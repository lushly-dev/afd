import { claim } from "@lushly-dev/specimen/evidence";
import { expect, userEvent, waitFor, within } from "@lushly-dev/specimen/test";
import type { Meta, StoryObj } from "@lushly-dev/specimen/types";

import "./violet-switch.define";
import type { VioletSwitch } from "./violet-switch";

type VioletSwitchStoryArgs = {
  checked: boolean;
  disabled: boolean;
  inline: boolean;
  invalid: boolean;
  errorText: string;
  ariaLabel: string;
  label: string;
  supporting: string;
  name: string;
  value: string;
  required: boolean;
};

function renderSwitch(args: VioletSwitchStoryArgs): HTMLElement {
  const element = document.createElement("violet-switch") as VioletSwitch;
  element.checked = args.checked;
  element.disabled = args.disabled;
  element.inline = args.inline;
  element.invalid = args.invalid;
  element.errorText = args.errorText;
  element.name = args.name;
  element.value = args.value;
  element.required = args.required;

  if (args.ariaLabel) {
    element.setAttribute("aria-label", args.ariaLabel);
  }

  if (args.label) {
    element.textContent = args.label;
  }

  if (args.supporting) {
    const supporting = document.createElement("span");
    supporting.slot = "supporting";
    supporting.textContent = args.supporting;
    element.append(supporting);
  }

  return element;
}

const meta = {
  title: "Components/Switch",
  component: "violet-switch",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Reusable Violet switch primitive with binary on/off semantics, inline mode, and optional supporting text.",
      },
    },
  },
  argTypes: {
    checked: { control: "boolean" },
    disabled: { control: "boolean" },
    inline: { control: "boolean" },
    invalid: { control: "boolean" },
    required: { control: "boolean" },
  },
  render: (args: VioletSwitchStoryArgs) => renderSwitch(args),
} satisfies Meta<VioletSwitchStoryArgs>;

export default meta;

type Story = StoryObj<VioletSwitchStoryArgs>;

export const Overview: Story = {
  args: {
    checked: false,
    disabled: false,
    inline: false,
    invalid: false,
    errorText: "",
    ariaLabel: "",
    label: "Enable irrigation alerts",
    supporting: "Turns on weather-driven watering notifications for this bed.",
    name: "irrigationAlerts",
    value: "enabled",
    required: true,
  },
  play: async ({ canvasElement }) => {
    const element = canvasElement.querySelector("violet-switch") as VioletSwitch | null;
    const root = element?.shadowRoot;

    if (!element || !root) {
      throw new Error("Expected violet-switch to render.");
    }

    // The switch is found and clicked by role, as a person or an agent would: the
    // decorative track passes pointer events through to this input.
    const input = within(root as unknown as HTMLElement).getByRole("switch") as HTMLInputElement;

    await expect(input.getAttribute("role")).toBe("switch");
    await expect(input.checked).toBe(false);
    await expect(element.checkValidity()).toBe(false);
    const invalidWhileOff = !element.checkValidity();

    await userEvent.click(input);

    await waitFor(() => {
      expect(element.checked).toBe(true);
      expect(element.checkValidity()).toBe(true);
    });
    await claim(element, "guide:switch.required", "invalid-off-valid-on", () =>
      expect([invalidWhileOff, element.checked, element.checkValidity()]).toEqual([
        true,
        true,
        true,
      ]),
    );

    const { parentNode, nextSibling } = element;
    const form = document.createElement("form");
    form.append(element);
    await waitFor(() => {
      const formData = new FormData(form);
      expect(formData.get("irrigationAlerts")).toBe("enabled");
    });
    // Back where it was, so the capture after the play shows it and its claim.
    parentNode?.insertBefore(element, nextSibling);
  },
};

export const Checked: Story = {
  args: {
    checked: true,
    disabled: false,
    inline: false,
    invalid: false,
    errorText: "",
    ariaLabel: "",
    label: "Auto-approve tray restocks",
    supporting: "Keeps replenishment requests moving without manual review.",
    name: "trayRestocks",
    value: "enabled",
    required: false,
  },
};

export const Disabled: Story = {
  args: {
    checked: false,
    disabled: true,
    inline: false,
    invalid: false,
    errorText: "",
    ariaLabel: "",
    label: "Enable harvest sync",
    supporting: "Unavailable while the field audit is in progress.",
    name: "harvestSync",
    value: "enabled",
    required: false,
  },
};

export const Invalid: Story = {
  args: {
    checked: false,
    disabled: false,
    inline: false,
    invalid: true,
    errorText: "Turn this setting on before continuing.",
    ariaLabel: "",
    label: "Share bed availability",
    supporting: "Shares bed availability with the harvest schedule.",
    name: "shareBedAvailability",
    value: "enabled",
    required: false,
  },
};

export const Inline: Story = {
  args: {
    checked: true,
    disabled: false,
    inline: true,
    invalid: false,
    errorText: "",
    ariaLabel: "Compact irrigation alerts switch",
    label: "",
    supporting: "",
    name: "compactIrrigationAlerts",
    value: "enabled",
    required: false,
  },
  play: async ({ canvasElement }) => {
    const element = canvasElement.querySelector("violet-switch") as VioletSwitch | null;
    const input = element?.shadowRoot?.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;

    if (!element || !input) {
      throw new Error("Expected inline violet-switch to render.");
    }

    await expect(element.shadowRoot?.querySelector(".content")?.hasAttribute("hidden")).toBe(true);
    await expect(input.getAttribute("aria-label")).toBe("Compact irrigation alerts switch");
  },
};
