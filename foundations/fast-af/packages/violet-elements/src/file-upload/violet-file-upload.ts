import { FASTElement, Observable, attr, css, html, observable, repeat, when } from "@lushly-dev/fast-element";

import { registerSystemAttachIcon } from "../icon/generated/icons/system-attach";
import { registerSystemDismissIcon } from "../icon/generated/icons/system-dismiss";
import { registerSystemDocumentIcon } from "../icon/generated/icons/system-document";
import "../button/violet-button";
import "../icon-button/violet-icon-button";
import "../icon/violet-icon";
import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";
import { installFormDisabled } from "../foundations/violet-form-disabled";

export type VioletFileUploadAppearance = "button" | "dropzone";
export type VioletFileUploadSize = "compact" | "natural" | "comfortable";

type VioletFileListItem = {
    readonly file: File;
    readonly index: number;
    readonly key: string;
    readonly meta: string;
};

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        display: grid;
        --violet-target-size: var(--_target-size-natural);
        --violet-control-label-size: var(--_type-label-size);
        --violet-control-body-size: var(--_type-body-size);
        --violet-control-caption-size: var(--_type-caption-size);
        --_upload-surface: var(--_surface-page);
        --_upload-surface-hover: color-mix(in srgb, var(--_surface-page) 76%, var(--_surface-subtle));
        --_upload-surface-active: color-mix(in srgb, var(--_focus-ring) 10%, var(--_surface-page));
        --_upload-border: var(--_border-subtle);
        --_upload-gap: var(--_space-stack-sm);
        --_upload-radius: calc(var(--_radius-md) * 1.5);
        --_upload-space-2xs: var(--_space-stack-2xs);
        --_upload-space-sm: var(--_space-inline-sm);
        --_upload-space-md: calc(var(--_space-inline-md) * 1.5);
        --_upload-space-lg: calc(var(--_space-inline-md) * 2.5);
        --_upload-stack-md: calc(var(--_space-stack-sm) * 1.5);
        --_upload-stack-lg: calc(var(--_space-stack-sm) * 2);
        --_upload-padding: clamp(var(--_upload-space-md), 2vw, var(--_upload-space-lg));
        --_upload-title-size: var(--_control-body-size);
        --_upload-summary-size: var(--_control-caption-size);
        --_upload-icon-size: max(1rem, calc(var(--_target-size) * 0.4));
        color: var(--color-text-primary, #18181b);
    }

    :host([size="compact"]) {
        --violet-target-size: var(--_target-size-compact);
        --violet-control-label-size: var(--_type-label-size-compact);
        --violet-control-body-size: var(--_type-body-size-compact);
        --violet-control-caption-size: var(--_type-caption-size-compact);
    }

    :host([size="natural"]) {
        --violet-target-size: var(--_target-size-natural);
    }

    :host([size="comfortable"]) {
        --violet-target-size: var(--_target-size-comfortable);
    }

    .field {
        display: grid;
        gap: var(--_space-stack-sm);
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin: 0;
    }

    .surface {
        box-sizing: border-box;
        display: grid;
        gap: var(--_upload-stack-md);
        inline-size: 100%;
        padding: var(--_upload-padding);
        border: 1px solid var(--_upload-border);
        border-radius: var(--_upload-radius);
        background: var(--_upload-surface);
        box-shadow: var(--_shadow-control);
        transition:
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            background-color var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .surface:hover {
        border-color: color-mix(in srgb, var(--_border-subtle) 70%, var(--_focus-ring));
        background: var(--_upload-surface-hover);
    }

    .surface:focus-within {
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px var(--_focus-ring);
        transform: translateY(calc(var(--_space-inline-sm) / -4));
    }

    :host([invalid]) .surface,
    :host([data-invalid]) .surface {
        border-color: var(--_danger-border);
    }

    :host([disabled]) .surface,
    :host(:disabled) .surface {
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
    }

    .surface.dropzone {
        min-block-size: calc(var(--_target-size) * 4.15);
        border-style: dashed;
        align-content: center;
        justify-items: stretch;
        padding: max(var(--_upload-space-lg), calc(var(--_target-size) * 0.5));
    }

    :host([data-drag-active]) .surface.dropzone {
        border-color: color-mix(in srgb, var(--_focus-ring) 70%, var(--_border-subtle));
        background: var(--_upload-surface-active);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 42%, transparent);
    }

    .button-layout {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        gap: var(--_upload-space-lg);
        min-block-size: calc(var(--_target-size) * 1.45);
    }

    .dropzone-layout {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        column-gap: var(--_upload-space-lg);
        row-gap: var(--_upload-stack-md);
        align-items: start;
        min-inline-size: 0;
        min-block-size: 100%;
    }

    .browse-button {
        align-self: center;
    }

    .browse-button::part(control) {
        min-inline-size: max-content;
    }

    .button-copy {
        align-content: center;
        min-inline-size: 0;
    }

    .dropzone-copy,
    .button-copy,
    .selection,
    .file-copy {
        display: grid;
        min-inline-size: 0;
    }

    .leading-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: calc(var(--_target-size) * 0.95);
        block-size: calc(var(--_target-size) * 0.95);
        border-radius: calc(var(--_radius-md) * 1.25);
        background: color-mix(in srgb, var(--_focus-ring) 10%, var(--_surface-subtle));
        color: var(--_text-secondary);
        flex: 0 0 auto;
    }

    .leading-icon violet-icon {
        --violet-icon-size: var(--_upload-icon-size);
        color: currentColor;
    }

    .trigger-copy,
    .dropzone-title {
        margin: 0;
        color: var(--color-text-primary, #18181b);
        font-size: var(--_upload-title-size);
        line-height: 1.25;
        font-weight: 600;
    }

    .summary,
    .dropzone-message,
    .selection-summary,
    .meta,
    .supporting,
    .error {
        margin: 0;
        color: var(--_text-muted);
        font-size: var(--_upload-summary-size);
        line-height: var(--_type-caption-line);
    }

    .button-copy {
        gap: var(--_space-stack-2xs);
    }

    .dropzone-copy {
        gap: var(--_space-stack-xs);
        align-content: start;
        max-inline-size: 34rem;
        padding-block-start: var(--_upload-space-2xs);
    }

    .dropzone-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--_upload-space-md);
        grid-column: 2;
    }

    .native-input {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        opacity: 0;
        pointer-events: none;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
    }

    .selection {
        gap: var(--_space-stack-xs);
    }

    .selection[hidden],
    .supporting[hidden],
    .error[hidden] {
        display: none;
    }

    .file-list {
        display: grid;
        gap: var(--_upload-stack-md);
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .file-item {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: start;
        gap: var(--_upload-space-md);
        padding: var(--_upload-space-md) var(--_upload-space-lg);
        border: 1px solid var(--_border-subtle);
        border-radius: calc(var(--_radius-md) * 1.25);
        background: color-mix(in srgb, var(--_surface-subtle) 45%, var(--_surface-page));
        box-shadow: var(--_shadow-control);
    }

    .file-item-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: calc(var(--_target-size) * 0.8);
        block-size: calc(var(--_target-size) * 0.8);
        border-radius: calc(var(--_radius-md) * 1.15);
        background: color-mix(in srgb, var(--_focus-ring) 8%, var(--_surface-page));
        color: var(--_text-secondary);
    }

    .file-item-icon violet-icon {
        --violet-icon-size: var(--_upload-icon-size);
        color: currentColor;
    }

    .file-copy {
        gap: 2px;
    }

    .filename {
        margin: 0;
        color: var(--color-text-primary, #18181b);
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .remove-button {
        align-self: center;
    }

    @media (max-width: 40rem) {
        .button-layout,
        .dropzone-layout {
            grid-template-columns: minmax(0, 1fr);
        }

        .dropzone-actions {
            grid-column: auto;
        }

        .button-copy,
        .dropzone-copy {
            max-inline-size: none;
        }
    }

    .error {
        color: var(--color-state-danger-text, #b42318);
    }

    @media (forced-colors: active) {
        .surface,
        .file-item {
            forced-color-adjust: none;
            background: Canvas;
            border-color: ButtonText;
            box-shadow: none;
        }

        :host([drag-active]) .surface.dropzone {
            background: Canvas;
            outline: 2px solid Highlight;
        }

        .leading-icon,
        .file-item-icon {
            background: Canvas;
            color: ButtonText;
        }

        .error {
            color: LinkText;
        }
    }
`;

const template = html<VioletFileUpload>`
    <div class="field" part="field">
        ${when(
            x => Boolean(x.label),
            html<VioletFileUpload>`
                <p class="label" part="label" id="${x => x.labelId}">${x => x.label}</p>
            `,
        )}

        <input
            id="${x => x.inputId}"
            class="native-input"
            part="native-input"
            type="file"
            tabindex="-1"
            aria-hidden="true"
            accept="${x => x.accept}"
            name="${x => x.name}"
            :value="${x => x.value}"
            ?multiple="${x => x.multiple}"
            ?disabled="${x => x.effectiveDisabled}"
            ?required="${x => x.required}"
            aria-invalid="${x => x.invalid ? "true" : "false"}"
            @input="${(x, c) => x.handleInput(c.event)}"
            @change="${(x, c) => x.handleCommit(c.event)}"
        />

        <div
            class="${x => `surface ${x.appearance}`}"
            part="surface"
            role="group"
            aria-labelledby="${x => x.label ? x.labelId : null}"
            aria-describedby="${x => x.describedBy || null}"
            @dragenter="${(x, c) => x.handleDragEnter(c.event as DragEvent)}"
            @dragover="${(x, c) => x.handleDragOver(c.event as DragEvent)}"
            @dragleave="${(x, c) => x.handleDragLeave(c.event as DragEvent)}"
            @drop="${(x, c) => x.handleDrop(c.event as DragEvent)}"
            @click="${(x, c) => x.handleSurfaceClick(c.event)}"
        >
            ${when(
                x => x.appearance === "button",
                html<VioletFileUpload>`
                    <div class="button-layout" part="button-layout">
                        <violet-button
                            class="browse-button"
                            part="browse-button"
                            appearance="secondary"
                            :ariaLabel="${x => x.triggerAriaLabel}"
                            :ariaDescribedby="${x => x.describedBy}"
                            :ariaErrormessage="${x => x.errorMessageId}"
                            ?disabled="${x => x.effectiveDisabled}"
                            @click="${(x, c) => x.handleBrowseButtonClick(c.event)}"
                        >
                            <violet-icon slot="before" icon="system/attach" decorative></violet-icon>
                            ${x => x.browseButtonLabel}
                        </violet-button>
                        <div class="button-copy" part="button-copy">
                            <p class="trigger-copy" part="trigger-copy">${x => x.buttonTitle}</p>
                            <p class="summary" part="summary" id="${x => x.summaryId}" role="status" aria-live="polite">${x => x.summaryText}</p>
                        </div>
                    </div>
                `,
            )}

            ${when(
                x => x.appearance === "dropzone",
                html<VioletFileUpload>`
                    <div class="dropzone-layout" part="dropzone-layout">
                        <span class="leading-icon" part="leading-icon">
                            <violet-icon icon="system/attach" decorative></violet-icon>
                        </span>
                        <div class="dropzone-copy" part="dropzone-copy">
                            <p class="dropzone-title" part="dropzone-title">${x => x.dropzoneTitle}</p>
                            <p class="dropzone-message" part="dropzone-message" id="${x => x.summaryId}" role="status" aria-live="polite">${x => x.dropzoneMessage}</p>
                        </div>
                        <div class="dropzone-actions" part="dropzone-actions">
                            <violet-button
                                class="browse-button"
                                part="browse-button"
                                appearance="secondary"
                                :ariaLabel="${x => x.triggerAriaLabel}"
                                :ariaDescribedby="${x => x.describedBy}"
                                :ariaErrormessage="${x => x.errorMessageId}"
                                ?disabled="${x => x.effectiveDisabled}"
                                @click="${(x, c) => x.handleBrowseButtonClick(c.event)}"
                            >
                                ${x => x.browseButtonLabel}
                            </violet-button>
                        </div>
                    </div>
                `,
            )}
        </div>

        <div class="selection" part="selection" ?hidden="${x => !x.hasFiles}">
            <p class="selection-summary" part="selection-summary">${x => x.selectionSummaryText}</p>
            <ul class="file-list" part="file-list">
                ${repeat(
                    x => x.fileItems,
                    html<VioletFileListItem, VioletFileUpload>`
                        <li class="file-item" part="file-item">
                            <span class="file-item-icon" part="file-icon">
                                <violet-icon icon="system/document" decorative></violet-icon>
                            </span>
                            <div class="file-copy" part="file-copy">
                                <p class="filename" part="filename" title="${x => x.file.name}">${x => x.file.name}</p>
                                <p class="meta" part="file-meta">${x => x.meta}</p>
                            </div>
                            <violet-icon-button
                                class="remove-button"
                                part="remove-button"
                                appearance="transparent"
                                label="${x => `Remove ${x.file.name}`}"
                                @click="${(x, c) => (c.parent as VioletFileUpload).removeFileAt(x.index)}"
                            >
                                <violet-icon icon="system/dismiss" decorative></violet-icon>
                            </violet-icon-button>
                        </li>
                    `,
                    { positioning: true },
                )}
            </ul>
        </div>

        <p class="supporting" part="supporting-text" id="${x => x.supportingId}" ?hidden="${x => !x.showSupportingText}">
            ${x => x.supportingText}
        </p>
        <p class="error" part="error-text" id="${x => x.errorId}" ?hidden="${x => !x.showErrorText}">
            ${x => x.effectiveErrorText}
        </p>
    </div>
`;

let violetFileUploadCount = 0;

/**
 * Native-first file selection control with optional dropzone presentation.
 *
 * @summary Form-associated file upload primitive that keeps the native file input as the source of truth while adding Violet trigger, drag-and-drop, selection list, and validation UI.
 * @fires input - Emitted when the selected files change. Detail: `{ files }`.
 * @fires change - Emitted when the selected files are committed. Detail: `{ files }`.
 * @fires remove - Emitted when a selected file is removed. Detail: `{ file, index, files }`.
 * @csspart field - Overall field wrapper.
 * @csspart label - Field label.
 * @csspart native-input - Visually hidden native file input.
 * @csspart surface - Main trigger surface.
 * @csspart browse-button - Primary browse action button.
 * @csspart selection - Selected-file section.
 * @csspart file-list - List of selected files.
 * @csspart file-item - Individual selected-file row.
 * @csspart remove-button - Remove action for a selected file.
 * @csspart supporting-text - Supporting text element.
 * @csspart error-text - Error text element.
 */
export class VioletFileUpload extends FASTElement {
    public static readonly formAssociated = true;

    readonly #internals: ElementInternals;
    readonly inputId: string;
    readonly labelId: string;
    readonly supportingId: string;
    readonly errorId: string;
    readonly summaryId: string;
    #defaultFiles: File[];
    #dragDepth: number;
    #lastNativeSelectionKey: string;

    declare public label: string;
    declare public supportingText: string;
    declare public errorText: string;
    declare public appearance: VioletFileUploadAppearance;
    declare public size: VioletFileUploadSize;
    declare public accept: string;
    declare public name: string;
    declare public disabled: boolean;

    /**
     * True while an ancestor `<fieldset disabled>` disables the control.
     */
    declare public fieldsetDisabled: boolean;

    /**
     * Author `disabled` or fieldset-disabled.
     */
    declare public readonly effectiveDisabled: boolean;
    declare public required: boolean;
    declare public invalid: boolean;
    declare public multiple: boolean;
    declare public maxFiles: string;
    declare public maxFileSize: string;
    declare public dragActive: boolean;
    declare public files: File[];
    declare public customValidationMessage: string;

    public constructor() {
        super();
        this.#internals = this.attachInternals();
        violetFileUploadCount += 1;
        this.inputId = `violet-file-upload-input-${violetFileUploadCount}`;
        this.labelId = `violet-file-upload-label-${violetFileUploadCount}`;
        this.supportingId = `violet-file-upload-supporting-${violetFileUploadCount}`;
        this.errorId = `violet-file-upload-error-${violetFileUploadCount}`;
        this.summaryId = `violet-file-upload-summary-${violetFileUploadCount}`;
        this.#defaultFiles = [];
        this.#dragDepth = 0;
        this.#lastNativeSelectionKey = "";

        this.label = "";
        this.supportingText = "";
        this.errorText = "";
        this.dragActive = false;
        this.files = [];
        this.customValidationMessage = "";
        this.appearance = "button";
        this.size = "natural";
        this.accept = "";
        this.name = "";
        this.disabled = false;
        this.required = false;
        this.invalid = false;
        this.multiple = false;
        this.maxFiles = "";
        this.maxFileSize = "";

        registerSystemAttachIcon();
        registerSystemDocumentIcon();
        registerSystemDismissIcon();
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.#defaultFiles = [...this.files];
        this.#syncHostState();
        this.#syncFormState();
    }

    public filesChanged(): void {
        this.#syncHostState();
        this.#syncFormState();
    }

    public disabledChanged(): void {
        this.#syncHostState();
        this.#syncFormState();
    }

    public requiredChanged(): void {
        this.#syncFormState();
    }

    public invalidChanged(): void {
        this.#syncHostState();
        this.#syncFormState();
    }

    public customValidationMessageChanged(): void {
        this.#syncHostState();
        this.#syncFormState();
    }

    public multipleChanged(): void {
        if (!this.multiple && this.files.length > 1) {
            this.files = this.files.slice(0, 1);
            return;
        }

        this.#syncFormState();
    }

    public formResetCallback(): void {
        this.files = [...this.#defaultFiles];
        this.customValidationMessage = "";
        this.dragActive = false;
        this.#lastNativeSelectionKey = "";
        this.#clearNativeInputValue();
    }

    public get form(): HTMLFormElement | null {
        return this.#internals.form;
    }

    public get validity(): ValidityState {
        return this.#internals.validity;
    }

    public get validationMessage(): string {
        return this.#internals.validationMessage;
    }

    public get willValidate(): boolean {
        return this.#internals.willValidate;
    }

    public get value(): string {
        return "";
    }

    public checkValidity(): boolean {
        return this.#internals.checkValidity();
    }

    public reportValidity(): boolean {
        return this.#internals.reportValidity();
    }

    public setFiles(files: readonly File[]): boolean {
        const nextFiles = [...files];
        const validationMessage = this.#validateFiles(nextFiles);

        if (validationMessage) {
            this.customValidationMessage = validationMessage;
            return false;
        }

        this.customValidationMessage = "";
        this.#lastNativeSelectionKey = this.#selectionIdentity(nextFiles);
        this.files = nextFiles;
        this.#clearNativeInputValue();
        this.$emit("input", { files: [...this.files] });
        this.$emit("change", { files: [...this.files] });
        return true;
    }

    public clearFiles(): void {
        this.files = [];
        this.customValidationMessage = "";
        this.#lastNativeSelectionKey = "";
        this.#clearNativeInputValue();
        this.$emit("input", { files: [] });
        this.$emit("change", { files: [] });
    }

    public removeFileAt(index: number): void {
        const file = this.files[index];
        if (!file) {
            return;
        }

        this.files = this.files.filter((_, currentIndex) => currentIndex !== index);
        this.customValidationMessage = "";
        this.#lastNativeSelectionKey = this.#selectionIdentity(this.files);
        this.#clearNativeInputValue();
        this.$emit("remove", { file, index, files: [...this.files] });
        this.$emit("input", { files: [...this.files] });
        this.$emit("change", { files: [...this.files] });
    }

    public handleInput(event: Event): void {
        event.stopPropagation();
        const control = event.currentTarget as HTMLInputElement | null;
        const incomingFiles = Array.from(control?.files ?? []);
        this.#lastNativeSelectionKey = this.#selectionIdentity(incomingFiles);
    }

    public handleCommit(event: Event): void {
        event.stopPropagation();
        this.handleInputChange(event);
    }

    public handleBrowseButtonClick(event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        this.openPicker();
    }

    public handleSurfaceClick(event: Event): void {
        if (this.effectiveDisabled || this.appearance !== "dropzone") {
            return;
        }

        const path = event.composedPath();
        const clickedInteractive = path.some(target => {
            if (!(target instanceof HTMLElement)) {
                return false;
            }

            return target.tagName === "BUTTON" || target.tagName === "VIOLET-BUTTON" || target.tagName === "VIOLET-ICON-BUTTON";
        });

        if (!clickedInteractive) {
            this.openPicker();
        }
    }

    public handleInputChange(event: Event): void {
        const control = event.currentTarget as HTMLInputElement | null;
        const incomingFiles = Array.from(control?.files ?? []);
        this.#applyIncomingFiles(incomingFiles);
    }

    public handleDragEnter(event: DragEvent): void {
        if (!this.#canAcceptDrop(event)) {
            return;
        }

        event.preventDefault();
        this.#dragDepth += 1;
        this.dragActive = true;
    }

    public handleDragOver(event: DragEvent): void {
        if (!this.#canAcceptDrop(event)) {
            return;
        }

        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
        }
        this.dragActive = true;
    }

    public handleDragLeave(event: DragEvent): void {
        if (this.appearance !== "dropzone" || this.effectiveDisabled) {
            return;
        }

        event.preventDefault();
        this.#dragDepth = Math.max(0, this.#dragDepth - 1);
        if (this.#dragDepth === 0) {
            this.dragActive = false;
        }
    }

    public handleDrop(event: DragEvent): void {
        if (!this.#canAcceptDrop(event)) {
            return;
        }

        event.preventDefault();
        this.dragActive = false;
        this.#dragDepth = 0;
        const droppedFiles = Array.from(event.dataTransfer?.files ?? []);
        this.#applyIncomingFiles(droppedFiles);
    }

    public openPicker(): void {
        if (this.effectiveDisabled) {
            return;
        }

        const input = this.shadowRoot?.getElementById(this.inputId) as HTMLInputElement | null;
        input?.click();
    }

    public get hasFiles(): boolean {
        Observable.trackVolatile();
        return this.files.length > 0;
    }

    public get fileItems(): VioletFileListItem[] {
        Observable.trackVolatile();
        return this.files.map((file, index) => ({
            file,
            index,
            key: `${file.name}:${file.size}:${file.lastModified}:${file.type}:${index}`,
            meta: this.formatFileMeta(file),
        }));
    }

    public get browseButtonLabel(): string {
        Observable.trackVolatile();
        if (!this.multiple && this.hasFiles) {
            return "Replace file";
        }

        return this.multiple ? "Browse files" : "Browse file";
    }

    public get buttonTitle(): string {
        Observable.trackVolatile();
        if (!this.hasFiles) {
            return this.multiple ? "Select files to upload" : "Select a file to upload";
        }

        return this.multiple ? "Add or replace selected files" : "Replace the selected file";
    }

    public get summaryText(): string {
        Observable.trackVolatile();
        if (!this.hasFiles) {
            return this.multiple ? "No files selected yet." : "No file selected yet.";
        }

        if (this.files.length === 1) {
            return this.files[0].name;
        }

        return `${this.files.length} files selected`;
    }

    public get dropzoneTitle(): string {
        Observable.trackVolatile();
        if (this.dragActive) {
            return this.multiple ? "Drop files to add them" : "Drop a file to select it";
        }

        return this.multiple ? "Drop files here" : "Drop a file here";
    }

    public get dropzoneMessage(): string {
        Observable.trackVolatile();
        if (this.hasFiles) {
            return this.summaryText;
        }

        return this.multiple ? "Or browse from your device to select multiple files." : "Or browse from your device to select one file.";
    }

    public get selectionSummaryText(): string {
        Observable.trackVolatile();
        if (!this.hasFiles) {
            return "";
        }

        return this.files.length === 1 ? "Selected file" : `${this.files.length} selected files`;
    }

    public get triggerAriaLabel(): string {
        Observable.trackVolatile();
        return this.label ? `${this.label}: ${this.browseButtonLabel}` : this.browseButtonLabel;
    }

    public get describedBy(): string | null {
        Observable.trackVolatile();
        const ids = [this.summaryId];
        if (this.showErrorText) {
            ids.push(this.errorId);
        } else if (this.supportingText) {
            ids.push(this.supportingId);
        }

        return ids.join(" ") || null;
    }

    public get errorMessageId(): string | null {
        Observable.trackVolatile();
        return this.showErrorText ? this.errorId : null;
    }

    public get effectiveErrorText(): string {
        Observable.trackVolatile();
        if (this.customValidationMessage) {
            return this.customValidationMessage;
        }

        if (this.invalid) {
            return this.errorText || "There is a problem with the selected file.";
        }

        return "";
    }

    public get showErrorText(): boolean {
        Observable.trackVolatile();
        return Boolean(this.effectiveErrorText);
    }

    public get showSupportingText(): boolean {
        Observable.trackVolatile();
        return Boolean(this.supportingText) && !this.showErrorText;
    }

    public formatFileMeta(file: File): string {
        const parts = [this.#formatFileSize(file.size)];
        if (file.type) {
            parts.push(file.type);
        }

        return parts.join(" • ");
    }

    #applyIncomingFiles(incomingFiles: File[]): void {
        const nextSelectionKey = this.#selectionIdentity(incomingFiles);
        if (nextSelectionKey === this.#lastNativeSelectionKey && nextSelectionKey === this.#selectionIdentity(this.files)) {
            return;
        }

        this.#lastNativeSelectionKey = nextSelectionKey;
        const nextFiles = this.multiple ? this.#mergeFiles(this.files, incomingFiles) : incomingFiles.slice(0, 1);
        this.setFiles(nextFiles);
    }

    #mergeFiles(existingFiles: readonly File[], incomingFiles: readonly File[]): File[] {
        const merged = [...existingFiles];
        const seen = new Set(existingFiles.map(file => this.#fileIdentity(file)));

        for (const file of incomingFiles) {
            const identity = this.#fileIdentity(file);
            if (!seen.has(identity)) {
                seen.add(identity);
                merged.push(file);
            }
        }

        return merged;
    }

    #fileIdentity(file: File): string {
        return `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
    }

    #selectionIdentity(files: readonly File[]): string {
        return files.map(file => this.#fileIdentity(file)).join("|");
    }

    #validateFiles(files: readonly File[]): string {
        if (!this.multiple && files.length > 1) {
            return "Only one file can be selected.";
        }

        const maxFiles = this.#normalizedMaxFiles;
        if (maxFiles > 0 && files.length > maxFiles) {
            return maxFiles === 1 ? "Only one file can be selected." : `Select no more than ${maxFiles} files.`;
        }

        const maxFileSize = this.#normalizedMaxFileSize;
        if (maxFileSize > 0) {
            const oversized = files.find(file => file.size > maxFileSize);
            if (oversized) {
                return `${oversized.name} exceeds the ${this.#formatFileSize(maxFileSize)} limit.`;
            }
        }

        if (this.accept.trim()) {
            const invalidFile = files.find(file => !this.#matchesAccept(file));
            if (invalidFile) {
                return `${invalidFile.name} does not match the accepted file types.`;
            }
        }

        return "";
    }

    #matchesAccept(file: File): boolean {
        const acceptTokens = this.accept
            .split(",")
            .map(token => token.trim().toLowerCase())
            .filter(Boolean);

        if (acceptTokens.length === 0) {
            return true;
        }

        const fileName = file.name.toLowerCase();
        const fileType = file.type.toLowerCase();

        return acceptTokens.some(token => {
            if (token.startsWith(".")) {
                return fileName.endsWith(token);
            }

            if (token.endsWith("/*")) {
                const prefix = token.slice(0, -1);
                return fileType.startsWith(prefix);
            }

            return fileType === token;
        });
    }

    get #normalizedMaxFiles(): number {
        const value = Number.parseInt(this.maxFiles, 10);
        return Number.isFinite(value) && value > 0 ? value : 0;
    }

    get #normalizedMaxFileSize(): number {
        const value = Number.parseInt(this.maxFileSize, 10);
        return Number.isFinite(value) && value > 0 ? value : 0;
    }

    #syncHostState(): void {
        this.toggleAttribute("data-invalid", this.invalid || Boolean(this.customValidationMessage));
        this.toggleAttribute("data-drag-active", this.dragActive);
    }

    #syncFormState(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        const files = this.files ?? [];
        const valueMissing = this.required && files.length === 0;
        const customError = Boolean(this.customValidationMessage) || this.invalid;
        const validationMessage = this.customValidationMessage || (this.invalid ? this.errorText || "Invalid file selection." : "") || (valueMissing ? "Select a file to continue." : "");
        const control = this.shadowRoot?.querySelector("input") as HTMLInputElement | null;

        this.#internals.ariaInvalid = this.invalid || Boolean(this.customValidationMessage) ? "true" : "false";

        this.#internals.setValidity(
            {
                valueMissing,
                customError,
            },
            validationMessage || undefined,
            control ?? undefined,
        );

        if (this.effectiveDisabled || files.length === 0 || !this.name) {
            this.#internals.setFormValue(null);
            return;
        }

        const formData = new FormData();
        for (const file of files) {
            formData.append(this.name, file);
        }
        this.#internals.setFormValue(formData);
    }

    #formatFileSize(sizeInBytes: number): string {
        if (sizeInBytes < 1024) {
            return `${sizeInBytes} B`;
        }

        if (sizeInBytes < 1024 * 1024) {
            return `${Math.round(sizeInBytes / 102.4) / 10} KB`;
        }

        return `${Math.round(sizeInBytes / 104857.6) / 10} MB`;
    }

    #canAcceptDrop(event: DragEvent): boolean {
        if (this.appearance !== "dropzone" || this.effectiveDisabled) {
            return false;
        }

        const types = event.dataTransfer?.types;
        return types ? Array.from(types).includes("Files") : true;
    }

    #clearNativeInputValue(): void {
        const input = this.shadowRoot?.getElementById(this.inputId) as HTMLInputElement | null;
        if (input) {
            input.value = "";
        }
    }
}

