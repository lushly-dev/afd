import { defineVioletElement } from "../shared/define-element";
import { VioletOption, violetOptionDefinition, violetOptionExtensions } from "./violet-option";

/**
 * Defines `<violet-option>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletOption(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletOption, violetOptionDefinition, registry, violetOptionExtensions);
}

await defineVioletOption();
