import { defineVioletElement } from "../shared/define-element";
import { VioletMenuItem, violetMenuItemDefinition } from "./violet-menu-item";

/**
 * Defines `<violet-menu-item>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletMenuItem(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletMenuItem, violetMenuItemDefinition, registry);
}

await defineVioletMenuItem();
