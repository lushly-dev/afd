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

import "../listbox/violet-listbox";
import type { VioletListbox } from "../listbox/violet-listbox";
import "../option/violet-option";
import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";
import type { VioletDataGridEditorOption } from "./violet-data-grid";
import {
  displayOptionForValue,
  filterEditorOptions,
  resolveOptionVisuals,
} from "./violet-data-grid-editor-option-helpers";
import {
  normalizeReferencePickerValues,
  parseReferencePickerValue,
  serializeReferencePickerValue,
} from "./violet-data-grid-reference-picker-values";

let violetDataGridReferencePickerInstanceCount = 0;

const MAX_VISIBLE_REFERENCES = 2;

type VioletDataGridReferencePickerSelectionDetail = {
  value: string;
  selectedValues: string[];
};

type VioletDataGridReferencePickerQueryDetail = {
  query: string;
};

type VioletDataGridReferencePickerCreateDetail = {
  query: string;
};

type VioletDataGridReferencePickerSelectedEntry = {
  label: string;
  option: VioletDataGridEditorOption | null;
  value: string;
};

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
        --_surface-card: var(--color-surface-card, #faf9f5);
        --_surface-floating: var(--color-surface-floating, #f0efe6);
        --_surface-subtle: var(--color-surface-subtle, #f0efe6);
        --_border-subtle: var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        --_border-strong: var(--color-border-strong, rgba(28, 26, 13, 0.48));
        --_text-primary: var(--color-text-primary, #18181b);
        --_text-secondary: var(--color-text-secondary, #414651);
        --_text-muted: var(--color-text-muted, #616775);
        --_focus-ring: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
        --_radius-sm: var(--radius-sm, 2px);
        --_radius-md: var(--radius-md, 4px);
        --_shadow-floating: var(--shadow-floating, 0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08));
        --_pill-font-size: var(--violet-data-grid-pill-font-size, 0.8125rem);
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
        border-radius: var(--_radius-sm);
    }

    .trigger:disabled {
        cursor: not-allowed;
    }

    .selection {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.5rem;
        padding-inline: 0.25rem 0.5625rem;
        border: 1px solid transparent;
        border-radius: 999px;
        box-sizing: border-box;
        font-size: var(--_pill-font-size);
        font-weight: 400;
        line-height: 1;
    }

    .selection[data-empty="true"] {
        background: var(--_surface-subtle);
        border-color: color-mix(in srgb, var(--_border-subtle) 85%, transparent);
        color: var(--_text-secondary);
    }

    .references {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
    }

    .reference-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.375rem;
        padding-inline: 0.625rem;
        border: 1px solid color-mix(in srgb, var(--_border-subtle) 80%, transparent);
        border-radius: 999px;
        box-sizing: border-box;
        background: color-mix(in srgb, var(--_surface-subtle) 82%, white);
        color: var(--_text-primary);
        font-size: var(--_pill-font-size);
        line-height: 1;
    }

    .pill-label,
    .placeholder {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .pill-dot {
        inline-size: 0.5rem;
        block-size: 0.5rem;
        flex: 0 0 auto;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--_border-subtle) 75%, transparent);
        box-sizing: border-box;
    }

    .overflow-pill {
        background: color-mix(in srgb, var(--_surface-subtle) 88%, white);
        border-color: color-mix(in srgb, var(--_border-subtle) 80%, transparent);
        color: var(--_text-secondary);
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
        max-inline-size: calc(100vw - 16px);
        max-block-size: calc(100vh - 16px);
        overflow: auto;
        z-index: var(--_layer-popover);
        display: grid;
        gap: 0.5rem;
        inline-size: min(20rem, max(15rem, 100%));
        min-inline-size: 0;
        padding: 0.5rem;
        border: 1px solid color-mix(in srgb, var(--_border-strong) 50%, transparent);
        border-radius: var(--_radius-md);
        background: var(--_surface-floating);
        box-shadow: var(--_shadow-floating);
    }

    .search {
        inline-size: 100%;
        min-inline-size: 0;
        padding: 0.5rem 0.625rem;
        border: 1px solid var(--_border-subtle);
        border-radius: calc(var(--_radius-md) - 2px);
        background: var(--_surface-page);
        color: var(--_text-primary);
        font: inherit;
        font-size: var(--_size-font-md);
        outline: none;
        box-sizing: border-box;
    }

    .search:focus-visible {
        border-color: color-mix(in srgb, var(--_focus-ring) 55%, transparent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 25%, transparent);
    }

    .selection-summary {
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
        line-height: 1.2;
        padding-inline: 0.125rem;
    }

    .listbox {
        --violet-listbox-min-inline-size: 100%;
        --violet-listbox-max-block-size: 13rem;
        --violet-listbox-padding: 0.25rem;
    }

    .option-token {
        inline-size: 1.5rem;
        block-size: 1.5rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        border-radius: 999px;
        border: 1px solid transparent;
        box-sizing: border-box;
        font-size: 0.6875rem;
        font-weight: 700;
        line-height: 1;
        text-transform: uppercase;
    }

    .option-check {
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
        font-weight: 700;
        line-height: 1;
    }

    .create-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: 100%;
        min-block-size: 2rem;
        padding-inline: 0.75rem;
        border: 1px dashed color-mix(in srgb, var(--_border-strong) 45%, transparent);
        border-radius: calc(var(--_radius-md) - 2px);
        background: color-mix(in srgb, var(--_surface-subtle) 48%, white);
        color: var(--_text-primary);
        font: inherit;
        font-size: var(--_size-font-sm);
        cursor: pointer;
    }

    .create-action:focus-visible {
        outline: none;
        border-color: color-mix(in srgb, var(--_focus-ring) 55%, transparent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 25%, transparent);
    }

    .empty {
        padding: 0.5rem 0.25rem 0.25rem;
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
    }
`;

const template = html<VioletDataGridReferencePicker>`
    <div class="root" part="base">
        <button
            class="trigger"
            type="button"
            part="trigger"
            ?disabled="${(x) => x.disabled}"
            aria-label="${(x) => x.getAttribute("aria-label") || x.placeholder || "Link records"}"
            aria-haspopup="listbox"
            aria-controls="${(x) => x.panelId}"
            aria-expanded="${(x) => String(x.open)}"
            @click="${(x) => {
              x.handleTriggerClick();
              return true;
            }}"
            @keydown="${(x, c) => {
              x.handleTriggerKeydown(c.event as KeyboardEvent);
              return true;
            }}"
        >
            <span class="selection" part="selection" data-empty="${(x) => String(x.selectedValues.length === 0)}">
                <span class="references">
                    ${when(
                      (x) => x.selectedValues.length === 0,
                      html<VioletDataGridReferencePicker>`
                            <span class="placeholder">${(x) => x.placeholder || "Link records"}</span>
                        `,
                    )}
                    ${repeat(
                      (x) => x.visibleSelectedEntries,
                      html<
                        VioletDataGridReferencePickerSelectedEntry,
                        VioletDataGridReferencePicker
                      >`
                            <span class="reference-pill" part="pill">
                                <span class="pill-dot" style="${(x, c) => c.parent.pillDotStyleForValue(x.value)}"></span>
                                <span class="pill-label">${(x) => x.label}</span>
                            </span>
                        `,
                    )}
                    ${when(
                      (x) => x.overflowCount > 0,
                      html<VioletDataGridReferencePicker>`
                            <span class="reference-pill overflow-pill" part="overflow-pill">+${(x) => x.overflowCount}</span>
                        `,
                    )}
                </span>
                <span class="caret" part="caret" aria-hidden="true"></span>
            </span>
        </button>

        ${when(
          (x) => x.open,
          html<VioletDataGridReferencePicker>`
                <div class="panel" id="${(x) => x.panelId}" part="panel" popover="manual"
                    @toggle="${(x, c) => {
                      x.handlePanelToggle(c.event as ToggleEvent);
                      return true;
                    }}">
                    <input
                        class="search"
                        part="search"
                        type="search"
                        placeholder="Find records"
                        aria-label="Find records"
                        aria-controls="${(x) => x.listboxId}"
                        :value="${(x) => x.filterQuery}"
                        @input="${(x, c) => {
                          x.handleSearchInput(c.event);
                          return true;
                        }}"
                        @keydown="${(x, c) => {
                          x.handleSearchKeydown(c.event as KeyboardEvent);
                          return true;
                        }}"
                    />
                    <div class="selection-summary" part="selection-summary" role="status">${(x) => x.selectionSummary}</div>
                            <violet-listbox
                                id="${(x) => x.listboxId}"
                                class="listbox"
                                part="listbox"
                                ?multiple="${(x) => x.multiple}"
                                ?disabled="${(x) => x.disabled}"
                                aria-label="${(x) => x.getAttribute("aria-label") || x.placeholder || "Records"}"
                                :value="${(x) => x.selectedValues[0] ?? ""}"
                                :selectedValues="${(x) => x.selectedValues}"
                                @input="${(x, c) => {
                                  x.handleListboxInput(c.event);
                                  return true;
                                }}"
                                @change="${(x, c) => {
                                  x.handleListboxChange(c.event);
                                  return true;
                                }}"
                                @keydown="${(x, c) => {
                                  x.handleListboxKeydown(c.event as KeyboardEvent);
                                  return true;
                                }}"
                            >
                                ${repeat(
                                  (x) => x.filteredOptions,
                                  html<VioletDataGridEditorOption, VioletDataGridReferencePicker>`
                                        <violet-option value="${(x) => x.value}" label="${(x) => x.label}">
                                            <span
                                                slot="before"
                                                class="option-token"
                                                style="${(x, c) => c.parent.optionTokenStyle(x)}"
                                            >
                                                ${(x, c) => c.parent.optionTokenText(x)}
                                            </span>
                                            ${when(
                                              (x) => Boolean(x.description),
                                              html<VioletDataGridEditorOption>`
                                                    <span slot="description">${(x) => x.description}</span>
                                                `,
                                            )}
                                            <span
                                                slot="after"
                                                class="option-check"
                                                ?hidden="${(x, c) => !c.parent.isSelected(x.value)}"
                                            >Linked</span>
                                            ${(x) => x.label}
                                        </violet-option>
                                    `,
                                )}
                            </violet-listbox>
                    ${when(
                      (x) => x.filteredOptions.length === 0 && !x.hasCreateAction,
                      html<VioletDataGridReferencePicker>`
                            <div class="empty" part="empty-state" role="status">No matching records</div>
                        `,
                    )}
                    ${when(
                      (x) => x.hasCreateAction,
                      html<VioletDataGridReferencePicker>`
                            <button
                                class="create-action"
                                part="create-action"
                                type="button"
                                @keydown="${(x, c) => {
                                  x.handleListboxKeydown(c.event as KeyboardEvent);
                                  return true;
                                }}"
                                @click="${(x) => {
                                  x.handleCreateAction();
                                  return true;
                                }}"
                            >
                                ${(x) => x.createActionText}
                            </button>
                        `,
                    )}
                </div>
            `,
        )}
    </div>
