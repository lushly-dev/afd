import {
  attr,
  css,
  FASTElement,
  html,
  observable,
  repeat,
  Updates,
  when,
} from "@lushly-dev/fast-element";

import { registerSystemDismissIcon } from "../icon/generated/icons/system-dismiss";
import { registerSystemDocumentIcon } from "../icon/generated/icons/system-document";
import "../file-upload/violet-file-upload";
import "../icon-button/violet-icon-button";
import "../icon/violet-icon";
import "../image/violet-image";
import type { VioletFileUpload } from "../file-upload/violet-file-upload";
import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";
import {
  attachmentItemsFromFiles,
  clearOwnedAttachmentPreview,
  getOwnedAttachmentPreviewUrl,
  isImageAttachment,
  normalizeAttachmentItems,
  parseAttachmentCellValue,
  serializeAttachmentCellValue,
  type VioletDataGridAttachmentItem,
} from "./violet-data-grid-attachment-cell-values";

let violetDataGridAttachmentCellInstanceCount = 0;

const MAX_VISIBLE_ATTACHMENTS = 2;

registerSystemDocumentIcon();
registerSystemDismissIcon();

export type VioletDataGridAttachmentCellChangeDetail = {
  attachments: VioletDataGridAttachmentItem[];
  value: string;
};

export type VioletDataGridAttachmentCellUploadRequestDetail = {
  files: File[];
  attachments: VioletDataGridAttachmentItem[];
};

