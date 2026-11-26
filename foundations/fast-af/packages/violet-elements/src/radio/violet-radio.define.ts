import { defineVioletElement } from "../shared/define-element";
import { VioletRadio, violetRadioDefinition } from "./violet-radio";

/**
 * Defines `<violet-radio>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletRadio(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletRadio, violetRadioDefinition, registry);
}

await defineVioletRadio();
