import {
  attr,
  css,
  FASTElement,
  html,
  Observable,
  observable,
  type PartialFASTElementDefinition,
  when,
} from "@lushly-dev/fast-element";
import { installFormDisabled } from "../foundations/violet-form-disabled";
import {
  findOriginatingOption,
  getEnabledOptions,
  getNextEnabledIndex,
  getOwnedOptions,
  getSelectedOption,
  isOptionDisabled,
  normalizeMatchText,
  resolveActiveOption,
  syncOptionSelection,
} from "../listbox/violet-selection-helpers";
import type { VioletOption } from "../option/violet-option";
import { resolveFieldErrorText } from "../shared/field-error";
import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";

let violetComboboxCount = 0;

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        position: relative;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
    }

    .field {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
        gap: 0;
    }

    .control-shell {
        position: relative;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
    }

    .control-shell.open {
        z-index: var(--_layer-raised);
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin-block-end: var(--_space-field-gap);
    }

    .control-frame {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: var(--_space-inline-sm);
        inline-size: 100%;
        min-inline-size: 0;
        min-block-size: var(--_target-size);
        padding-inline: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
        border: 1px solid var(--_border-subtle);
        border-radius: var(--_radius-md);
        background: var(--_field-background);
        color: var(--_field-text);
        box-shadow: var(--_field-shadow);
        transition:
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard);
    }

    .control-frame:hover {
        box-shadow: var(--_field-shadow-hover);
    }

    .control-frame:focus-within,
    .control-shell.open .control-frame {
        border-color: var(--_field-border-focus);
        box-shadow: var(--_field-shadow-focus);
    }

    :host([disabled]) .control-frame,
    :host(:disabled) .control-frame {
        opacity: 0.5;
        cursor: not-allowed;
    }

    :host([invalid]) .control-frame {
        border-color: var(--_danger-border);
    }

    .input {
        flex: 1 1 auto;
        min-inline-size: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: var(--_control-body-size);
        line-height: 1;
        outline: none;
    }

    .input::placeholder {
        color: var(--_field-placeholder);
    }

    .caret {
        inline-size: 0.4375rem;
        block-size: 0.4375rem;
        flex: 0 0 auto;
        margin-inline-end: 2px;
        border-inline-end: 1.5px solid currentColor;
        border-block-end: 1.5px solid currentColor;
        color: var(--_text-muted);
        transform: translateY(-1px) rotate(45deg);
        pointer-events: none;
    }

    /*
     * The panel is a manual popover, so it opens in the top layer, which an ancestor's
     * containment, transform or overflow does not reach (#712). The rules below replace the
     * popover's UA defaults (inset: 0, margin: auto).
     */
    .panel {
        box-sizing: border-box;
        position: fixed;
        inset: unset;
        margin: 0;
        z-index: var(--_layer-popover);
        inline-size: var(--_panel-inline-size, auto);
        max-inline-size: calc(100vw - 8px);
        max-block-size: min(18rem, 60vh);
        padding: var(--_space-inline-sm);
        /* The list floats on its surface and shadow. The edge is kept, clear, for forced colours. */
        border: thin solid transparent;
        border-radius: var(--_radius-lg);
        overflow: hidden;
        background: var(--_surface-floating);
        box-shadow: var(--_shadow-floating);
        color: inherit;
    }

    .panel[hidden] {
        display: none;
    }

    .listbox {
        /* The keys are in this list while it is open, so its active row draws its ring at >= 3:1. */
        --_option-active-ring: var(--_focus-ring);
        display: grid;
        gap: 2px;
        max-block-size: inherit;
        overflow: auto;
    }

    .empty {
        padding: var(--_space-inline-sm) var(--_space-inline-md);
        color: var(--_text-muted);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    .supporting,
    .error {
        margin: 0;
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    .supporting {
        color: var(--_text-muted);
        margin-block-start: var(--_space-field-gap);
    }

    .error {
        color: var(--_danger-text);
        margin-block-start: var(--_space-field-gap);
    }

    .control-shell.open ~ .supporting,
    .control-shell.open ~ .error {
        visibility: hidden;
    }

    @media (forced-colors: active) {
        .control-frame {
            border-color: ButtonText;
        }

        .control-frame:focus-within,
        .control-shell.open .control-frame {
            outline: 2px solid Highlight;
            outline-offset: 1px;
        }

        :host([disabled]) .control-frame,
        :host(:disabled) .control-frame {
            border-color: GrayText;
        }
    }
`;

const template = html<VioletCombobox>`
    <div class="field" part="field">
        ${when(
          (x) => Boolean(x.label),
          html<VioletCombobox>`
                <div class="label" part="label" id="${(x) => x.labelId}">${(x) => x.label}</div>
            `,
        )}
        <div class="control-shell" part="control-shell">
            <div class="control-frame" part="control-frame" @click="${(x) => x.handleControlClick()}">
                <input
                    id="${(x) => x.inputId}"
                    class="input"
                    part="input"
                    type="text"
                    name="${(x) => x.name}"
                    placeholder="${(x) => x.placeholder}"
                    :value="${(x) => x.value}"
                    ?disabled="${(x) => x.effectiveDisabled}"
                    ?required="${(x) => x.required}"
                    role="combobox"
                    autocomplete="off"
                    aria-autocomplete="list"
                    aria-expanded="false"
                    aria-controls="${(x) => x.listboxId}"
                    aria-labelledby="${(x) => (x.label ? x.labelId : null)}"
                    aria-describedby="${(x) => x.describedBy || null}"
                    aria-invalid="${(x) => (!x.effectiveDisabled && x.invalid ? "true" : "false")}"
                    @focus="${(x) => x.handleInputFocus()}"
                    @focusout="${(x, c) => x.handleFocusOut(c.event as FocusEvent)}"
                    @input="${(x, c) => x.handleInput(c.event)}"
                    @change="${(x, c) => x.handleCommit(c.event)}"
                    @keydown="${(x, c) => x.handleKeydown(c.event as KeyboardEvent)}"
                />
                <span class="caret" part="caret" aria-hidden="true"></span>
            </div>

            <div class="panel" part="panel" popover="manual" hidden>
                <div
                    id="${(x) => x.listboxId}"
                    class="listbox"
                    part="listbox"
                    role="listbox"
                    aria-label="${(x) => x.label || x.placeholder || "Options"}"
                >
                    <slot @slotchange="${(x) => x.handleSlotChange()}"></slot>
                </div>
                ${when(
                  (x) => x.visibleOptions.length === 0,
                  html<VioletCombobox>`
                        <div class="empty" part="empty-state">No matching options</div>
                    `,
                )}
            </div>
        </div>

        ${when(
          (x) => Boolean(x.supportingText) && !x.displayErrorText,
          html<VioletCombobox>`
                <p class="supporting" part="supporting-text" id="${(x) => x.supportingId}">${(x) => x.supportingText}</p>
            `,
        )}
        ${when(
          (x) => Boolean(x.displayErrorText),
          html<VioletCombobox>`
                <p class="error" part="error-message" id="${(x) => x.errorId}" role="alert">${(x) => x.displayErrorText}</p>
            `,
        )}
    </div>
`;

/**
 * Violet reusable combobox primitive.
 *
 * @summary Editable field that filters a popup list of options as the user types; the form receives the chosen option's value.
 * @slot - The options: violet-option and violet-option-group elements.
 * @fires input - Emitted while the text changes, with the text and the chosen option's value.
 * @fires change - Emitted when an option is chosen or the text is committed.
 * @csspart field - Field wrapper.
 * @csspart label - Label text element.
 * @csspart control-shell - Wrapper around the input frame and the popup panel.
 * @csspart control-frame - Framed wrapper around the input and the caret.
 * @csspart input - Native text input.
 * @csspart caret - Decorative open indicator.
 * @csspart panel - Popup panel.
 * @csspart listbox - The popup list that holds the slotted options.
 * @csspart empty-state - Shown when no option matches the text.
 * @csspart supporting-text - Supporting text element.
 * @csspart error-message - Error text element.
 */
export class VioletCombobox extends FASTElement {
  public static readonly formAssociated = true;

  readonly #internals: ElementInternals;
  #defaultValue: string;
  #defaultSelectedOptionValue: string | null;
  #defaultExplicitEmpty = false;
  #selectedOption: VioletOption | null = null;
  #committedValue: string | null = null;
  #activeOption: VioletOption | null = null;
  #pendingInitialEmptyValue = false;
  #syncingActive = false;
  #syncingSelection = false;

  readonly #handleViewportChange = () => {
    if (this.open) {
      this.#positionPanel();
    }
  };

  readonly #handleDocumentPointerDown = (event: PointerEvent) => {
    if (!this.open) {
      return;
    }

    if (event.composedPath().includes(this)) {
      return;
    }

    this.hide(true);
  };

  // The slot's slotchange misses options nested in groups and edits to an
  // option's label or value, so watch the light DOM for both (#1377).
  // The host's own attributes are left to their change callbacks.
  readonly #optionsObserver = new MutationObserver((records) => {
    if (records.some((record) => record.target !== this)) {
      this.handleSlotChange();
    }
  });

  @observable
  declare public open: boolean;

  @observable
  declare public validationMessageText: string;

  @observable
  declare public activeValue: string;

  @observable
  declare public selectedOptionValue: string;

  declare public label: string;
  declare public placeholder: string;
  declare public supportingText: string;
  declare public errorText: string;
  declare public value: string;
  declare public name: string;
  declare public required: boolean;
  declare public disabled: boolean;

  /**
   * True while an ancestor `<fieldset disabled>` disables the control.
   */
  declare public fieldsetDisabled: boolean;

  /**
   * Author `disabled` or fieldset-disabled.
   */
  declare public readonly effectiveDisabled: boolean;
  declare public invalid: boolean;
  declare public openOnFocus: boolean;

  public readonly inputId: string;
  public readonly labelId: string;
  public readonly listboxId: string;
  public readonly supportingId: string;
  public readonly errorId: string;

  public constructor() {
    super();
    this.#internals = this.attachInternals();
    this.#defaultValue = "";
    this.#defaultSelectedOptionValue = null;
    this.open = false;
    this.validationMessageText = "";
    this.label = "";
    this.placeholder = "";
    this.supportingText = "";
    this.errorText = "";
    this.value = "";
    this.activeValue = "";
    this.selectedOptionValue = "";
    this.name = "";
    this.required = false;
    this.disabled = false;
    this.invalid = false;
    this.openOnFocus = false;

    violetComboboxCount += 1;
    this.inputId = `violet-combobox-input-${violetComboboxCount}`;
    this.labelId = `violet-combobox-label-${violetComboboxCount}`;
    this.listboxId = `violet-combobox-listbox-${violetComboboxCount}`;
    this.supportingId = `violet-combobox-supporting-${violetComboboxCount}`;
    this.errorId = `violet-combobox-error-${violetComboboxCount}`;
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("request-select", this.handleRequestSelect as EventListener);
    this.ownerDocument.addEventListener("pointerdown", this.#handleDocumentPointerDown, true);
    window.addEventListener("resize", this.#handleViewportChange);
    window.addEventListener("scroll", this.#handleViewportChange, true);
    this.#optionsObserver.observe(this, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["value", "label", "disabled"],
    });
    this.#defaultExplicitEmpty = this.hasAttribute("value") && this.getAttribute("value") === "";
    this.#pendingInitialEmptyValue = this.#defaultExplicitEmpty;
    this.handleSlotChange();
    this.#defaultValue = this.getAttribute("value") ?? this.value;
    this.#defaultSelectedOptionValue = this.#selectedOption ? this.#selectedOption.value : null;
    this.#syncFormState();
    this.openChanged();
  }

  public disconnectedCallback(): void {
    this.#optionsObserver.disconnect();
    this.removeEventListener("request-select", this.handleRequestSelect as EventListener);
    this.ownerDocument.removeEventListener("pointerdown", this.#handleDocumentPointerDown, true);
    window.removeEventListener("resize", this.#handleViewportChange);
    window.removeEventListener("scroll", this.#handleViewportChange, true);
    super.disconnectedCallback();
  }

  public get options(): VioletOption[] {
    return getOwnedOptions(this);
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

  public checkValidity(): boolean {
    return this.#internals.checkValidity();
  }

  public reportValidity(): boolean {
    return this.#internals.reportValidity();
  }

  public get visibleOptions(): VioletOption[] {
    Observable.track(this, "visibleOptions");
    const query = normalizeMatchText(this.value.trim());
    if (!query) {
      return this.options;
    }

    return this.options.filter((option) => normalizeMatchText(option.labelText).includes(query));
  }

  public get activeOptionId(): string {
    return this.#activeOption && this.visibleOptions.includes(this.#activeOption)
      ? this.#activeOption.optionId
      : "";
  }

  public get describedBy(): string {
    if (this.displayErrorText) {
      return this.errorId;
    }
    return this.supportingText ? this.supportingId : "";
  }

  public get displayErrorText(): string {
    Observable.track(this, "displayErrorText");
    const missing = this.required && this.#selectedOption === null && !this.value.trim();
    return resolveFieldErrorText({
      invalid: this.invalid,
      disabled: this.effectiveDisabled,
      errorText: this.errorText,
      fallbackValidationMessage: missing ? "Please choose an option." : "",
    });
  }

  public formStateRestoreCallback(state: File | string | FormData | null): void {
    if (typeof state === "string") {
      this.#setSelectedOption(null);
      this.options.forEach((option) => {
        option.selected = false;
      });
      this.#pendingInitialEmptyValue = state === "";
      this.value = state;
      this.handleSlotChange();
    }
  }

  public formResetCallback(): void {
    this.#setSelectedOption(null);
    this.#applyActiveOption(null);
    this.open = false;
    this.options.forEach((option) => {
      option.selected = false;
    });
    if (this.#defaultSelectedOptionValue !== null) {
      const option = getSelectedOption(this.options, this.#defaultSelectedOptionValue);
      this.#pendingInitialEmptyValue = option === null && this.#defaultSelectedOptionValue === "";
      if (option) {
        this.#setSelectedOption(option);
        this.value = option.labelText;
      } else {
        this.value = this.#defaultValue;
      }
    } else if (this.#defaultExplicitEmpty) {
      this.#pendingInitialEmptyValue = true;
      this.value = "";
    } else {
      this.#pendingInitialEmptyValue = false;
      this.value = this.#defaultValue;
    }
    this.handleSlotChange();
  }

  public handleSlotChange(): void {
    const options = this.options;
    // While the panel is open with no active selection, the user is filtering; do not
    // auto-select a newly arrived option or overwrite their filter query.
    const filteringOpen =
      this.open && this.#selectedOption === null && this.#committedValue === null;
    const currentSelected =
      this.#selectedOption &&
      options.includes(this.#selectedOption) &&
      !isOptionDisabled(this.#selectedOption) &&
      (this.#selectedOption.value === this.#committedValue ||
        !this.#selectedOption.hasAttribute("value"))
        ? this.#selectedOption
        : null;
    let selected: VioletOption | null = currentSelected;
    const hadSelection = currentSelected !== null || this.#committedValue !== null;

    if (!selected && this.#committedValue !== null && !filteringOpen) {
      selected = getSelectedOption(options, this.#committedValue);
    }

    if (!selected && !filteringOpen) {
      const lookupValue =
        this.value !== "" ? this.value : this.#pendingInitialEmptyValue ? "" : null;
      selected = getSelectedOption(options, lookupValue);
      if (!selected && normalizeMatchText(this.value) !== "") {
        selected =
          options.find(
            (option) =>
              !isOptionDisabled(option) &&
              normalizeMatchText(option.labelText ?? option.textContent ?? "") ===
                normalizeMatchText(this.value),
          ) ?? null;
      }
    }

    if (selected) {
      this.#pendingInitialEmptyValue = false;
      this.#setSelectedOption(selected);

      if (
        !this.open ||
        hadSelection ||
        !this.value ||
        this.value === selected.value ||
        normalizeMatchText(this.value) === normalizeMatchText(selected.labelText)
      ) {
        this.value = selected.labelText;
      }
    } else if (
      this.#selectedOption !== null ||
      this.#committedValue !== null ||
      (!this.open && !this.value)
    ) {
      this.#setSelectedOption(null);
    }

    const visible = this.visibleOptions;
    const nextActive = resolveActiveOption(
      visible,
      this.#activeOption,
      this.activeValue,
      visible[0] ?? null,
    );
    if (nextActive === this.#activeOption) {
      this.#syncVisibleState();
    } else {
      this.#applyActiveOption(nextActive);
    }

    this.#syncFormState();
    Observable.notify(this, "visibleOptions");
  }

  public handleInputFocus(): void {
    if (!this.effectiveDisabled && this.openOnFocus) {
      this.show();
    }
  }

  public handleControlClick(): boolean {
    if (!this.effectiveDisabled) {
      this.#input?.focus();
      this.show();
    }
    return true;
  }

  public handleFocusOut(event: FocusEvent): boolean {
    const next = event.relatedTarget as Node | null;
    if (this.open && next && !this.contains(next) && !this.shadowRoot?.contains(next)) {
      this.hide(true);
    }
    return true;
  }

  public handleInput(event: Event): void {
    // The native `input` is composed and would reach the host as a second event; this element emits its own.
    event.stopPropagation();
    const control = event.currentTarget as HTMLInputElement | null;
    this.#pendingInitialEmptyValue = false;
    this.value = control?.value ?? "";
    this.open = true;

    const selectedLabel = this.#selectedOption?.labelText ?? "";
    if (
      !this.#selectedOption ||
      normalizeMatchText(selectedLabel) !== normalizeMatchText(this.value)
    ) {
      this.#setSelectedOption(null);
    }

    this.#applyActiveOption(this.visibleOptions[0] ?? null);
    this.#syncFormState();
    this.$emit("input", { value: this.value, selectedValue: this.selectedOptionValue });
  }

  public handleCommit(event: Event): void {
    const control = event.currentTarget as HTMLInputElement | null;
    this.value = control?.value ?? "";
    this.#syncFormState();
    this.$emit("change", { value: this.value, selectedValue: this.selectedOptionValue });
  }

  public handleKeydown(event: KeyboardEvent): boolean {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (event.altKey) {
          this.show();
        } else {
          this.show();
          this.#moveActive(1);
        }
        return false;
      case "ArrowUp":
        event.preventDefault();
        if (event.altKey) {
          if (this.open) {
            this.hide(true);
          }
        } else {
          this.show();
          this.#moveActive(-1);
        }
        return false;
      case "Enter":
        if (
          this.open &&
          this.#activeOption &&
          this.visibleOptions.includes(this.#activeOption) &&
          !isOptionDisabled(this.#activeOption)
        ) {
          event.preventDefault();
          this.#selectOption(this.#activeOption);
          return false;
        }
        break;
      case "Tab":
        // Focus is leaving: close without blocking the native focus move.
        if (this.open) {
          this.hide(true);
        }
        break;
      case "Escape":
        if (this.open) {
          event.preventDefault();
          this.hide(true);
          return false;
        }
        break;
    }

    // Unhandled keys (typing, Tab, ...) must keep their native default action.
    return true;
  }

  public handleRequestSelect(event: CustomEvent<{ value?: string }>): void {
    event.stopPropagation();
    const origin = findOriginatingOption(event, this.options);
    if (origin) {
      this.#selectOption(origin);
      return;
    }
    const nextValue = event.detail?.value ?? "";
    this.selectValue(nextValue);
  }

  public valueChanged(): void {
    if (this.value !== "") {
      this.#pendingInitialEmptyValue = false;
    }
    if (this.$fastController.isConnected) {
      const visible = this.visibleOptions;
      if (this.#activeOption && !visible.includes(this.#activeOption)) {
        this.#applyActiveOption(visible[0] ?? null);
      } else {
        this.#syncVisibleState();
      }
      this.#syncFormState();
    }
    Observable.notify(this, "visibleOptions");
  }

  public activeValueChanged(): void {
    if (this.#syncingActive || !this.$fastController.isConnected) {
      return;
    }
    this.#activeOption =
      this.visibleOptions.find(
        (option) => option.value === this.activeValue && !isOptionDisabled(option),
      ) ?? null;
    this.#syncVisibleState();
  }

  public selectedOptionValueChanged(): void {
    if (this.#syncingSelection) {
      return;
    }
    this.#committedValue = this.selectedOptionValue === "" ? null : this.selectedOptionValue;
    if (this.$fastController.isConnected) {
      this.#selectedOption =
        this.#committedValue === null
          ? null
          : getSelectedOption(this.options, this.#committedValue);
      this.#syncVisibleState();
      this.#syncFormState();
    }
  }

  public requiredChanged(): void {
    this.#syncFormState();
  }

  public disabledChanged(): void {
    this.#syncFormState();
  }

  public invalidChanged(): void {
    this.#syncFormState();
  }

  public errorTextChanged(): void {
    this.#syncFormState();
  }

  public openChanged(): void {
    const shell = this.#controlShell;
    const panel = this.#panel;
    const input = this.#input;

    shell?.classList.toggle("open", this.open);
    panel?.toggleAttribute("hidden", !this.open);
    if (panel?.isConnected && panel.matches(":popover-open") !== this.open) {
      this.open ? panel.showPopover() : panel.hidePopover();
    }
    // Placed as it opens, so nothing reads or paints it at the top layer's origin first.
    if (this.open) {
      this.#positionPanel();
    }
    input?.setAttribute("aria-expanded", String(this.open));

    if (this.open) {
      requestAnimationFrame(() => {
        this.#positionPanel();
      });
    }
  }

  public show(): void {
    if (this.effectiveDisabled) {
      return;
    }

    const wasOpen = this.open;
    this.open = true;
    const visible = this.visibleOptions;
    // Keep the keyboard-driven active option when the panel is already open (repeated ArrowUp/Down).
    const activeStillVisible = this.#activeOption !== null && visible.includes(this.#activeOption);
    if (!wasOpen || !activeStillVisible) {
      const selectedVisible =
        this.#selectedOption !== null && visible.includes(this.#selectedOption)
          ? this.#selectedOption
          : null;
      this.#applyActiveOption(selectedVisible ?? visible[0] ?? null);
    } else {
      this.#syncVisibleState();
    }
  }

  public hide(commitSelection: boolean): void {
    this.open = false;

    if (commitSelection) {
      this.value = this.#selectedOption?.labelText ?? "";
    }

    this.#syncVisibleState();
    this.#syncFormState();
    Observable.notify(this, "visibleOptions");
  }

  public selectValue(nextValue: string): void {
    const option =
      getEnabledOptions(this.options).find((candidate) => candidate.value === nextValue) ?? null;
    if (!option) {
      return;
    }

    this.#selectOption(option);
  }

  #selectOption(option: VioletOption): void {
    this.#pendingInitialEmptyValue = false;
    this.#setSelectedOption(option);
    this.value = option.labelText;
    this.#applyActiveOption(option);
    this.hide(false);
    this.#syncVisibleState();
    this.#syncFormState();
    this.$emit("change", {
      value: this.value,
      selectedValue: option.value,
      label: option.labelText,
    });
  }

  #setSelectedOption(option: VioletOption | null): void {
    this.#selectedOption = option;
    this.#committedValue = option ? option.value : null;
    this.#syncingSelection = true;
    try {
      this.selectedOptionValue = option?.value ?? "";
    } finally {
      this.#syncingSelection = false;
    }
  }

  #applyActiveOption(option: VioletOption | null): void {
    this.#activeOption = option;
    this.#syncVisibleState();
    this.#syncingActive = true;
    try {
      this.activeValue = option?.value ?? "";
    } finally {
      this.#syncingActive = false;
    }
  }

  #moveActive(step: 1 | -1): void {
    const options = this.visibleOptions;
    const currentIndex = this.#activeOption ? options.indexOf(this.#activeOption) : -1;
    const nextIndex = getNextEnabledIndex(
      options,
      currentIndex < 0 ? (step === 1 ? -1 : 0) : currentIndex,
      step,
    );
    this.#applyActiveOption(nextIndex >= 0 ? (options[nextIndex] ?? null) : null);
    this.#scrollActiveIntoView();
  }

  #scrollActiveIntoView(): void {
    this.#activeOption?.shadowRoot
      ?.querySelector('[part="control"]')
      ?.scrollIntoView({ block: "nearest" });
  }

  #syncVisibleState(): void {
    const visible = new Set(this.visibleOptions);

    for (const option of this.options) {
      option.hidden = !visible.has(option);
    }

    const active =
      this.#activeOption && visible.has(this.#activeOption) ? this.#activeOption : null;
    syncOptionSelection(this.options, this.#selectedOption ? [this.#selectedOption] : [], active);
    this.#syncActiveDescendant();
  }

  #syncActiveDescendant(): void {
    const input = this.#input;
    if (!input) {
      return;
    }

    input.ariaActiveDescendantElement =
      this.open && this.#activeOption && this.visibleOptions.includes(this.#activeOption)
        ? this.#activeOption
        : null;
  }

  #positionPanel(): void {
    const panel = this.#panel;
    const frame = this.#controlFrame;
    if (!panel || !frame) {
      return;
    }

    const rect = frame.getBoundingClientRect();
    const viewportPadding = 4;
    const gap = -1;

    let left = rect.left;
    let top = rect.bottom + gap;
    const width = Math.min(rect.width, window.innerWidth - viewportPadding * 2);

    panel.style.width = `${width}px`;
    panel.style.left = `${Math.max(viewportPadding, left)}px`;
    panel.style.top = `${Math.max(viewportPadding, top)}px`;

    requestAnimationFrame(() => {
      const panelRect = panel.getBoundingClientRect();

      if (panelRect.right > window.innerWidth - viewportPadding) {
        left = Math.max(viewportPadding, window.innerWidth - panelRect.width - viewportPadding);
      }

      if (panelRect.bottom > window.innerHeight - viewportPadding) {
        top = Math.max(viewportPadding, rect.top - panelRect.height + 1);
      }

      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    });
  }

  get #controlShell(): HTMLElement | null {
    return this.shadowRoot?.querySelector(".control-shell") ?? null;
  }

  get #panel(): HTMLElement | null {
    return this.shadowRoot?.querySelector(".panel") ?? null;
  }

  get #controlFrame(): HTMLElement | null {
    return this.shadowRoot?.querySelector(".control-frame") ?? null;
  }

  get #input(): HTMLInputElement | null {
    return this.shadowRoot?.querySelector('input[role="combobox"]') ?? null;
  }

  get #submittedValue(): string | null {
    if (this.effectiveDisabled) {
      return null;
    }
    if (this.#selectedOption) {
      return this.#selectedOption.value;
    }
    return this.value || null;
  }

  #syncFormState(): void {
    if (!this.$fastController.isConnected) {
      return;
    }

    const control = this.shadowRoot?.querySelector(
      'input[role="combobox"]',
    ) as HTMLInputElement | null;
    const nextErrorText = this.displayErrorText;
    const message = nextErrorText || (this.errorText ?? "").trim() || "Please choose an option.";
    const submittedValue = this.#submittedValue;
    const invalid = !this.effectiveDisabled && this.invalid;

    if (this.validationMessageText !== nextErrorText) {
      this.validationMessageText = nextErrorText;
      Observable.notify(this, "displayErrorText");
    }
    this.#internals.ariaInvalid = invalid ? "true" : "false";
    this.#internals.setFormValue(submittedValue, submittedValue);

    if (this.effectiveDisabled) {
      this.#internals.setValidity({});
      return;
    }

    if (this.invalid) {
      this.#internals.setValidity({ customError: true }, message, control ?? undefined);
      return;
    }

    if (this.required && this.#selectedOption === null && !this.value.trim()) {
      this.#internals.setValidity({ valueMissing: true }, message, control ?? undefined);
      return;
    }

    this.#internals.setValidity({});
  }
}

attr(VioletCombobox.prototype, "label");
attr(VioletCombobox.prototype, "placeholder");
attr({ attribute: "supporting-text" })(VioletCombobox.prototype, "supportingText");
attr({ attribute: "error-text" })(VioletCombobox.prototype, "errorText");
// fromView: typed text must not be reflected back into the DOM `value` attribute.
attr({ mode: "fromView" })(VioletCombobox.prototype, "value");
attr(VioletCombobox.prototype, "name");
attr({ mode: "boolean" })(VioletCombobox.prototype, "required");
attr({ mode: "boolean" })(VioletCombobox.prototype, "disabled");
installFormDisabled(VioletCombobox.prototype);
attr({ mode: "boolean" })(VioletCombobox.prototype, "invalid");
attr({ mode: "boolean" })(VioletCombobox.prototype, "open");
attr({ attribute: "open-on-focus", mode: "boolean" })(VioletCombobox.prototype, "openOnFocus");

/** The FAST definition of `<violet-combobox>`; `defineVioletCombobox` in `./violet-combobox.define` registers it. */
export const violetComboboxDefinition = {
  name: "violet-combobox",
  template,
  styles,
  shadowOptions: {
    delegatesFocus: true,
  },
} satisfies PartialFASTElementDefinition;
