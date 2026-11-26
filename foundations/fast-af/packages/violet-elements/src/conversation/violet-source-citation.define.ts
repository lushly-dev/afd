import { defineVioletIcon } from "../icon/violet-icon.define";
import { defineVioletElement } from "../shared/define-element";
import { VioletSourceCitation, violetSourceCitationDefinition } from "./violet-source-citation";

/**
 * Defines `<violet-source-citation>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletSourceCitation(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletIcon(registry);
  await defineVioletElement(VioletSourceCitation, violetSourceCitationDefinition, registry);
}

await defineVioletSourceCitation();
