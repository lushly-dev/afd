import { defineVioletElement } from "../shared/define-element";
import { VioletCalendar, violetCalendarDefinition } from "./violet-calendar";

/**
 * Defines `<violet-calendar>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletCalendar(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletCalendar, violetCalendarDefinition, registry);
}

await defineVioletCalendar();
