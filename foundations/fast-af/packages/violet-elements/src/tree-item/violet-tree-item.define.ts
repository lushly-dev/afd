import { defineVioletElement } from "../shared/define-element";
import { defineVioletIcon } from "../icon/violet-icon.define";
import { registerSystemChevronRightIcon } from "../icon/generated/icons/system-chevron-right";
import { VioletTreeItem, violetTreeItemDefinition } from "./violet-tree-item";

/**
 * Defines `<violet-tree-item>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletTreeItem(registry: CustomElementRegistry = customElements): Promise<void> {
    await defineVioletIcon(registry);
    registerSystemChevronRightIcon();
    await defineVioletElement(VioletTreeItem, violetTreeItemDefinition, registry);
}

await defineVioletTreeItem();
