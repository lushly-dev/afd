import {
  attr,
  css,
  FASTElement,
  html,
  observable,
  type PartialFASTElementDefinition,
  Updates,
  when,
} from "@lushly-dev/fast-element";
import { installFormDisabled } from "../foundations/violet-form-disabled";
import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        display: inline-grid;

        --_selection-background: var(--violet-color-control-selected-background, #c0daeb);
        --_selection-text: var(--violet-color-control-selected-foreground, #1b5f80);
        --_selection-border: var(--violet-color-control-selected-border, rgba(27, 95, 128, 0.5));
        --_surface-card: var(--violet-color-surface-card, #f8f9f3);
        --_border-strong: var(--violet-color-border-strong, #6b7d6e);
        --_radius-sm: var(--violet-radius-inset, 4px);
        --_size-font-md: var(--violet-type-body-size, 14px);
        --_control-size: max(var(--_size-font-md), calc(var(--_target-size) * 0.5));
        --_type-body-line: var(--violet-type-body-line, 20px);
        --_type-caption-line: var(--violet-type-caption-line, 16px);
    }

    :host([inline]) {
        --_target-size: var(--violet-checkbox-inline-target-size, var(--_target-size-compact));
        --_space-inline-sm: var(--violet-checkbox-inline-gap, 4px);
    }

    .root {
        display: inline-grid;
        grid-template-columns: auto 1fr;
        gap: var(--_space-inline-md);
        align-items: start;
        min-block-size: var(--_target-size);
    }

    :host([inline]) .root {
        grid-template-columns: auto;
        gap: 0;
        align-items: center;
        min-block-size: auto;
    }

    /*
     * The native input sits inside its own <label class="control-shell">, while the
     * primary label text sits in a sibling <label for="control">. That gives both the
     * box and the label text native activation without wrapping the supporting slot.
     */
    .input {
        position: absolute;
        inset: 0;
        inline-size: 100%;
        block-size: 100%;
        margin: 0;
        padding: 0;
        appearance: none;
        opacity: 0;
        border: 0;
        cursor: inherit;
    }

    .control-shell {
        position: relative;
        display: inline-grid;
        min-block-size: var(--_target-size);
        align-items: center;
        cursor: pointer;
    }

    :host([inline]) .control-shell {
        min-block-size: auto;
        line-height: 0;
    }

    /* Decorative: it paints over the input, so pointers pass through it to the input (#1424). */
    .box {
        box-sizing: border-box;
        position: relative;
        display: inline-grid;
        pointer-events: none;
        place-items: center;
        inline-size: var(--_control-size);
        block-size: var(--_control-size);
        border: 1px solid var(--_border-strong);
        border-radius: var(--_radius-sm);
        background: var(--_surface-card);
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard);
    }

    .checkmark,
    .mixed-mark {
        display: block;
        grid-area: 1 / 1;
        justify-self: center;
        align-self: center;
        background: var(--_selection-text);
        opacity: 0;
        transition:
            opacity var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .checkmark {
        inline-size: calc(var(--_control-size) * 0.72);
        block-size: calc(var(--_control-size) * 0.72);
        clip-path: polygon(14% 44%, 0 59%, 37% 100%, 100% 16%, 84% 0, 35% 62%);
        transform: scale(0.7);
    }

    .mixed-mark {
        inline-size: calc(var(--_control-size) * 0.56);
        block-size: 2px;
        border-radius: 999px;
        transform: scaleX(0.7);
    }

    .input:checked + .box {
        background: var(--_selection-background);
        border-color: var(--_selection-border);
    }

    .input:checked + .box .checkmark {
        opacity: 1;
        transform: scale(1);
    }

    .input:indeterminate + .box {
        background: var(--_selection-background);
        border-color: var(--_selection-border);
    }

    .input:indeterminate + .box .mixed-mark {
        opacity: 1;
        transform: scaleX(1);
    }

    .root:hover .input:not(:checked):not(:indeterminate):not(:disabled) + .box {
        border-color: var(--_field-border-hover);
    }

    .input:focus-visible + .box {
        box-shadow:
            0 0 0 2px var(--_surface-page),
            0 0 0 4px var(--_focus-ring);
    }

    /* The state colours are for messages; an invalid mark takes the field's 3:1 invalid edge. */
    :host([invalid]) .box {
        border-color: var(--_danger-border);
    }

    :host([disabled]) .control-shell,
    :host(:disabled) .control-shell,
    :host([disabled]) .label,
    :host(:disabled) .label {
        cursor: not-allowed;
    }

    /* Supporting text often says why the control is unavailable, so it stays readable. */
    :host([disabled]) :is(.control-shell, .label),
    :host(:disabled) :is(.control-shell, .label) {
        opacity: 0.5;
    }

    /*
     * The label sits on the first line beside the mark: its line is centred in the target by
     * the inset, and supporting text runs on below it instead of pushing the label up.
     */
    .content {
        box-sizing: border-box;
        display: grid;
        gap: var(--_space-stack-2xs);
        min-block-size: var(--_target-size);
        padding-block: calc((var(--_target-size) - var(--_type-body-line)) / 2);
        align-content: start;
    }

    .content[hidden] {
        display: none;
    }

    :host([inline]) .content {
        min-block-size: auto;
        padding-block: 0;
        align-content: center;
    }

    .label {
        color: var(--violet-color-text-primary, #181b1a);
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        overflow-wrap: break-word;
        cursor: pointer;
    }

    .supporting {
        color: var(--_text-muted);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
        overflow-wrap: break-word;
    }

    .supporting[hidden] {
        display: none;
    }

    .error {
        color: var(--_danger-text);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
        overflow-wrap: break-word;
    }

    @media (forced-colors: active) {
        .box,
        .root:hover .input:not(:checked):not(:indeterminate):not(:disabled) + .box {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            box-shadow: none;
        }

        .checkmark,
        .mixed-mark {
            forced-color-adjust: none;
            background: HighlightText;
        }

        .input:checked + .box,
        .input:indeterminate + .box {
            border-color: Highlight;
            background: Highlight;
        }

        .input:focus-visible + .box {
            outline: 2px solid Highlight;
            outline-offset: 2px;
            box-shadow: none;
        }

        :host([disabled]) .box,
        :host(:disabled) .box {
            border-color: GrayText;
        }
    }
`;

const template = html<VioletCheckbox>`
    <div class="root" part="root">
        <label class="control-shell">
            <input
                class="input"
                part="input"
                id="control"
                type="checkbox"
                :checked="${(x) => x.checked}"
                name="${(x) => x.name}"
                value="${(x) => x.value}"
                ?disabled="${(x) => x.effectiveDisabled}"
                ?required="${(x) => x.required}"
                aria-label="${(x) => x.explicitAriaLabel}"
                aria-invalid="${(x) => (x.invalid ? "true" : "false")}"
                @change="${(x, c) => x.handleChange(c.event)}"
            />
            <span class="box" part="control" aria-hidden="true">
                <span class="checkmark" part="mark checkmark"></span>
                <span class="mixed-mark" part="mark mixed-mark"></span>
            </span>
        </label>
        <span class="content" ?hidden="${(x) => x.inline && !x.hasLabel && !x.hasSupporting && !x.displayErrorText}">
            <label class="label" part="label" for="control" ?hidden="${(x) => x.inline && !x.hasLabel}">
                <slot @slotchange="${(x) => x.handleDefaultSlotChange()}"></slot>
            </label>
            <span
                class="supporting"
                part="supporting-text"
                id="supporting-text"
                ?hidden="${(x) => !x.hasSupporting || Boolean(x.displayErrorText)}"
            >
                <slot name="supporting" @slotchange="${(x) => x.handleSupportingSlotChange()}"></slot>
            </span>
            ${when(
              (x) => Boolean(x.displayErrorText),
              html<VioletCheckbox>`
                    <span class="error" part="error-message" id="error-message" role="alert">${(x) => x.displayErrorText}</span>
                `,
            )}
        </span>
    </div>
`;

/**
 * Violet reusable checkbox primitive.
 *
 * @summary Token-driven checkbox with label, inline selection mode, indeterminate support, and field errors.
 * @fires change - Emitted when the checked state changes.
 * @slot - Checkbox label content.
 * @slot supporting - Optional supporting copy rendered under the label.
 * @csspart root - Root label wrapper.
 * @csspart input - Native checkbox input.
 * @csspart control - Visible checkbox control box.
 * @csspart mark - Checkmark glyph inside the control.
 * @csspart label - Primary label text wrapper.
 * @csspart supporting-text - Optional supporting text wrapper.
 * @csspart error-message - Error message element shown while invalid.
 */
export class VioletCheckbox extends FASTElement {
  public static readonly formAssociated = true;

  readonly #internals: ElementInternals;
  readonly #hostAriaObserver = new MutationObserver(() => this.#syncControlState());
  // A described-by target can appear after the host connects without the attribute changing, so focus re-links it.
  readonly #handleFocusIn = (): void => this.#syncDescribedBy();
  #defaultChecked: boolean;
  #defaultIndeterminate: boolean;

  @observable
  declare public hasSupporting: boolean;

  @observable
  declare public hasLabel: boolean;

  /**
   * Backing state for `displayErrorText`.
   */
  @observable
  private _displayErrorText = "";

  /**
   * Active error message rendered while the checkbox is invalid.
   */
  public get displayErrorText(): string {
    return this._displayErrorText;
  }

  /**
   * Checked state for the checkbox.
   */
  declare public checked: boolean;

  /**
   * Mixed selection state for aggregate checkboxes.
   */
  declare public indeterminate: boolean;

  /**
   * Disables the checkbox.
   */
  declare public disabled: boolean;

  /**
   * True while an ancestor `<fieldset disabled>` disables the control.
   */
  declare public fieldsetDisabled: boolean;

  /**
   * Author `disabled` or fieldset-disabled.
   */
  declare public readonly effectiveDisabled: boolean;

  /**
   * Presents a compact inline layout that can collapse to the control only.
   */
  declare public inline: boolean;

  /**
   * Marks the checkbox as invalid.
   */
  declare public invalid: boolean;

  /**
   * Optional error message shown while the checkbox is invalid.
   */
  declare public errorText: string;

  /**
   * Native form name used during submission.
   */
  declare public name: string;

  /**
   * Native submitted value when checked.
   */
  declare public value: string;

  /**
   * Marks the checkbox as required.
   */
  declare public required: boolean;

  public constructor() {
    super();
    this.#internals = this.attachInternals();
    this.hasSupporting = false;
    this.hasLabel = false;
    this.checked = false;
    this.indeterminate = false;
    this.disabled = false;
    this.inline = false;
    this.invalid = false;
    this.errorText = "";
    this.name = "";
    this.value = "on";
    this.required = false;
    this.#defaultChecked = false;
    this.#defaultIndeterminate = false;
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this.#defaultChecked = this.hasAttribute("checked")
      ? this.getAttribute("checked") !== "false"
      : this.checked;
    this.#defaultIndeterminate = this.hasAttribute("indeterminate")
      ? this.getAttribute("indeterminate") !== "false"
      : this.indeterminate;
    this.#syncLabelState();
    this.#syncSupportingState();
    this.#syncControlState();
    this.#syncFormState();
    this.#hostAriaObserver.observe(this, {
      attributes: true,
      attributeFilter: ["aria-describedby", "aria-label"],
    });
    this.addEventListener("focusin", this.#handleFocusIn);
    // Targets rendered in the same update as the checkbox exist once that update has landed.
    Updates.enqueue(() => this.#syncDescribedBy());
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#hostAriaObserver.disconnect();
    this.removeEventListener("focusin", this.#handleFocusIn);
  }

  public handleChange(event: Event): void {
    const control = event.currentTarget as HTMLInputElement | null;
    this.checked = control?.checked ?? false;
    this.indeterminate = false;
    this.$emit("change", { checked: this.checked });
  }

  public handleDefaultSlotChange(): void {
    this.#syncLabelState();
  }

  public handleSupportingSlotChange(): void {
    this.#syncSupportingState();
    this.#syncDescribedBy();
  }

  public formStateRestoreCallback(state: File | string | FormData | null): void {
    if (state === "checked" || state === "unchecked") {
      this.checked = state === "checked";
    }
  }

  public formResetCallback(): void {
    this.checked = this.#defaultChecked;
    this.indeterminate = this.#defaultIndeterminate;
  }

  public get explicitAriaLabel(): string | null {
    return this.getAttribute("aria-label")?.trim() || null;
  }

  public get controlAriaLabel(): string | null {
    const explicitLabel = this.explicitAriaLabel;
    if (explicitLabel) {
      return explicitLabel;
    }

    const visibleLabel = this.#defaultSlotText();
    return visibleLabel || null;
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

  public checkedChanged(): void {
    this.#syncControlState();
    this.#syncFormState();
  }

  public indeterminateChanged(): void {
    this.#syncControlState();
    this.#syncFormState();
  }

  public disabledChanged(): void {
    this.#syncControlState();
    this.#syncFormState();
  }

  public invalidChanged(): void {
    this.#syncControlState();
    this.#syncFormState();
  }

  public errorTextChanged(): void {
    this.#syncFormState();
  }

  #setDisplayErrorText(next: string): void {
    if (this._displayErrorText === next) {
      return;
    }
    this._displayErrorText = next;
    if (!this.$fastController.isConnected) {
      return;
    }
    Updates.enqueue(() => {
      Updates.enqueue(() => {
        this.#syncDescribedBy();
      });
    });
  }

  public requiredChanged(): void {
    this.#syncControlState();
    this.#syncFormState();
  }

  public valueChanged(): void {
    this.#syncControlState();
    this.#syncFormState();
  }

  public nameChanged(): void {
    this.#syncControlState();
  }

  #syncLabelState(): void {
    this.hasLabel = this.#defaultSlotText().length > 0;
  }

  #syncSupportingState(): void {
    const slot = this.shadowRoot?.querySelector(
      'slot[name="supporting"]',
    ) as HTMLSlotElement | null;
    this.hasSupporting = (slot?.assignedNodes({ flatten: true }) ?? []).some((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return Boolean(node.textContent?.trim());
      }
      return true;
    });
  }

  #defaultSlotText(): string {
    return Array.from(this.childNodes)
      .filter((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return true;
        }

        return !(node as Element).hasAttribute("slot");
      })
      .map((node) => node.textContent ?? "")
      .join(" ")
      .trim();
  }

  #syncControlState(): void {
    if (!this.$fastController.isConnected) {
      return;
    }

    const control = this.shadowRoot?.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    if (!control) {
      return;
    }

    control.checked = this.checked;
    control.indeterminate = this.indeterminate;
    control.disabled = this.effectiveDisabled;
    control.required = this.required;
    control.name = this.name;
    control.value = this.value;
    control.setAttribute("aria-invalid", this.invalid ? "true" : "false");

    const explicitAriaLabel = this.explicitAriaLabel;
    if (explicitAriaLabel) {
      control.setAttribute("aria-label", explicitAriaLabel);
    } else {
      control.removeAttribute("aria-label");
    }

    this.#syncDescribedBy();
  }

  /**
   * Describes the input by the host's `aria-describedby` targets and the active error or slotted
   * supporting text. Host IDREFs cannot cross the shadow boundary, so they are resolved in the
   * host's root node and assigned through element reflection (`ariaDescribedByElements`). Without
   * element reflection only the internal caption is linked, by an IDREF inside the shadow root.
   */
  #syncDescribedBy(): void {
    const control = this.shadowRoot?.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    if (!control) {
      return;
    }

    const targets: Element[] = [];
    const root = this.getRootNode() as Document | ShadowRoot;
    for (const id of (this.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)) {
      const target = root.getElementById?.(id) ?? null;
      if (target && !targets.includes(target)) {
        targets.push(target);
      }
    }

    const error = this.displayErrorText
      ? (this.shadowRoot?.getElementById("error-message") ?? null)
      : null;
    const supporting =
      !error && this.hasSupporting
        ? (this.shadowRoot?.getElementById("supporting-text") ?? null)
        : null;
    const caption = error ?? supporting;
    if (caption) {
      targets.push(caption);
    }

    const hasElementReflection: boolean = "ariaDescribedByElements" in control;
    if (hasElementReflection) {
      control.removeAttribute("aria-describedby");
      control.ariaDescribedByElements = targets.length ? targets : null;
      return;
    }

    if (caption) {
      control.setAttribute("aria-describedby", caption.id);
    } else {
      control.removeAttribute("aria-describedby");
    }
  }

  #syncFormState(): void {
    if (!this.$fastController.isConnected) {
      return;
    }

    const control = this.shadowRoot?.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;

    this.#internals.ariaInvalid = this.invalid ? "true" : "false";
    this.#internals.setFormValue(
      !this.effectiveDisabled && this.checked ? this.value : null,
      this.checked ? "checked" : "unchecked",
    );

    if (this.effectiveDisabled) {
      this.#setDisplayErrorText("");
      this.#internals.setValidity({});
      return;
    }

    if (this.invalid) {
      const customError = (this.errorText ?? "").trim();
      this.#setDisplayErrorText(customError || control?.validationMessage || "");
      this.#internals.setValidity(
        { customError: true },
        customError || "Please correct this field.",
        control ?? undefined,
      );
      return;
    }

    this.#setDisplayErrorText("");

    if (this.required && !this.checked) {
      this.#internals.setValidity(
        { valueMissing: true },
        "Please select this option.",
        control ?? undefined,
      );
      return;
    }

    this.#internals.setValidity({});
  }
}

attr({ mode: "boolean" })(VioletCheckbox.prototype, "checked");
attr({ mode: "boolean" })(VioletCheckbox.prototype, "indeterminate");
attr({ mode: "boolean" })(VioletCheckbox.prototype, "disabled");
installFormDisabled(VioletCheckbox.prototype);
attr({ mode: "boolean" })(VioletCheckbox.prototype, "inline");
attr({ mode: "boolean" })(VioletCheckbox.prototype, "invalid");
attr({ attribute: "error-text" })(VioletCheckbox.prototype, "errorText");
attr(VioletCheckbox.prototype, "name");
attr(VioletCheckbox.prototype, "value");
attr({ mode: "boolean" })(VioletCheckbox.prototype, "required");

/** The FAST definition of `<violet-checkbox>`; `defineVioletCheckbox` in `./violet-checkbox.define` registers it. */
export const violetCheckboxDefinition = {
  name: "violet-checkbox",
  template,
  styles,
  shadowOptions: {
    delegatesFocus: true,
  },
} satisfies PartialFASTElementDefinition;
