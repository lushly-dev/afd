import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "./violet-data-grid-attachment-cell";
import type { VioletFileUpload } from "../file-upload/violet-file-upload";
import type {
  VioletDataGridAttachmentCell,
  VioletDataGridAttachmentCellChangeDetail,
  VioletDataGridAttachmentCellUploadRequestDetail,
} from "./violet-data-grid-attachment-cell";
import type { VioletDataGridAttachmentItem } from "./violet-data-grid-attachment-cell-values";
import { parseAttachmentCellValue } from "./violet-data-grid-attachment-cell-values";

const attachmentItems: VioletDataGridAttachmentItem[] = [
  {
    id: "attachment-bed-plan",
    label: "Bed plan cover.png",
    kind: "image",
    previewSrc: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'></svg>",
    meta: "PNG · 84 KB",
  },
  {
    id: "attachment-yield-sheet",
    label: "Yield sheet.pdf",
    kind: "document",
    meta: "PDF · 180 KB",
  },
];

const previewlessImageAttachment: VioletDataGridAttachmentItem = {
  id: "attachment-cover-art",
  label: "Cover art.png",
  kind: "image",
  meta: "PNG · 42 KB",
};

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function renderAttachmentCell(
  overrides: Partial<{
    attachments: VioletDataGridAttachmentItem[];
    readonly: boolean;
  }> = {},
): Promise<VioletDataGridAttachmentCell> {
  document.body.innerHTML = "";

  const element = document.createElement(
    "violet-data-grid-attachment-cell",
  ) as VioletDataGridAttachmentCell;
  element.placeholder = "Add attachments";
  element.attachments = overrides.attachments ?? [attachmentItems[0]];
  element.readonly = overrides.readonly ?? false;
  element.setAttribute("aria-label", "Attachments");
  document.body.append(element);

  await customElements.whenDefined("violet-data-grid-attachment-cell");
  await nextFrame();

  return element;
}

