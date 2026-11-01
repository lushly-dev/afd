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
import "../persona/violet-persona";
import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";
import type { VioletDataGridEditorOption } from "./violet-data-grid";
import {
  displayOptionForValue,
  filterEditorOptions,
} from "./violet-data-grid-editor-option-helpers";
import {
  normalizePersonaPickerValues,
  parsePersonaPickerValue,
  serializePersonaPickerValue,
} from "./violet-data-grid-persona-picker-values";

let violetDataGridPersonaPickerInstanceCount = 0;

const MAX_VISIBLE_PERSONAS = 3;

type VioletDataGridPersonaPickerSelectionDetail = {
  value: string;
  selectedValues: string[];
};

type VioletDataGridPersonaPickerSelectedEntry = {
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
        --_focus-ring: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
        --_radius-md: var(--radius-md, 4px);
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
        line-height: 1;
    }

    .selection[data-empty="true"] {
        background: var(--_surface-subtle);
        border-color: color-mix(in srgb, var(--_border-subtle) 85%, transparent);
        color: var(--_text-secondary);
    }

    .summary {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .persona-stack {
        display: inline-flex;
        align-items: center;
        min-inline-size: 0;
        flex: 0 0 auto;
    }

    .stack-item {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-inline-start: -0.375rem;
        border-radius: 999px;
        background: var(--_surface-page);
    }

    .stack-item:first-child {
        margin-inline-start: 0;
    }

    .stack-overflow {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-inline-size: 1.5rem;
        min-block-size: 1.5rem;
        margin-inline-start: -0.375rem;
        padding-inline: 0.375rem;
        border: 1px solid color-mix(in srgb, var(--_border-subtle) 80%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--_surface-subtle) 88%, white);
        color: var(--_text-secondary);
        font-size: 0.75rem;
        line-height: 1;
    }

    violet-persona.stack-persona,
    violet-persona.option-persona {
        --violet-persona-size: 1.5rem;
        --violet-persona-font-size: 0.625rem;
    }

    violet-persona.option-persona {
        --violet-persona-size: 1.75rem;
        --violet-persona-font-size: 0.75rem;
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
        gap: 0.5rem;
        inline-size: min(20rem, calc(100vw - 16px));
        max-block-size: calc(100vh - 16px);
        overflow: auto;
        min-inline-size: 0;
        padding: 0.5rem;
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
        .search:focus-visible {
            outline: 2px solid Highlight;
        }

        .panel {
            border-color: CanvasText;
        }
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

    .option-check {
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
        font-weight: 700;
        line-height: 1;
    }

    .empty {
        padding: 0.5rem 0.25rem 0.25rem;
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
    }
`;

const template = html<VioletDataGridPersonaPicker>`
    <div class="root" part="base" @keydown="${(x, c) => (x.handlePanelKeydown(c.event as KeyboardEvent), true)}">
        <button
            class="trigger"
            type="button"
            part="trigger"
            ?disabled="${(x) => x.disabled}"
            aria-label="${(x) => x.getAttribute("aria-label") || x.placeholder || "Assign people"}"
            aria-haspopup="dialog"
            aria-controls="${(x) => x.panelId}"
            aria-expanded="${(x) => String(x.open)}"
            @click="${(x) => (x.handleTriggerClick(), true)}"
            @keydown="${(x, c) => (x.handleTriggerKeydown(c.event as KeyboardEvent), true)}"
        >
            <span class="selection" part="selection" data-empty="${(x) => String(x.selectedValues.length === 0)}">
                ${when(
                  (x) => x.selectedValues.length > 0,
                  html<VioletDataGridPersonaPicker>`
                        <span class="persona-stack">
                            ${repeat(
                              (x) => x.visibleSelectedEntries,
                              html<VioletDataGridPersonaPickerSelectedEntry>`
                                    <span class="stack-item">
                                        <violet-persona
                                            class="stack-persona"
                                            decorative
                                            size="xs"
                                            label="${(x) => x.option?.label ?? x.label}"
                                            initials="${(x) => x.option?.initials ?? ""}"
                                            src="${(x) => x.option?.src ?? ""}"
                                        ></violet-persona>
                                    </span>
                                `,
                            )}
                            ${when(
                              (x) => x.overflowCount > 0,
                              html<VioletDataGridPersonaPicker>`
                                    <span class="stack-overflow" part="overflow-pill">+${(x) => x.overflowCount}</span>
                                `,
                            )}
                        </span>
                    `,
                )}
                <span class="summary">${(x) => x.selectionLabel}</span>
                <span class="caret" part="caret" aria-hidden="true"></span>
            </span>
        </button>

        ${when(
          (x) => x.open,
          html<VioletDataGridPersonaPicker>`
                <div
                    class="panel"
                    id="${(x) => x.panelId}"
                    part="panel"
                    popover="manual"
                    role="dialog"
                    aria-label="${(x) => x.getAttribute("aria-label") || x.placeholder || "Assign people"}"
                    @toggle="${(x, c) => (x.handlePanelToggle(c.event as ToggleEvent), true)}"
                >
                    <input
                        class="search"
                        part="search"
                        type="search"
                        placeholder="Find people"
                        aria-label="Find people"
                        :value="${(x) => x.filterQuery}"
                        @input="${(x, c) => (x.handleSearchInput(c.event), true)}"
                        @keydown="${(x, c) => (x.handleSearchKeydown(c.event as KeyboardEvent), true)}"
                    />
                    <div class="selection-summary" part="selection-summary">${(x) => x.selectionSummary}</div>
                    ${when(
                      (x) => x.filteredOptions.length > 0,
                      html<VioletDataGridPersonaPicker>`
                            <violet-listbox
                                class="listbox"
                                part="listbox"
                                ?multiple="${(x) => x.multiple}"
                                ?disabled="${(x) => x.disabled}"
                                aria-label="${(x) => x.getAttribute("aria-label") || x.placeholder || "People"}"
                                :value="${(x) => x.selectedValues[0] ?? ""}"
                                :selectedValues="${(x) => x.selectedValues}"
                                @input="${(x, c) => (x.handleListboxInput(c.event), true)}"
                                @change="${(x, c) => (x.handleListboxChange(c.event), true)}"
                                @keydown="${(x, c) => (x.handleListboxKeydown(c.event as KeyboardEvent), true)}"
                            >
                                ${repeat(
                                  (x) => x.filteredOptions,
                                  html<VioletDataGridEditorOption, VioletDataGridPersonaPicker>`
                                        <violet-option value="${(x) => x.value}" label="${(x) => x.label}">
                                            <violet-persona
                                                slot="before"
                                                class="option-persona"
                                                decorative
                                                size="sm"
                                                label="${(x) => x.label}"
                                                initials="${(x) => x.initials ?? ""}"
                                                src="${(x) => x.src ?? ""}"
                                            ></violet-persona>
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
                                            >Assigned</span>
                                            ${(x) => x.label}
                                        </violet-option>
                                    `,
                                )}
                            </violet-listbox>
                        `,
                    )}
                    ${when(
                      (x) => x.filteredOptions.length === 0,
                      html<VioletDataGridPersonaPicker>`
                            <div class="empty" part="empty-state">No matching people</div>
                        `,
                    )}
                </div>
            `,
        )}
    </div>
`;

/**
 * Compact assignee picker for dense grid cells.
 *
 * @summary Grid-native persona picker with searchable assignees, compact avatar stacks, and deferred commit on close.
 * @fires input - Emitted whenever the pending assignee selection changes while the panel is open.
 * @fires change - Emitted when the current pending assignee selection is committed by closing the picker.
 * @csspart base - Root wrapper for the persona picker.
 * @csspart trigger - Trigger button that opens the option list.
 * @csspart selection - Visible selection surface rendered inside the trigger.
 * @csspart overflow-pill - Overflow count chip when more assignees are selected than can be shown inline.
 * @csspart caret - Caret icon inside the trigger.
 * @csspart panel - Floating option panel.
 * @csspart search - Search input inside the panel.
 * @csspart selection-summary - Compact summary row describing the current assignee count.
 * @csspart listbox - Selection listbox surface inside the panel.
 * @csspart empty-state - Empty message shown when the current filter has no matches.
 */
export class VioletDataGridPersonaPicker extends FASTElement {
  public declare placeholder: string;

  public declare disabled: boolean;

  public declare multiple: boolean;

  public declare selectedValues: string[];

  public declare options: VioletDataGridEditorOption[];

  public declare open: boolean;

  public declare filterQuery: string;

  readonly #instanceId = ++violetDataGridPersonaPickerInstanceCount;
  #openSelectionSnapshot = "[]";
  #pendingOpenFocusTarget: "search" | "listbox" | null = null;
  #openGeneration = 0;
  #focusFrame: number | null = null;
  #listboxPointerId: number | null = null;
  readonly #scrollRoots: (Document | ShadowRoot)[] = [];
  readonly #handleViewportChange = () => this.positionPanel();
  readonly #handleFocusOut = (event: FocusEvent) => {
    const target = event.relatedTarget as Node | null;
    if (target && (target === this || this.shadowRoot?.contains(target))) {
      return;
    }
    // Pointer activation of a nonfocusable option blurs search before its click.
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
  readonly #handleListboxNativeKeydown = (event: KeyboardEvent) => {
    const listbox = this.listboxElement();
    // The current listbox's binding consumes unhandled keys. Keep Tab and IME native.
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
    this.selectedValues = [];
    this.options = [];
    this.open = false;
    this.filterQuery = "";
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("keydown", this.#handleListboxNativeKeydown, true);
    this.addEventListener("focusout", this.#handleFocusOut);
    this.ownerDocument.addEventListener("pointerdown", this.#handleDocumentPointerDown, true);
    this.ownerDocument.addEventListener("pointerup", this.#handlePointerEnd, true);
    this.ownerDocument.addEventListener("pointercancel", this.#handlePointerEnd, true);
  }

  public disconnectedCallback(): void {
    this.ownerDocument.removeEventListener("pointerdown", this.#handleDocumentPointerDown, true);
    this.ownerDocument.removeEventListener("pointerup", this.#handlePointerEnd, true);
    this.ownerDocument.removeEventListener("pointercancel", this.#handlePointerEnd, true);
    this.removeEventListener("keydown", this.#handleListboxNativeKeydown, true);
    this.removeEventListener("focusout", this.#handleFocusOut);
    this.close(false);
    super.disconnectedCallback();
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
    if (this.open) {
      // Contain editor keys without cancelling text editing, Tab, or composition.
      event.stopPropagation();
      if (event.key === "Escape" && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        this.close(true);
        this.focusTrigger();
      }
    }
  }

  public get value(): string {
    return serializePersonaPickerValue(this.selectedValues);
  }

  public set value(nextValue: string) {
    this.syncSelectionFromValue(nextValue);
  }

  public get panelId(): string {
    return `${this.localName}-panel-${this.#instanceId}`;
  }

  public get selectedEntries(): VioletDataGridPersonaPickerSelectedEntry[] {
    return this.selectedValues.map((value) => {
      const option = displayOptionForValue(this.options, value);

      return {
        label: option.label,
        option: option.value === value ? option : null,
        value,
      };
    });
  }

  public get visibleSelectedEntries(): VioletDataGridPersonaPickerSelectedEntry[] {
    return this.selectedEntries.slice(0, MAX_VISIBLE_PERSONAS);
  }

  public get overflowCount(): number {
    return Math.max(0, this.selectedValues.length - MAX_VISIBLE_PERSONAS);
  }

  public get selectionLabel(): string {
    if (this.selectedValues.length === 0) {
      return this.placeholder || "Assign people";
    }

    if (this.selectedValues.length === 1) {
      return this.selectedEntries[0]?.label ?? "1 assignee";
    }

    const lead = this.selectedEntries[0]?.label ?? `${this.selectedValues.length} assignees`;
    return `${lead} +${this.selectedValues.length - 1}`;
  }

  public get selectionSummary(): string {
    if (this.selectedValues.length === 0) {
      return "No assignees";
    }

    return `${this.selectedValues.length} assignee${this.selectedValues.length === 1 ? "" : "s"}`;
  }

  public get filteredOptions(): VioletDataGridEditorOption[] {
    return filterEditorOptions(this.options, this.filterQuery);
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
      this.openPanel("listbox");
    }
  }

  public handleSearchInput(event: Event): void {
    event.stopPropagation();
    const target = event.target as HTMLInputElement | null;
    this.filterQuery = target?.value ?? "";
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

    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      this.focusListboxControl();
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

  private syncSelectionFromValue(value: string): void {
    const parsedValues = parsePersonaPickerValue(value);
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
    const normalizedValues = normalizePersonaPickerValues(nextSelectedValues);
    this.selectedValues = this.multiple
      ? this.orderedSelectedValues(new Set(normalizedValues))
      : normalizedValues.slice(0, 1);

    this.$emit(eventName, {
      value: this.value,
      selectedValues: [...this.selectedValues],
    } satisfies VioletDataGridPersonaPickerSelectionDetail);
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
    this.#openGeneration += 1;
    this.stopPanelTracking();
    const panel = this.panelElement();
    if (panel?.matches(":popover-open")) {
      panel.hidePopover();
    }
    if (!this.open) {
      return;
    }

    const nextValue = serializePersonaPickerValue(this.selectedValues);
    const selectionChanged = nextValue !== this.#openSelectionSnapshot;
    this.#pendingOpenFocusTarget = null;
    this.open = false;
    this.filterQuery = "";

    if (emitCommitEvent && selectionChanged) {
      this.$emit("change", {
        value: nextValue,
        selectedValues: [...this.selectedValues],
      } satisfies VioletDataGridPersonaPickerSelectionDetail);
    }
  }

  private openPanel(focusTarget: "search" | "listbox"): void {
    if (!this.open) {
      this.#openSelectionSnapshot = serializePersonaPickerValue(this.selectedValues);
    }
    this.#pendingOpenFocusTarget = focusTarget;
    this.open = true;
    this.queueOpenFocus();
  }

  private queueOpenFocus(): void {
    const focusTarget = this.#pendingOpenFocusTarget;
    this.#pendingOpenFocusTarget = null;

    if (!focusTarget) {
      return;
    }

    const generation = ++this.#openGeneration;
    void Updates.next().then(() => {
      if (!this.open || !this.$fastController.isConnected || generation !== this.#openGeneration) {
        return;
      }

      const panel = this.panelElement();
      if (!panel) {
        return;
      }
      if (!panel.matches(":popover-open")) {
        panel.showPopover();
      }
      this.startPanelTracking();
      this.positionPanel();
      this.#focusFrame = requestAnimationFrame(() => {
        this.#focusFrame = null;
        if (
          !this.open ||
          !this.$fastController.isConnected ||
          generation !== this.#openGeneration
        ) {
          return;
        }

        if (focusTarget === "listbox" && this.filteredOptions.length > 0) {
          this.focusListboxControl();
          return;
        }

        this.focusSearch(true);
      });
    });
  }

  private focusTrigger(): void {
    this.#focusFrame = requestAnimationFrame(() => {
      this.#focusFrame = null;
      if (this.open || this.disabled || !this.$fastController.isConnected) {
        return;
      }
      this.triggerElement()?.focus();
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
    const trigger = this.triggerElement();
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

  private focusSearch(selectText = false): void {
    const search = this.searchElement();
    search?.focus();
    if (selectText) {
      search?.select();
    }
  }

  private focusListboxControl(): void {
    const listbox = this.listboxElement();
    const control = listbox?.shadowRoot?.querySelector(".control") as HTMLElement | null;
    control?.focus();
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
}

attr(VioletDataGridPersonaPicker.prototype, "placeholder");
attr({ mode: "boolean" })(VioletDataGridPersonaPicker.prototype, "disabled");
attr({ mode: "boolean" })(VioletDataGridPersonaPicker.prototype, "multiple");
observable(VioletDataGridPersonaPicker.prototype, "selectedValues");
observable(VioletDataGridPersonaPicker.prototype, "options");
observable(VioletDataGridPersonaPicker.prototype, "open");
observable(VioletDataGridPersonaPicker.prototype, "filterQuery");

if (!customElements.get("violet-data-grid-persona-picker")) {
  await FASTElement.define(VioletDataGridPersonaPicker, {
    name: "violet-data-grid-persona-picker",
    template,
    styles,
    shadowOptions: {
      delegatesFocus: true,
    },
  });
}
