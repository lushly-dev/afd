import { defineVioletElement } from "../shared/define-element";
import { VioletPopover, violetPopoverDefinition } from "./violet-popover";

/**
 * Defines `<violet-popover>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletPopover(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletPopover, violetPopoverDefinition, registry);
}

await defineVioletPopover();
