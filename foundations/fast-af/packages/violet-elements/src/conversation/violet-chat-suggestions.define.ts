import { defineVioletElement } from "../shared/define-element";
import { VioletChatSuggestions, violetChatSuggestionsDefinition } from "./violet-chat-suggestions";

/**
 * Defines `<violet-chat-suggestions>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletChatSuggestions(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletChatSuggestions, violetChatSuggestionsDefinition, registry);
}

await defineVioletChatSuggestions();
