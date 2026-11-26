import { defineVioletElement } from "../shared/define-element";
import { VioletSegment, violetSegmentDefinition } from "./violet-segment";

/**
 * Defines `<violet-segment>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletSegment(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletSegment, violetSegmentDefinition, registry);
}

await defineVioletSegment();