`;

/**
 * Compact reference picker for linked-record style grid cells.
 *
 * @summary Grid-native reference picker with searchable linked records, secondary metadata, and optional create hooks.
 * @fires input - Emitted whenever the pending selected references change while the panel is open.
 * @fires change - Emitted when the current pending selection is committed by closing the picker.
 * @fires query-change - Emitted whenever the search query changes so the host can provide filtered options.
 * @fires create-request - Emitted when the create action is invoked for the current query.
 * @csspart base - Root wrapper for the reference picker.
 * @csspart trigger - Trigger button that opens the option list.
 * @csspart selection - Visible selection surface rendered inside the trigger.
 * @csspart pill - Styled linked-record pill preview for each visible selected reference.
 * @csspart overflow-pill - Overflow count pill when more references are selected than can be shown inline.
 * @csspart caret - Caret icon inside the trigger.
 * @csspart panel - Floating option panel.
 * @csspart search - Search input inside the panel.
 * @csspart selection-summary - Compact summary row describing the current linked-record count.
 * @csspart listbox - Selection listbox surface inside the panel.
 * @csspart create-action - Optional create action button shown for unmatched queries.
 * @csspart empty-state - Empty message shown when the current filter has no matches.
 */
export class VioletDataGridReferencePicker extends FASTElement {
  public declare placeholder: string;

  public declare disabled: boolean;

  public declare multiple: boolean;

  public declare allowCreate: boolean;

  public declare selectedValues: string[];

  public declare options: VioletDataGridEditorOption[];

  public declare open: boolean;

  public declare filterQuery: string;

  readonly #instanceId = ++violetDataGridReferencePickerInstanceCount;
  #openSelectionSnapshot = "[]";
  #pendingOpenFocusTarget: "search" | "listbox" | "last" | null = null;
  #focusRevision = 0;
  #scrollRoot: ShadowRoot | null = null;
  #listboxPointerId: number | null = null;
  readonly #handleViewportChange = (event: Event) => {
    const panel = this.panelElement();
    if (panel && !event.composedPath().includes(panel)) {
      this.positionPanel();
    }
  };

  readonly #handleFocusOut = (event: FocusEvent) => {
    const target = event.relatedTarget as Node | null;
    if (target && (target === this || this.shadowRoot?.contains(target))) {
      return;
    }
    // A nonfocusable option can blur search before its click selects a value.
    if (!target && this.#listboxPointerId !== null) {
      return;
    }
    this.close(true);
  };

  readonly #handlePointerEnd = (event: PointerEvent) => {
    if (event.pointerId !== this.#listboxPointerId) {
      return;
    }
    this.#listboxPointerId = null;
    const listbox = this.listboxElement();
    if (!this.open || !listbox || !this.$fastController.isConnected) {
      return;
    }
    const path = event.composedPath();
    if (event.type === "pointerup" && path.includes(listbox)) {
      const option = listbox.options.find((candidate) => path.includes(candidate));
      if (option && !option.isDisabled) {
        listbox.activeValue = option.value;
      }
      listbox.shadowRoot?.querySelector<HTMLElement>('[role="listbox"]')?.focus();
      return;
    }
    const root = this.getRootNode() as Document | ShadowRoot;
    if (root.activeElement !== this) {
      this.close(true);
    }
  };

  readonly #handleComposingKeydown = (event: KeyboardEvent) => {
    // Preserve Tab and IME defaults despite the primitive's consuming event binding.
    const listbox = this.listboxElement();
    if (
      listbox &&
      (event.isComposing || event.keyCode === 229 || event.key === "Tab") &&
      event.composedPath().includes(listbox)
    ) {
      event.stopPropagation();
    }
  };

  readonly #handleDocumentPointerDown = (event: PointerEvent) => {
    if (!this.open) {
      return;
    }

    const path = event.composedPath();
    if (path.includes(this)) {
      const listbox = this.listboxElement();
      if (event.button === 0 && listbox && !this.disabled && path.includes(listbox)) {
        this.#listboxPointerId = event.pointerId;
      }
      return;
    }

    this.close(true);
  };

  public constructor() {
    super();
    this.placeholder = "";
    this.disabled = false;
    this.multiple = true;
    this.allowCreate = false;
    this.selectedValues = [];
    this.options = [];
    this.open = false;
    this.filterQuery = "";
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("focusout", this.#handleFocusOut);
    this.addEventListener("keydown", this.#handleComposingKeydown, true);
    this.ownerDocument.addEventListener("pointerdown", this.#handleDocumentPointerDown, true);
    this.ownerDocument.addEventListener("pointerup", this.#handlePointerEnd, true);
    this.ownerDocument.addEventListener("pointercancel", this.#handlePointerEnd, true);
  }

  public disconnectedCallback(): void {
    this.close(false);
    this.removeViewportListeners();
    this.#focusRevision += 1;
    this.removeEventListener("focusout", this.#handleFocusOut);
    this.removeEventListener("keydown", this.#handleComposingKeydown, true);
    this.ownerDocument.removeEventListener("pointerdown", this.#handleDocumentPointerDown, true);
    this.ownerDocument.removeEventListener("pointerup", this.#handlePointerEnd, true);
    this.ownerDocument.removeEventListener("pointercancel", this.#handlePointerEnd, true);
    super.disconnectedCallback();
  }

  public get value(): string {
    return serializeReferencePickerValue(this.selectedValues);
  }

  public set value(nextValue: string) {
    this.syncSelectionFromValue(nextValue);
  }

  public get panelId(): string {
    return `${this.localName}-panel-${this.#instanceId}`;
  }

  public get listboxId(): string {
    return `${this.panelId}-listbox`;
  }

  public disabledChanged(): void {
    if (this.disabled && this.open) {
      this.close(true);
    }
  }

  public handlePanelToggle(event: ToggleEvent): void {
    const panel = this.panelElement();
    if (event.newState === "closed" && panel && !panel.matches(":popover-open")) {
      this.close(true);
    }
  }

  public filterQueryChanged(): void {
    void Updates.next().then(() => this.positionPanel());
  }

  public get selectedEntries(): VioletDataGridReferencePickerSelectedEntry[] {
    return this.selectedValues.map((value) => {
      const option = displayOptionForValue(this.options, value);

      return {
        label: option.label,
        option: option.value === value ? option : null,
        value,
      };
    });
  }

  public get visibleSelectedEntries(): VioletDataGridReferencePickerSelectedEntry[] {
    return this.selectedEntries.slice(0, MAX_VISIBLE_REFERENCES);
  }

  public get overflowCount(): number {
    return Math.max(0, this.selectedValues.length - MAX_VISIBLE_REFERENCES);
  }

  public get selectionSummary(): string {
    if (this.selectedValues.length === 0) {
      return "No linked records";
    }

    return `${this.selectedValues.length} linked record${this.selectedValues.length === 1 ? "" : "s"}`;
  }

  public get filteredOptions(): VioletDataGridEditorOption[] {
    return filterEditorOptions(this.options, this.filterQuery);
  }

  public get hasCreateAction(): boolean {
    const query = this.normalizedQuery();
    if (!this.allowCreate || !query) {
      return false;
    }

    return !this.options.some((option) => {
      const label = option.label.trim().toLowerCase();
      const value = option.value.trim().toLowerCase();
      return label === query || value === query;
    });
  }

  public get createActionText(): string {
    return `Create "${this.filterQuery.trim()}"`;
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

    this.openPanel("search");
  }

  public handleTriggerKeydown(event: KeyboardEvent): void {
    if (this.disabled || event.isComposing || event.keyCode === 229) {
      return;
    }

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (this.open) {
        this.close(true);
      } else {
        this.openPanel("search");
      }
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      this.openPanel(event.key === "ArrowUp" ? "last" : "listbox");
    }
  }

  public handleSearchInput(event: Event): void {
    event.stopPropagation();
    const target = event.target as HTMLInputElement | null;
    this.filterQuery = target?.value ?? "";
    this.$emit("query-change", {
      query: this.filterQuery,
    } satisfies VioletDataGridReferencePickerQueryDetail);
  }

  public handleSearchKeydown(event: KeyboardEvent): void {
    if (this.disabled || event.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close(true);
      this.focusTrigger();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (this.filteredOptions.length > 0) {
        this.focusListboxControl(event.key === "ArrowUp");
        return;
      }

      if (this.hasCreateAction) {
        this.focusCreateAction();
      }
      return;
    }

    if (event.key === "Enter" && this.hasCreateAction && this.filteredOptions.length === 0) {
      event.preventDefault();
      event.stopPropagation();
      this.handleCreateAction();
      return;
    }

    if (event.key === "Backspace" && !this.filterQuery && this.selectedValues.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      this.applySelection(this.selectedValues.slice(0, -1), "input");
    }
  }

  public handleListboxInput(event: Event): void {
    event.stopPropagation();
    if (this.disabled) {
      return;
    }
    const detail = (event as CustomEvent<{ value?: string; selectedValues?: string[] }>).detail;
    const visibleValues = new Set(this.filteredOptions.map((option) => option.value));
    const hiddenSelected = this.selectedValues.filter((value) => !visibleValues.has(value));
    const nextSelectedValues = this.multiple
      ? [...hiddenSelected, ...(detail?.selectedValues ?? [])]
      : detail?.value
        ? [detail.value]
        : [];

    this.applySelection(nextSelectedValues, "input");

    if (!this.multiple) {
      this.close(true);
      this.focusTrigger();
    }
  }

  public handleListboxChange(event: Event): void {
    event.stopPropagation();
  }

  public handleListboxKeydown(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close(true);
      this.focusTrigger();
    }
  }

  public handleCreateAction(): void {
    const query = this.filterQuery.trim();
    if (this.disabled || !query || !this.hasCreateAction) {
      return;
    }

    this.$emit("create-request", {
      query,
    } satisfies VioletDataGridReferencePickerCreateDetail);
  }

  public toggleValue(value: string): void {
    if (this.disabled) {
      return;
    }
    if (!this.multiple) {
      const isSameValue = this.selectedValues.length === 1 && this.selectedValues[0] === value;
      this.applySelection(isSameValue ? [] : [value], "input");
      return;
    }

    const selected = new Set(this.selectedValues);

    if (selected.has(value)) {
      selected.delete(value);
    } else {
      selected.add(value);
    }

    this.applySelection(this.orderedSelectedValues(selected), "input");
  }

  public toggleOption(value: string): void {
    this.toggleValue(value);
  }

  public isSelected(value: string): boolean {
    return this.selectedValues.includes(value);
  }

  public optionTokenStyle(option: VioletDataGridEditorOption): string {
    const visuals = resolveOptionVisuals(option);
    return `background:${visuals.background};color:${visuals.foreground};border-color:${visuals.borderColor};`;
  }

  public optionTokenText(option: VioletDataGridEditorOption): string {
    const words = option.label.trim().split(/\s+/u).filter(Boolean);

    if (words.length === 0) {
      return "?";
    }

    if (words.length === 1) {
      return words[0].slice(0, 2);
    }

    return `${words[0][0] ?? ""}${words[1][0] ?? ""}`;
  }

  public pillDotStyleForValue(value: string): string {
    const option = this.options.find((candidate) => candidate.value === value);
    const visuals = resolveOptionVisuals(option ?? { label: value, value });
    return `background:${visuals.background};`;
  }

  private normalizedQuery(): string {
    return this.filterQuery.trim().toLowerCase();
  }

  private syncSelectionFromValue(value: string): void {
    const parsedValues = parseReferencePickerValue(value);
    const nextSelectedValues = this.multiple ? parsedValues : parsedValues.slice(0, 1);

    if (
      nextSelectedValues.length === this.selectedValues.length &&
      nextSelectedValues.every((entry, index) => entry === this.selectedValues[index])
    ) {
      return;
    }

    this.selectedValues = nextSelectedValues;
  }

  private applySelection(nextSelectedValues: string[], eventName: "input" | "change"): void {
    const normalizedValues = normalizeReferencePickerValues(nextSelectedValues);
    this.selectedValues = this.multiple
      ? this.orderedSelectedValues(new Set(normalizedValues))
      : normalizedValues.slice(0, 1);

    this.$emit(eventName, {
      value: this.value,
      selectedValues: [...this.selectedValues],
    } satisfies VioletDataGridReferencePickerSelectionDetail);
  }

  private orderedSelectedValues(selected: Set<string>): string[] {
    const ordered = this.options
      .filter((option) => selected.has(option.value))
      .map((option) => option.value);
    const unknown = [...selected].filter(
      (value) => !this.options.some((option) => option.value === value),
    );
    return [...ordered, ...unknown];
  }

  private close(emitCommitEvent: boolean): void {
    this.#listboxPointerId = null;
    if (!this.open) {
      return;
    }
    this.#focusRevision += 1;
    const nextValue = serializeReferencePickerValue(this.selectedValues);
    const selectionChanged = nextValue !== this.#openSelectionSnapshot;
    this.#pendingOpenFocusTarget = null;
    this.open = false;
    const panel = this.panelElement();
    if (panel?.matches(":popover-open")) {
      panel.hidePopover();
    }
    this.removeViewportListeners();
    this.filterQuery = "";

    if (emitCommitEvent && selectionChanged) {
      this.$emit("change", {
        value: nextValue,
        selectedValues: [...this.selectedValues],
      } satisfies VioletDataGridReferencePickerSelectionDetail);
    }
  }

  private openPanel(focusTarget: "search" | "listbox" | "last"): void {
    if (this.disabled) {
      return;
    }
    this.#focusRevision += 1;
    if (!this.open) {
      this.#openSelectionSnapshot = serializeReferencePickerValue(this.selectedValues);
    }
    this.#pendingOpenFocusTarget = focusTarget;
    this.open = true;
    const root = this.getRootNode();
    this.#scrollRoot = root instanceof ShadowRoot ? root : null;
    this.#scrollRoot?.addEventListener("scroll", this.#handleViewportChange, true);
    this.ownerDocument.defaultView?.addEventListener("scroll", this.#handleViewportChange, true);
    this.ownerDocument.defaultView?.addEventListener("resize", this.#handleViewportChange);
    this.queueOpenFocus();
  }

  private queueOpenFocus(): void {
    const revision = this.#focusRevision;
    const focusTarget = this.#pendingOpenFocusTarget;
    this.#pendingOpenFocusTarget = null;

    if (!focusTarget) {
      return;
    }

    void Updates.next().then(() => {
      if (revision !== this.#focusRevision || !this.open || !this.$fastController.isConnected) {
        return;
      }

      requestAnimationFrame(() => {
        if (revision !== this.#focusRevision || !this.open || !this.$fastController.isConnected) {
          return;
        }

        const panel = this.panelElement();
        if (panel && !panel.matches(":popover-open")) {
          panel.showPopover();
        }
        this.positionPanel();

        if (focusTarget !== "search" && this.filteredOptions.length > 0) {
          this.focusListboxControl(focusTarget === "last");
          return;
        }

        this.focusSearch(true);
      });
    });
  }

  private focusTrigger(): void {
    this.triggerElement()?.focus();
  }

  private removeViewportListeners(): void {
    this.#scrollRoot?.removeEventListener("scroll", this.#handleViewportChange, true);
    this.#scrollRoot = null;
    this.ownerDocument.defaultView?.removeEventListener("scroll", this.#handleViewportChange, true);
    this.ownerDocument.defaultView?.removeEventListener("resize", this.#handleViewportChange);
  }

  private panelElement(): HTMLElement | null {
    return this.shadowRoot?.querySelector<HTMLElement>(".panel") ?? null;
  }

  private positionPanel(): void {
    const panel = this.panelElement();
    const trigger = this.triggerElement();
    const viewport = this.ownerDocument.defaultView;
    if (!this.open || !panel?.matches(":popover-open") || !trigger || !viewport) {
      return;
    }
    const bounds = trigger.getBoundingClientRect();
    const padding = 8;
    const gap = 6;
    panel.style.inlineSize = `${Math.min(Math.max(bounds.width, 288), viewport.innerWidth - padding * 2)}px`;
    const size = panel.getBoundingClientRect();
    const left = Math.max(
      padding,
      Math.min(bounds.left, viewport.innerWidth - size.width - padding),
    );
    const below = bounds.bottom + gap;
    const top =
      below + size.height <= viewport.innerHeight - padding
        ? below
        : bounds.top - size.height - gap;
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.max(padding, Math.min(top, viewport.innerHeight - size.height - padding))}px`;
  }

  private focusSearch(selectText = false): void {
    const search = this.searchElement();
    search?.focus();
    if (selectText) {
      search?.select();
    }
  }

  private focusListboxControl(last = false): void {
    const listbox = this.listboxElement();
    const control = listbox?.shadowRoot?.querySelector<HTMLElement>('[role="listbox"]');
    if (listbox && this.filteredOptions.length > 0) {
      listbox.activeValue =
        (last ? this.filteredOptions.at(-1) : this.filteredOptions[0])?.value ?? "";
    }
    control?.focus();
  }

  private focusCreateAction(): void {
    const action = this.createActionElement();
    action?.focus();
  }

  private triggerElement(): HTMLButtonElement | null {
    return this.shadowRoot?.querySelector(".trigger") as HTMLButtonElement | null;
  }

  private searchElement(): HTMLInputElement | null {
    return this.shadowRoot?.querySelector(".search") as HTMLInputElement | null;
  }

  private listboxElement(): VioletListbox | null {
    return this.shadowRoot?.querySelector<VioletListbox>("violet-listbox") ?? null;
  }

  private createActionElement(): HTMLButtonElement | null {
    return this.shadowRoot?.querySelector(".create-action") as HTMLButtonElement | null;
  }
}

attr(VioletDataGridReferencePicker.prototype, "placeholder");
attr({ mode: "boolean" })(VioletDataGridReferencePicker.prototype, "disabled");
attr({ mode: "boolean" })(VioletDataGridReferencePicker.prototype, "multiple");
attr({ mode: "boolean", attribute: "allow-create" })(
  VioletDataGridReferencePicker.prototype,
  "allowCreate",
);
observable(VioletDataGridReferencePicker.prototype, "selectedValues");
observable(VioletDataGridReferencePicker.prototype, "options");
observable(VioletDataGridReferencePicker.prototype, "open");
observable(VioletDataGridReferencePicker.prototype, "filterQuery");

if (!customElements.get("violet-data-grid-reference-picker")) {
  await FASTElement.define(VioletDataGridReferencePicker, {
    name: "violet-data-grid-reference-picker",
    template,
    styles,
    shadowOptions: {
      delegatesFocus: true,
    },
  });
}
