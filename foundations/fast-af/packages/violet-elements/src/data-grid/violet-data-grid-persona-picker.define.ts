import { defineVioletListbox } from "../listbox/violet-listbox.define";
import { defineVioletOption } from "../option/violet-option.define";
import { defineVioletPersona } from "../persona/violet-persona.define";
import { defineVioletElement } from "../shared/define-element";
import {
  VioletDataGridPersonaPicker,
  violetDataGridPersonaPickerDefinition,
} from "./violet-data-grid-persona-picker";

/**
 * Defines `<violet-data-grid-persona-picker>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletDataGridPersonaPicker(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletListbox(registry);
  await defineVioletOption(registry);
  await defineVioletPersona(registry);
  await defineVioletElement(
    VioletDataGridPersonaPicker,
    violetDataGridPersonaPickerDefinition,
    registry,
  );
}

await defineVioletDataGridPersonaPicker();
