import { defineVioletCard } from "../card/violet-card.define";
import { defineVioletIcon } from "../icon/violet-icon.define";
import { defineVioletElement } from "../shared/define-element";
import { defineVioletApprovalCard } from "./violet-approval-card.define";
import { VioletToolCallCard, violetToolCallCardDefinition } from "./violet-tool-call-card";

/**
 * Defines `<violet-tool-call-card>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletToolCallCard(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletIcon(registry);
  await defineVioletCard(registry);
  await defineVioletApprovalCard(registry);
  await defineVioletElement(VioletToolCallCard, violetToolCallCardDefinition, registry);
}

await defineVioletToolCallCard();
