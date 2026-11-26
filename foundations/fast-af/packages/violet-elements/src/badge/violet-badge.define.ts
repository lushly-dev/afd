import { defineVioletIcon } from "../icon/violet-icon.define";
import { defineVioletElement } from "../shared/define-element";
import { VioletBadge, violetBadgeDefinition } from "./violet-badge";

/**
 * Defines `<violet-badge>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletBadge(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletIcon(registry);
  await defineVioletElement(VioletBadge, violetBadgeDefinition, registry);
}

await defineVioletBadge();
