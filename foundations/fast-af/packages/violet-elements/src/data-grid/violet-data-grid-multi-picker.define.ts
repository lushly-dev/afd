import { defineVioletListbox } from "../listbox/violet-listbox.define";
import { defineVioletOption } from "../option/violet-option.define";
import { defineVioletElement } from "../shared/define-element";
import {
  VioletDataGridMultiPicker,
  violetDataGridMultiPickerDefinition,
} from "./violet-data-grid-multi-picker";

/**
 * Defines `<violet-data-grid-multi-picker>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletDataGridMultiPicker(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletListbox(registry);
  await defineVioletOption(registry);
  await defineVioletElement(
    VioletDataGridMultiPicker,
    violetDataGridMultiPickerDefinition,
    registry,
  );
}

await defineVioletDataGridMultiPicker();
