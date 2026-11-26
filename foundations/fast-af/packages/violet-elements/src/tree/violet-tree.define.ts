import { defineVioletElement } from "../shared/define-element";
import { defineVioletTreeItem } from "../tree-item/violet-tree-item.define";
import { VioletTree, violetTreeDefinition } from "./violet-tree";

/**
 * Defines `<violet-tree>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletTree(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletTreeItem(registry);
  await defineVioletElement(VioletTree, violetTreeDefinition, registry);
}

await defineVioletTree();
