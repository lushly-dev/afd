import { defineVioletAccordionItem } from "../accordion-item/violet-accordion-item.define";
import { defineVioletElement } from "../shared/define-element";
import { VioletAccordion, violetAccordionDefinition } from "./violet-accordion";

/**
 * Defines `<violet-accordion>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletAccordion(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletAccordionItem(registry);
  await defineVioletElement(VioletAccordion, violetAccordionDefinition, registry);
}

await defineVioletAccordion();
