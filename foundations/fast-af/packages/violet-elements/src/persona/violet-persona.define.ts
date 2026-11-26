import { defineVioletElement } from "../shared/define-element";
import { VioletPersona, violetPersonaDefinition } from "./violet-persona";

/**
 * Defines `<violet-persona>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletPersona(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletPersona, violetPersonaDefinition, registry);
}

await defineVioletPersona();
