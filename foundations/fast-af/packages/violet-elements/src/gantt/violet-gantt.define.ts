import { defineVioletElement } from "../shared/define-element";
import { VioletGantt, violetGanttDefinition } from "./violet-gantt";

/**
 * Defines `<violet-gantt>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletGantt(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletGantt, violetGanttDefinition, registry);
}

await defineVioletGantt();
