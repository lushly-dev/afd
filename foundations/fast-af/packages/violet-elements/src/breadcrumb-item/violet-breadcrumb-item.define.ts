import { defineVioletElement } from "../shared/define-element";
import { VioletBreadcrumbItem, violetBreadcrumbItemDefinition } from "./violet-breadcrumb-item";

/**
 * Defines `<violet-breadcrumb-item>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletBreadcrumbItem(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletBreadcrumbItem, violetBreadcrumbItemDefinition, registry);
}

await defineVioletBreadcrumbItem();
