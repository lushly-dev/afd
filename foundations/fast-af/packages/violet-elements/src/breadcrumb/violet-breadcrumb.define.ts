import { defineVioletBreadcrumbItem } from "../breadcrumb-item/violet-breadcrumb-item.define";
import { defineVioletElement } from "../shared/define-element";
import { VioletBreadcrumb, violetBreadcrumbDefinition } from "./violet-breadcrumb";

/**
 * Defines `<violet-breadcrumb>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletBreadcrumb(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletBreadcrumbItem(registry);
  await defineVioletElement(VioletBreadcrumb, violetBreadcrumbDefinition, registry);
}

await defineVioletBreadcrumb();
