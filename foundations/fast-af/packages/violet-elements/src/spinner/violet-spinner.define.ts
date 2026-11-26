import { defineVioletElement } from "../shared/define-element";
import { VioletSpinner, violetSpinnerDefinition } from "./violet-spinner";

/**
 * Defines `<violet-spinner>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletSpinner(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletSpinner, violetSpinnerDefinition, registry);
}

await defineVioletSpinner();
