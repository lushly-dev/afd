import { defineVioletElement } from "../shared/define-element";
import { defineVioletText } from "../text/violet-text.define";
import { VioletEmptyState, violetEmptyStateDefinition } from "./violet-empty-state";

/**
 * Defines `<violet-empty-state>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletEmptyState(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletText(registry);
  await defineVioletElement(VioletEmptyState, violetEmptyStateDefinition, registry);
}

await defineVioletEmptyState();
