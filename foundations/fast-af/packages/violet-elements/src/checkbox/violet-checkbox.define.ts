import { defineVioletElement } from "../shared/define-element";
import { VioletCheckbox, violetCheckboxDefinition } from "./violet-checkbox";

/**
 * Defines `<violet-checkbox>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletCheckbox(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletCheckbox, violetCheckboxDefinition, registry);
}

await defineVioletCheckbox();
