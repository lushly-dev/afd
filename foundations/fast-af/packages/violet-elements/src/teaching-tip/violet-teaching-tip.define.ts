import { registerSystemCloseIcon } from "../icon/generated/icons/system-close";
import { defineVioletIcon } from "../icon/violet-icon.define";
import { defineVioletIconButton } from "../icon-button/violet-icon-button.define";
import { defineVioletElement } from "../shared/define-element";
import { VioletTeachingTip, violetTeachingTipDefinition } from "./violet-teaching-tip";

/**
 * Defines `<violet-teaching-tip>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletTeachingTip(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletIcon(registry);
  await defineVioletIconButton(registry);
  registerSystemCloseIcon();
  await defineVioletElement(VioletTeachingTip, violetTeachingTipDefinition, registry);
}

await defineVioletTeachingTip();
