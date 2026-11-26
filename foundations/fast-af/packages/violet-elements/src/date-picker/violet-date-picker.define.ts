import { defineVioletCalendar } from "../calendar/violet-calendar.define";
import { registerSystemCalendarIcon } from "../icon/generated/icons/system-calendar";
import { defineVioletIcon } from "../icon/violet-icon.define";
import { defineVioletElement } from "../shared/define-element";
import { VioletDatePicker, violetDatePickerDefinition } from "./violet-date-picker";

/**
 * Defines `<violet-date-picker>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletDatePicker(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletCalendar(registry);
  await defineVioletIcon(registry);
  registerSystemCalendarIcon();
  await defineVioletElement(VioletDatePicker, violetDatePickerDefinition, registry);
}

await defineVioletDatePicker();
