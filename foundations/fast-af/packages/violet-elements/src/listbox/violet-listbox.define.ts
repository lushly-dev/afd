import { defineVioletOption } from "../option/violet-option.define";
import { defineVioletOptionGroup } from "../option-group/violet-option-group.define";
import { defineVioletElement } from "../shared/define-element";
import { VioletListbox, violetListboxDefinition, violetListboxExtensions } from "./violet-listbox";

/**
 * Defines `<violet-listbox>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletListbox(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletOptionGroup(registry);
  await defineVioletOption(registry);
  await defineVioletElement(
    VioletListbox,
    violetListboxDefinition,
    registry,
    violetListboxExtensions,
  );
}

await defineVioletListbox();
