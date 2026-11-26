import { defineVioletButton } from "../button/violet-button.define";
import { defineVioletIcon } from "../icon/violet-icon.define";
import { defineVioletIconButton } from "../icon-button/violet-icon-button.define";
import { defineVioletElement } from "../shared/define-element";
import { VioletFileUpload, violetFileUploadDefinition } from "./violet-file-upload";

/**
 * Defines `<violet-file-upload>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletFileUpload(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletButton(registry);
  await defineVioletIconButton(registry);
  await defineVioletIcon(registry);
  await defineVioletElement(VioletFileUpload, violetFileUploadDefinition, registry);
}

await defineVioletFileUpload();
