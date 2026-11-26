import {
  attr,
  css,
  FASTElement,
  html,
  type PartialFASTElementDefinition,
  when,
} from "@lushly-dev/fast-element";
import { installFormDisabled } from "../foundations/violet-form-disabled";
import { resolveFieldErrorText } from "../shared/field-error";
import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";

export type VioletSliderOrientation = "horizontal" | "vertical";

let violetSliderCount = 0;

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        display: grid;

        /* The rail is a well, filled to the value; the thumb is the end of the fill, in its colour. */
        --_selection-fill: var(--violet-color-control-selected-foreground, #1b5f80);
        --_rail-background: color-mix(in srgb, var(--violet-color-text-primary, #181b1a) 10%, transparent);
        --_danger-border: var(--violet-color-state-danger-border, transparent);
        --_radius-full: var(--violet-radius-round, 9999px);
        --_thumb-size: calc(var(--_target-size) * 0.5);
        --_track-size: calc(var(--_target-size) * 0.125);
        --_control-block-size: var(--_target-size);
        --_vertical-track-size: calc(var(--_target-size) * 4);
        --_tick-size: 6px;
        --_tick-color: var(--violet-color-border-strong, #6b7d6e);
        --_slider-percent: 50%;
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
        align-items: center;
        inline-size: 100%;
        min-inline-size: 0;
        block-size: var(--_control-block-size);
        border-radius: var(--_radius-md);
    }

    :host([orientation="vertical"]) .control-shell {
        justify-items: center;
        inline-size: var(--_target-size);
        block-size: var(--_vertical-track-size);
    }

    .input {
        position: absolute;
        inset: 0;
        margin: 0;
        inline-size: 100%;
        block-size: 100%;
        appearance: none;
        -webkit-appearance: none;
        background: transparent;
        border: 0;
        opacity: 0;
        cursor: pointer;
        touch-action: none;
    }

    :host([orientation="vertical"]) .input {
        writing-mode: vertical-lr;
        direction: rtl;
    }

    .visual {
        position: relative;
        display: grid;
        align-items: center;
        inline-size: 100%;
        block-size: 100%;
        pointer-events: none;
    }

    :host([orientation="vertical"]) .visual {
        justify-items: center;
    }

    .rail {
        position: relative;
        inline-size: 100%;
        block-size: var(--_track-size);
        border-radius: var(--_radius-full);
        background: var(--_rail-background);
        overflow: hidden;
    }

    :host([orientation="vertical"]) .rail {
        inline-size: var(--_track-size);
        block-size: 100%;
    }

    .fill {
        position: absolute;
        inset-inline-start: 0;
        inset-block-start: 0;
        inline-size: var(--_slider-percent);
        block-size: 100%;
        border-radius: inherit;
        background: var(--_selection-fill);
    }

    :host([orientation="vertical"]) .fill {
        inset-block-start: auto;
        inset-block-end: 0;
        inline-size: 100%;
        block-size: var(--_slider-percent);
    }

    .ticks {
        display: none;
        position: absolute;
        inset-inline: 0;
        block-size: var(--_tick-size);
        inset-block-start: calc(50% - var(--_track-size) / 2 - var(--_tick-size) - 2px);
        pointer-events: none;
    }

    :host([show-ticks]) .ticks {
        display: block;
    }

    :host([orientation="vertical"]) .ticks {
        inset-block: 0;
        inset-inline: auto;
        inset-inline-start: calc(50% - var(--_track-size) / 2 - var(--_tick-size) - 2px);
        inline-size: var(--_tick-size);
        block-size: auto;
    }

    .thumb {
        position: absolute;
        inset-inline-start: var(--_slider-percent);
        inset-block-start: 50%;
        inline-size: var(--_thumb-size);
        block-size: var(--_thumb-size);
        box-sizing: border-box;
        /* The edge is inside the size and clear; it shows only in forced colours. */
        border: 1px solid transparent;
        border-radius: var(--_radius-full);
        background: var(--_selection-fill);
        box-shadow: var(--_shadow-control);
        transform: translate(-50%, -50%);
        transition:
            transform var(--_duration-base) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard);
    }

    :host([orientation="vertical"]) .thumb {
        inset-inline-start: 50%;
        inset-block-start: auto;
        inset-block-end: var(--_slider-percent);
        transform: translate(-50%, 50%);
    }

    .control-shell:focus-within .thumb {
        box-shadow:
            0 0 0 2px var(--_surface-page),
            0 0 0 4px var(--_focus-ring);
    }

    :host([disabled]) .input,
    :host(:disabled) .input {
        cursor: not-allowed;
    }

    :host([disabled]) .control-shell,
    :host(:disabled) .control-shell {
        cursor: not-allowed;
    }

    :host([disabled]) .visual,
    :host(:disabled) .visual {
        opacity: 0.5;
    }

    :host([disabled]) .rail,
    :host(:disabled) .rail {
        background: color-mix(in srgb, var(--_rail-background) 55%, var(--_surface-page));
    }

    :host([disabled]) .fill,
    :host(:disabled) .fill {
        background: color-mix(in srgb, var(--_selection-fill) 55%, var(--_surface-page));
    }

    :host([disabled]) .thumb,
    :host(:disabled) .thumb {
        box-shadow: none;
    }

    :host([invalid]) .rail {
        outline: 1px solid var(--_danger-border);
        outline-offset: -1px;
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
        .rail {
            forced-color-adjust: none;
            background: ButtonText;
        }

        .fill {
            background: Highlight;
        }

        .thumb {
            background: HighlightText;
            border: 1px solid Highlight;
            box-shadow: none;
        }

        :host([disabled]) .rail,
        :host(:disabled) .rail {
            background: GrayText;
        }

        :host([disabled]) .fill,
        :host(:disabled) .fill {
            background: GrayText;
        }

        :host([disabled]) .thumb,
        :host(:disabled) .thumb {
            border-color: GrayText;
            background: Canvas;
        }
    }
`;

const template = html<VioletSlider>`
    <div class="field" part="field">
        ${when(
          (x) => Boolean(x.label),
          html<VioletSlider>`
                <label class="label" part="label" for="${(x) => x.inputId}">${(x) => x.label}</label>
            `,
        )}
        <div class="control-shell" part="control-shell" style="${(x) => x.controlStyle}">
            <input
                id="${(x) => x.inputId}"
                class="input"
                part="input"
                type="range"
                min="${(x) => x.min}"
                max="${(x) => x.max}"
                step="${(x) => x.step}"
                :value="${(x) => x.value}"
                name="${(x) => x.name}"
                ?disabled="${(x) => x.effectiveDisabled}"
                ?required="${(x) => x.required}"
                aria-label="${(x) => x.label || x.getAttribute("aria-label") || ""}"
                aria-describedby="${(x) => x.describedByIds || null}"
                aria-invalid="${(x) => (!x.effectiveDisabled && x.invalid ? "true" : "false")}"
                aria-orientation="${(x) => x.orientation}"
                aria-valuetext="${(x) => x.valueText || null}"
                @pointerdown="${(x, c) => x.handlePointerDown(c.event as PointerEvent)}"
                @input="${(x, c) => x.handleInput(c.event)}"
                @change="${(x, c) => x.handleCommit(c.event)}"
            />
            <div class="visual" part="visual" aria-hidden="true">
                <div class="ticks" part="ticks" style="${(x) => x.tickStyle}"></div>
                <div class="rail" part="rail">
                    <div class="fill" part="fill"></div>
                </div>
                <div class="thumb" part="thumb"></div>
            </div>
        </div>
        ${when(
          (x) => Boolean(x.supportingText) && !x.displayErrorText,
          html<VioletSlider>`
                <p class="supporting" id="${(x) => x.supportingTextId}" part="supporting-text">${(x) => x.supportingText}</p>
            `,
        )}
        ${when(
          (x) => Boolean(x.displayErrorText),
          html<VioletSlider>`
                <p class="error" id="${(x) => x.errorTextId}" part="error-message" role="alert">${(x) => x.displayErrorText}</p>
            `,
        )}
    </div>
`;

/**
 * Violet reusable slider primitive.
 *
 * @summary Token-driven native-first range input with Violet rail, thumb, label, and supporting/error text.
 * @fires input - Emitted when the slider value changes while dragging or using the keyboard.
 * @fires change - Emitted when the slider value is committed.
 * @csspart field - Field wrapper.
 * @csspart label - Slider label text.
 * @csspart control-shell - Slider control wrapper.
 * @csspart input - Native range input carrying semantics.
 * @csspart visual - Visual wrapper for the custom rail and thumb.
 * @csspart rail - Resting slider rail.
 * @csspart fill - Active filled portion of the rail.
 * @csspart thumb - Slider thumb.
 * @csspart supporting-text - Supporting helper text.
 * @csspart error-message - Visible error text.
 */
export class VioletSlider extends FASTElement {
  public static readonly formAssociated = true;

  readonly #internals: ElementInternals;
  #defaultValue: string;
  #activePointerId: number | null;

  public readonly inputId: string;
  public readonly supportingTextId: string;
  public readonly errorTextId: string;

  declare public label: string;
  declare public supportingText: string;
  declare public errorText: string;
  declare public valueText: string;
  declare public value: string;
  declare public min: string;
  declare public max: string;
  declare public step: string;
  declare public name: string;
  declare public required: boolean;
  declare public orientation: VioletSliderOrientation;
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
  /**
   * Kept so existing markup stays valid; it has no effect. The rail is always filled from the
   * minimum to the value.
   */
  declare public showFill: boolean;
  declare public showTicks: boolean;

  public constructor() {
    super();
    this.#internals = this.attachInternals();
    violetSliderCount += 1;
    this.inputId = `violet-slider-${violetSliderCount}`;
    this.supportingTextId = `${this.inputId}-supporting`;
    this.errorTextId = `${this.inputId}-error`;
    this.#defaultValue = "";
    this.#activePointerId = null;
    this.label = "";
    this.supportingText = "";
    this.errorText = "";
    this.valueText = "";
    this.value = "50";
    this.min = "0";
    this.max = "100";
    this.step = "1";
    this.name = "";
    this.required = false;
    this.orientation = "horizontal";
    this.disabled = false;
    this.invalid = false;
    this.showFill = false;
    this.showTicks = false;
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

  public connectedCallback(): void {
    super.connectedCallback();
    if (this.name && this.getAttribute("name") !== this.name) {
      this.setAttribute("name", this.name);
    }
    this.#defaultValue = this.getAttribute("value") ?? this.value;
    this.#syncHostAttributes();
    this.#syncValue();
    this.#syncFormState();
  }

  public formStateRestoreCallback(state: File | string | FormData | null): void {
    if (typeof state === "string") {
      this.value = state;
    }
  }

  public formResetCallback(): void {
    this.value = this.#defaultValue || this.min || "0";
    this.#syncValue();
    this.#syncFormState();
  }

  public nameChanged(): void {
    if (this.$fastController.isConnected && this.name && this.getAttribute("name") !== this.name) {
      this.setAttribute("name", this.name);
    }
  }

  public valueChanged(): void {
    if (this.$fastController.isConnected) {
      this.#syncValue();
      this.#syncFormState();
    }
  }

  public errorTextChanged(): void {
    if (this.$fastController.isConnected) {
      this.#syncFormState();
    }
  }

  public minChanged(): void {
    if (this.$fastController.isConnected) {
      this.#syncValue();
      this.#syncFormState();
    }
  }

  public maxChanged(): void {
    if (this.$fastController.isConnected) {
      this.#syncValue();
      this.#syncFormState();
    }
  }

  public stepChanged(): void {
    if (this.$fastController.isConnected) {
      this.#syncValue();
    }
  }

  public disabledChanged(): void {
    if (this.$fastController.isConnected) {
      this.#syncHostAttributes();
      this.#syncFormState();
    }
  }

  public invalidChanged(): void {
    if (this.$fastController.isConnected) {
      this.#syncHostAttributes();
      this.#syncFormState();
    }
  }

  public orientationChanged(): void {
    if (this.$fastController.isConnected) {
      this.#syncHostAttributes();
    }
  }

  public get displayErrorText(): string {
    return resolveFieldErrorText({
      invalid: this.invalid,
      disabled: this.effectiveDisabled,
      errorText: this.errorText,
    });
  }

  public get validationMessageText(): string {
    return this.displayErrorText;
  }

  public get describedByIds(): string {
    if (this.displayErrorText) {
      return this.errorTextId;
    }
    return this.supportingText ? this.supportingTextId : "";
  }

  public get controlStyle(): string {
    return `--_slider-percent: ${this.percent};`;
  }

  public get tickStyle(): string {
    const min = this.minAsNumber;
    const max = this.maxAsNumber;
    const step = this.stepAsNumber;
    const range = max - min;

    if (range <= 0 || step <= 0) {
      return "";
    }

    const count = Math.round(range / step);
    if (count < 2 || count > 50) {
      return "";
    }

    const stops: string[] = [];
    for (let i = 0; i <= count; i++) {
      const pct = (i / count) * 100;
      if (i === 0) {
        stops.push(`var(--_tick-color) 0`, `var(--_tick-color) 1px`, `transparent 1px`);
      } else if (i === count) {
        stops.push(
          `transparent calc(100% - 1px)`,
          `var(--_tick-color) calc(100% - 1px)`,
          `var(--_tick-color) 100%`,
        );
      } else {
        stops.push(
          `transparent calc(${pct}% - 0.5px)`,
          `var(--_tick-color) calc(${pct}% - 0.5px)`,
          `var(--_tick-color) calc(${pct}% + 0.5px)`,
          `transparent calc(${pct}% + 0.5px)`,
        );
      }
    }

    const dir = this.orientation === "vertical" ? "to top" : "to right";
    return `background-image: linear-gradient(${dir}, ${stops.join(", ")});`;
  }

  public handleInput(event: Event): void {
    // The native `input` is composed and would reach the host as a second event; this element emits its own.
    event.stopPropagation();
    const input = event.currentTarget as HTMLInputElement | null;
    this.value = input?.value ?? this.value;
    this.$emit("input", { value: this.value });
  }

  public handleCommit(event: Event): void {
    const input = event.currentTarget as HTMLInputElement | null;
    this.value = input?.value ?? this.value;
    this.$emit("change", { value: this.value });
  }

  public handlePointerDown(event: PointerEvent): void {
    if (this.effectiveDisabled || !this.#isPrimaryPointer(event)) {
      return;
    }

    const input = this.#inputControl;
    if (!input) {
      return;
    }

    event.preventDefault();
    this.#activePointerId = event.pointerId;
    input.focus({ preventScroll: true });
    this.#teardownPointerListeners();
    this.ownerDocument.addEventListener("pointermove", this.#handlePointerMove);
    this.ownerDocument.addEventListener("pointerup", this.#handlePointerEnd);
    this.ownerDocument.addEventListener("pointercancel", this.#handlePointerEnd);
    this.#syncPointerValue(event, "input");
  }

  public disconnectedCallback(): void {
    this.#teardownPointerListeners();
    super.disconnectedCallback();
  }

  #syncValue(): void {
    this.value = this.#normalizeValue(this.value);

    const input = this.#inputControl;
    if (input && input.value !== this.value) {
      input.value = this.value;
    }
  }

  #syncFormState(): void {
    if (this.effectiveDisabled) {
      this.#internals.setFormValue(null);
      this.#internals.setValidity({});
      return;
    }

    this.#internals.setFormValue(this.value);

    if (this.invalid) {
      this.#internals.setValidity(
        { customError: true },
        this.displayErrorText || "Please choose a valid value.",
      );
      return;
    }

    this.#internals.setValidity({});
  }

  #syncHostAttributes(): void {
    this.#reflectBooleanAttribute("disabled", this.disabled);
    this.#reflectBooleanAttribute("invalid", this.invalid);

    const nextOrientation = this.orientation === "vertical" ? "vertical" : "horizontal";
    if (this.getAttribute("orientation") !== nextOrientation) {
      this.setAttribute("orientation", nextOrientation);
    }
  }

  #reflectBooleanAttribute(name: string, value: boolean): void {
    if (this.hasAttribute(name) !== value) {
      this.toggleAttribute(name, value);
    }
  }

  #normalizeValue(rawValue: string): string {
    const min = this.minAsNumber;
    const max = this.maxAsNumber;
    const step = this.stepAsNumber;
    const parsed = Number.parseFloat(rawValue);
    const fallback = Number.isFinite(parsed) ? parsed : min;
    const clamped = Math.min(max, Math.max(min, fallback));

    if (!Number.isFinite(step) || step <= 0) {
      return String(clamped);
    }

    const stepped = Math.round((clamped - min) / step) * step + min;
    const precision = this.#decimalPlaces(step);
    return String(Number(stepped.toFixed(precision)));
  }

  #decimalPlaces(value: number): number {
    const [, fraction = ""] = String(value).split(".");
    return fraction.length;
  }

  #isPrimaryPointer(event: PointerEvent): boolean {
    return event.pointerType !== "mouse" || event.button === 0;
  }

  get #inputControl(): HTMLInputElement | null {
    return this.shadowRoot?.querySelector(".input") ?? null;
  }

  #syncPointerValue(event: PointerEvent, phase: "input" | "change"): void {
    const input = this.#inputControl;
    if (!input) {
      return;
    }

    const nextValue = this.#valueFromPointer(event, input);
    if (nextValue === null) {
      return;
    }

    if (this.value !== nextValue) {
      this.value = nextValue;
    }

    if (input.value !== this.value) {
      input.value = this.value;
    }

    if (phase === "input") {
      this.$emit("input", { value: this.value });
    } else {
      this.$emit("change", { value: this.value });
    }
  }

  #valueFromPointer(event: PointerEvent, input: HTMLInputElement): string | null {
    const rect = input.getBoundingClientRect();
    const min = this.minAsNumber;
    const max = this.maxAsNumber;

    if (rect.width <= 0 || rect.height <= 0 || max <= min) {
      return null;
    }

    const ratio =
      this.orientation === "vertical"
        ? 1 - (event.clientY - rect.top) / rect.height
        : (event.clientX - rect.left) / rect.width;

    const boundedRatio = Math.min(1, Math.max(0, ratio));
    const rawValue = min + boundedRatio * (max - min);
    return this.#normalizeValue(String(rawValue));
  }

  #handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.#activePointerId) {
      return;
    }

    event.preventDefault();
    this.#syncPointerValue(event, "input");
  };

  #handlePointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.#activePointerId) {
      return;
    }

    event.preventDefault();
    this.#syncPointerValue(event, "change");

    this.#activePointerId = null;
    this.#teardownPointerListeners();
  };

  #teardownPointerListeners(): void {
    this.ownerDocument.removeEventListener("pointermove", this.#handlePointerMove);
    this.ownerDocument.removeEventListener("pointerup", this.#handlePointerEnd);
    this.ownerDocument.removeEventListener("pointercancel", this.#handlePointerEnd);
  }

  get minAsNumber(): number {
    const parsed = Number.parseFloat(this.min);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  get maxAsNumber(): number {
    const parsed = Number.parseFloat(this.max);
    return Number.isFinite(parsed) ? parsed : 100;
  }

  get stepAsNumber(): number {
    const parsed = Number.parseFloat(this.step);
    return Number.isFinite(parsed) ? parsed : 1;
  }

  get valueAsNumber(): number {
    const parsed = Number.parseFloat(this.value);
    return Number.isFinite(parsed) ? parsed : this.minAsNumber;
  }

  get percent(): string {
    const min = this.minAsNumber;
    const max = this.maxAsNumber;

    if (max <= min) {
      return "0%";
    }

    const ratio = (this.valueAsNumber - min) / (max - min);
    const percent = Math.min(1, Math.max(0, ratio)) * 100;
    return `${percent}%`;
  }
}

attr(VioletSlider.prototype, "label");
attr({ attribute: "supporting-text" })(VioletSlider.prototype, "supportingText");
attr({ attribute: "error-text" })(VioletSlider.prototype, "errorText");
attr({ attribute: "value-text" })(VioletSlider.prototype, "valueText");
attr(VioletSlider.prototype, "value");
attr(VioletSlider.prototype, "min");
attr(VioletSlider.prototype, "max");
attr(VioletSlider.prototype, "step");
attr(VioletSlider.prototype, "name");
attr({ mode: "boolean" })(VioletSlider.prototype, "required");
attr(VioletSlider.prototype, "orientation");
attr({ mode: "boolean" })(VioletSlider.prototype, "disabled");
installFormDisabled(VioletSlider.prototype);
attr({ mode: "boolean" })(VioletSlider.prototype, "invalid");
attr({ attribute: "show-fill", mode: "boolean" })(VioletSlider.prototype, "showFill");
attr({ attribute: "show-ticks", mode: "boolean" })(VioletSlider.prototype, "showTicks");

/** The FAST definition of `<violet-slider>`; `defineVioletSlider` in `./violet-slider.define` registers it. */
export const violetSliderDefinition = {
  name: "violet-slider",
  template,
  styles,
  shadowOptions: {
    delegatesFocus: true,
  },
} satisfies PartialFASTElementDefinition;
