import { defineVioletElement } from "../shared/define-element";
import { VioletAccordionItem, violetAccordionItemDefinition } from "./violet-accordion-item";

/**
 * Defines `<violet-accordion-item>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletAccordionItem(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletAccordionItem, violetAccordionItemDefinition, registry);
}

await defineVioletAccordionItem();
