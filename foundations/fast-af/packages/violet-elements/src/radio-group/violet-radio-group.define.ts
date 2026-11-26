import { defineVioletRadio } from "../radio/violet-radio.define";
import { defineVioletElement } from "../shared/define-element";
import { VioletRadioGroup, violetRadioGroupDefinition } from "./violet-radio-group";

/**
 * Defines `<violet-radio-group>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletRadioGroup(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletRadio(registry);
  await defineVioletElement(VioletRadioGroup, violetRadioGroupDefinition, registry);
}

await defineVioletRadioGroup();
