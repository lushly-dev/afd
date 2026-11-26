import { defineVioletOption } from "../option/violet-option.define";
import { defineVioletElement } from "../shared/define-element";
import { VioletSelect, violetSelectDefinition, violetSelectExtensions } from "./violet-select";

/**
 * Defines `<violet-select>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletSelect(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletOption(registry);
  await defineVioletElement(VioletSelect, violetSelectDefinition, registry, violetSelectExtensions);
}

await defineVioletSelect();