function isImageFallbackAttachment(item: VioletDataGridAttachmentItem): boolean {
  return item.kind === "image" && !isImageAttachment(item);
}

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        position: relative;
        display: inline-grid;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        color: var(--_text-primary);
        font-family: var(--violet-data-grid-font-family, "IBM Plex Sans", "Segoe UI", sans-serif);

        --_surface-page: var(--color-surface-page, #fffefa);
        --_surface-floating: var(--color-surface-floating, #ffffff);
        --_surface-subtle: var(--color-surface-subtle, #f0efe6);
        --_border-subtle: var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        --_border-strong: var(--color-border-strong, rgba(28, 26, 13, 0.35));
        --_text-primary: var(--color-text-primary, #18181b);
        --_text-secondary: var(--color-text-secondary, #414651);
        --_text-muted: var(--color-text-muted, #6b7280);
        --_focus-ring: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
        --_radius-md: var(--radius-md, 8px);
        --_shadow-floating: var(--shadow-floating, 0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08));
        --_size-font-md: var(--size-font-md, 14px);
        --_size-font-sm: var(--size-font-sm, 12px);
    }

    :host([disabled]) {
        opacity: 0.7;
    }

    .root {
        position: relative;
        display: grid;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
    }

    .trigger {
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.75rem;
        padding: 0;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }

    .trigger:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: 2px;
        border-radius: var(--_radius-md);
    }

    .trigger:disabled {
        cursor: not-allowed;
    }

    .selection {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.5rem;
        padding-inline: 0.25rem 0.5625rem;
        border: 1px solid transparent;
        border-radius: 999px;
        box-sizing: border-box;
        font-size: 0.8125rem;
        font-weight: 400;
        line-height: 1.15;
    }

    .selection[data-empty="true"] {
        background: var(--_surface-subtle);
        border-color: color-mix(in srgb, var(--_border-subtle) 85%, transparent);
        color: var(--_text-secondary);
    }

    .preview-stack {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
    }

    violet-image.preview-thumb {
        inline-size: 1.625rem;
        block-size: 1.625rem;
        flex: 0 0 auto;
    }

    .preview-thumb-fallback {
        inline-size: 1.625rem;
        block-size: 1.625rem;
    }

    .file-chip,
    .overflow-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.3125rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.5rem;
        padding-inline: 0.625rem;
        border: 1px solid color-mix(in srgb, var(--_border-subtle) 80%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--_surface-subtle) 82%, white);
        color: var(--_text-primary);
        box-sizing: border-box;
        white-space: nowrap;
    }

    .overflow-chip {
        color: var(--_text-secondary);
    }

    .chip-label,
    .placeholder,
    .summary {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    violet-icon.file-icon {
        --violet-icon-size: 0.875rem;
        color: var(--_text-secondary);
        flex: 0 0 auto;
    }

    .preview-thumb-fallback,
    .row-thumb-fallback {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        border-radius: calc(var(--_radius-md) - 2px);
        background: color-mix(in srgb, var(--_surface-subtle) 90%, white);
        color: var(--_text-secondary);
    }

    violet-icon.preview-icon {
        --violet-icon-size: 0.9375rem;
        flex: 0 0 auto;
    }

    .caret {
        inline-size: 0.375rem;
        block-size: 0.375rem;
        flex: 0 0 auto;
        margin-inline-start: 0.0625rem;
        border-inline-end: 1.25px solid currentColor;
        border-block-end: 1.25px solid currentColor;
        transform: translateY(-2.5px) rotate(45deg);
        opacity: 0.78;
    }

    .panel {
        position: fixed;
        inset: unset;
        margin: 0;
        box-sizing: border-box;
        z-index: var(--_layer-popover);
        display: none;
        gap: 0.625rem;
        inline-size: min(22rem, calc(100vw - 16px));
        max-block-size: calc(100vh - 16px);
        overflow: auto;
        min-inline-size: 0;
        padding: 0.625rem;
        border: 1px solid color-mix(in srgb, var(--_border-strong) 50%, transparent);
        border-radius: var(--_radius-md);
        background: var(--_surface-floating);
        box-shadow: var(--_shadow-floating);
        color: var(--_text-primary);
    }

    .panel:popover-open {
        display: grid;
    }

    @media (forced-colors: active) {
        .trigger:focus-visible,
        .panel:focus-visible {
            outline: 2px solid Highlight;
        }

        .panel {
            border-color: CanvasText;
        }
    }

    .selection-summary {
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
        line-height: 1.2;
        padding-inline: 0.125rem;
    }

    .attachment-list {
        display: grid;
        gap: 0.5rem;
        min-inline-size: 0;
    }

    .attachment-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 0.625rem;
        padding: 0.5rem;
        border: 1px solid color-mix(in srgb, var(--_border-subtle) 88%, transparent);
        border-radius: calc(var(--_radius-md) - 2px);
        background: color-mix(in srgb, var(--_surface-subtle) 42%, var(--_surface-page));
    }

    .attachment-preview {
        inline-size: 2rem;
        block-size: 2rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        border-radius: calc(var(--_radius-md) - 2px);
        background: color-mix(in srgb, var(--_surface-subtle) 90%, white);
        overflow: hidden;
    }

    violet-image.row-thumb {
        inline-size: 2rem;
        block-size: 2rem;
    }

    .row-thumb-fallback {
        inline-size: 2rem;
        block-size: 2rem;
    }

    .attachment-copy {
        display: grid;
        gap: 2px;
        min-inline-size: 0;
    }

    .attachment-label {
        margin: 0;
        color: var(--_text-primary);
        font-size: var(--_size-font-md);
        line-height: 1.25;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .attachment-meta {
        margin: 0;
        color: var(--_text-muted);
        font-size: var(--_size-font-sm);
        line-height: 1.25;
    }

    .remove-button {
        align-self: center;
    }

    .add-upload {
        min-inline-size: 0;
    }

    .add-upload::part(label),
    .add-upload::part(selection),
    .add-upload::part(supporting-text),
    .add-upload::part(error-text),
    .add-upload::part(button-copy) {
        display: none;
    }

    .add-upload::part(surface) {
        padding: 0;
        border: none;
        background: transparent;
        box-shadow: none;
    }

    .add-upload::part(button-layout) {
        min-block-size: auto;
    }

    .empty {
        padding: 0.25rem 0.125rem;
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
    }
`;

const template = html<VioletDataGridAttachmentCell>`
    <div class="root" part="base">
        <button
            class="trigger"
            type="button"
            part="trigger"
            ?disabled="${(x) => x.disabled}"
            aria-label="${(x) => x.getAttribute("aria-label") || x.placeholder || "Edit attachments"}"
            aria-haspopup="dialog"
            aria-controls="${(x) => x.panelId}"
            aria-expanded="${(x) => String(x.open)}"
            @click="${(x) => (x.handleTriggerClick(), true)}"
        >
            <span class="selection" part="selection" data-empty="${(x) => String(x.attachments.length === 0)}">
                <span class="preview-stack">
                    ${when(
                      (x) => x.attachments.length === 0,
                      html<VioletDataGridAttachmentCell>`
                            <span class="placeholder">${(x) => x.placeholder || "Add attachments"}</span>
                        `,
                    )}
                    ${repeat(
                      (x) => x.visibleAttachments,
                      html<VioletDataGridAttachmentItem, VioletDataGridAttachmentCell>`
                            ${when(
                              (x, c) => c.parent.isImageItem(x),
                              html<VioletDataGridAttachmentItem>`
                                    <violet-image
                                        class="preview-thumb"
                                        decorative
                                        shape="rounded"
                                        ratio="square"
                                        fit="cover"
                                        src="${(x) => x.previewSrc ?? ""}"
                                        alt="${(x) => x.label}"
                                    ></violet-image>
                                `,
                            )}
                            ${when(
                              (x) => isImageFallbackAttachment(x),
                              html<VioletDataGridAttachmentItem>`
                                    <span class="preview-thumb-fallback" aria-hidden="true">
                                        <violet-icon class="preview-icon" icon="system/document" decorative></violet-icon>
                                    </span>
                                `,
                            )}
                            ${when(
                              (x, c) => !c.parent.isImageItem(x) && !isImageFallbackAttachment(x),
                              html<VioletDataGridAttachmentItem>`
                                    <span class="file-chip">
                                        <violet-icon class="file-icon" icon="system/document" decorative></violet-icon>
                                        <span class="chip-label">${(x) => x.label}</span>
                                    </span>
                                `,
                            )}
                        `,
                    )}
                    ${when(
                      (x) => x.overflowCount > 0,
                      html<VioletDataGridAttachmentCell>`
                            <span class="overflow-chip" part="overflow-pill">+${(x) => x.overflowCount}</span>
                        `,
                    )}
                </span>
                ${when(
                  (x) => x.attachments.length > 0,
                  html<VioletDataGridAttachmentCell>`
                        <span class="summary">${(x) => x.selectionLabel}</span>
                    `,
                )}
                <span class="caret" part="caret" aria-hidden="true"></span>
            </span>
        </button>

        ${when(
          (x) => x.open,
          html<VioletDataGridAttachmentCell>`
                <div
                    class="panel"
                    id="${(x) => x.panelId}"
                    part="panel"
                    popover="manual"
                    role="dialog"
                    tabindex="-1"
                    aria-label="${(x) => x.getAttribute("aria-label") || x.placeholder || "Attachments"}"
                    @toggle="${(x, c) => (x.handlePanelToggle(c.event as ToggleEvent), true)}"
                    @keydown="${(x, c) => (x.handlePanelKeydown(c.event as KeyboardEvent), true)}"
                >
                    <div class="selection-summary" part="selection-summary">${(x) => x.selectionSummary}</div>
                    ${when(
                      (x) => x.attachments.length > 0,
                      html<VioletDataGridAttachmentCell>`
                            <div class="attachment-list" part="attachment-list">
                                ${repeat(
                                  (x) => x.attachments,
                                  html<VioletDataGridAttachmentItem, VioletDataGridAttachmentCell>`
                                        <div class="attachment-row" part="attachment-row">
                                            <span class="attachment-preview">
                                                ${when(
                                                  (x, c) => c.parent.isImageItem(x),
                                                  html<VioletDataGridAttachmentItem>`
                                                        <violet-image
                                                            class="row-thumb"
                                                            decorative
                                                            shape="rounded"
                                                            ratio="square"
                                                            fit="cover"
                                                            src="${(x) => x.previewSrc ?? ""}"
                                                            alt="${(x) => x.label}"
                                                        ></violet-image>
                                                    `,
                                                )}
                                                ${when(
                                                  (x) => isImageFallbackAttachment(x),
                                                  html<VioletDataGridAttachmentItem>`
                                                        <span class="row-thumb-fallback" aria-hidden="true">
                                                            <violet-icon class="preview-icon" icon="system/document" decorative></violet-icon>
                                                        </span>
                                                    `,
                                                )}
                                                ${when(
                                                  (x, c) =>
                                                    !c.parent.isImageItem(x) &&
                                                    !isImageFallbackAttachment(x),
                                                  html<VioletDataGridAttachmentItem>`
                                                        <violet-icon class="file-icon" icon="system/document" decorative></violet-icon>
                                                    `,
                                                )}
                                            </span>
                                            <div class="attachment-copy">
                                                <p class="attachment-label" title="${(x) => x.label}">${(x) => x.label}</p>
                                                <p class="attachment-meta">${(x) => x.meta || "Attachment"}</p>
                                            </div>
                                            ${when(
                                              (x, c) => !c.parent.readonly,
                                              html<
                                                VioletDataGridAttachmentItem,
                                                VioletDataGridAttachmentCell
                                              >`
                                                    <violet-icon-button
                                                        class="remove-button"
                                                        part="remove-button"
                                                        appearance="transparent"
                                                        label="${(x) => `Remove ${x.label}`}"
                                                        ?disabled="${(x, c) => c.parent.disabled}"
                                                        @click="${(x, c) => (c.parent.removeAttachmentById(x.id), true)}"
                                                    >
                                                        <violet-icon icon="system/dismiss" decorative></violet-icon>
                                                    </violet-icon-button>
                                                `,
                                            )}
                                        </div>
                                    `,
                                )}
                            </div>
                        `,
                    )}
                    ${when(
                      (x) => x.attachments.length === 0,
                      html<VioletDataGridAttachmentCell>`
                            <div class="empty" part="empty-state">No attachments yet</div>
                        `,
                    )}
                    ${when(
                      (x) => !x.readonly,
                      html<VioletDataGridAttachmentCell>`
                            <violet-file-upload
                                class="add-upload"
                                part="add-control"
                                appearance="button"
                                size="compact"
                                multiple
                                ?disabled="${(x) => x.disabled}"
                                @input="${(_x, c) => (c.event.stopPropagation(), true)}"
                                @change="${(x, c) => (x.handleUploadChange(c.event), true)}"
                            ></violet-file-upload>
                        `,
                    )}
                </div>
            `,
        )}
    </div>
`;

/**
 * Compact attachment renderer/editor for dense grid cells.
 *
 * @summary Grid-native attachment cell with thumbnail-or-chip previews, compact list editing, and deferred commit on close.
 * @fires input - Emitted whenever the pending attachment list changes while the panel is open.
 * @fires change - Emitted on close with durable attachments matching the parsed serialized value, excluding owned thumbnail URLs.
 * @fires upload-request - Upload intent with `{ files, attachments }` before the uploader is cleared. Hosts own persistence and can replace items by id with durable URLs; the cell does not upload files.
 * @csspart base - Root wrapper for the attachment cell.
 * @csspart trigger - Trigger button that opens the attachment panel.
 * @csspart selection - Visible attachment preview surface rendered inside the trigger.
 * @csspart overflow-pill - Overflow count chip when more attachments exist than can be shown inline.
 * @csspart caret - Caret icon inside the trigger.
 * @csspart panel - Floating attachment panel.
 * @csspart selection-summary - Compact summary row describing the current attachment count.
 * @csspart attachment-list - Wrapper around the current attachment rows.
 * @csspart attachment-row - Individual attachment row inside the panel.
 * @csspart add-control - Inline add-files control shown in editable mode.
 * @csspart remove-button - Remove action for an attachment row.
 * @csspart empty-state - Empty message shown when no attachments exist.
 */
export class VioletDataGridAttachmentCell extends FASTElement {
  public declare placeholder: string;

  public declare disabled: boolean;

  public declare readonly: boolean;

  public declare attachments: VioletDataGridAttachmentItem[];

  public declare open: boolean;

  readonly #instanceId = ++violetDataGridAttachmentCellInstanceCount;
  #openAttachmentSnapshot = "[]";
  readonly #ownedPreviewUrls = new Set<string>();
  #skipAttachmentChangeSync = false;
  #openGeneration = 0;
  #focusFrame: number | null = null;
  readonly #scrollRoots: (Document | ShadowRoot)[] = [];
  readonly #handleViewportChange = () => this.positionPanel();
  readonly #handleFocusOut = (event: FocusEvent) => {
    const target = event.relatedTarget as Node | null;
    if (target && target !== this && !this.shadowRoot?.contains(target)) {
      this.close(true);
    }
  };

  readonly #handleDocumentPointerDown = (event: PointerEvent) => {
    if (!this.open) {
      return;
    }

    const path = event.composedPath();
    if (path.includes(this)) {
      return;
    }

    this.close(true);
  };

  public constructor() {
    super();
    this.placeholder = "";
    this.disabled = false;
    this.readonly = false;
    this.attachments = [];
    this.open = false;
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("focusout", this.#handleFocusOut);
    this.ownerDocument.addEventListener("pointerdown", this.#handleDocumentPointerDown, true);
  }

  public disconnectedCallback(): void {
    this.ownerDocument.removeEventListener("pointerdown", this.#handleDocumentPointerDown, true);
    this.removeEventListener("focusout", this.#handleFocusOut);
    this.close(false);
    super.disconnectedCallback();
    // Coupled FAST repeat observers survive unbind. Do not notify an array replacement
    // while disconnected; clear only plain owned preview fields before recycling.
    this.attachments.forEach(clearOwnedAttachmentPreview);
    this.releaseAllOwnedPreviewUrls();
  }

  public get value(): string {
    return serializeAttachmentCellValue(this.attachments);
  }

  public set value(nextValue: string) {
    const nextAttachments = parseAttachmentCellValue(nextValue);
    if (serializeAttachmentCellValue(nextAttachments) === this.value) {
      return;
    }

    this.setAttachments(nextAttachments);
  }

  public get panelId(): string {
    return `${this.localName}-panel-${this.#instanceId}`;
  }

  public get visibleAttachments(): VioletDataGridAttachmentItem[] {
    return this.attachments.slice(0, MAX_VISIBLE_ATTACHMENTS);
  }

  public get overflowCount(): number {
    return Math.max(0, this.attachments.length - MAX_VISIBLE_ATTACHMENTS);
  }

  public get selectionLabel(): string {
    if (this.attachments.length === 0) {
      return this.placeholder || "Add attachments";
    }

    if (this.attachments.length === 1) {
      return this.attachments[0]?.label ?? "1 attachment";
    }

    const lead = this.attachments[0]?.label ?? `${this.attachments.length} attachments`;
    return `${lead} +${this.attachments.length - 1}`;
  }

  public get selectionSummary(): string {
    if (this.attachments.length === 0) {
      return "No attachments";
    }

    return `${this.attachments.length} attachment${this.attachments.length === 1 ? "" : "s"}`;
  }

  public attachmentsChanged(
    previous: VioletDataGridAttachmentItem[] | undefined,
    next: VioletDataGridAttachmentItem[] | undefined,
  ): void {
    if (this.#skipAttachmentChangeSync) {
      return;
    }

    this.syncOwnedPreviewUrls(previous ?? [], next ?? []);
  }

  public handleTriggerClick(): void {
    if (this.disabled) {
      return;
    }

    if (this.open) {
      this.close(true);
      this.focusTrigger();
      return;
    }

    this.#openAttachmentSnapshot = this.value;
    this.open = true;
    const generation = ++this.#openGeneration;
    void Updates.next().then(() => {
      if (!this.open || !this.$fastController.isConnected || generation !== this.#openGeneration) {
        return;
      }
      const panel = this.panelElement();
      if (!panel) {
        return;
      }
      panel.showPopover();
      this.startPanelTracking();
      this.positionPanel();
      this.#focusFrame = requestAnimationFrame(() => {
        this.#focusFrame = null;
        if (this.open && this.$fastController.isConnected && generation === this.#openGeneration) {
          panel.focus({ preventScroll: true });
        }
      });
    });
  }

  public disabledChanged(): void {
    if (this.disabled) {
      this.close(true);
    }
  }

  public handlePanelToggle(event: ToggleEvent): void {
    if (
      event.newState === "closed" &&
      event.currentTarget === this.panelElement() &&
      !this.panelElement()?.matches(":popover-open")
    ) {
      this.close(true);
    }
  }

  public handlePanelKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229 || event.key !== "Escape") {
      return;
    }
    event.preventDefault();
    this.close(true);
    this.focusTrigger();
  }

  public handleUploadChange(event: Event): void {
    event.stopPropagation();
    if (this.disabled || this.readonly) {
      return;
    }
    const detail = (event as CustomEvent<{ files?: File[] }>).detail;
    const upload = event.currentTarget as VioletFileUpload | null;
    const incomingFiles = detail?.files ?? [];

    if (incomingFiles.length === 0) {
      return;
    }

    this.appendFiles(incomingFiles);
    upload?.clearFiles();
  }

  public appendFiles(files: readonly File[]): void {
    if (this.disabled || this.readonly) {
      return;
    }
    if (files.length === 0) {
      return;
    }
    const items = attachmentItemsFromFiles(files);
    this.appendAttachments(items);
    this.$emit("upload-request", {
      files: [...files],
      attachments: parseAttachmentCellValue(serializeAttachmentCellValue(items)),
    } satisfies VioletDataGridAttachmentCellUploadRequestDetail);
  }

  public appendAttachments(items: readonly VioletDataGridAttachmentItem[]): void {
    if (this.disabled || this.readonly) {
      return;
    }
    const merged = normalizeAttachmentItems([...this.attachments, ...items]);
    // Normalization can drop duplicate uploads; release their otherwise orphaned previews.
    this.syncOwnedPreviewUrls([...this.attachments, ...items], merged);
    this.applyAttachments(merged, "input");
  }

  public removeAttachmentById(id: string): void {
    if (this.disabled || this.readonly) {
      return;
    }
    this.applyAttachments(
      this.attachments.filter((attachment) => attachment.id !== id),
      "input",
    );
  }

  public isImageItem(item: VioletDataGridAttachmentItem): boolean {
    return isImageAttachment(item);
  }

  private applyAttachments(
    nextAttachments: VioletDataGridAttachmentItem[],
    eventName: "input" | "change",
  ): void {
    this.setAttachments(normalizeAttachmentItems(nextAttachments));
    this.$emit(eventName, {
      attachments: [...this.attachments],
      value: this.value,
    } satisfies VioletDataGridAttachmentCellChangeDetail);
  }

  private close(emitCommitEvent: boolean): void {
    this.#openGeneration += 1;
    this.stopPanelTracking();
    const panel = this.panelElement();
    if (panel?.matches(":popover-open")) {
      panel.hidePopover();
    }
    if (!this.open) {
      return;
    }
    const nextValue = this.value;
    const attachmentsChanged = nextValue !== this.#openAttachmentSnapshot;
    this.open = false;

    if (emitCommitEvent && attachmentsChanged) {
      this.$emit("change", {
        attachments: parseAttachmentCellValue(nextValue),
        value: nextValue,
      } satisfies VioletDataGridAttachmentCellChangeDetail);
    }
  }

  private focusTrigger(): void {
    this.#focusFrame = requestAnimationFrame(() => {
      this.#focusFrame = null;
      if (this.open || this.disabled || !this.$fastController.isConnected) {
        return;
      }
      this.shadowRoot?.querySelector<HTMLButtonElement>(".trigger")?.focus();
    });
  }

  private panelElement(): HTMLElement | null {
    return this.shadowRoot?.querySelector(".panel") ?? null;
  }

  private startPanelTracking(): void {
    this.stopPanelTracking();
    // Scroll does not cross shadow roots, including the grid's own scroll surface.
    let root = this.getRootNode();
    while (root instanceof ShadowRoot) {
      this.#scrollRoots.push(root);
      root = root.host.getRootNode();
    }
    this.#scrollRoots.push(this.ownerDocument);
    this.#scrollRoots.forEach((target) => {
      target.addEventListener("scroll", this.#handleViewportChange, true);
    });
    this.ownerDocument.defaultView?.addEventListener("resize", this.#handleViewportChange);
  }

  private stopPanelTracking(): void {
    this.#scrollRoots.forEach((target) => {
      target.removeEventListener("scroll", this.#handleViewportChange, true);
    });
    this.#scrollRoots.length = 0;
    this.ownerDocument.defaultView?.removeEventListener("resize", this.#handleViewportChange);
    if (this.#focusFrame !== null) {
      cancelAnimationFrame(this.#focusFrame);
      this.#focusFrame = null;
    }
  }

  private positionPanel(): void {
    const panel = this.panelElement();
    const trigger = this.shadowRoot?.querySelector<HTMLButtonElement>(".trigger");
    const viewport = this.ownerDocument.defaultView;
    if (!this.open || !panel?.matches(":popover-open") || !trigger || !viewport) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const padding = 8;
    const below = rect.bottom + 6;
    const top =
      below + panelRect.height <= viewport.innerHeight - padding
        ? below
        : rect.top - panelRect.height - 6;
    panel.style.left = `${Math.max(padding, Math.min(rect.left, viewport.innerWidth - panelRect.width - padding))}px`;
    panel.style.top = `${Math.max(padding, top)}px`;
  }

  private setAttachments(nextAttachments: VioletDataGridAttachmentItem[]): void {
    this.syncOwnedPreviewUrls(this.attachments, nextAttachments);
    this.#skipAttachmentChangeSync = true;

    try {
      this.attachments = nextAttachments;
    } finally {
      this.#skipAttachmentChangeSync = false;
    }
  }

  private syncOwnedPreviewUrls(
    previous: readonly VioletDataGridAttachmentItem[],
    next: readonly VioletDataGridAttachmentItem[],
  ): void {
    const nextOwnedPreviewUrls = new Set(
      next
        .map((item) => getOwnedAttachmentPreviewUrl(item))
        .filter((url): url is string => Boolean(url)),
    );

    previous
      .map((item) => getOwnedAttachmentPreviewUrl(item))
      .filter((url): url is string => Boolean(url))
      .forEach((url) => {
        if (!nextOwnedPreviewUrls.has(url)) {
          URL.revokeObjectURL(url);
          this.#ownedPreviewUrls.delete(url);
        }
      });

    nextOwnedPreviewUrls.forEach((url) => {
      this.#ownedPreviewUrls.add(url);
    });
  }

  private releaseAllOwnedPreviewUrls(): void {
    this.#ownedPreviewUrls.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    this.#ownedPreviewUrls.clear();
  }
}

attr(VioletDataGridAttachmentCell.prototype, "placeholder");
attr({ mode: "boolean" })(VioletDataGridAttachmentCell.prototype, "disabled");
attr({ mode: "boolean" })(VioletDataGridAttachmentCell.prototype, "readonly");
observable(VioletDataGridAttachmentCell.prototype, "attachments");
observable(VioletDataGridAttachmentCell.prototype, "open");

if (!customElements.get("violet-data-grid-attachment-cell")) {
  await FASTElement.define(VioletDataGridAttachmentCell, {
    name: "violet-data-grid-attachment-cell",
    template,
    styles,
    shadowOptions: {
      delegatesFocus: true,
    },
  });
}
