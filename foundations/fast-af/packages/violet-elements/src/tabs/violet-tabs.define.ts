import { defineVioletElement } from "../shared/define-element";
import { defineVioletTab } from "../tab/violet-tab.define";
import { defineVioletTabPanel } from "../tab-panel/violet-tab-panel.define";
import { VioletTabs, violetTabsDefinition } from "./violet-tabs";

/**
 * Defines `<violet-tabs>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletTabs(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletTab(registry);
  await defineVioletTabPanel(registry);
  await defineVioletElement(VioletTabs, violetTabsDefinition, registry);
}

await defineVioletTabs();
