import { defineVioletCard } from "../card/violet-card.define";
import { defineVioletIcon } from "../icon/violet-icon.define";
import { defineVioletElement } from "../shared/define-element";
import { VioletToolResultCard, violetToolResultCardDefinition } from "./violet-tool-result-card";

/**
 * Defines `<violet-tool-result-card>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletToolResultCard(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletIcon(registry);
  await defineVioletCard(registry);
  await defineVioletElement(VioletToolResultCard, violetToolResultCardDefinition, registry);
}

await defineVioletToolResultCard();
