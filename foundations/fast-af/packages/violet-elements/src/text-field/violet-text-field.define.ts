import { defineVioletElement } from "../shared/define-element";
import { VioletTextField, violetTextFieldDefinition } from "./violet-text-field";

/**
 * Defines `<violet-text-field>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletTextField(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletTextField, violetTextFieldDefinition, registry);
}

await defineVioletTextField();
