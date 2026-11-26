import { defineVioletIcon } from "../icon/violet-icon.define";
import { defineVioletIconButton } from "../icon-button/violet-icon-button.define";
import { defineVioletElement } from "../shared/define-element";
import { defineVioletTextArea } from "../text-area/violet-text-area.define";
import { VioletChatComposer, violetChatComposerDefinition } from "./violet-chat-composer";

/**
 * Defines `<violet-chat-composer>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletChatComposer(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletIcon(registry);
  await defineVioletIconButton(registry);
  await defineVioletTextArea(registry);
  await defineVioletElement(VioletChatComposer, violetChatComposerDefinition, registry);
}

await defineVioletChatComposer();
