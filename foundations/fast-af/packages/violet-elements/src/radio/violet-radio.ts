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
import { isDisabledByFieldset } from "../foundations/violet-form-disabled";
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
        --_radius-full: 999px;
        --_size-font-md: var(--violet-type-body-size, 14px);
        --_control-size: max(var(--_size-font-md), calc(var(--_target-size) * 0.5));
        --_dot-size: max(8px, calc(var(--_control-size) * 0.5));
        --_type-body-line: var(--violet-type-body-line, 20px);
        --_type-caption-line: var(--violet-type-caption-line, 16px);
    }

    /* The host takes focus; the ring is drawn on the mark, not round the whole row. */
    :host(:focus-visible) {
        outline: none;
    }

    :host([inline]) {
        --_target-size: var(--violet-radio-inline-target-size, var(--_target-size-compact));
        --_space-inline-sm: var(--violet-radio-inline-gap, 4px);
    }

    .root {
        display: inline-grid;
        grid-template-columns: auto 1fr;
        gap: var(--_space-inline-md);
        align-items: start;
        min-block-size: var(--_target-size);
        cursor: pointer;
    }

    :host([inline]) .root {
        grid-template-columns: auto;
        gap: 0;
        align-items: center;
        min-block-size: auto;
    }

    .control-shell {
        position: relative;
        display: inline-grid;
        min-block-size: var(--_target-size);
        align-items: center;
    }

    :host([inline]) .control-shell {
        min-block-size: auto;
        line-height: 0;
    }

    .control {
        box-sizing: border-box;
        position: relative;
        display: inline-grid;
        place-items: center;
        inline-size: var(--_control-size);
        block-size: var(--_control-size);
        border: 1px solid var(--_border-strong);
        border-radius: var(--_radius-full);
        background: var(--_surface-card);
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard);
    }

    .dot {
        position: absolute;
        inset-inline-start: 50%;
        inset-block-start: 50%;
        inline-size: var(--_dot-size);
        block-size: var(--_dot-size);
        border-radius: var(--_radius-full);
        background: var(--_selection-text);
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.72);
        transform-origin: center;
        transition:
            opacity var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    :host([checked]) .control {
        background: var(--_selection-background);
        border-color: var(--_selection-border);
    }

    :host([checked]) .dot {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
    }

    :host(:not([checked]):not([disabled]):not([aria-disabled="true"])) .root:hover .control {
        border-color: var(--_field-border-hover);
    }

    :host(:focus-visible) .control {
        box-shadow:
            0 0 0 2px var(--_surface-page),
            0 0 0 4px var(--_focus-ring);
    }

    /* The state colours are for messages; an invalid mark takes the field's 3:1 invalid edge. */
    :host([invalid]) .control {
        border-color: var(--_danger-border);
    }

    :host([disabled]) .root,
    :host([aria-disabled="true"]) .root {
        cursor: not-allowed;
    }

    /* Supporting text often says why the control is unavailable, so it stays readable. */
    :host([disabled]) :is(.control-shell, .label),
    :host([aria-disabled="true"]) :is(.control-shell, .label) {
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
        .control,
        :host(:not([checked]):not([disabled]):not([aria-disabled="true"])) .root:hover .control {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            box-shadow: none;
        }

        :host([checked]) .control {
            border-color: Highlight;
        }

        .dot {
            forced-color-adjust: none;
            background: Highlight;
        }

        :host(:focus-visible) .control {
            outline: 2px solid Highlight;
            outline-offset: 2px;
            box-shadow: none;
        }

        :host([disabled]) .control,
        :host([aria-disabled="true"]) .control {
            border-color: GrayText;
        }

        :host([disabled]) .dot,
        :host([aria-disabled="true"]) .dot {
            background: GrayText;
        }
    }
`;

const template = html<VioletRadio>`
    <div class="root" part="root" @click="${(x, c) => x.handleClick(c.event)}">
        <span class="control-shell">
            <span class="control" part="control" aria-hidden="true">
                <span class="dot" part="mark"></span>
            </span>
        </span>
        <span class="content" ?hidden="${(x) => x.inline && !x.hasLabel && !x.hasSupporting && !x.displayErrorText}">
            <span class="label" part="label" ?hidden="${(x) => x.inline && !x.hasLabel}">
                <slot @slotchange="${(x) => x.handleDefaultSlotChange()}"></slot>
            </span>
            <span
                class="supporting"
                part="supporting-text"
                ?hidden="${(x) => !x.hasSupporting || Boolean(x.displayErrorText)}"
            >
                <slot name="supporting" @slotchange="${(x) => x.handleSupportingSlotChange()}"></slot>
            </span>
            ${when(
              (x) => Boolean(x.displayErrorText),
              html<VioletRadio>`
                    <span class="error" part="error-message" role="alert">${(x) => x.displayErrorText}</span>
                `,
            )}
        </span>
    </div>
