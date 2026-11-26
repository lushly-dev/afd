import { defineVioletElement } from "../shared/define-element";
import { VioletCard, violetCardDefinition } from "./violet-card";

/**
 * Defines `<violet-card>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletCard(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletCard, violetCardDefinition, registry);
}

await defineVioletCard();
