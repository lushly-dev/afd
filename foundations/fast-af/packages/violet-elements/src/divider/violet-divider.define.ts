import { defineVioletElement } from "../shared/define-element";
import { VioletDivider, violetDividerDefinition } from "./violet-divider";

/**
 * Defines `<violet-divider>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletDivider(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletDivider, violetDividerDefinition, registry);
}

await defineVioletDivider();
