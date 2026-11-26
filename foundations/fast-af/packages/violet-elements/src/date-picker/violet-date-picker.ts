import {
  attr,
  css,
  FASTElement,
  html,
  observable,
  type PartialFASTElementDefinition,
  when,
} from "@lushly-dev/fast-element";

import type { VioletCalendar } from "../calendar/violet-calendar";
import { formatDisplayDate, parseIsoDate } from "../date-time/violet-date-utils";
import { installFormDisabled } from "../foundations/violet-form-disabled";
import {
  findEnclosingDialog,
  hideManualPopover,
  isDialogOpen,
  observeEnclosingDialog,
  showManualPopover,
} from "../foundations/violet-popover-layer";
import { resolveFieldErrorText } from "../shared/field-error";
import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";

export type VioletDatePickerSize = "compact" | "natural" | "comfortable";

let violetDatePickerCount = 0;

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        position: relative;
        display: grid;
    }

    :host([size="compact"]) {
        --violet-target-size: var(--_target-size-compact);
        --violet-control-label-size: var(--_type-label-size-compact);
        --violet-control-body-size: var(--_type-body-size-compact);
        --violet-control-caption-size: var(--_type-caption-size-compact);
    }

    :host([size="natural"]) {
        --violet-target-size: var(--_target-size-natural);
        --violet-control-label-size: var(--_type-label-size);
        --violet-control-body-size: var(--_type-body-size);
        --violet-control-caption-size: var(--_type-caption-size);
    }

    :host([size="comfortable"]) {
        --violet-target-size: var(--_target-size-comfortable);
        --violet-control-label-size: var(--_type-label-size);
        --violet-control-body-size: var(--_type-body-size);
        --violet-control-caption-size: var(--_type-caption-size);
    }

    .field {
        display: grid;
        gap: 0;
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin-block-end: var(--_space-field-gap);
    }

    .control-shell {
        position: relative;
        display: grid;
    }

    .control-shell.open {
        z-index: var(--_layer-raised);
    }

    .control-frame {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: var(--_space-inline-sm);
        inline-size: 100%;
        block-size: var(--_target-size);
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

    .input::-webkit-calendar-picker-indicator {
        display: none;
    }

    .toggle {
        display: inline-grid;
        place-items: center;
        inline-size: calc(var(--_target-size) * 0.75);
        block-size: calc(var(--_target-size) * 0.75);
        padding: 0;
        border: 1px solid transparent;
        border-radius: var(--_radius-round, 9999px);
        background: transparent;
        color: inherit;
        cursor: pointer;
    }

    .toggle:hover {
        background: color-mix(in srgb, var(--_focus-ring) 10%, transparent);
    }

    .toggle:focus-visible {
        outline: none;
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 35%, transparent);
    }

    .icon {
        display: inline-grid;
        place-items: center;
    }

    .icon violet-icon {
        --violet-icon-size: max(0.9rem, calc(var(--_target-size) * 0.33));
    }

    .display {
        display: none;
    }

    .panel {
        box-sizing: border-box;
        position: fixed;
        inset: unset;
        margin: 0;
        z-index: var(--_layer-popover);
        inline-size: var(--_panel-inline-size, auto);
        max-inline-size: calc(100vw - 8px);
        padding: 0;
        border: 0;
        overflow: visible;
        background: transparent;
        color: inherit;
        /* The calendar inside is the popup: it takes the floating surface and shadow. */
        --violet-calendar-background: var(--_surface-floating);
        --violet-calendar-shadow: var(--_shadow-floating);
    }

    .panel[hidden] {
        display: none;
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

        .toggle:focus-visible {
            outline: 2px solid Highlight;
            outline-offset: 1px;
        }

        :host([disabled]) .control-frame,
        :host(:disabled) .control-frame {
            border-color: GrayText;
        }
    }
