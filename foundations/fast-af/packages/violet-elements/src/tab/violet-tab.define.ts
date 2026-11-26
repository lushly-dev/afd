import { defineVioletElement } from "../shared/define-element";
import { VioletTab, violetTabDefinition } from "./violet-tab";

/**
 * Defines `<violet-tab>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletTab(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletTab, violetTabDefinition, registry);
}

await defineVioletTab();
