import { defineVioletBreadcrumb } from "../breadcrumb/violet-breadcrumb.define";
import { defineVioletBreadcrumbItem } from "../breadcrumb-item/violet-breadcrumb-item.define";
import { defineVioletButton } from "../button/violet-button.define";
import { defineVioletEmptyState } from "../empty-state/violet-empty-state.define";
import { registerSystemDocumentIcon } from "../icon/generated/icons/system-document";
import { registerSystemFolderIcon } from "../icon/generated/icons/system-folder";
import { defineVioletIcon } from "../icon/violet-icon.define";
import { defineVioletElement } from "../shared/define-element";
import { defineVioletSpinner } from "../spinner/violet-spinner.define";
import { defineVioletTree } from "../tree/violet-tree.define";
import { defineVioletTreeItem } from "../tree-item/violet-tree-item.define";
import { VioletFileExplorer, violetFileExplorerDefinition } from "./violet-file-explorer";

/**
 * Defines `<violet-file-explorer>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletFileExplorer(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletBreadcrumbItem(registry);
  await defineVioletBreadcrumb(registry);
  await defineVioletButton(registry);
  await defineVioletEmptyState(registry);
  await defineVioletIcon(registry);
  await defineVioletSpinner(registry);
  await defineVioletTreeItem(registry);
  await defineVioletTree(registry);
  registerSystemDocumentIcon();
  registerSystemFolderIcon();
  await defineVioletElement(VioletFileExplorer, violetFileExplorerDefinition, registry);
}

await defineVioletFileExplorer();
