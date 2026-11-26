import { defineVioletElement } from "../shared/define-element";
import { VioletRangeSlider, violetRangeSliderDefinition } from "./violet-range-slider";

/**
 * Defines `<violet-range-slider>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletRangeSlider(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletRangeSlider, violetRangeSliderDefinition, registry);
}

await defineVioletRangeSlider();