attr(VioletFileUpload.prototype, "label");
attr({ attribute: "supporting-text" })(VioletFileUpload.prototype, "supportingText");
attr({ attribute: "error-text" })(VioletFileUpload.prototype, "errorText");
attr(VioletFileUpload.prototype, "appearance");
attr(VioletFileUpload.prototype, "size");
attr(VioletFileUpload.prototype, "accept");
attr(VioletFileUpload.prototype, "name");
attr({ mode: "boolean" })(VioletFileUpload.prototype, "disabled");
installFormDisabled(VioletFileUpload.prototype);
attr({ mode: "boolean" })(VioletFileUpload.prototype, "required");
attr({ mode: "boolean" })(VioletFileUpload.prototype, "invalid");
attr({ mode: "boolean" })(VioletFileUpload.prototype, "multiple");
attr({ attribute: "max-files" })(VioletFileUpload.prototype, "maxFiles");
attr({ attribute: "max-file-size" })(VioletFileUpload.prototype, "maxFileSize");
observable(VioletFileUpload.prototype, "files");
observable(VioletFileUpload.prototype, "customValidationMessage");
observable(VioletFileUpload.prototype, "dragActive");

if (!customElements.get("violet-file-upload")) {
    await FASTElement.define(VioletFileUpload, {
        name: "violet-file-upload",
        template,
        styles,
    });
}
