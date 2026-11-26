import { defineVioletElement } from "../shared/define-element";
import { VioletMessage, violetMessageDefinition } from "./violet-message";

/**
 * Defines `<violet-message>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletMessage(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletMessage, violetMessageDefinition, registry);
}

await defineVioletMessage();
