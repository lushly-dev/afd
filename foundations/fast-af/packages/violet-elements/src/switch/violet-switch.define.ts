import { defineVioletElement } from "../shared/define-element";
import { VioletSwitch, violetSwitchDefinition } from "./violet-switch";

/**
 * Defines `<violet-switch>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletSwitch(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletSwitch, violetSwitchDefinition, registry);
}

await defineVioletSwitch();
