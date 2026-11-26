import { defineVioletElement } from "../shared/define-element";
import { VioletColorSwatch, violetColorSwatchDefinition } from "./violet-color-swatch";

/**
 * Defines `<violet-color-swatch>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletColorSwatch(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletColorSwatch, violetColorSwatchDefinition, registry);
}

await defineVioletColorSwatch();
