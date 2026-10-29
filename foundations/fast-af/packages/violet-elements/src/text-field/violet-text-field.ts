import { FASTElement, Updates, attr, css, html, nullableNumberConverter, when } from "@lushly-dev/fast-element";

import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";
import { installFormDisabled } from "../foundations/violet-form-disabled";

export type VioletTextFieldType = "text" | "search" | "email" | "url" | "password" | "tel" | "number" | "date";

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        display: grid;
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
        margin-block-end: var(--_space-stack-xs);
    }

    .control-frame {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        inline-size: 100%;
        block-size: var(--_target-size);
        padding-inline: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
        padding-block: 0;
        border: 1px solid var(--_border-subtle);
        border-radius: var(--_radius-md);
        background: var(--_surface-page);
        color: var(--color-text-primary, #18181b);
        box-shadow: var(--_shadow-control);
        font-family: inherit;
        transition:
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .control {
        flex: 1 1 auto;
        min-inline-size: 0;
        border: 0;
        background: transparent;
        color: var(--color-text-primary, #18181b);
        box-shadow: none;
        font-family: inherit;
        font-size: var(--_control-body-size);
        line-height: 1;
    }

    .control::placeholder {
        color: var(--_text-muted);
    }

    .control:focus {
        outline: none;
    }

    .control-frame:hover {
        border-color: var(--color-field-border-hover, rgba(28, 26, 13, 0.35));
    }

    .control-frame:focus-within {
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px var(--_focus-ring);
        transform: translateY(calc(var(--_space-inline-sm) / -4));
    }

    :host([readonly]) .control-frame {
        background: var(--_surface-subtle);
    }

    :host([disabled]) .control-frame,
    :host(:disabled) .control-frame {
        opacity: 0.65;
        cursor: not-allowed;
    }

    :host([disabled]) .control,
    :host(:disabled) .control {
        cursor: not-allowed;
    }

    :host([invalid]) .control-frame {
        border-color: var(--_danger-border);
    }

    slot[name="before"] {
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
        color: var(--_text-muted);
    }

    ::slotted([slot="before"]) {
        margin-inline-end: var(--_space-inline-sm);
    }

    .supporting {
        color: var(--_text-muted);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
        margin-block-start: var(--_space-stack-2xs);
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

const template = html<VioletTextField>`
    <div class="field" part="field">
        ${when(
            x => Boolean(x.label),
            html<VioletTextField>`
                <label class="label" part="label" for="${x => x.inputId}">${x => x.label}</label>
            `,
        )}
        <div class="control-frame" part="control-frame">
            <slot name="before" part="before"></slot>
            <input
                id="${x => x.inputId}"
                class="control"
                part="control"
                name="${x => x.name}"
                type="${x => x.type}"
                min="${x => x.min}"
                max="${x => x.max}"
                step="${x => x.step}"
                minlength="${x => x.minLength}"
                maxlength="${x => x.maxLength}"
                pattern="${x => x.pattern || null}"
                autocomplete="${x => x.autocomplete}"
                placeholder="${x => x.placeholder}"
                :value="${x => x.value}"
                ?disabled="${x => x.effectiveDisabled}"
                ?readonly="${x => x.readonly}"
                ?required="${x => x.required}"
                aria-label="${x => x.label || x.getAttribute("aria-label") || ""}"
                aria-invalid="${x => x.invalid ? "true" : "false"}"
                @input="${(x, c) => x.handleInput(c.event)}"
                @change="${(x, c) => x.handleCommit(c.event)}"
            />
        </div>
        ${when(
            x => Boolean(x.supportingText),
            html<VioletTextField>`
                <p class="supporting" part="supporting-text" id="${x => x.supportingId}">${x => x.supportingText}</p>
            `,
        )}
    </div>
`;

let violetTextFieldCount = 0;

/**
 * Violet reusable text field primitive.
 *
 * @summary Token-driven single-line text input with built-in label and supporting text.
 * @slot before - Leading inline content such as a search or password icon.
 * @fires input - Emitted when the value changes while typing.
 * @fires change - Emitted when the value is committed.
 * @csspart field - Field wrapper.
 * @csspart label - Label text element.
 * @csspart control-frame - Framed wrapper around the input and leading slot.
 * @csspart before - Leading slot for inline affordances.
 * @csspart control - Native input control.
 * @csspart supporting-text - Supporting text element.
 */
export class VioletTextField extends FASTElement {
    public static readonly formAssociated = true;

    readonly #internals: ElementInternals;
    readonly #describedByObserver = new MutationObserver(() => this.#scheduleSync());
    readonly #handleFocusIn = (): void => this.#syncDescribedBy();
    #syncScheduled = false;
    #defaultValue: string;

    public readonly inputId: string;

    /**
     * Id of the supporting text element inside the shadow root.
     */
    public readonly supportingId: string;

    /**
     * Optional field label.
     */
    declare public label: string;

    /**
     * Optional placeholder text.
     */
    declare public placeholder: string;

    /**
     * Current input value.
     */
    declare public value: string;

    /**
     * Native input type.
     */
    declare public type: VioletTextFieldType;

    /**
     * Optional supporting text shown below the field.
     */
    declare public supportingText: string;

    /**
     * Disables the field.
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
     * Marks the field readonly.
     */
    declare public readonly: boolean;

    /**
     * Marks the field invalid.
     */
    declare public invalid: boolean;

    /**
     * Native form name used during submission.
     */
    declare public name: string;

    /**
     * Marks the field as required.
     */
    declare public required: boolean;

    /**
     * Native `min` constraint (numbers, dates) forwarded to the input.
     */
    declare public min?: string | null;

    /**
     * Native `max` constraint (numbers, dates) forwarded to the input.
     */
    declare public max?: string | null;

    /**
     * Native `step` constraint forwarded to the input.
     */
    declare public step?: string | null;

    /**
     * Native `minlength` constraint forwarded to the input.
     */
    declare public minLength?: number | null;

    /**
     * Native `maxlength` constraint forwarded to the input.
     */
    declare public maxLength?: number | null;

    /**
     * Native `pattern` constraint forwarded to the input.
     */
    declare public pattern?: string | null;

    /**
     * Native `autocomplete` hint forwarded to the input.
     */
    declare public autocomplete?: string | null;

    public constructor() {
        super();
        this.#internals = this.attachInternals();
        violetTextFieldCount += 1;
        this.inputId = `violet-text-field-${violetTextFieldCount}`;
        this.supportingId = `${this.inputId}-supporting`;
        this.label = "";
        this.placeholder = "";
        this.value = "";
        this.type = "text";
        this.supportingText = "";
        this.disabled = false;
        this.readonly = false;
        this.invalid = false;
        this.name = "";
        this.required = false;
        this.#defaultValue = "";
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.#defaultValue = this.getAttribute("value") ?? this.value;
        this.#syncFormState();
        this.#syncDescribedBy();
        this.#describedByObserver.observe(this, { attributes: true, attributeFilter: ["aria-describedby"] });
        this.addEventListener("focusin", this.#handleFocusIn);
        this.#scheduleSync();
    }

    public disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#describedByObserver.disconnect();
        this.removeEventListener("focusin", this.#handleFocusIn);
    }

    public handleInput(event: Event): void {
        const control = event.currentTarget as HTMLInputElement | null;
        this.value = control?.value ?? "";
        this.$emit("input", { value: this.value });
    }

    public handleCommit(event: Event): void {
        const control = event.currentTarget as HTMLInputElement | null;
        this.value = control?.value ?? "";
        this.$emit("change", { value: this.value });
    }

    public formStateRestoreCallback(state: File | string | FormData | null): void {
        if (typeof state === "string") {
            this.value = state;
        }
    }

    public formResetCallback(): void {
        this.value = this.#defaultValue;
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

    public valueChanged(): void {
        this.#syncFormState();
        this.#scheduleSync();
    }

    public typeChanged(): void {
        this.#scheduleSync();
    }

    public minChanged(): void {
        this.#scheduleSync();
    }

    public maxChanged(): void {
        this.#scheduleSync();
    }

    public stepChanged(): void {
        this.#scheduleSync();
    }

    public minLengthChanged(): void {
        this.#scheduleSync();
    }

    public maxLengthChanged(): void {
        this.#scheduleSync();
    }

    public patternChanged(): void {
        this.#scheduleSync();
    }

    public supportingTextChanged(): void {
        this.#scheduleSync();
    }

    public disabledChanged(): void {
        this.#syncFormState();
    }

    public invalidChanged(): void {
        this.#syncFormState();
    }

    public readonlyChanged(): void {
        this.#syncFormState();
    }

    public requiredChanged(): void {
        this.#syncFormState();
        this.#scheduleSync();
    }

    /**
     * Template bindings flush on the next update batch, so validity derived from the inner
     * input and the describedby targets are re-synced once that batch has landed.
     */
    #scheduleSync(): void {
        if (this.#syncScheduled || !this.$fastController.isConnected) {
            return;
        }

        this.#syncScheduled = true;
        Updates.enqueue(() => {
            Updates.enqueue(() => {
                this.#syncScheduled = false;
                this.#syncFormState();
                this.#syncDescribedBy();
            });
        });
    }

    /**
     * IDREFs in a host `aria-describedby` cannot cross the shadow boundary, so the ids are
     * resolved in the host's root node and assigned to the input through element reflection
     * (`ariaDescribedByElements`), together with the supporting text. Without element
     * reflection only the supporting text is linked, by an IDREF inside the shadow root;
     * light-DOM targets cannot be referenced in that case.
     */
    #syncDescribedBy(): void {
        const control = this.shadowRoot?.querySelector("input") as HTMLInputElement | null;

        if (!control) {
            return;
        }

        const targets: Element[] = [];
        const root = this.getRootNode() as Document | ShadowRoot;
        const hostIds = (this.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);

        for (const id of hostIds) {
            const target = root.getElementById?.(id) ?? null;
            if (target && !targets.includes(target)) {
                targets.push(target);
            }
        }

        const supporting = this.shadowRoot?.getElementById(this.supportingId) ?? null;
        if (supporting) {
            targets.push(supporting);
        }

        const hasElementReflection: boolean = "ariaDescribedByElements" in control;
        if (hasElementReflection) {
            control.removeAttribute("aria-describedby");
            control.ariaDescribedByElements = targets.length ? targets : null;
            return;
        }

        if (supporting) {
            control.setAttribute("aria-describedby", this.supportingId);
        } else {
            control.removeAttribute("aria-describedby");
        }
    }

    #syncFormState(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        const control = this.shadowRoot?.querySelector("input") as HTMLInputElement | null;

        this.#internals.ariaInvalid = this.invalid ? "true" : "false";
        this.#internals.setFormValue(this.effectiveDisabled ? null : this.value);

        if (this.effectiveDisabled || this.readonly) {
            this.#internals.setValidity({});
            return;
        }

        if (this.invalid) {
            this.#internals.setValidity({ customError: true }, "Please correct this field.", control ?? undefined);
            return;
        }

        if (this.required && !this.value.trim()) {
            this.#internals.setValidity({ valueMissing: true }, "Please fill out this field.", control ?? undefined);
            return;
        }

        if (!control) {
            this.#internals.setValidity({});
            return;
        }

        // Native length validity only fires for user edits, and the `:value` binding resets that
        // flag, so length limits are evaluated here against the current value instead.
        const native = control.validity;
        const length = this.value.length;
        const tooShort = native.tooShort || (this.minLength != null && length > 0 && length < this.minLength);
        const tooLong = native.tooLong || (this.maxLength != null && length > this.maxLength);

        if (native.valid && !tooShort && !tooLong) {
            this.#internals.setValidity({});
            return;
        }

        let message = control.validationMessage;
        if (!message && tooShort) {
            message = `Please lengthen this text to ${this.minLength} characters or more.`;
        } else if (!message && tooLong) {
            message = `Please shorten this text to ${this.maxLength} characters or less.`;
        }

        this.#internals.setValidity(
            {
                valueMissing: native.valueMissing,
                typeMismatch: native.typeMismatch,
                patternMismatch: native.patternMismatch,
                tooLong,
                tooShort,
                rangeUnderflow: native.rangeUnderflow,
                rangeOverflow: native.rangeOverflow,
                stepMismatch: native.stepMismatch,
                badInput: native.badInput,
                customError: native.customError,
            },
            message,
            control,
        );
    }
}

attr(VioletTextField.prototype, "label");
attr(VioletTextField.prototype, "placeholder");
// fromView: typed text must not be reflected back into the DOM `value` attribute.
attr({ mode: "fromView" })(VioletTextField.prototype, "value");
attr(VioletTextField.prototype, "type");
attr(VioletTextField.prototype, "min");
attr(VioletTextField.prototype, "max");
attr(VioletTextField.prototype, "step");
attr({ attribute: "minlength", converter: nullableNumberConverter })(VioletTextField.prototype, "minLength");
attr({ attribute: "maxlength", converter: nullableNumberConverter })(VioletTextField.prototype, "maxLength");
attr(VioletTextField.prototype, "pattern");
attr(VioletTextField.prototype, "autocomplete");
attr({ attribute: "supporting-text" })(VioletTextField.prototype, "supportingText");
attr({ mode: "boolean" })(VioletTextField.prototype, "disabled");
installFormDisabled(VioletTextField.prototype);
attr({ mode: "boolean" })(VioletTextField.prototype, "readonly");
attr({ mode: "boolean" })(VioletTextField.prototype, "invalid");
attr(VioletTextField.prototype, "name");
attr({ mode: "boolean" })(VioletTextField.prototype, "required");

if (!customElements.get("violet-text-field")) {
    await FASTElement.define(VioletTextField, {
        name: "violet-text-field",
        template,
        styles,
        shadowOptions: {
            delegatesFocus: true,
        },
    });
}