`;

const template = html<VioletDatePicker>`
    <div class="field" part="field" @focusout="${(x, c) => x.handleFocusOut(c.event as FocusEvent)}">
        ${when(
          (x) => Boolean(x.label),
          html<VioletDatePicker>`<label class="label" part="label" for="${(x) => x.inputId}">${(x) => x.label}</label>`,
        )}
        <div class="${(x) => `control-shell${x.open ? " open" : ""}`}" part="control-shell">
            <div class="control-frame" part="control-frame">
                <input
                    id="${(x) => x.inputId}"
                    class="input"
                    part="input"
                    type="date"
                    name="${(x) => x.name}"
                    min="${(x) => x.min}"
                    max="${(x) => x.max}"
                    ?disabled="${(x) => x.effectiveDisabled}"
                    ?required="${(x) => x.required}"
                    aria-describedby="${(x) => x.describedBy || null}"
                    aria-invalid="${(x) => (!x.effectiveDisabled && x.invalid ? "true" : "false")}"
                    @input="${(x, c) => x.handleInput(c.event)}"
                    @change="${(x, c) => x.handleCommit(c.event)}"
                    @keydown="${(x, c) => x.handleInputKeydown(c.event as KeyboardEvent)}"
                />
                <button
                    class="toggle"
                    part="toggle"
                    type="button"
                    ?disabled="${(x) => x.effectiveDisabled}"
                    aria-label="${(x) => (x.value ? "Change date" : "Choose date")}"
                    aria-haspopup="dialog"
                    aria-expanded="${(x) => String(x.open)}"
                    aria-controls="${(x) => x.panelId}"
                    @click="${(x) => x.toggleOpen()}"
                >
                    <span class="icon" aria-hidden="true">
                        <violet-icon icon="system/calendar" decorative></violet-icon>
                    </span>
                </button>
            </div>

            <div
                id="${(x) => x.panelId}"
                class="panel"
                part="panel"
                role="dialog"
                aria-label="${(x) => (x.label ? `${x.label} calendar` : "Choose date")}"
                popover="manual"
                hidden
                @keydown="${(x, c) => x.handlePanelKeydown(c.event as KeyboardEvent)}"
            >
                <violet-calendar
                    selection-mode="single"
                    locale="${(x) => x.locale}"
                    value="${(x) => x.value}"
                    min="${(x) => x.min}"
                    max="${(x) => x.max}"
                    @input="${(x, c) => x.handleCalendarInput(c.event)}"
                    @change="${(x, c) => x.handleCalendarChange(c.event as CustomEvent<{ value?: string }>)}"
                ></violet-calendar>
            </div>
        </div>
        ${when(
          (x) => Boolean(x.supportingText) && !x.displayErrorText,
          html<VioletDatePicker>`<p class="supporting" part="supporting-text" id="${(x) => x.supportingId}">${(x) => x.supportingText}</p>`,
        )}
        ${when(
          (x) => Boolean(x.displayErrorText),
          html<VioletDatePicker>`<p class="error" part="error-message" id="${(x) => x.errorId}" role="alert">${(x) => x.displayErrorText}</p>`,
        )}
    </div>
