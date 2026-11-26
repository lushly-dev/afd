import { defineVioletFileUpload } from "../file-upload/violet-file-upload.define";
import { registerSystemDismissIcon } from "../icon/generated/icons/system-dismiss";
import { registerSystemDocumentIcon } from "../icon/generated/icons/system-document";
import { defineVioletIcon } from "../icon/violet-icon.define";
import { defineVioletIconButton } from "../icon-button/violet-icon-button.define";
import { defineVioletImage } from "../image/violet-image.define";
import { defineVioletElement } from "../shared/define-element";
import {
  VioletDataGridAttachmentCell,
  violetDataGridAttachmentCellDefinition,
} from "./violet-data-grid-attachment-cell";

/**
 * Defines `<violet-data-grid-attachment-cell>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletDataGridAttachmentCell(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletFileUpload(registry);
  await defineVioletIconButton(registry);
  await defineVioletIcon(registry);
  await defineVioletImage(registry);
  registerSystemDismissIcon();
  registerSystemDocumentIcon();
  await defineVioletElement(
    VioletDataGridAttachmentCell,
    violetDataGridAttachmentCellDefinition,
    registry,
  );
}

await defineVioletDataGridAttachmentCell();
