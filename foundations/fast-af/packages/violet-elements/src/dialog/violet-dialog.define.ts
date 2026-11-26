import { registerSystemCloseIcon } from "../icon/generated/icons/system-close";
import { defineVioletIcon } from "../icon/violet-icon.define";
import { defineVioletIconButton } from "../icon-button/violet-icon-button.define";
import { defineVioletElement } from "../shared/define-element";
import { VioletDialog, violetDialogDefinition } from "./violet-dialog";

/**
 * Defines `<violet-dialog>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletDialog(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletIcon(registry);
  await defineVioletIconButton(registry);
  registerSystemCloseIcon();
  await defineVioletElement(VioletDialog, violetDialogDefinition, registry);
}

await defineVioletDialog();