`;

/**
 * Locale-aware date field with calendar popup selection.
 *
 * @summary Violet date picker composed from the field shell and calendar primitive.
 * @fires input - Emitted when the date value changes while editing or selecting.
 * @fires change - Emitted when the date value is committed.
 * @fires open-change - Emitted when the calendar popup opens or closes.
 * @csspart error-message - Error message element shown while invalid.
 */
export class VioletDatePicker extends FASTElement {
  public static readonly formAssociated = true;

  readonly #internals: ElementInternals;
  #defaultValue = "";
  #stopDialogObserver: (() => void) | null = null;

  readonly #handleViewportChange = () => {
    if (this.open && !this.panelElement?.hidden) {
      this.#positionPanel();
    }
  };

  /**
   * A pointer press began inside the picker and its click has not arrived yet. Pressing a
   * non-focusable part of the panel (the month heading, a weekday, a disabled day) moves focus
   * to the nearest focusable ancestor, such as a scrolling dialog body, which reads as focus
   * leaving the picker; the focus-out close ignores that until the press ends. A touch tap
   * moves focus on its compatibility mousedown, after pointerup, so the press ends at the
   * click (or pointercancel), not at pointerup. A keydown also ends it, so a keyboard exit always
   * closes even when no click follows, and the next pointerdown resets it.
   */
  #pressedInside = false;

  readonly #handleDocumentPointerDown = (event: PointerEvent) => {
    const inside = event.composedPath().includes(this);
    this.#pressedInside = inside;
    if (this.open && !this.panelElement?.hidden && !inside) {
      this.hide();
    }
  };

  readonly #handleDocumentPressEnd = () => {
    this.#pressedInside = false;
  };

  @observable
  declare public open: boolean;

  @observable
  declare public validationMessageText: string;

  declare public label: string;
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
  declare public min: string;
  declare public max: string;
  declare public locale: string;
  declare public size: VioletDatePickerSize;

  public readonly inputId: string;
  public readonly supportingId: string;
  public readonly errorId: string;
  public readonly panelId: string;

  public constructor() {
    super();
    this.#internals = this.attachInternals();
    this.open = false;
    this.validationMessageText = "";
    this.label = "";
    this.supportingText = "";
    this.errorText = "";
    this.value = "";
    this.name = "";
    this.required = false;
    this.disabled = false;
    this.invalid = false;
    this.min = "";
    this.max = "";
    this.locale = "";
    this.size = "natural";

    violetDatePickerCount += 1;
    this.inputId = `violet-date-picker-input-${violetDatePickerCount}`;
    this.supportingId = `violet-date-picker-supporting-${violetDatePickerCount}`;
    this.errorId = `violet-date-picker-error-${violetDatePickerCount}`;
    this.panelId = `violet-date-picker-panel-${violetDatePickerCount}`;
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this.ownerDocument.addEventListener("pointerdown", this.#handleDocumentPointerDown, true);
    this.ownerDocument.addEventListener("click", this.#handleDocumentPressEnd, true);
    this.ownerDocument.addEventListener("pointercancel", this.#handleDocumentPressEnd, true);
    this.ownerDocument.addEventListener("keydown", this.#handleDocumentPressEnd, true);
    window.addEventListener("resize", this.#handleViewportChange);
    window.addEventListener("scroll", this.#handleViewportChange, true);
    this.#syncInputElement();
    this.#defaultValue = this.value;
    this.#syncFormState();
    this.#applyOpenState(false);
  }

  public disconnectedCallback(): void {
    this.#stopDialogObserver?.();
    this.#stopDialogObserver = null;
    this.ownerDocument.removeEventListener("pointerdown", this.#handleDocumentPointerDown, true);
    this.ownerDocument.removeEventListener("click", this.#handleDocumentPressEnd, true);
    this.ownerDocument.removeEventListener("pointercancel", this.#handleDocumentPressEnd, true);
    this.ownerDocument.removeEventListener("keydown", this.#handleDocumentPressEnd, true);
    this.#pressedInside = false;
    window.removeEventListener("resize", this.#handleViewportChange);
    window.removeEventListener("scroll", this.#handleViewportChange, true);
    super.disconnectedCallback();
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

  public get displayValue(): string {
    return this.value ? formatDisplayDate(this.locale, this.value) : "";
  }

  public get describedBy(): string {
    if (this.displayErrorText) {
      return this.errorId;
    }
    return this.supportingText ? this.supportingId : "";
  }

  @observable
  private nativeValidationMessage = "";

  public get displayErrorText(): string {
    return resolveFieldErrorText({
      invalid: this.invalid,
      disabled: this.effectiveDisabled,
      errorText: this.errorText,
      fallbackValidationMessage: this.nativeValidationMessage,
    });
  }

  public valueChanged(): void {
    this.#syncInputElement();
    this.#syncFormState();
  }

  public disabledChanged(): void {
    this.#syncFormState();
  }

  public requiredChanged(): void {
    this.#syncFormState();
  }

  public invalidChanged(): void {
    this.#syncFormState();
  }

  public errorTextChanged(): void {
    this.#syncFormState();
  }

  public minChanged(): void {
    this.#syncFormState();
  }

  public maxChanged(): void {
    this.#syncFormState();
  }

  public openChanged(): void {
    this.#applyOpenState(true);
  }

  /**
   * Shows or hides the panel for `open`. Only a change announces itself and moves focus into the
   * calendar; connecting applies the state quietly.
   */
  #applyOpenState(changed: boolean): void {
    if (!this.$fastController.isConnected) {
      return;
    }

    const panel = this.panelElement;
    if (!panel) {
      return;
    }

    const shell = this.shadowRoot?.querySelector(".control-shell") as HTMLElement | null;
    shell?.classList.toggle("open", this.open);

    this.#stopDialogObserver?.();
    this.#stopDialogObserver = null;

    if (this.open) {
      const enclosingDialog = findEnclosingDialog(this);
      const showAndPosition = (repromote: boolean): void => {
        showManualPopover(panel, repromote);
        this.#positionPanel();
      };

      if (enclosingDialog) {
        this.#stopDialogObserver = observeEnclosingDialog(enclosingDialog, (dialogOpen) => {
          if (!this.open || !this.$fastController.isConnected) {
            return;
          }
          if (dialogOpen) {
            showAndPosition(true);
          } else {
            hideManualPopover(panel);
          }
        });
      }

      if (!enclosingDialog || isDialogOpen(enclosingDialog)) {
        showAndPosition(false);
        if (changed) {
          requestAnimationFrame(() => {
            if (this.open && !this.panelElement?.hidden) {
              (
                this.calendarElement?.shadowRoot?.querySelector(
                  '[tabindex="0"]',
                ) as HTMLElement | null
              )?.focus();
            }
          });
        }
      } else {
        hideManualPopover(panel);
      }
    } else {
      hideManualPopover(panel);
    }

    if (changed) {
      this.$emit("open-change", { open: this.open });
    }
  }

  public handleInput(event: Event): void {
    // The native `input` is composed and would reach the host as a second event; this element emits its own.
    event.stopPropagation();
    const control = event.currentTarget as HTMLInputElement | null;
    this.value = control?.value ?? "";
    this.#syncFormState();
    this.$emit("input", { value: this.value });
  }

  public handleCommit(event: Event): void {
    const control = event.currentTarget as HTMLInputElement | null;
    this.value = control?.value ?? "";
    this.#syncFormState();
    this.$emit("change", { value: this.value });
  }

  public handleInputKeydown(event: KeyboardEvent): boolean {
    if (this.effectiveDisabled) {
      return true;
    }

    if (event.key === "ArrowDown" && event.altKey) {
      event.preventDefault();
      this.show();
      return false;
    }

    if (event.key === "Escape" && this.open) {
      event.preventDefault();
      this.hide();
      return false;
    }

    // Let every other key (typing, ArrowUp/ArrowDown segment editing, Tab, ...) reach the native input.
    return true;
  }

  /**
   * Dismisses the popup when Escape is pressed from anywhere inside the calendar and returns
   * focus to the input. A handled Escape is stopped so it does not also close an ancestor
   * dialog; Escape while closed and every other key are left alone.
   */
  public handlePanelKeydown(event: KeyboardEvent): boolean {
    if (event.key === "Escape" && this.open) {
      event.preventDefault();
      event.stopPropagation();
      this.hide();
      this.inputElement?.focus();
      return false;
    }

    return true;
  }

  /**
   * Closes the popup when focus moves to something outside the picker, such as Tab past its last
   * control, so the open panel never covers the next field. Focus moving between the input, the
   * toggle and the calendar keeps it open, and so does focus leaving the window (no
   * `relatedTarget`) and a press inside the picker that hands focus to a focusable ancestor;
   * a pointer press outside is handled by the document listener.
   */
  public handleFocusOut(event: FocusEvent): boolean {
    const next = event.relatedTarget;
    if (
      this.open &&
      !this.panelElement?.hidden &&
      !this.#pressedInside &&
      next instanceof Node &&
      next !== this &&
      !this.shadowRoot?.contains(next)
    ) {
      this.hide();
    }

    // focusout cannot be cancelled; leave the event alone.
    return true;
  }

  /** The picker emits its own `input`; keep the calendar's composed one from escaping the shadow root. */
  public handleCalendarInput(event: Event): void {
    event.stopPropagation();
  }

  public handleCalendarChange(event: CustomEvent<{ value?: string }>): void {
    event.stopPropagation();
    const nextValue = event.detail?.value ?? "";
    if (!nextValue) {
      return;
    }

    this.value = nextValue;
    this.#syncFormState();
    this.hide();
    this.$emit("input", { value: this.value });
    this.$emit("change", { value: this.value });
    this.inputElement?.focus();
  }

  public show(): void {
    if (this.effectiveDisabled) {
      return;
    }

    this.open = true;
  }

  public hide(): void {
    this.open = false;
  }

  public toggleOpen(): void {
    this.open ? this.hide() : this.show();
  }

  public formStateRestoreCallback(state: File | string | FormData | null): void {
    if (typeof state === "string") {
      this.value = state;
    }
  }

  public formResetCallback(): void {
    this.value = this.#defaultValue;
    // Also when the value is unchanged: an incomplete entry reads as "" and must go too.
    this.#syncInputElement(true);
    this.#syncFormState();
  }

  public checkValidity(): boolean {
    return this.#internals.checkValidity();
  }

  public reportValidity(): boolean {
    return this.#internals.reportValidity();
  }

  private get inputElement(): HTMLInputElement | null {
    return this.shadowRoot?.querySelector(".input") as HTMLInputElement | null;
  }

  private get panelElement(): HTMLElement | null {
    return this.shadowRoot?.querySelector(".panel") as HTMLElement | null;
  }

  private get calendarElement(): VioletCalendar | null {
    return this.shadowRoot?.querySelector("violet-calendar") as VioletCalendar | null;
  }

  // Writes `value` to the native input only when it differs, never through a binding. The input reads `""`
  // while a segment is incomplete, so writing that `""` back erased the segments already entered (#712).
  #syncInputElement(force = false): void {
    const input = this.inputElement;
    if (input && (force || input.value !== this.value)) {
      input.value = this.value;
    }
  }

  #syncFormState(): void {
    if (this.effectiveDisabled) {
      this.nativeValidationMessage = "";
      this.validationMessageText = "";
      this.#internals.setFormValue(null);
      this.#internals.setValidity({});
      return;
    }

    const input = this.inputElement;
    const valueMissing = this.required && !this.value;
    const trimmedError = (this.errorText ?? "").trim();
    const customError = this.invalid ? trimmedError || "Select a valid date." : "";
    const nativeBadInput = this.value ? !parseIsoDate(this.value) : false;

    const parsedValue = this.value && !nativeBadInput;
    const rangeUnderflow = Boolean(parsedValue && parseIsoDate(this.min) && this.value < this.min);
    const rangeOverflow = Boolean(parsedValue && parseIsoDate(this.max) && this.value > this.max);

    const constraintMessage = valueMissing
      ? "Please choose a date."
      : nativeBadInput
        ? "Enter a valid date."
        : rangeUnderflow
          ? `Choose a date on or after ${this.min}.`
          : rangeOverflow
            ? `Choose a date on or before ${this.max}.`
            : "";

    this.nativeValidationMessage = constraintMessage;
    this.validationMessageText = customError || constraintMessage;

    this.#internals.setFormValue(this.value || null);
    this.#internals.setValidity(
      {
        valueMissing,
        customError: Boolean(customError),
        badInput: nativeBadInput,
        rangeUnderflow,
        rangeOverflow,
      },
      this.validationMessageText,
      input ?? undefined,
    );
  }

  #positionPanel(): void {
    const panel = this.panelElement;
    const frame = this.shadowRoot?.querySelector(".control-frame") as HTMLElement | null;
    if (!panel || !frame) {
      return;
    }

    const rect = frame.getBoundingClientRect();
    const inlineSize = Math.max(rect.width, 280);
    panel.style.inlineSize = `${inlineSize}px`;
    panel.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - inlineSize - 4))}px`;
    panel.style.top = `${Math.max(4, Math.min(rect.bottom + 4, window.innerHeight - 320))}px`;
  }
}

attr({ mode: "boolean" })(VioletDatePicker.prototype, "open");
attr(VioletDatePicker.prototype, "label");
attr({ attribute: "supporting-text" })(VioletDatePicker.prototype, "supportingText");
attr({ attribute: "error-text" })(VioletDatePicker.prototype, "errorText");
attr(VioletDatePicker.prototype, "value");
attr(VioletDatePicker.prototype, "name");
attr({ mode: "boolean" })(VioletDatePicker.prototype, "required");
attr({ mode: "boolean" })(VioletDatePicker.prototype, "disabled");
installFormDisabled(VioletDatePicker.prototype);
attr({ mode: "boolean" })(VioletDatePicker.prototype, "invalid");
attr(VioletDatePicker.prototype, "min");
attr(VioletDatePicker.prototype, "max");
attr(VioletDatePicker.prototype, "locale");
attr(VioletDatePicker.prototype, "size");

/** The FAST definition of `<violet-date-picker>`; `defineVioletDatePicker` in `./violet-date-picker.define` registers it. */
export const violetDatePickerDefinition = {
  name: "violet-date-picker",
  template,
  styles,
  shadowOptions: {
    delegatesFocus: true,
  },
} satisfies PartialFASTElementDefinition;
