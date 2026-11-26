import { defineVioletElement } from "../shared/define-element";
import { VioletOptionGroup, violetOptionGroupDefinition } from "./violet-option-group";

/**
 * Defines `<violet-option-group>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletOptionGroup(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletOptionGroup, violetOptionGroupDefinition, registry);
}

await defineVioletOptionGroup();
