import { defineVioletElement } from "../shared/define-element";
import { VioletMessageText, violetMessageTextDefinition } from "./violet-message-text";

/**
 * Defines `<violet-message-text>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletMessageText(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletMessageText, violetMessageTextDefinition, registry);
}

await defineVioletMessageText();
