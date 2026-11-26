import { defineVioletButton } from "../button/violet-button.define";
import { defineVioletCard } from "../card/violet-card.define";
import { defineVioletIcon } from "../icon/violet-icon.define";
import { defineVioletIconButton } from "../icon-button/violet-icon-button.define";
import { defineVioletElement } from "../shared/define-element";
import { VioletToast, violetToastDefinition } from "./violet-toast";

/**
 * Defines `<violet-toast>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletToast(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletButton(registry);
  await defineVioletCard(registry);
  await defineVioletIcon(registry);
  await defineVioletIconButton(registry);
  await defineVioletElement(VioletToast, violetToastDefinition, registry);
}

await defineVioletToast();
