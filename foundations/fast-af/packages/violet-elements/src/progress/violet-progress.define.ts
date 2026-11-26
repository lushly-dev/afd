import { defineVioletElement } from "../shared/define-element";
import { VioletProgress, violetProgressDefinition } from "./violet-progress";

/**
 * Defines `<violet-progress>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletProgress(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletProgress, violetProgressDefinition, registry);
}

await defineVioletProgress();
