import { defineVioletElement } from "../shared/define-element";
import {
  VioletConversationThread,
  violetConversationThreadDefinition,
} from "./violet-conversation-thread";

/**
 * Defines `<violet-conversation-thread>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletConversationThread(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletConversationThread, violetConversationThreadDefinition, registry);
}

await defineVioletConversationThread();
