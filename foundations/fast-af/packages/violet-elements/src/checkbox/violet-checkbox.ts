import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";
import { installFormDisabled } from "../foundations/violet-form-disabled";

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        display: inline-grid;

        --_selection-background: var(--color-control-selected-background, #ddeadf);
        --_selection-text: var(--color-control-selected-foreground, #244635);
        --_selection-border: var(--color-control-selected-border, rgba(36, 70, 53, 0.22));
        --_surface-card: var(--color-surface-card, #faf9f5);
        --_border-strong: var(--color-border-strong, rgba(28, 26, 13, 0.48));
        --_danger-border: var(--color-state-danger-border, rgba(220, 38, 38, 0.34));
        --_radius-sm: var(--radius-sm, 2px);
        --_size-font-md: var(--size-font-md, 14px);
        --_control-size: max(var(--_size-font-md), calc(var(--_target-size) * 0.5));
        --_type-body-line: var(--type-body-md-line, 20px);
        --_type-caption-line: var(--type-caption-xs-line, 14px);
    }

    :host([inline]) {
        --_target-size: var(--violet-checkbox-inline-target-size, var(--_target-size-compact));
        --_space-inline-sm: var(--violet-checkbox-inline-gap, 4px);
    }

    .root {
        display: inline-grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: calc(var(--_space-inline-sm) * 2);
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

    .input {
        position: absolute;
        inset: 0;
        inline-size: 100%;
        block-size: 100%;
        margin: 0;
        padding: 0;
        opacity: 0;
        overflow: hidden;
        border: 0;
        clip: rect(0 0 0 0);
        white-space: nowrap;
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

    .box {
        position: relative;
        display: inline-grid;
        place-items: center;
        inline-size: var(--_control-size);
        block-size: var(--_control-size);
        border: 1px solid var(--_border-strong);
        border-radius: var(--_radius-sm);
        background: var(--_surface-card);
        box-shadow: var(--_shadow-control);
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

    .input:focus-visible + .box {
        box-shadow:
            var(--_shadow-control),
            0 0 0 2px var(--_focus-ring);
    }

    :host([invalid]) .box {
        border-color: var(--_danger-border);
    }

    :host([disabled]) .root,
    :host(:disabled) .root {
        cursor: not-allowed;
        opacity: 0.6;
    }

    .content {
        display: grid;
        gap: var(--_space-stack-xs);
        min-block-size: var(--_target-size);
        align-content: center;
        min-inline-size: 0;
    }

    .content[hidden] {
        display: none;
    }

    :host([inline]) .content {
        min-block-size: auto;
        align-content: center;
    }

    .label {
        color: var(--color-text-primary, #18181b);
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
    }

    .supporting {
        color: var(--_text-secondary);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    @media (forced-colors: active) {
        .box {
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
        }

        :host([disabled]) .box,
        :host(:disabled) .box {
            border-color: GrayText;
        }
    }
`;

const template = html<VioletCheckbox>`
    <label class="root" part="root">
        <span class="control-shell">
            <input
                class="input"
                part="input"
                type="checkbox"
                :checked="${x => x.checked}"
                name="${x => x.name}"
                value="${x => x.value}"
                ?disabled="${x => x.effectiveDisabled}"
                ?required="${x => x.required}"
                aria-label="${x => x.controlAriaLabel}"
                aria-invalid="${x => x.invalid ? "true" : "false"}"
                @change="${(x, c) => x.handleChange(c.event)}"
            />
            <span class="box" part="control" aria-hidden="true">
                <span class="checkmark" part="mark checkmark"></span>
                <span class="mixed-mark" part="mark mixed-mark"></span>
            </span>
        </span>
        <span class="content" ?hidden="${x => x.inline && !x.hasLabel && !x.hasSupporting}">
            <span class="label" part="label" ?hidden="${x => x.inline && !x.hasLabel}">
                <slot @slotchange="${x => x.handleDefaultSlotChange()}"></slot>
            </span>
            <span class="supporting" part="supporting-text" ?hidden="${x => !x.hasSupporting}">
                <slot name="supporting" @slotchange="${x => x.handleSupportingSlotChange()}"></slot>
            </span>
        </span>
    </label>
`;

/**
 * Violet reusable checkbox primitive.
 *
 * @summary Token-driven checkbox with label, inline selection mode, and indeterminate support.
 * @fires change - Emitted when the checked state changes.
 * @slot - Checkbox label content.
 * @slot supporting - Optional supporting copy rendered under the label.
 * @csspart root - Root label wrapper.
 * @csspart input - Native checkbox input.
 * @csspart control - Visible checkbox control box.
 * @csspart mark - Checkmark glyph inside the control.
 * @csspart label - Primary label text wrapper.
 * @csspart supporting-text - Optional supporting text wrapper.
 */
export class VioletCheckbox extends FASTElement {
    public static readonly formAssociated = true;

    readonly #internals: ElementInternals;
    #defaultChecked: boolean;
    #defaultIndeterminate: boolean;

    @observable
    declare public hasSupporting: boolean;

    @observable
    declare public hasLabel: boolean;

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
        this.name = "";
        this.value = "on";
        this.required = false;
        this.#defaultChecked = false;
        this.#defaultIndeterminate = false;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.#defaultChecked = this.hasAttribute("checked") ? this.getAttribute("checked") !== "false" : this.checked;
        this.#defaultIndeterminate = this.hasAttribute("indeterminate")
            ? this.getAttribute("indeterminate") !== "false"
            : this.indeterminate;
        this.#syncLabelState();
        this.#syncSupportingState();
        this.#syncControlState();
        this.#syncFormState();
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

    public get controlAriaLabel(): string | null {
        const explicitLabel = this.getAttribute("aria-label");
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
        const slot = this.shadowRoot?.querySelector('slot[name="supporting"]') as HTMLSlotElement | null;
        this.hasSupporting = (slot?.assignedNodes({ flatten: true }) ?? []).some(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                return Boolean(node.textContent?.trim());
            }
            return true;
        });
    }

    #defaultSlotText(): string {
        return Array.from(this.childNodes)
            .filter(node => {
                if (node.nodeType !== Node.ELEMENT_NODE) {
                    return true;
                }

                return !(node as Element).hasAttribute("slot");
            })
            .map(node => node.textContent ?? "")
            .join(" ")
            .trim();
    }

    #syncControlState(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        const control = this.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
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

        const ariaLabel = this.controlAriaLabel;
        if (ariaLabel) {
            control.setAttribute("aria-label", ariaLabel);
        } else {
            control.removeAttribute("aria-label");
        }
    }

    #syncFormState(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        const control = this.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;

        this.#internals.ariaInvalid = this.invalid ? "true" : "false";
        this.#internals.setFormValue(!this.effectiveDisabled && this.checked ? this.value : null, this.checked ? "checked" : "unchecked");

        if (this.effectiveDisabled) {
            this.#internals.setValidity({});
            return;
        }

        if (this.invalid) {
            this.#internals.setValidity({ customError: true }, "Please correct this field.", control ?? undefined);
            return;
        }

        if (this.required && !this.checked) {
            this.#internals.setValidity({ valueMissing: true }, "Please select this option.", control ?? undefined);
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
attr(VioletCheckbox.prototype, "name");
attr(VioletCheckbox.prototype, "value");
attr({ mode: "boolean" })(VioletCheckbox.prototype, "required");

if (!customElements.get("violet-checkbox")) {
    await FASTElement.define(VioletCheckbox, {
        name: "violet-checkbox",
        template,
        styles,
        shadowOptions: {
            delegatesFocus: true,
        },
    });
}
