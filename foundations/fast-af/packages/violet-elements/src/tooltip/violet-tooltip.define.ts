import { defineVioletElement } from "../shared/define-element";
import { VioletTooltip, violetTooltipDefinition } from "./violet-tooltip";

/**
 * Defines `<violet-tooltip>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletTooltip(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletTooltip, violetTooltipDefinition, registry);
}

await defineVioletTooltip();
