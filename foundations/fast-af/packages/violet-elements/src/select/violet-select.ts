import {
  attr,
  css,
  FASTElement,
  type FASTElementExtension,
  html,
  Observable,
  observable,
  type PartialFASTElementDefinition,
  when,
} from "@lushly-dev/fast-element";
import { installFormDisabled } from "../foundations/violet-form-disabled";
import {
  findOriginatingOption,
  findTypeaheadMatch,
  getEnabledOptions,
  getNextEnabledIndex,
  getOwnedOptions,
  getSelectedOption,
  isOptionDisabled,
  observeAttribute,
  reflectStringAttribute,
  resolveActiveOption,
  syncOptionSelection,
} from "../listbox/violet-selection-helpers";
import type { VioletOption } from "../option/violet-option";
import { resolveFieldErrorText } from "../shared/field-error";
import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";

let violetSelectCount = 0;

function isComposingKeyboardEvent(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

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

    .trigger {
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
        cursor: pointer;
        font-family: inherit;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        text-align: start;
        transition:
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard);
    }

    .trigger:hover {
        box-shadow: var(--_field-shadow-hover);
    }

    .trigger:focus-visible,
    .control-shell.open .trigger {
        outline: none;
        border-color: var(--_field-border-focus);
        box-shadow: var(--_field-shadow-focus);
    }

    :host([disabled]) .trigger,
    :host(:disabled) .trigger {
        opacity: 0.5;
        cursor: not-allowed;
    }

    :host([invalid]) .trigger {
        border-color: var(--_danger-border);
    }

    .value {
        flex: 1 1 auto;
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .value[data-placeholder="true"] {
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
        outline: none;
    }

    .listbox:focus-visible {
        outline: none;
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
        .trigger,
        .trigger:hover,
        .panel {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: ButtonText;
            box-shadow: none;
        }

        .trigger:focus-visible,
        .control-shell.open .trigger {
            box-shadow: 0 0 0 2px Highlight;
            border-color: Highlight;
        }
    }
`;

const template = html<VioletSelect>`
    <div class="field" part="field">
        ${when(
          (x) => Boolean(x.label),
          html<VioletSelect>`
                <div class="label" part="label" id="${(x) => x.labelId}">${(x) => x.label}</div>
            `,
        )}
        <div
            class="control-shell"
            part="control-shell"
            @focusout="${(x, c) => x.handleControlFocusOut(c.event as FocusEvent)}"
        >
            <button
                id="${(x) => x.triggerId}"
                class="trigger"
                part="trigger"
                type="button"
                ?disabled="${(x) => x.effectiveDisabled}"
                aria-haspopup="listbox"
                aria-expanded="false"
                aria-controls="${(x) => x.listboxId}"
                aria-labelledby="${(x) => (x.label ? `${x.labelId} ${x.valueId}` : x.valueId)}"
                aria-describedby="${(x) => x.describedBy || null}"
                aria-invalid="${(x) => (!x.effectiveDisabled && x.invalid ? "true" : "false")}"
                @click="${(x) => x.handleTriggerClick()}"
                @keydown="${(x, c) => x.handleTriggerKeydown(c.event as KeyboardEvent)}"
            >
                <span id="${(x) => x.valueId}" class="value" data-placeholder="${(x) => String(!x.selectedLabel && !x.value)}">
                    ${(x) => x.selectedLabel || x.value || x.placeholder || "Select an option"}
                </span>
                <span class="caret" part="caret" aria-hidden="true"></span>
            </button>

            <div class="panel" part="panel" popover="manual" hidden>
                <div
                    id="${(x) => x.listboxId}"
                    class="listbox"
                    part="listbox"
                    role="listbox"
                    tabindex="-1"
                    aria-labelledby="${(x) => (x.label ? `${x.labelId} ${x.valueId}` : x.valueId)}"
                    @keydown="${(x, c) => x.handleListboxKeydown(c.event as KeyboardEvent)}"
                >
                    <slot @slotchange="${(x) => x.handleSlotChange()}"></slot>
                </div>
            </div>
        </div>

        ${when(
          (x) => Boolean(x.supportingText) && !x.displayErrorText,
          html<VioletSelect>`
                <p class="supporting" part="supporting-text" id="${(x) => x.supportingId}">${(x) => x.supportingText}</p>
            `,
        )}
        ${when(
          (x) => Boolean(x.displayErrorText),
          html<VioletSelect>`
                <p class="error" part="error-message" id="${(x) => x.errorId}" role="alert">${(x) => x.displayErrorText}</p>
            `,
        )}
    </div>
`;

/**
 * Violet reusable select primitive.
 *
 * @summary Button-triggered popup list for choosing one option; the form receives the chosen option's value.
 * @attr {string} [value=""] - The chosen option's value.
 * @slot - The options: violet-option and violet-option-group elements.
 * @fires input - Emitted when the chosen option changes.
 * @fires change - Emitted when the chosen option changes.
 * @csspart field - Field wrapper.
 * @csspart label - Label text element.
 * @csspart control-shell - Wrapper around the trigger and the popup panel.
 * @csspart trigger - The button that opens the list and shows the chosen option.
 * @csspart caret - Decorative open indicator.
 * @csspart panel - Popup panel.
 * @csspart listbox - The popup list that holds the slotted options.
 * @csspart supporting-text - Supporting text element.
 * @csspart error-message - Error text element.
 */
export class VioletSelect extends FASTElement {
  public static readonly formAssociated = true;

  readonly #internals: ElementInternals;
  #explicitValue: string | null = null;
  #defaultExplicitValue: string | null = null;
  #selectedOption: VioletOption | null = null;
  #activeOption: VioletOption | null = null;
  #reflectingValue = false;
  #syncingActive = false;
  #typeaheadBuffer = "";
  #typeaheadTimer = 0;

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

    this.hide();
  };

  readonly #handleFocusOut = (event: FocusEvent) => {
    this.handleControlFocusOut(event);
  };

  // The slot's slotchange misses options nested in groups and edits to an
  // option's label, so watch the light DOM for both (#499).
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

  declare public label: string;
  declare public placeholder: string;
  declare public supportingText: string;
  declare public errorText: string;
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

  public readonly triggerId: string;
  public readonly labelId: string;
  public readonly valueId: string;
  public readonly listboxId: string;
  public readonly supportingId: string;
  public readonly errorId: string;

  public constructor() {
    super();
    this.#internals = this.attachInternals();
    this.open = false;
    this.validationMessageText = "";
    this.label = "";
    this.placeholder = "";
    this.supportingText = "";
    this.errorText = "";
    this.activeValue = "";
    this.name = "";
    this.required = false;
    this.disabled = false;
    this.invalid = false;

    violetSelectCount += 1;
    this.triggerId = `violet-select-trigger-${violetSelectCount}`;
    this.labelId = `violet-select-label-${violetSelectCount}`;
    this.valueId = `violet-select-value-${violetSelectCount}`;
    this.listboxId = `violet-select-listbox-${violetSelectCount}`;
    this.supportingId = `violet-select-supporting-${violetSelectCount}`;
    this.errorId = `violet-select-error-${violetSelectCount}`;
  }

  public get value(): string {
    Observable.track(this, "value");
    return this.#explicitValue ?? "";
  }

  public set value(next: string) {
    const normalized = next === null || next === undefined ? null : String(next);
    this.#setExplicitValue(normalized, true);
  }

  public override attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (name === "value") {
      if (!this.#reflectingValue) {
        this.#setExplicitValue(newValue, false);
      }
      return;
    }
    super.attributeChangedCallback(name, oldValue, newValue);
  }

  public connectedCallback(): void {
    super.connectedCallback();
    if (this.#explicitValue === null && this.hasAttribute("value")) {
      this.#explicitValue = this.getAttribute("value");
    } else if (this.#explicitValue !== null) {
      this.#reflectValueAttribute(this.#explicitValue);
    }
    if (this.name && this.getAttribute("name") !== this.name) {
      this.setAttribute("name", this.name);
    }
    this.addEventListener("request-select", this.handleRequestSelect as EventListener);
    this.addEventListener("focusout", this.#handleFocusOut);
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
    this.handleSlotChange();
    this.#defaultExplicitValue = this.#explicitValue;
    this.#syncFormState();
    this.openChanged();
  }

  public disconnectedCallback(): void {
    this.#optionsObserver.disconnect();
    this.removeEventListener("request-select", this.handleRequestSelect as EventListener);
    this.removeEventListener("focusout", this.#handleFocusOut);
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

  /**
   * The chosen option's label. It is read from the slotted options, which
   * are not observable, so bindings re-read it when the options change.
   */
  public get selectedLabel(): string {
    Observable.track(this, "selectedLabel");
    return this.#selectedOption?.labelText ?? "";
  }

  public get activeOptionId(): string {
    return this.#activeOption?.optionId ?? "";
  }

  public get describedBy(): string {
    if (this.displayErrorText) {
      return this.errorId;
    }
    return this.supportingText ? this.supportingId : "";
  }

  public get displayErrorText(): string {
    Observable.track(this, "displayErrorText");
    return resolveFieldErrorText({
      invalid: this.invalid,
      disabled: this.effectiveDisabled,
      errorText: this.errorText,
      fallbackValidationMessage:
        this.required && this.#selectedOption === null && !this.value
          ? "Please select an option."
          : "",
    });
  }

  public formStateRestoreCallback(state: File | string | FormData | null): void {
    if (typeof state === "string") {
      this.value = state;
    }
  }

  public formResetCallback(): void {
    this.#selectedOption = null;
    this.options.forEach((option) => {
      option.selected = false;
    });
    this.#setExplicitValue(this.#defaultExplicitValue, true);
    this.handleSlotChange();
  }

  public handleSlotChange(): void {
    const options = this.options;
    const enabled = getEnabledOptions(options);
    let selected: VioletOption | null = null;
    if (
      this.#selectedOption &&
      enabled.includes(this.#selectedOption) &&
      (this.#selectedOption.value === this.#explicitValue ||
        !this.#selectedOption.hasAttribute("value"))
    ) {
      selected = this.#selectedOption;
      if (this.#explicitValue !== selected.value) {
        this.#explicitValue = selected.value;
        this.#reflectValueAttribute(this.#explicitValue);
        Observable.notify(this, "value");
      }
    } else {
      selected = getSelectedOption(options, this.#explicitValue);
      this.#selectedOption = selected;
      if (this.#explicitValue === null && selected) {
        this.#explicitValue = selected.value;
        this.#reflectValueAttribute(this.#explicitValue);
        Observable.notify(this, "value");
      }
    }

    const nextActive = resolveActiveOption(
      enabled,
      this.#activeOption,
      this.activeValue,
      selected ?? enabled[0] ?? null,
    );
    this.#applyActiveOption(nextActive);
    this.#syncFormState();
    Observable.notify(this, "selectedLabel");
  }

  public handleTriggerClick(): void {
    if (this.effectiveDisabled) {
      return;
    }

    this.open ? this.hide() : this.show();
  }

  public handleTriggerKeydown(event: KeyboardEvent): boolean {
    if (isComposingKeyboardEvent(event)) {
      return true;
    }

    if (this.effectiveDisabled) {
      return true;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        this.show();
        this.#moveActive(1);
        return false;
      case "ArrowUp":
        event.preventDefault();
        this.show();
        this.#moveActive(-1);
        return false;
      case "Enter":
      case " ": {
        event.preventDefault();
        this.show();
        return false;
      }
      default:
        if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
          this.#queueTypeahead(event.key);
        }
        return true;
    }
  }

  public handleListboxKeydown(event: KeyboardEvent): boolean {
    if (isComposingKeyboardEvent(event) || !this.open) {
      return true;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        this.#moveActive(1);
        return false;
      case "ArrowUp":
        event.preventDefault();
        this.#moveActive(-1);
        return false;
      case "Home":
        event.preventDefault();
        this.#setActiveOption(getEnabledOptions(this.options)[0] ?? null);
        return false;
      case "End": {
        event.preventDefault();
        const enabled = getEnabledOptions(this.options);
        this.#setActiveOption(enabled.at(-1) ?? null);
        return false;
      }
      case "Enter":
      case " ": {
        const active =
          this.#activeOption && !isOptionDisabled(this.#activeOption) ? this.#activeOption : null;
        if (!active) {
          return true;
        }

        event.preventDefault();
        this.#selectOption(active);
        return false;
      }
      case "Escape":
        event.preventDefault();
        this.hide();
        this.#focusTrigger();
        return false;
      case "Tab":
        return true;
      default:
        if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
          this.#queueTypeahead(event.key);
        }
        return true;
    }
  }

  public handleControlFocusOut(event: FocusEvent): boolean {
    const relatedTarget = event.relatedTarget as Node | null;
    if (
      relatedTarget &&
      (relatedTarget === this ||
        this.shadowRoot?.contains(relatedTarget) ||
        this.contains(relatedTarget))
    ) {
      return true;
    }

    this.hide();
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

  public activeValueChanged(): void {
    if (this.#syncingActive || !this.$fastController.isConnected) {
      return;
    }
    this.#activeOption =
      getEnabledOptions(this.options).find((option) => option.value === this.activeValue) ?? null;
    this.#syncOptions();
  }

  public nameChanged(): void {
    if (this.$fastController.isConnected && this.name && this.getAttribute("name") !== this.name) {
      this.setAttribute("name", this.name);
    }
  }

  public openChanged(): void {
    const shell = this.#controlShell;
    const panel = this.#panel;
    const trigger = this.#trigger;
    const listbox = this.#listbox;

    shell?.classList.toggle("open", this.open);
    panel?.toggleAttribute("hidden", !this.open);
    if (panel?.isConnected && panel.matches(":popover-open") !== this.open) {
      this.open ? panel.showPopover() : panel.hidePopover();
    }
    // Placed as it opens, so nothing reads or paints it at the top layer's origin first.
    if (this.open) {
      this.#positionPanel();
    }
    trigger?.setAttribute("aria-expanded", String(this.open));
    if (trigger) {
      trigger.tabIndex = this.open ? -1 : 0;
    }

    if (!listbox) {
      return;
    }

    listbox.tabIndex = this.open ? 0 : -1;

    if (this.open) {
      requestAnimationFrame(() => {
        this.#positionPanel();
        this.#listbox?.focus();
        this.#scrollActiveIntoView();
      });
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

  public show(): void {
    if (this.effectiveDisabled || this.open) {
      return;
    }

    this.open = true;
    const enabled = getEnabledOptions(this.options);
    const selected =
      this.#selectedOption && enabled.includes(this.#selectedOption) ? this.#selectedOption : null;
    this.#applyActiveOption(selected ?? enabled[0] ?? null);
  }

  public hide(): void {
    this.open = false;
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
    this.#selectedOption = option;
    this.#explicitValue = option.value;
    this.#reflectValueAttribute(this.#explicitValue);
    this.hide();
    this.#applyActiveOption(option);
    this.#syncFormState();
    Observable.notify(this, "value");
    Observable.notify(this, "selectedLabel");
    this.$emit("input", { value: this.value });
    this.$emit("change", { value: this.value });
    this.#focusTrigger();
  }

  #focusTrigger(): void {
    this.#trigger?.focus();
  }

  #moveActive(step: 1 | -1): void {
    const options = this.options;
    const currentIndex = this.#activeOption ? options.indexOf(this.#activeOption) : -1;
    const nextIndex = getNextEnabledIndex(
      options,
      currentIndex < 0 ? (step === 1 ? -1 : 0) : currentIndex,
      step,
    );
    this.#setActiveOption(nextIndex >= 0 ? (options[nextIndex] ?? null) : null);
  }

  #setActiveOption(nextOption: VioletOption | null): void {
    this.#applyActiveOption(nextOption);
    this.#scrollActiveIntoView();
  }

  #applyActiveOption(nextOption: VioletOption | null): void {
    this.#activeOption = nextOption;
    this.#syncOptions();
    this.#syncingActive = true;
    try {
      this.activeValue = nextOption?.value ?? "";
    } finally {
      this.#syncingActive = false;
    }
  }

  #queueTypeahead(key: string): void {
    window.clearTimeout(this.#typeaheadTimer);
    this.#typeaheadBuffer = `${this.#typeaheadBuffer}${key.toLowerCase()}`;
    const match = findTypeaheadMatch(this.options, this.#typeaheadBuffer, this.#activeOption);

    if (match) {
      if (this.open) {
        this.#setActiveOption(match);
      } else {
        this.#selectOption(match);
      }
    }

    this.#typeaheadTimer = window.setTimeout(() => {
      this.#typeaheadBuffer = "";
    }, 500);
  }

  #scrollActiveIntoView(): void {
    this.#activeOption?.shadowRoot
      ?.querySelector('[part="control"]')
      ?.scrollIntoView({ block: "nearest" });
  }

  #positionPanel(): void {
    const panel = this.#panel;
    const trigger = this.#trigger;
    if (!panel || !trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
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

  get #listbox(): HTMLElement | null {
    return this.shadowRoot?.querySelector('[role="listbox"]') ?? null;
  }

  get #trigger(): HTMLButtonElement | null {
    return this.shadowRoot?.querySelector(".trigger") ?? null;
  }

  #setExplicitValue(next: string | null, reflect: boolean): void {
    const previous = this.#explicitValue ?? "";
    this.#explicitValue = next;
    if (reflect) {
      this.#reflectValueAttribute(next);
    }
    if (this.$fastController.isConnected) {
      this.#selectedOption = next === null ? null : getSelectedOption(this.options, next);
      this.#syncOptions();
      this.#syncFormState();
    }
    if (previous !== (next ?? "")) {
      Observable.notify(this, "value");
    }
    Observable.notify(this, "selectedLabel");
  }

  #reflectValueAttribute(next: string | null): void {
    this.#reflectingValue = true;
    try {
      reflectStringAttribute(this, "value", next);
    } finally {
      this.#reflectingValue = false;
    }
  }

  #syncOptions(): void {
    syncOptionSelection(
      this.options,
      this.#selectedOption ? [this.#selectedOption] : [],
      this.#activeOption,
    );
    const listbox = this.#listbox;
    if (listbox) {
      listbox.ariaActiveDescendantElement = this.#activeOption;
    }
  }

  #syncFormState(): void {
    if (!this.$fastController.isConnected) {
      return;
    }

    const control = this.shadowRoot?.querySelector(".trigger") as HTMLButtonElement | null;
    const nextErrorText = this.displayErrorText;
    const message = nextErrorText || (this.errorText ?? "").trim() || "Please select an option.";
    const invalid = !this.effectiveDisabled && this.invalid;
    const formValue = this.effectiveDisabled
      ? null
      : this.#selectedOption
        ? this.#selectedOption.value
        : this.value || null;

    if (this.validationMessageText !== nextErrorText) {
      this.validationMessageText = nextErrorText;
      Observable.notify(this, "displayErrorText");
    }
    this.#internals.ariaInvalid = invalid ? "true" : "false";
    this.#internals.setFormValue(formValue, formValue);

    if (this.effectiveDisabled) {
      this.#internals.setValidity({});
      return;
    }

    if (this.invalid) {
      this.#internals.setValidity({ customError: true }, message, control ?? undefined);
      return;
    }

    if (this.required && this.#selectedOption === null && !this.value) {
      this.#internals.setValidity({ valueMissing: true }, message, control ?? undefined);
      return;
    }

    this.#internals.setValidity({});
  }
}

attr(VioletSelect.prototype, "label");
attr(VioletSelect.prototype, "placeholder");
attr({ attribute: "supporting-text" })(VioletSelect.prototype, "supportingText");
attr({ attribute: "error-text" })(VioletSelect.prototype, "errorText");
attr(VioletSelect.prototype, "name");
attr({ mode: "boolean" })(VioletSelect.prototype, "required");
attr({ mode: "boolean" })(VioletSelect.prototype, "disabled");
installFormDisabled(VioletSelect.prototype);
attr({ mode: "boolean" })(VioletSelect.prototype, "invalid");
attr({ mode: "boolean" })(VioletSelect.prototype, "open");

/** The FAST definition of `<violet-select>`; `defineVioletSelect` in `./violet-select.define` registers it. */
export const violetSelectDefinition = {
  name: "violet-select",
  template,
  styles,
  shadowOptions: {
    delegatesFocus: true,
  },
} satisfies PartialFASTElementDefinition;

/** The FAST extensions `<violet-select>` is defined with. */
export const violetSelectExtensions: FASTElementExtension[] = [observeAttribute("value")];
