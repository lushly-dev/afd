import { defineVioletElement } from "../shared/define-element";
import { VioletMessageStatus, violetMessageStatusDefinition } from "./violet-message-status";

/**
 * Defines `<violet-message-status>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletMessageStatus(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletMessageStatus, violetMessageStatusDefinition, registry);
}

await defineVioletMessageStatus();
