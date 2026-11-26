import { defineVioletIcon } from "../icon/violet-icon.define";
import { defineVioletElement } from "../shared/define-element";
import { VioletReasoningBlock, violetReasoningBlockDefinition } from "./violet-reasoning-block";

/**
 * Defines `<violet-reasoning-block>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletReasoningBlock(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletIcon(registry);
  await defineVioletElement(VioletReasoningBlock, violetReasoningBlockDefinition, registry);
}

await defineVioletReasoningBlock();