`;

/**
 * Violet reusable radio primitive.
 *
 * @summary Token-driven radio option with label, optional supporting text, and field errors.
 * @fires change - Emitted when the radio becomes checked through user interaction.
 * @slot - Radio label content.
 * @slot supporting - Optional supporting copy rendered under the label.
 * @csspart root - Root label wrapper.
 * @csspart control - Visible radio control.
 * @csspart mark - Selection dot inside the control.
 * @csspart label - Primary label text wrapper.
 * @csspart supporting-text - Optional supporting text wrapper.
 * @csspart error-message - Error message element shown while invalid.
 */
export class VioletRadio extends FASTElement {
  readonly #internals: ElementInternals;
  readonly #fieldsetObserver = new MutationObserver(() => this.#syncFieldsetDisabled());
  readonly #describedByObserver = new MutationObserver(() => this.#syncAccessibilityState());
  #managedTabIndex: number | null;
  #disabledFromGroup: boolean;
  #disabledByFieldset: boolean;

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
   * Active error message rendered while the radio is invalid.
   */
  public get displayErrorText(): string {
    return this._displayErrorText;
  }

  /**
   * Checked state for the radio.
   */
  declare public checked: boolean;

  /**
   * Disables the radio.
   */
  declare public disabled: boolean;

  /**
   * Presents a compact inline layout that can collapse to the control only.
   */
  declare public inline: boolean;

  /**
   * Marks the radio as invalid.
   */
  declare public invalid: boolean;

  /**
   * Optional error message shown while the radio is invalid.
   */
  declare public errorText: string;

  /**
   * Native group name forwarded from a parent radio group when available.
   */
  declare public name: string;

  /**
   * Submitted value associated with this radio.
   */
  declare public value: string;

  public constructor() {
    super();
    this.#internals = this.attachInternals();
    this.#internals.role = "radio";
    this.#managedTabIndex = null;
    this.#disabledFromGroup = false;
    this.#disabledByFieldset = false;
    this.hasSupporting = false;
    this.hasLabel = false;
    this.checked = false;
    this.disabled = false;
    this.inline = false;
    this.invalid = false;
    this.errorText = "";
    this.name = "";
    this.value = "on";
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute("role", "radio");
    this.addEventListener("keydown", this.handleKeydown as EventListener);
    this.#observeAncestorFieldsets();
    this.#disabledByFieldset = isDisabledByFieldset(this);
    this.#describedByObserver.observe(this, {
      attributes: true,
      attributeFilter: ["aria-describedby"],
    });
    this.#syncLabelState();
    this.#syncSupportingState();
    this.#syncErrorState();
    this.#syncAccessibilityState();
    this.#syncTabIndex();
  }

  public disconnectedCallback(): void {
    this.removeEventListener("keydown", this.handleKeydown as EventListener);
    this.#fieldsetObserver.disconnect();
    this.#describedByObserver.disconnect();
    this.#disabledByFieldset = false;
    super.disconnectedCallback();
  }

  public get effectiveDisabled(): boolean {
    return this.disabled || this.#disabledFromGroup || this.#disabledByFieldset;
  }

  public setCheckedFromGroup(checked: boolean): void {
    this.checked = checked;
  }

  public setGroupDisabled(disabled: boolean): void {
    this.#disabledFromGroup = disabled;
    this.#syncErrorState();
    this.#syncAccessibilityState();
    this.#syncTabIndex();
  }

  public get managedTabIndex(): number | null {
    return this.#managedTabIndex;
  }

  public set managedTabIndex(tabIndex: number | null) {
    this.setManagedTabIndex(tabIndex);
  }

  public setManagedTabIndex(tabIndex: number | null): void {
    this.#managedTabIndex = tabIndex;
    this.#syncTabIndex();
  }

  public handleClick(event: Event): void {
    event.preventDefault();
    this.#activateFromUser();
  }

  public handleDefaultSlotChange(): void {
    this.#syncLabelState();
    this.#syncAccessibilityState();
  }

  public handleSupportingSlotChange(): void {
    this.#syncSupportingState();
    if (this.$fastController.isConnected) {
      Updates.enqueue(() => {
        Updates.enqueue(() => {
          this.#syncAccessibilityState();
        });
      });
    }
  }

  public checkedChanged(): void {
    this.#syncAccessibilityState();
    this.#syncTabIndex();
  }

  public disabledChanged(): void {
    this.#syncErrorState();
    this.#syncAccessibilityState();
    this.#syncTabIndex();
  }

  public invalidChanged(): void {
    this.#syncErrorState();
    this.#syncAccessibilityState();
  }

  public errorTextChanged(): void {
    this.#syncErrorState();
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
        this.#syncAccessibilityState();
      });
    });
  }

  #observeAncestorFieldsets(): void {
    this.#fieldsetObserver.disconnect();
    let node: Node | null = this.parentNode;
    while (node) {
      if (node instanceof HTMLFieldSetElement) {
        this.#fieldsetObserver.observe(node, { attributes: true, attributeFilter: ["disabled"] });
      }
      node = node.parentNode;
    }
  }

  #syncFieldsetDisabled(): void {
    const next = isDisabledByFieldset(this);
    if (this.#disabledByFieldset === next) {
      return;
    }
    this.#disabledByFieldset = next;
    this.#syncErrorState();
    this.#syncAccessibilityState();
    this.#syncTabIndex();
  }

  public valueChanged(): void {
    this.#syncAccessibilityState();
  }

  public get controlAriaLabel(): string | null {
    const explicitLabel = this.getAttribute("aria-label");
    if (explicitLabel) {
      return explicitLabel;
    }

    const visibleLabel = this.#defaultSlotText();
    return visibleLabel || null;
  }

  #activateFromUser(): void {
    if (this.effectiveDisabled) {
      return;
    }

    this.focus();

    if (this.checked) {
      return;
    }

    this.checked = true;
    this.$emit("change", { checked: true, value: this.value });
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

  #syncErrorState(): void {
    this.#setDisplayErrorText(
      this.invalid && !this.effectiveDisabled ? (this.errorText ?? "").trim() : "",
    );
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

  #syncAccessibilityState(): void {
    this.#internals.ariaChecked = this.checked ? "true" : "false";
    this.#internals.ariaDisabled = this.effectiveDisabled ? "true" : "false";
    this.#internals.ariaInvalid = this.invalid ? "true" : "false";

    const labelElement = this.shadowRoot?.querySelector(".label:not([hidden])");
    const errorElement = this.shadowRoot?.querySelector(".error");
    const supportingElement = this.shadowRoot?.querySelector(".supporting:not([hidden])");

    if (labelElement instanceof Element) {
      this.#internals.ariaLabelledByElements = [labelElement];
      this.#internals.ariaLabel = null;
    } else {
      this.#internals.ariaLabelledByElements = null;
      this.#internals.ariaLabel = this.controlAriaLabel ?? null;
    }

    if (this.hasAttribute("aria-describedby")) {
      this.#internals.ariaDescribedByElements = null;
      if ("ariaErrorMessageElements" in this.#internals) {
        this.#internals.ariaErrorMessageElements =
          errorElement instanceof Element ? [errorElement] : null;
      }
    } else {
      const descriptionElement = errorElement ?? supportingElement;
      this.#internals.ariaDescribedByElements =
        descriptionElement instanceof Element ? [descriptionElement] : null;
      if ("ariaErrorMessageElements" in this.#internals) {
        this.#internals.ariaErrorMessageElements = null;
      }
    }

    if (this.$fastController.isConnected) {
      this.setAttribute("aria-checked", this.checked ? "true" : "false");
    }

    if (this.effectiveDisabled) {
      this.setAttribute("aria-disabled", "true");
    } else {
      this.removeAttribute("aria-disabled");
    }
  }

  #syncTabIndex(): void {
    if (!this.$fastController.isConnected) {
      return;
    }

    if (this.effectiveDisabled) {
      this.tabIndex = -1;
      return;
    }

    this.tabIndex = this.#managedTabIndex ?? 0;
  }

  handleKeydown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) {
      return;
    }

    if (event.key !== " " && event.key !== "Enter") {
      return;
    }

    if (this.closest("violet-radio-group")) {
      return;
    }

    event.preventDefault();
    this.#activateFromUser();
  };
}

attr({ mode: "boolean" })(VioletRadio.prototype, "checked");
attr({ mode: "boolean" })(VioletRadio.prototype, "disabled");
attr({ mode: "boolean" })(VioletRadio.prototype, "inline");
attr({ mode: "boolean" })(VioletRadio.prototype, "invalid");
attr({ attribute: "error-text" })(VioletRadio.prototype, "errorText");
attr(VioletRadio.prototype, "name");
attr(VioletRadio.prototype, "value");

/** The FAST definition of `<violet-radio>`; `defineVioletRadio` in `./violet-radio.define` registers it. */
export const violetRadioDefinition = {
  name: "violet-radio",
  template,
  styles,
} satisfies PartialFASTElementDefinition;
