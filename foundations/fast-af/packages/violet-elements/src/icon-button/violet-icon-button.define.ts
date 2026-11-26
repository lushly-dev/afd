import { defineVioletElement } from "../shared/define-element";
import { VioletIconButton, violetIconButtonDefinition } from "./violet-icon-button";

/**
 * Defines `<violet-icon-button>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletIconButton(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletIconButton, violetIconButtonDefinition, registry);
}

await defineVioletIconButton();
