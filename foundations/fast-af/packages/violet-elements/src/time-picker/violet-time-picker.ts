import {
  attr,
  css,
  FASTElement,
  html,
  observable,
  type PartialFASTElementDefinition,
  when,
} from "@lushly-dev/fast-element";

import { parseTimeValue } from "../date-time/violet-date-utils";
import { installFormDisabled } from "../foundations/violet-form-disabled";
import { resolveFieldErrorText } from "../shared/field-error";
import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";

export type VioletTimePickerSize = "compact" | "natural" | "comfortable";

let violetTimePickerCount = 0;

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
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

    .control-frame:focus-within {
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
        appearance: none;
        -webkit-appearance: none;
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

    .input::-webkit-calendar-picker-indicator,
    .input::-webkit-clear-button,
    .input::-webkit-inner-spin-button {
        display: none;
        opacity: 0;
        pointer-events: none;
    }

    .input::-webkit-date-and-time-value {
        min-block-size: auto;
        padding: 0;
        text-align: start;
    }

    .icon {
        display: inline-grid;
        place-items: center;
        color: var(--_text-muted);
        pointer-events: none;
    }

    .icon violet-icon {
        --violet-icon-size: max(0.9rem, calc(var(--_target-size) * 0.33));
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

    @media (forced-colors: active) {
        .control-frame {
            border-color: ButtonText;
        }

        .control-frame:focus-within {
            outline: 2px solid Highlight;
            outline-offset: 1px;
        }

        :host([disabled]) .control-frame,
        :host(:disabled) .control-frame {
            border-color: GrayText;
        }
    }
`;

const template = html<VioletTimePicker>`
    <div class="field" part="field">
        ${when(
          (x) => Boolean(x.label),
          html<VioletTimePicker>`<label class="label" part="label" for="${(x) => x.inputId}">${(x) => x.label}</label>`,
        )}
        <div class="control-frame" part="control-frame">
            <input
                id="${(x) => x.inputId}"
                class="input"
                part="input"
                type="time"
                name="${(x) => x.name}"
                min="${(x) => x.min}"
                max="${(x) => x.max}"
                step="${(x) => x.stepValue}"
                ?disabled="${(x) => x.effectiveDisabled}"
                ?required="${(x) => x.required}"
                aria-describedby="${(x) => x.describedBy || null}"
                aria-invalid="${(x) => (!x.effectiveDisabled && x.invalid ? "true" : "false")}"
                @input="${(x, c) => x.handleInput(c.event)}"
                @change="${(x, c) => x.handleCommit(c.event)}"
            />
            <span class="icon" aria-hidden="true">
                <violet-icon icon="system/clock" decorative></violet-icon>
            </span>
        </div>
        ${when(
          (x) => Boolean(x.supportingText) && !x.displayErrorText,
          html<VioletTimePicker>`<p class="supporting" part="supporting-text" id="${(x) => x.supportingId}">${(x) => x.supportingText}</p>`,
        )}
        ${when(
          (x) => Boolean(x.displayErrorText),
          html<VioletTimePicker>`<p class="error" part="error-message" id="${(x) => x.errorId}" role="alert">${(x) => x.displayErrorText}</p>`,
        )}
    </div>
`;

/**
 * Native-backed time field with Violet shell styling.
 *
 * @summary Time picker wrapper around the native time input for form and keyboard parity.
 * @fires input - Emitted when the time value changes while editing.
 * @fires change - Emitted when the time value is committed.
 * @csspart error-message - Error message element shown while invalid.
 */
export class VioletTimePicker extends FASTElement {
  public static readonly formAssociated = true;

  readonly #internals: ElementInternals;
  #defaultValue = "";

  @observable
  declare public validationMessageText: string;

  declare public label: string;
  declare public supportingText: string;
  declare public errorText: string;
  declare public value: string;
  declare public name: string;
  declare public min: string;
  declare public max: string;
  declare public step: string;
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
  declare public size: VioletTimePickerSize;

  public readonly inputId: string;
  public readonly supportingId: string;
  public readonly errorId: string;

  public constructor() {
    super();
    this.#internals = this.attachInternals();
    this.validationMessageText = "";
    this.label = "";
    this.supportingText = "";
    this.errorText = "";
    this.value = "";
    this.name = "";
    this.min = "";
    this.max = "";
    this.step = "60";
    this.required = false;
    this.disabled = false;
    this.invalid = false;
    this.size = "natural";

    violetTimePickerCount += 1;
    this.inputId = `violet-time-picker-input-${violetTimePickerCount}`;
    this.supportingId = `violet-time-picker-supporting-${violetTimePickerCount}`;
    this.errorId = `violet-time-picker-error-${violetTimePickerCount}`;
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this.#syncInputElement();
    this.#defaultValue = this.value;
    this.#syncFormState();
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

  public get stepValue(): string {
    return this.step || "60";
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

  public stepChanged(): void {
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

  public handleInput(event: Event): void {
    // The native `input` is composed and would reach the host as a second event; this element emits its own.
    event.stopPropagation();
    const input = event.currentTarget as HTMLInputElement | null;
    this.value = input?.value ?? "";
    this.#syncFormState();
    this.$emit("input", { value: this.value });
  }

  public handleCommit(event: Event): void {
    const input = event.currentTarget as HTMLInputElement | null;
    this.value = input?.value ?? "";
    this.#syncFormState();
    this.$emit("change", { value: this.value });
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
    return this.shadowRoot?.querySelector('input[type="time"]') as HTMLInputElement | null;
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
    const badInput = this.value ? !parseTimeValue(this.value) : false;
    const trimmedError = (this.errorText ?? "").trim();
    const customError = this.invalid ? trimmedError || "Enter a valid time." : "";

    const toSeconds = (time: string): number | null => {
      const parsed = parseTimeValue(time);
      return parsed ? parsed.hour * 3600 + parsed.minute * 60 + parsed.second : null;
    };
    const current = this.value && !badInput ? toSeconds(this.value) : null;
    const min = toSeconds(this.min);
    const max = toSeconds(this.max);
    const rangeUnderflow = current !== null && min !== null && current < min;
    const rangeOverflow = current !== null && max !== null && current > max;
    const rawStep = this.stepValue ?? "";
    const isAnyStep = rawStep.toLowerCase() === "any";
    const parsedStep =
      !isAnyStep && /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(rawStep)
        ? Number(rawStep)
        : Number.NaN;
    const stepSeconds = isAnyStep
      ? Number.NaN
      : Number.isFinite(parsedStep) && parsedStep > 0
        ? parsedStep
        : 60;
    const stepBase = min ?? 0;
    const delta = current !== null ? current - stepBase : 0;
    const stepMismatch =
      current !== null &&
      Number.isFinite(stepSeconds) &&
      stepSeconds > 0 &&
      Math.abs(delta - Math.round(delta / stepSeconds) * stepSeconds) > 1e-6;

    const constraintMessage = valueMissing
      ? "Please choose a time."
      : badInput
        ? "Enter a valid time."
        : rangeUnderflow
          ? `Choose a time at or after ${this.min}.`
          : rangeOverflow
            ? `Choose a time at or before ${this.max}.`
            : stepMismatch
              ? "Choose a valid time increment."
              : "";

    this.nativeValidationMessage = constraintMessage;
    this.validationMessageText = customError || constraintMessage;

    this.#internals.setFormValue(this.value || null);
    this.#internals.setValidity(
      {
        valueMissing,
        badInput,
        rangeUnderflow,
        rangeOverflow,
        stepMismatch,
        customError: Boolean(customError),
      },
      this.validationMessageText,
      input ?? undefined,
    );
  }
}

attr(VioletTimePicker.prototype, "label");
attr({ attribute: "supporting-text" })(VioletTimePicker.prototype, "supportingText");
attr({ attribute: "error-text" })(VioletTimePicker.prototype, "errorText");
attr(VioletTimePicker.prototype, "value");
attr(VioletTimePicker.prototype, "name");
attr(VioletTimePicker.prototype, "min");
attr(VioletTimePicker.prototype, "max");
attr(VioletTimePicker.prototype, "step");
attr({ mode: "boolean" })(VioletTimePicker.prototype, "required");
attr({ mode: "boolean" })(VioletTimePicker.prototype, "disabled");
installFormDisabled(VioletTimePicker.prototype);
attr({ mode: "boolean" })(VioletTimePicker.prototype, "invalid");
attr(VioletTimePicker.prototype, "size");

/** The FAST definition of `<violet-time-picker>`; `defineVioletTimePicker` in `./violet-time-picker.define` registers it. */
export const violetTimePickerDefinition = {
  name: "violet-time-picker",
  template,
  styles,
  shadowOptions: {
    delegatesFocus: true,
  },
} satisfies PartialFASTElementDefinition;
