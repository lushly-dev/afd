import { FASTElement, attr, css, html, when } from "@lushly-dev/fast-element";

import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";
import { installFormDisabled } from "../foundations/violet-form-disabled";

const rowConverter = {
    fromView(value: string | null): number {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
    },
    toView(value: number): string {
        return String(value);
    },
};

const maxlengthConverter = {
    fromView(value: unknown): number | null {
        if (value === null || value === undefined || value === "") {
            return null;
        }
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
    },
    toView(value: number | null): string | null {
        return value === null || value === undefined ? null : String(value);
    },
};

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        display: grid;
        --_space-layout-sm: var(--space-layout-sm, 12px);
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
        align-items: flex-start;
        inline-size: 100%;
        min-block-size: calc(var(--_target-size) * 2 + var(--_space-layout-sm));
        padding-inline: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
        padding-block: calc(var(--_target-size) * 0.25);
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
        min-block-size: calc(var(--_target-size) * 1.5);
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--color-text-primary, #18181b);
        box-shadow: none;
        font-family: inherit;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        resize: vertical;
    }

    .control::placeholder {
        color: var(--_text-muted);
    }

    .control:focus {
        outline: none;
    }

    .control-frame:hover {
        border-color: var(--color-field-border-hover, rgba(28, 26, 13, 0.48));
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
        align-items: flex-start;
        flex: 0 0 auto;
        color: var(--_text-muted);
        padding-block-start: calc((var(--_type-body-line) - 1em) / 2);
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

const template = html<VioletTextArea>`
    <div class="field" part="field">
        ${when(
            x => Boolean(x.label),
            html<VioletTextArea>`
                <label class="label" part="label" for="${x => x.inputId}">${x => x.label}</label>
            `,
        )}
        <div class="control-frame" part="control-frame">
            <slot name="before" part="before"></slot>
            <textarea
                id="${x => x.inputId}"
                class="control"
                part="control"
                name="${x => x.name}"
                rows="${x => x.rows}"
                placeholder="${x => x.placeholder}"
                maxlength="${x => x.maxLength ?? void 0}"
                aria-describedby="${x => (x.supportingText ? x.supportingId : void 0)}"
                :value="${x => x.value}"
                ?disabled="${x => x.effectiveDisabled}"
                ?readonly="${x => x.readonly}"
                ?required="${x => x.required}"
                aria-invalid="${x => x.invalid ? "true" : "false"}"
                @input="${(x, c) => x.handleInput(c.event)}"
                @change="${(x, c) => x.handleCommit(c.event)}"
            ></textarea>
        </div>
        ${when(
            x => Boolean(x.supportingText),
            html<VioletTextArea>`
                <p id="${x => x.supportingId}" class="supporting" part="supporting-text">${x => x.supportingText}</p>
            `,
        )}
    </div>
`;

let violetTextAreaCount = 0;

/**
 * Violet reusable text area primitive.
 *
 * @summary Token-driven multiline text area with built-in label and supporting text.
 * @slot before - Leading inline content such as a note or search affordance.
 * @fires input - Emitted when the value changes while typing.
 * @fires change - Emitted when the value is committed.
 * @csspart field - Field wrapper.
 * @csspart label - Label text element.
 * @csspart control-frame - Framed wrapper around the textarea and leading slot.
 * @csspart before - Leading slot for inline affordances.
 * @csspart control - Native textarea control.
 * @csspart supporting-text - Supporting text element.
 */
export class VioletTextArea extends FASTElement {
    public static readonly formAssociated = true;

    readonly #internals: ElementInternals;
    #defaultValue: string;

    public readonly inputId: string;

    /**
     * Id of the supporting text, which describes the textarea.
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
     * Current textarea value.
     */
    declare public value: string;

    /**
     * Optional supporting text shown below the field.
     */
    declare public supportingText: string;

    /**
     * Maximum number of characters, forwarded to the native textarea.
     */
    declare public maxLength: number | null;

    /**
     * Number of visible rows.
     */
    declare public rows: number;

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

    public constructor() {
        super();
        this.#internals = this.attachInternals();
        violetTextAreaCount += 1;
        this.inputId = `violet-text-area-${violetTextAreaCount}`;
        this.supportingId = `${this.inputId}-supporting`;
        this.label = "";
        this.placeholder = "";
        this.value = "";
        this.supportingText = "";
        this.maxLength = null;
        this.rows = 4;
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
    }

    public handleInput(event: Event): void {
        const control = event.currentTarget as HTMLTextAreaElement | null;
        this.value = control?.value ?? "";
        this.$emit("input", { value: this.value });
    }

    public handleCommit(event: Event): void {
        const control = event.currentTarget as HTMLTextAreaElement | null;
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
    }

    #syncFormState(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        const control = this.shadowRoot?.querySelector("textarea") as HTMLTextAreaElement | null;

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

        this.#internals.setValidity({});
    }
}

attr(VioletTextArea.prototype, "label");
attr(VioletTextArea.prototype, "placeholder");
// fromView: typed text must not be reflected back into the DOM `value` attribute.
attr({ mode: "fromView" })(VioletTextArea.prototype, "value");
attr({ attribute: "supporting-text" })(VioletTextArea.prototype, "supportingText");
attr({ attribute: "maxlength", converter: maxlengthConverter })(VioletTextArea.prototype, "maxLength");
attr({ converter: rowConverter })(VioletTextArea.prototype, "rows");
attr({ mode: "boolean" })(VioletTextArea.prototype, "disabled");
installFormDisabled(VioletTextArea.prototype);
attr({ mode: "boolean" })(VioletTextArea.prototype, "readonly");
attr({ mode: "boolean" })(VioletTextArea.prototype, "invalid");
attr(VioletTextArea.prototype, "name");
attr({ mode: "boolean" })(VioletTextArea.prototype, "required");

if (!customElements.get("violet-text-area")) {
    await FASTElement.define(VioletTextArea, {
        name: "violet-text-area",
        template,
        styles,
        shadowOptions: {
            delegatesFocus: true,
        },
    });
}
