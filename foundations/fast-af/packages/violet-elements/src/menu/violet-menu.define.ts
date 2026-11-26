import { defineVioletElement } from "../shared/define-element";
import { VioletMenu, violetMenuDefinition } from "./violet-menu";

/**
 * Defines `<violet-menu>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletMenu(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletMenu, violetMenuDefinition, registry);
}

await defineVioletMenu();
