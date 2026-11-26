import { defineVioletElement } from "../shared/define-element";
import { VioletText, violetTextDefinition } from "./violet-text";

/**
 * Defines `<violet-text>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletText(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletText, violetTextDefinition, registry);
}

await defineVioletText();
