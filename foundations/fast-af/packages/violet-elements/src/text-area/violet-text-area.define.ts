import { defineVioletElement } from "../shared/define-element";
import { VioletTextArea, violetTextAreaDefinition } from "./violet-text-area";

/**
 * Defines `<violet-text-area>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletTextArea(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletTextArea, violetTextAreaDefinition, registry);
}

await defineVioletTextArea();
