import { defineVioletElement } from "../shared/define-element";
import {
  VioletDataGridPillSelect,
  violetDataGridPillSelectDefinition,
} from "./violet-data-grid-pill-select";

/**
 * Defines `<violet-data-grid-pill-select>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletDataGridPillSelect(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletDataGridPillSelect, violetDataGridPillSelectDefinition, registry);
}

await defineVioletDataGridPillSelect();
