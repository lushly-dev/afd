import { defineVioletCheckbox } from "../checkbox/violet-checkbox.define";
import { registerSystemSortAscendingIcon } from "../icon/generated/icons/system-sort-ascending";
import { registerSystemSortDescendingIcon } from "../icon/generated/icons/system-sort-descending";
import { defineVioletIcon } from "../icon/violet-icon.define";
import { defineVioletRadio } from "../radio/violet-radio.define";
import { defineVioletElement } from "../shared/define-element";
import { defineVioletTextField } from "../text-field/violet-text-field.define";
import { VioletDataGrid, violetDataGridDefinition } from "./violet-data-grid";

/**
 * Defines `<violet-data-grid>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletDataGrid(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletCheckbox(registry);
  await defineVioletIcon(registry);
  await defineVioletRadio(registry);
  await defineVioletTextField(registry);
  registerSystemSortAscendingIcon();
  registerSystemSortDescendingIcon();
  await defineVioletElement(VioletDataGrid, violetDataGridDefinition, registry);
}

await defineVioletDataGrid();
