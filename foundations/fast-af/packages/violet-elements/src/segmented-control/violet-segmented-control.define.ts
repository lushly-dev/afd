import { defineVioletSegment } from "../segment/violet-segment.define";
import { defineVioletElement } from "../shared/define-element";
import {
  VioletSegmentedControl,
  violetSegmentedControlDefinition,
} from "./violet-segmented-control";

/**
 * Defines `<violet-segmented-control>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletSegmentedControl(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletSegment(registry);
  await defineVioletElement(VioletSegmentedControl, violetSegmentedControlDefinition, registry);
}

await defineVioletSegmentedControl();
