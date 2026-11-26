import { defineVioletColorSwatch } from "../color-swatch/violet-color-swatch.define";
import { registerSystemChevronRightIcon } from "../icon/generated/icons/system-chevron-right";
import { defineVioletIcon } from "../icon/violet-icon.define";
import { defineVioletElement } from "../shared/define-element";
import { VioletColorPicker, violetColorPickerDefinition } from "./violet-color-picker";

/**
 * Defines `<violet-color-picker>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletColorPicker(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletColorSwatch(registry);
  await defineVioletIcon(registry);
  registerSystemChevronRightIcon();
  await defineVioletElement(VioletColorPicker, violetColorPickerDefinition, registry);
}

await defineVioletColorPicker();
