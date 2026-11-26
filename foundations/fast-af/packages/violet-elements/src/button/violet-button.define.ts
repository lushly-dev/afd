import { defineVioletElement } from "../shared/define-element";
import { VioletButton, violetButtonDefinition } from "./violet-button";

/**
 * Defines `<violet-button>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletButton(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletButton, violetButtonDefinition, registry);
}

await defineVioletButton();
