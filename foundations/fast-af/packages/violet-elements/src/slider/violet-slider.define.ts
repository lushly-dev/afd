import { defineVioletElement } from "../shared/define-element";
import { VioletSlider, violetSliderDefinition } from "./violet-slider";

/**
 * Defines `<violet-slider>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletSlider(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletSlider, violetSliderDefinition, registry);
}

await defineVioletSlider();
