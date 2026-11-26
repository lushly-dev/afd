import { defineVioletElement } from "../shared/define-element";
import { VioletPagination, violetPaginationDefinition } from "./violet-pagination";

/**
 * Defines `<violet-pagination>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletPagination(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletPagination, violetPaginationDefinition, registry);
}

await defineVioletPagination();
