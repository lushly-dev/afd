import { defineVioletElement } from "../shared/define-element";
import { VioletDataGridRating, violetDataGridRatingDefinition } from "./violet-data-grid-rating";

/**
 * Defines `<violet-data-grid-rating>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletDataGridRating(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletDataGridRating, violetDataGridRatingDefinition, registry);
}

await defineVioletDataGridRating();
