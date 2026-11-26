import { defineVioletElement } from "../shared/define-element";
import { VioletSkeleton, violetSkeletonDefinition } from "./violet-skeleton";

/**
 * Defines `<violet-skeleton>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletSkeleton(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletSkeleton, violetSkeletonDefinition, registry);
}

await defineVioletSkeleton();