describe("violet-data-grid-attachment-cell", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("tracks pending attachments and emits change when the panel closes", async () => {
    const element = await renderAttachmentCell();
    const inputSpy = vi.fn();
    const changeSpy = vi.fn();

    element.addEventListener("input", inputSpy);
    element.addEventListener("change", changeSpy);

    element.handleTriggerClick();
    await nextFrame();

    expect(element.open).toBe(true);

    element.appendAttachments([attachmentItems[1]]);
    await nextFrame();

    expect(element.attachments).toHaveLength(2);
    expect(inputSpy).toHaveBeenCalledTimes(1);
    expect(changeSpy).not.toHaveBeenCalled();

    element.handleTriggerClick();
    await nextFrame();

    expect(element.open).toBe(false);
    expect(changeSpy).toHaveBeenCalledTimes(1);
    expect(element.value).toContain("Yield sheet.pdf");
  });

  it("removes attachments while editing", async () => {
    const element = await renderAttachmentCell({
      attachments: attachmentItems,
    });

    element.removeAttachmentById("attachment-yield-sheet");
    await nextFrame();

    expect(element.attachments).toEqual([attachmentItems[0]]);
  });

  it("hides add controls in readonly mode", async () => {
    const element = await renderAttachmentCell({
      readonly: true,
    });

    element.handleTriggerClick();
    await nextFrame();

    expect(element.open).toBe(true);
    expect(Boolean(element.shadowRoot?.querySelector("violet-file-upload"))).toBe(false);
  });

  it("renders the empty placeholder only once in the trigger", async () => {
    const element = await renderAttachmentCell({
      attachments: [],
    });
    const selection = element.shadowRoot?.querySelector(".selection");

    expect(selection?.textContent?.match(/Add attachments/gu)).toHaveLength(1);
    expect(Boolean(selection?.querySelector(".summary"))).toBe(false);
  });

  it("uses a system icon fallback for image attachments without previews", async () => {
    const element = await renderAttachmentCell({
      attachments: [previewlessImageAttachment],
    });
    const fallbackIcon = element.shadowRoot?.querySelector(".preview-thumb-fallback violet-icon");

    expect(fallbackIcon?.getAttribute("icon")).toBe("system/document");
    expect(Boolean(element.shadowRoot?.querySelector("violet-image.preview-thumb"))).toBe(false);
  });

  it("releases generated preview URLs when uploaded attachments are removed", async () => {
    const createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:attachment-preview");
    const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const file = new File(["leaf"], "Field plan.png", {
      type: "image/png",
      lastModified: 7,
    });
    const element = await renderAttachmentCell({
      attachments: [],
    });

    element.appendFiles([file]);
    await nextFrame();

    expect(createObjectURLSpy).toHaveBeenCalledWith(file);
    expect(element.attachments).toHaveLength(1);

    element.removeAttachmentById("Field plan.png:4:7");
    await nextFrame();

    expect(element.attachments).toEqual([]);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:attachment-preview");
  });

  it("passes original uploaded image Files to the host and commits only durable metadata", async () => {
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-image-preview");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const element = await renderAttachmentCell({ attachments: [] });
    const file = new File(["image"], "Harvest.png", { type: "image/png", lastModified: 42 });
    let intent: VioletDataGridAttachmentCellUploadRequestDetail | undefined;
    let committed: VioletDataGridAttachmentCellChangeDetail | undefined;
    element.handleTriggerClick();
    await nextFrame();
    const upload = element.shadowRoot!.querySelector<VioletFileUpload>("violet-file-upload")!;
    const clearFiles = vi.spyOn(upload, "clearFiles");
    let filesBeforeClear: File[] | undefined;
    let clearCallsAtIntent = -1;
    const input = upload.shadowRoot!.querySelector<HTMLInputElement>('input[type="file"]')!;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    element.addEventListener("upload-request", (event) => {
      intent = (event as CustomEvent<VioletDataGridAttachmentCellUploadRequestDetail>).detail;
      filesBeforeClear = [...upload.files];
      clearCallsAtIntent = clearFiles.mock.calls.length;
    });
    element.addEventListener("change", (event) => {
      committed = (event as CustomEvent<VioletDataGridAttachmentCellChangeDetail>).detail;
    });
    const nativeChange = new Event("change", { bubbles: true, composed: true, cancelable: true });
    input.dispatchEvent(nativeChange);
    await nextFrame();
    expect(createUrl).toHaveBeenCalledWith(file);
    expect(intent?.files[0]).toBe(file);
    expect(filesBeforeClear).toEqual([file]);
    expect(clearCallsAtIntent).toBe(0);
    expect(clearFiles).toHaveBeenCalledTimes(1);
    expect(intent?.attachments[0]).toMatchObject({
      id: "Harvest.png:5:42",
      label: "Harvest.png",
      kind: "image",
    });
    expect(intent?.attachments[0].previewSrc).toBeUndefined();
    expect(element.attachments[0].previewSrc).toBe("blob:local-image-preview");
    expect(element.shadowRoot!.querySelector("violet-image.preview-thumb")).not.toBeNull();
    expect(input.files).toHaveLength(0);
    element.handleTriggerClick();
    expect(committed?.attachments).toEqual(parseAttachmentCellValue(committed?.value));
    expect(committed?.value).not.toContain("blob:");
    const value = element.value;
    element.remove();
    expect(revokeUrl).toHaveBeenCalledWith("blob:local-image-preview");
    document.body.append(element);
    await nextFrame();
    expect(element.attachments[0].previewSrc).toBeUndefined();
    expect(
      element
        .shadowRoot!.querySelector(".preview-thumb-fallback violet-icon")
        ?.getAttribute("icon"),
    ).toBe("system/document");
    const reopened = await renderAttachmentCell({ attachments: parseAttachmentCellValue(value) });
    expect(
      reopened
        .shadowRoot!.querySelector(".preview-thumb-fallback violet-icon")
        ?.getAttribute("icon"),
    ).toBe("system/document");
  });

  it("preserves host-provided preview URLs, including external blob URLs", async () => {
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const element = await renderAttachmentCell({ attachments: [] });
    const item = {
      id: "host-image",
      label: "Host.png",
      kind: "image" as const,
      previewSrc: "blob:host-managed-preview",
    };
    element.value = JSON.stringify([item]);
    await nextFrame();
    expect(parseAttachmentCellValue(element.value)).toEqual([item]);
    element.value = JSON.stringify([
      { ...item, label: "Renamed.png", previewSrc: "https://example.test/host.png" },
    ]);
    await nextFrame();
    expect(element.attachments[0].label).toBe("Renamed.png");
    expect(element.value).toContain("https://example.test/host.png");
    element.remove();
    expect(revokeUrl).not.toHaveBeenCalled();
  });

  it("releases duplicate image previews and all remaining owned previews on disconnect", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:first-image")
      .mockReturnValueOnce("blob:duplicate-image");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const element = await renderAttachmentCell({ attachments: [] });
    const file = new File(["image"], "Harvest.png", { type: "image/png", lastModified: 42 });
    element.appendFiles([file]);
    element.appendFiles([file]);
    expect(element.attachments).toHaveLength(1);
    expect(revokeUrl).toHaveBeenCalledWith("blob:duplicate-image");
    expect(revokeUrl).not.toHaveBeenCalledWith("blob:first-image");
    element.remove();
    expect(revokeUrl).toHaveBeenCalledWith("blob:first-image");
  });

  it("ignores disabled and readonly edits before creating previews", async () => {
    const createUrl = vi.spyOn(URL, "createObjectURL");
    const element = await renderAttachmentCell();
    const file = new File(["image"], "Harvest.png", { type: "image/png" });
    for (const state of ["disabled", "readonly"] as const) {
      element[state] = true;
      element.appendFiles([file]);
      element.removeAttachmentById(attachmentItems[0].id);
      expect(element.attachments).toEqual([attachmentItems[0]]);
      element[state] = false;
    }
    expect(createUrl).not.toHaveBeenCalled();
  });

  it("allows normal panel keys and composition while containing grid shortcuts", async () => {
    const element = await renderAttachmentCell();
    element.handleTriggerClick();
    await nextFrame();
    const panel = element.shadowRoot!.querySelector<HTMLElement>(".panel")!;
    const parentKeydown = vi.fn();
    document.body.addEventListener("keydown", parentKeydown);
    try {
      for (const init of [{ key: "Tab" }, { key: "Enter" }, { key: "Escape", isComposing: true }]) {
        const event = new KeyboardEvent("keydown", {
          ...init,
          bubbles: true,
          composed: true,
          cancelable: true,
        });
        panel.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(element.open).toBe(true);
      }
      expect(parentKeydown).not.toHaveBeenCalled();
      panel.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
      expect(element.open).toBe(false);
    } finally {
      document.body.removeEventListener("keydown", parentKeydown);
    }
  });

  it("escapes overflow clipping, tracks shadow-root scrolling, and cleans up on disconnect", async () => {
    const element = await renderAttachmentCell();
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const scroller = document.createElement("div");
    scroller.style.cssText = "overflow:auto; height:45px; width:400px; margin:40px";
    root.append(scroller);
    scroller.append(element);
    document.body.append(host);
    await nextFrame();
    const removeScroll = vi.spyOn(root, "removeEventListener");
    const removeResize = vi.spyOn(window, "removeEventListener");
    element.handleTriggerClick();
    await nextFrame();
    await nextFrame();
    const panel = element.shadowRoot!.querySelector<HTMLElement>(".panel")!;
    expect(panel.matches(":popover-open")).toBe(true);
    expect(getComputedStyle(panel).position).toBe("fixed");
    const rect = panel.getBoundingClientRect();
    expect(rect.bottom).toBeGreaterThan(scroller.getBoundingClientRect().bottom);
    const hit = element.shadowRoot!.elementFromPoint(rect.left + 10, rect.bottom - 10);
    expect(hit === panel || panel.contains(hit)).toBe(true);
    const previousLeft = panel.style.left;
    element.style.marginInlineStart = "30px";
    scroller.dispatchEvent(new Event("scroll"));
    expect(panel.style.left).not.toBe(previousLeft);
    element.remove();
    expect(panel.matches(":popover-open")).toBe(false);
    expect(element.open).toBe(false);
    expect(removeScroll.mock.calls.some(([type]) => type === "scroll")).toBe(true);
    expect(removeResize.mock.calls.some(([type]) => type === "resize")).toBe(true);
    const closedLeft = panel.style.left;
    scroller.dispatchEvent(new Event("scroll"));
    expect(panel.style.left).toBe(closedLeft);
  });

  it("disconnect cancels a queued popover open", async () => {
    const element = await renderAttachmentCell();
    element.handleTriggerClick();
    element.remove();
    await nextFrame();
    expect(element.open).toBe(false);
    expect(element.shadowRoot?.querySelector(".panel:popover-open")).toBeNull();
  });

  it("repeated rapid upload and disconnect never restores revoked previews", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:rapid-1")
      .mockReturnValueOnce("blob:rapid-2")
      .mockReturnValueOnce("blob:rapid-3");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const element = await renderAttachmentCell({ attachments: [] });
    for (let index = 1; index <= 3; index += 1) {
      element.appendFiles([new File(["image"], `Image-${index}.png`, { type: "image/png" })]);
      element.handleTriggerClick();
      const value = element.value;
      element.remove();
      await nextFrame();
      expect(element.open).toBe(false);
      expect(revokeUrl).toHaveBeenCalledWith(`blob:rapid-${index}`);
      expect(element.attachments.every((item) => !item.previewSrc)).toBe(true);
      element.value = value;
      document.body.append(element);
      await nextFrame();
      expect(element.shadowRoot?.querySelector("violet-image.preview-thumb")).toBeNull();
      expect(element.shadowRoot?.querySelector(".preview-thumb-fallback")).not.toBeNull();
    }
  });
});
