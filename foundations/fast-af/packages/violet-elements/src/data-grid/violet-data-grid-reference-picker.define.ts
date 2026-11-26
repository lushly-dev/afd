import { defineVioletListbox } from "../listbox/violet-listbox.define";
import { defineVioletOption } from "../option/violet-option.define";
import { defineVioletElement } from "../shared/define-element";
import {
  VioletDataGridReferencePicker,
  violetDataGridReferencePickerDefinition,
} from "./violet-data-grid-reference-picker";

/**
 * Defines `<violet-data-grid-reference-picker>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletDataGridReferencePicker(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletListbox(registry);
  await defineVioletOption(registry);
  await defineVioletElement(
    VioletDataGridReferencePicker,
    violetDataGridReferencePickerDefinition,
    registry,
  );
}

await defineVioletDataGridReferencePicker();
