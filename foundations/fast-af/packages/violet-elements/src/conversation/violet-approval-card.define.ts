import { defineVioletButton } from "../button/violet-button.define";
import { defineVioletCard } from "../card/violet-card.define";
import { defineVioletIcon } from "../icon/violet-icon.define";
import { defineVioletElement } from "../shared/define-element";
import { VioletApprovalCard, violetApprovalCardDefinition } from "./violet-approval-card";

/**
 * Defines `<violet-approval-card>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletApprovalCard(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletIcon(registry);
  await defineVioletButton(registry);
  await defineVioletCard(registry);
  await defineVioletElement(VioletApprovalCard, violetApprovalCardDefinition, registry);
}

await defineVioletApprovalCard();
