import { registerSystemClockIcon } from "../icon/generated/icons/system-clock";
import { defineVioletIcon } from "../icon/violet-icon.define";
import { defineVioletElement } from "../shared/define-element";
import { VioletTimePicker, violetTimePickerDefinition } from "./violet-time-picker";

/**
 * Defines `<violet-time-picker>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletTimePicker(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletIcon(registry);
  registerSystemClockIcon();
  await defineVioletElement(VioletTimePicker, violetTimePickerDefinition, registry);
}

await defineVioletTimePicker();
