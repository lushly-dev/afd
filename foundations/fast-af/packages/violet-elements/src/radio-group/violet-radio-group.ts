import { FASTElement, attr, css, html, observable, when } from "@lushly-dev/fast-element";

import "../radio/violet-radio";
import type { VioletRadio } from "../radio/violet-radio";
import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";
import { installFormDisabled } from "../foundations/violet-form-disabled";
import { logicalArrowKey } from "../foundations/violet-direction";

export type VioletRadioGroupOrientation = "horizontal" | "vertical";

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
        margin-block-end: var(--_space-stack-2xs);
    }

    .group {
        display: flex;
        flex-wrap: wrap;
        gap: var(--_space-stack-sm) calc(var(--_space-inline-md) * 2);
        align-items: start;
        min-inline-size: 0;
    }

    :host([orientation="vertical"]) .group {
        flex-direction: column;
        align-items: stretch;
        gap: var(--_space-stack-xs);
    }

    .supporting {
        margin: 0;
        color: var(--_text-muted);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
        margin-block-start: var(--_space-stack-xs);
    }

    .error {
        margin: 0;
        color: var(--color-state-danger-foreground, #b42318);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
        margin-block-start: var(--_space-stack-xs);
    }
`;

const template = html<VioletRadioGroup>`
    <div class="field" part="field">
        ${when(
            x => Boolean(x.label),
            html<VioletRadioGroup>`
                <div class="label" part="label">${x => x.label}</div>
            `,
        )}
        <div class="group" part="group">
            <slot @slotchange="${x => x.handleSlotChange()}"></slot>
        </div>
        ${when(
            x => Boolean(x.supportingText),
            html<VioletRadioGroup>`
                <p class="supporting" part="supporting-text">${x => x.supportingText}</p>
            `,
        )}
        ${when(
            x => Boolean(x.validationMessageText),
            html<VioletRadioGroup>`
                <p class="error" part="error-message">${x => x.validationMessageText}</p>
            `,
        )}
    </div>
`;

/**
 * Violet reusable radio group primitive.
 *
 * @summary Token-driven form-associated radio group with roving focus and optional label/supporting text.
 * @fires change - Emitted when the selected value changes.
 * @slot - Radio options rendered inside the group.
 * @csspart field - Field wrapper.
 * @csspart label - Group label text element.
 * @csspart group - Layout wrapper for slotted radios.
 * @csspart supporting-text - Supporting text element.
 */
export class VioletRadioGroup extends FASTElement {
    public static readonly formAssociated = true;

    readonly #internals: ElementInternals;
    #defaultValue: string;
    #synchronizing: boolean;

    @observable
    declare public radios: VioletRadio[];

    @observable
    declare public validationMessageText: string;

    /**
     * Optional field label.
     */
    declare public label: string;

    /**
     * Optional supporting text shown below the group.
     */
    declare public supportingText: string;

    /**
     * Optional visible error copy used when the group is invalid.
     */
    declare public errorText: string;

    /**
     * Selected radio value.
     */
    declare public value: string;

    /**
     * Native group name forwarded to child radios and form submission.
     */
    declare public name: string;

    /**
     * Disables the radio group and child radios.
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
     * Marks the group invalid.
     */
    declare public invalid: boolean;

    /**
     * Marks the group required.
     */
    declare public required: boolean;

    /**
     * Layout orientation for the group.
     */
    declare public orientation: VioletRadioGroupOrientation;

    public constructor() {
        super();
        this.#internals = this.attachInternals();
        this.#internals.role = "radiogroup";
        this.#defaultValue = "";
        this.#synchronizing = false;
        this.radios = [];
        this.validationMessageText = "";
        this.label = "";
        this.supportingText = "";
        this.errorText = "";
        this.value = "";
        this.name = "";
        this.disabled = false;
        this.invalid = false;
        this.required = false;
        this.orientation = "vertical";
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.addEventListener("change", this.handleRadioChange as EventListener);
        this.addEventListener("keydown", this.handleKeydown as EventListener);
        this.handleSlotChange();
        this.#defaultValue = this.value;
        this.#syncAccessibilityState();
        this.#syncFormState();
    }

    public disconnectedCallback(): void {
        this.removeEventListener("change", this.handleRadioChange as EventListener);
        this.removeEventListener("keydown", this.handleKeydown as EventListener);
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

    public checkValidity(): boolean {
        return this.#internals.checkValidity();
    }

    public reportValidity(): boolean {
        return this.#internals.reportValidity();
    }

    public formStateRestoreCallback(state: File | string | FormData | null): void {
        if (typeof state === "string") {
            this.value = state;
        }
    }

    public formResetCallback(): void {
        this.value = this.#defaultValue;
        this.#synchronizeRadios();
    }

    public handleSlotChange(): void {
        this.radios = this.#ownedRadios();
        this.#synchronizeRadios();
    }

    public radiosChanged(): void {
        this.#synchronizeRadios();
    }

    public labelChanged(): void {
        this.#syncAccessibilityState();
    }

    public supportingTextChanged(): void {
        this.#syncAccessibilityState();
    }

    public errorTextChanged(): void {
        this.#syncFormState();
    }

    public valueChanged(): void {
        if (this.#synchronizing) {
            return;
        }

        this.#synchronizeRadios();
    }

    public nameChanged(): void {
        this.#synchronizeRadios();
    }

    public disabledChanged(): void {
        this.#synchronizeRadios();
    }

    public invalidChanged(): void {
        this.#syncAccessibilityState();
        this.#syncFormState();
    }

    public requiredChanged(): void {
        this.#syncAccessibilityState();
        this.#syncFormState();
    }

    public orientationChanged(): void {
        this.#syncAccessibilityState();
    }

    #ownedRadios(): VioletRadio[] {
        return Array.from(this.querySelectorAll("violet-radio")).filter(
            (radio): radio is VioletRadio => radio.closest("violet-radio-group") === this
        );
    }

    #selectedRadio(): VioletRadio | null {
        if (this.value) {
            const matchingValue = this.radios.find(radio => radio.value === this.value);
            if (matchingValue) {
                return matchingValue;
            }
        }

        return this.radios.find(radio => radio.checked) ?? null;
    }

    #enabledRadios(): VioletRadio[] {
        return this.radios.filter(radio => !radio.effectiveDisabled);
    }

    #synchronizeRadios(options: { focusTarget?: VioletRadio | null } = {}): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        const selectedRadio = this.#selectedRadio();
        const nextValue = selectedRadio?.value ?? "";
        const enabledRadios = this.#enabledRadios();
        const focusTarget =
            (!options.focusTarget || options.focusTarget.effectiveDisabled ? null : options.focusTarget) ??
            (selectedRadio && !selectedRadio.effectiveDisabled ? selectedRadio : null) ??
            enabledRadios[0] ??
            null;

        this.#synchronizing = true;

        this.radios.forEach(radio => {
            // Radios may not be upgraded yet when the group connects; upgrade them now, and skip any that still
            // lack the API (a later slotchange pass re-synchronizes once they are ready).
            customElements.upgrade(radio);
            if (typeof radio.setGroupDisabled !== "function") {
                return;
            }
            radio.setGroupDisabled(this.effectiveDisabled);
            if (this.name) {
                radio.name = this.name;
            }
            radio.setCheckedFromGroup(Boolean(selectedRadio) && radio === selectedRadio);
            radio.setManagedTabIndex(focusTarget && radio === focusTarget ? 0 : -1);
        });

        this.value = nextValue;
        this.#synchronizing = false;

        this.#syncAccessibilityState();
        this.#syncFormState();
    }

    #selectRadio(radio: VioletRadio, options: { emitChange?: boolean; focus?: boolean } = {}): void {
        if (!this.radios.includes(radio) || radio.effectiveDisabled) {
            return;
        }

        const previousValue = this.value;
        this.value = radio.value;
        this.#synchronizeRadios({ focusTarget: radio });

        if (options.focus) {
            radio.focus();
        }

        if (options.emitChange && this.value !== previousValue) {
            this.$emit("change", { value: this.value });
        }
    }

    #radioFromEvent(event: Event): VioletRadio | null {
        const composedPath = event.composedPath();
        for (const item of composedPath) {
            if (item instanceof HTMLElement && item.tagName.toLowerCase() === "violet-radio") {
                return item as VioletRadio;
            }
        }

        return null;
    }

    #syncAccessibilityState(): void {
        this.#internals.ariaDisabled = this.effectiveDisabled ? "true" : "false";
        this.#internals.ariaOrientation = this.orientation;
        this.#internals.ariaRequired = this.required ? "true" : "false";

        const labelElement = this.shadowRoot?.querySelector(".label");
        const supportingElement = this.shadowRoot?.querySelector(".supporting");
        const errorElement = this.shadowRoot?.querySelector(".error");

        if (labelElement instanceof Element && !this.getAttribute("aria-label")) {
            this.#internals.ariaLabelledByElements = [labelElement];
            this.#internals.ariaLabel = null;
        } else {
            this.#internals.ariaLabelledByElements = null;
            this.#internals.ariaLabel = this.getAttribute("aria-label") || this.label || null;
        }

        this.#internals.ariaDescribedByElements = supportingElement instanceof Element ? [supportingElement] : null;
        this.#internals.ariaErrorMessageElements = errorElement instanceof Element ? [errorElement] : null;
    }

    #syncFormState(): void {
        this.#internals.setFormValue(this.effectiveDisabled || !this.value ? null : this.value);

        if (this.effectiveDisabled) {
            this.validationMessageText = "";
            this.#internals.setValidity({});
            this.#internals.ariaInvalid = "false";
            return;
        }

        if (this.invalid) {
            this.validationMessageText = this.errorText || "Please select a valid option.";
            this.#internals.setValidity({ customError: true }, this.validationMessageText);
            this.#internals.ariaInvalid = "true";
            this.#syncAccessibilityState();
            return;
        }

        if (this.required && !this.value) {
            this.validationMessageText = this.errorText || "Please select an option.";
            this.#internals.setValidity({ valueMissing: true }, this.validationMessageText);
            this.#internals.ariaInvalid = "true";
            this.#syncAccessibilityState();
            return;
        }

        this.validationMessageText = "";
        this.#internals.setValidity({});
        this.#internals.ariaInvalid = "false";
        this.#syncAccessibilityState();
    }

    handleRadioChange = (event: Event): void => {
        const radio = this.#radioFromEvent(event);
        if (!radio) {
            return;
        }

        if (this.#synchronizing) {
            return;
        }

        this.#selectRadio(radio, { emitChange: true, focus: false });
    };

    handleKeydown = (event: KeyboardEvent): void => {
        const currentRadio = this.#radioFromEvent(event);
        if (!currentRadio || this.effectiveDisabled) {
            return;
        }

        const enabledRadios = this.#enabledRadios();
        if (!enabledRadios.length) {
            return;
        }

        const currentIndex = enabledRadios.indexOf(currentRadio);

        switch (logicalArrowKey(event.key, this)) {
            case "ArrowDown":
            case "ArrowRight": {
                event.preventDefault();
                const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % enabledRadios.length : 0;
                this.#selectRadio(enabledRadios[nextIndex]!, { emitChange: true, focus: true });
                break;
            }
            case "ArrowUp":
            case "ArrowLeft": {
                event.preventDefault();
                const nextIndex =
                    currentIndex >= 0 ? (currentIndex - 1 + enabledRadios.length) % enabledRadios.length : enabledRadios.length - 1;
                this.#selectRadio(enabledRadios[nextIndex]!, { emitChange: true, focus: true });
                break;
            }
            case "Home": {
                event.preventDefault();
                this.#selectRadio(enabledRadios[0]!, { emitChange: true, focus: true });
                break;
            }
            case "End": {
                event.preventDefault();
                this.#selectRadio(enabledRadios[enabledRadios.length - 1]!, { emitChange: true, focus: true });
                break;
            }
            case " ":
            case "Enter": {
                event.preventDefault();
                this.#selectRadio(currentRadio, { emitChange: true, focus: true });
                break;
            }
            default:
                break;
        }
    };
}

attr(VioletRadioGroup.prototype, "label");
attr({ attribute: "supporting-text" })(VioletRadioGroup.prototype, "supportingText");
attr({ attribute: "error-text" })(VioletRadioGroup.prototype, "errorText");
attr(VioletRadioGroup.prototype, "value");
attr(VioletRadioGroup.prototype, "name");
attr({ mode: "boolean" })(VioletRadioGroup.prototype, "disabled");
installFormDisabled(VioletRadioGroup.prototype);
attr({ mode: "boolean" })(VioletRadioGroup.prototype, "invalid");
attr({ mode: "boolean" })(VioletRadioGroup.prototype, "required");
attr(VioletRadioGroup.prototype, "orientation");

if (!customElements.get("violet-radio-group")) {
    await FASTElement.define(VioletRadioGroup, {
        name: "violet-radio-group",
        template,
        styles,
        shadowOptions: {
            delegatesFocus: true,
        },
    });
}
