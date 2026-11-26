import { defineVioletElement } from "../shared/define-element";
import { VioletTheme, violetThemeDefinition } from "./violet-theme";

/**
 * Defines `<violet-theme>` in `registry`.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletTheme(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletElement(VioletTheme, violetThemeDefinition, registry);
}

await defineVioletTheme();
