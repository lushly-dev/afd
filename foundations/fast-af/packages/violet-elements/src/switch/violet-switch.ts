import { FASTElement, Updates, attr, css, html, observable, when, type PartialFASTElementDefinition } from "@lushly-dev/fast-element";

import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";
import { installFormDisabled } from "../foundations/violet-form-disabled";

let violetSwitchId = 0;

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        display: inline-grid;

        --_selection-background: var(--violet-color-control-selected-background, #c0daeb);
        --_selection-text: var(--violet-color-control-selected-foreground, #1b5f80);
        --_selection-border: var(--violet-color-control-selected-border, rgba(27, 95, 128, 0.5));
        --_surface-card: var(--violet-color-surface-card, #f8f9f3);
        --_border-strong: var(--violet-color-border-strong, #6b7d6e);
        --_radius-sm: var(--violet-radius-sm, 4px);
        --_size-font-md: var(--violet-size-font-md, 14px);
        /*
         * A slide key, not an outlined pill: a filled slot as tall as one line of text, and a
         * squared key the size of a checkbox that crosses it and shows a tick when it is on.
         * Off, the slot is the control edge colour, which holds 3:1 on the page and on a card.
         */
        --_track-block-size: var(--_type-body-line);
        --_track-inline-size: calc(var(--_track-block-size) * 1.8);
        --_track-border-width: 0px;
        --_track-padding: 2px;
        --_track-edge: 0 0 0 0 transparent;
        --_thumb-size: calc(var(--_track-block-size) - (var(--_track-padding) * 2));
        --_thumb-offset: calc(
            var(--_track-inline-size) -
            var(--_thumb-size) -
            (var(--_track-padding) * 2) -
            (var(--_track-border-width) * 2)
        );
        --_type-body-line: var(--violet-type-body-md-line, 20px);
        --_type-caption-line: var(--violet-type-caption-xs-line, 16px);
    }

    :host([inline]) {
        --_target-size: var(--violet-switch-inline-target-size, var(--_target-size-compact));
        --_space-inline-sm: var(--violet-switch-inline-gap, 4px);
    }

    .root {
        display: inline-grid;
        grid-template-columns: auto minmax(0, 1fr);
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

    /*
     * The native input is transparent but fills the whole control shell, so it is
     * the element a pointer (or a role-based click) lands on: the decorative track
     * does not take pointer events, and a clipped box would have no hit area. It
     * has no z-index, so it never competes with page content outside the control.
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

    .track {
        box-sizing: border-box;
        position: relative;
        display: inline-block;
        pointer-events: none;
        inline-size: var(--_track-inline-size);
        block-size: var(--_track-block-size);
        border: var(--_track-border-width) solid var(--_border-strong);
        border-radius: calc(var(--_radius-sm) + var(--_track-padding));
        background: var(--_border-strong);
        box-shadow: var(--_track-edge);
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard);
    }

    .thumb {
        position: absolute;
        inset-inline-start: var(--_track-padding);
        inset-block-start: 50%;
        inline-size: var(--_thumb-size);
        block-size: var(--_thumb-size);
        border-radius: var(--_radius-sm);
        background: var(--_surface-card);
        box-shadow: var(--_shadow-control);
        transform: translate(0, -50%);
        transform-origin: center;
        transition:
            transform var(--_duration-base) var(--_easing-standard),
            background-color var(--_duration-fast) var(--_easing-standard);
    }

    /* The tick the key shows when it is on. */
    .thumb::after {
        content: "";
        position: absolute;
        inset: 0;
        margin: auto;
        inline-size: 62%;
        block-size: 62%;
        background: var(--_selection-background);
        clip-path: polygon(14% 44%, 0 59%, 37% 100%, 100% 16%, 84% 0, 35% 62%);
        opacity: 0;
        transform: scale(0.6);
        transition:
            opacity var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .root:hover .input:not(:checked):not(:disabled) + .track {
        background: var(--_field-border-hover);
    }

    .input:checked + .track {
        background: var(--_selection-background);
        --_track-edge: inset 0 0 0 1px var(--_selection-border);
    }

    .input:checked + .track .thumb {
        transform: translate(var(--_thumb-offset), -50%);
        background: var(--_selection-text);
        box-shadow: none;
    }

    .input:checked + .track .thumb::after {
        opacity: 1;
        transform: scale(1);
    }

    /* The state colours are for messages; an invalid slot takes the field's 3:1 invalid edge. */
    :host([invalid]) .track {
        --_track-edge: inset 0 0 0 1px var(--_danger-border);
    }

    .input:focus-visible + .track {
        box-shadow:
            var(--_track-edge),
            0 0 0 2px var(--_surface-page),
            0 0 0 4px var(--_focus-ring);
    }

    :host([disabled]) .root,
    :host(:disabled) .root {
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
        min-inline-size: 0;
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
    }

    .supporting {
        color: var(--_text-muted);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    .supporting[hidden] {
        display: none;
    }

    .error {
        color: var(--_danger-text);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    @media (forced-colors: active) {
        /* The slot has no fill to tell it from the page here, so it gets its outline back. */
        :host {
            --_track-border-width: 1px;
        }

        .track,
        .root:hover .input:not(:checked):not(:disabled) + .track {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
        }

        .thumb {
            background: ButtonText;
            box-shadow: none;
        }

        .thumb::after {
            background: Highlight;
        }

        .input:checked + .track {
            border-color: Highlight;
            background: Highlight;
        }

        .input:checked + .track .thumb {
            background: HighlightText;
        }

        /* The track opts out of forced colours, so its focus ring is set to the system's here. */
        .input:focus-visible + .track {
            box-shadow:
                0 0 0 2px Canvas,
                0 0 0 4px Highlight;
        }

        :host([disabled]) .track,
        :host(:disabled) .track {
            border-color: GrayText;
            background: Canvas;
        }

        :host([disabled]) .thumb,
        :host(:disabled) .thumb {
            background: GrayText;
        }
    }
`;

const template = html<VioletSwitch>`
    <div class="root" part="root">
        <span class="control-shell">
            <input
                class="input"
                part="input"
                id="${x => x.controlId}"
                type="checkbox"
                role="switch"
                :checked="${x => x.checked}"
                name="${x => x.name}"
                value="${x => x.value}"
                ?disabled="${x => x.effectiveDisabled}"
                ?required="${x => x.required}"
                aria-invalid="${x => x.invalid ? "true" : "false"}"
                @change="${(x, c) => x.handleChange(c.event)}"
            />
            <span class="track" part="control" aria-hidden="true" @click="${x => x.handleTrackClick()}">
                <span class="thumb" part="thumb" aria-hidden="true"></span>
            </span>
        </span>
        <span class="content" ?hidden="${x => x.inline && !x.hasLabel && !x.hasSupporting && !x.displayErrorText}">
            <label class="label" part="label" for="${x => x.controlId}" ?hidden="${x => x.inline && !x.hasLabel}">
                <slot @slotchange="${x => x.handleDefaultSlotChange()}"></slot>
            </label>
            <span
                class="supporting"
                id="${x => x.supportingTextId}"
                part="supporting-text"
                ?hidden="${x => !x.hasSupporting || Boolean(x.displayErrorText)}"
            >
                <slot name="supporting" @slotchange="${x => x.handleSupportingSlotChange()}"></slot>
            </span>
            ${when(
                x => Boolean(x.displayErrorText),
                html<VioletSwitch>`
                    <span
                        class="error"
                        id="${x => x.errorTextId}"
                        part="error-message"
                        role="alert"
                    >${x => x.displayErrorText}</span>
                `,
            )}
        </span>
    </div>
`;

/**
 * Violet reusable switch primitive.
 *
 * @summary Token-driven binary switch with label, inline mode, form participation, and field errors.
 * @fires change - Emitted when the checked state changes.
 * @slot - Switch label content.
 * @slot supporting - Optional supporting copy rendered under the label.
 * @csspart root - Root switch wrapper.
 * @csspart input - Native checkbox input carrying switch semantics.
 * @csspart control - Visible switch track.
 * @csspart thumb - Switch thumb inside the track.
 * @csspart label - Primary label text wrapper.
 * @csspart supporting-text - Optional supporting text wrapper.
 * @csspart error-message - Error message element shown while invalid.
 */
export class VioletSwitch extends FASTElement {
    public static readonly formAssociated = true;

    readonly #internals: ElementInternals;
    #defaultChecked: boolean;

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
     * Active error message rendered while the switch is invalid.
     */
    public get displayErrorText(): string {
        return this._displayErrorText;
    }

    declare public checked: boolean;
    declare public disabled: boolean;

    /**
     * True while an ancestor `<fieldset disabled>` disables the control.
     */
    declare public fieldsetDisabled: boolean;

    /**
     * Author `disabled` or fieldset-disabled.
     */
    declare public readonly effectiveDisabled: boolean;
    declare public inline: boolean;
    declare public invalid: boolean;

    /**
     * Optional error message shown while the switch is invalid.
     */
    declare public errorText: string;
    declare public name: string;
    declare public value: string;
    declare public required: boolean;

    public readonly controlId: string;
    public readonly supportingTextId: string;
    public readonly errorTextId: string;

    public constructor() {
        super();
        this.#internals = this.attachInternals();
        const id = violetSwitchId;
        violetSwitchId += 1;
        this.controlId = `${this.localName || "violet-switch"}-control-${id}`;
        this.supportingTextId = `${this.localName || "violet-switch"}-supporting-${id}`;
        this.errorTextId = `${this.localName || "violet-switch"}-error-${id}`;
        this.hasSupporting = false;
        this.hasLabel = false;
        this.checked = false;
        this.disabled = false;
        this.inline = false;
        this.invalid = false;
        this.errorText = "";
        this.name = "";
        this.value = "on";
        this.required = false;
        this.#defaultChecked = false;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.#defaultChecked = this.hasAttribute("checked") ? this.getAttribute("checked") !== "false" : this.checked;
        this.#syncLabelState();
        this.#syncSupportingState();
        this.#syncControlState();
        this.#syncFormState();
    }

    public handleChange(event: Event): void {
        const control = event.currentTarget as HTMLInputElement | null;
        this.checked = control?.checked ?? false;
        this.$emit("change", { checked: this.checked });
    }

    public handleTrackClick(): void {
        const control = this.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        control?.click();
    }

    public handleDefaultSlotChange(): void {
        this.#syncLabelState();
        this.#syncControlState();
    }

    public handleSupportingSlotChange(): void {
        this.#syncSupportingState();
        this.#syncControlState();
    }

    public formStateRestoreCallback(state: File | string | FormData | null): void {
        if (state === "checked" || state === "unchecked") {
            this.checked = state === "checked";
        }
    }

    public formResetCallback(): void {
        this.checked = this.#defaultChecked;
    }

    public get explicitAriaLabel(): string | null {
        return this.getAttribute("aria-label")?.trim() || null;
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
                this.#syncControlState();
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
        control.disabled = this.effectiveDisabled;
        control.required = this.required;
        control.name = this.name;
        control.value = this.value;
        control.setAttribute("role", "switch");
        control.setAttribute("aria-invalid", this.invalid ? "true" : "false");

        const explicitAriaLabel = this.explicitAriaLabel;
        if (explicitAriaLabel) {
            control.setAttribute("aria-label", explicitAriaLabel);
        } else {
            control.removeAttribute("aria-label");
        }

        if (this.displayErrorText) {
            control.setAttribute("aria-describedby", this.errorTextId);
        } else if (this.hasSupporting) {
            control.setAttribute("aria-describedby", this.supportingTextId);
        } else {
            control.removeAttribute("aria-describedby");
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
            this.#internals.setValidity({ valueMissing: true }, "Please turn this setting on.", control ?? undefined);
            return;
        }

        this.#internals.setValidity({});
    }
}

attr({ mode: "boolean" })(VioletSwitch.prototype, "checked");
attr({ mode: "boolean" })(VioletSwitch.prototype, "disabled");
installFormDisabled(VioletSwitch.prototype);
attr({ mode: "boolean" })(VioletSwitch.prototype, "inline");
attr({ mode: "boolean" })(VioletSwitch.prototype, "invalid");
attr({ attribute: "error-text" })(VioletSwitch.prototype, "errorText");
attr(VioletSwitch.prototype, "name");
attr(VioletSwitch.prototype, "value");
attr({ mode: "boolean" })(VioletSwitch.prototype, "required");

/** The FAST definition of `<violet-switch>`; `defineVioletSwitch` in `./violet-switch.define` registers it. */
export const violetSwitchDefinition = {
    name: "violet-switch",
    template,
    styles,
    shadowOptions: {
        delegatesFocus: true,
    },
} satisfies PartialFASTElementDefinition;
