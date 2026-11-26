import { defineVioletElement } from "../shared/define-element";
import { VioletImage, violetImageDefinition } from "./violet-image";

/**
 * Defines `<violet-image>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletImage(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletImage, violetImageDefinition, registry);
}

await defineVioletImage();
