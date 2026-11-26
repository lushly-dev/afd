import { defineVioletOption } from "../option/violet-option.define";
import { defineVioletElement } from "../shared/define-element";
import { VioletCombobox, violetComboboxDefinition } from "./violet-combobox";

/**
 * Defines `<violet-combobox>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletCombobox(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletOption(registry);
  await defineVioletElement(VioletCombobox, violetComboboxDefinition, registry);
}

await defineVioletCombobox();
