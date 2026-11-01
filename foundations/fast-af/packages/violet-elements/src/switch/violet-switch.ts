import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";
import { installFormDisabled } from "../foundations/violet-form-disabled";

let violetSwitchId = 0;

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
        --_thumb-resting: var(--color-text-muted, #616775);
        --_radius-full: var(--radius-round, 9999px);
        --_size-font-md: var(--size-font-md, 14px);
        --_track-block-size: clamp(20px, calc(var(--_target-size) - 10px), 24px);
        --_track-inline-size: calc(var(--_track-block-size) * 2);
        --_track-border-width: 1px;
        --_track-padding: 2px;
        --_thumb-size: clamp(16px, calc(var(--_track-block-size) - 4px), 20px);
        --_thumb-offset: calc(
            var(--_track-inline-size) -
            var(--_thumb-size) -
            (var(--_track-padding) * 2) -
            (var(--_track-border-width) * 2)
        );
        --_type-body-line: var(--type-body-md-line, 20px);
        --_type-caption-line: var(--type-caption-xs-line, 14px);
    }

    :host([inline]) {
        --_target-size: var(--violet-switch-inline-target-size, var(--_target-size-compact));
        --_space-inline-sm: var(--violet-switch-inline-gap, 4px);
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

    .track {
        box-sizing: border-box;
        position: relative;
        display: inline-block;
        inline-size: var(--_track-inline-size);
        block-size: var(--_track-block-size);
        border: var(--_track-border-width) solid var(--_border-strong);
        border-radius: var(--_radius-full);
        background: var(--_surface-card);
        box-shadow: var(--_shadow-control);
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
        border-radius: var(--_radius-full);
        background: var(--_thumb-resting);
        transform: translate(0, -50%);
        transform-origin: center;
        transition:
            transform var(--_duration-base) var(--_easing-standard),
            background-color var(--_duration-fast) var(--_easing-standard);
    }

    .input:checked + .track {
        background: var(--_selection-background);
        border-color: var(--_selection-border);
    }

    .input:checked + .track .thumb {
        transform: translate(var(--_thumb-offset), -50%);
        background: var(--_selection-text);
    }

    .input:focus-visible + .track {
        box-shadow:
            var(--_shadow-control),
            0 0 0 2px var(--_focus-ring);
    }

    :host([invalid]) .track {
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
        .track {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
        }

        .thumb {
            background: ButtonText;
        }

        .input:checked + .track {
            border-color: Highlight;
            background: Highlight;
        }

        .input:checked + .track .thumb {
            background: HighlightText;
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
        <span class="content" ?hidden="${x => x.inline && !x.hasLabel && !x.hasSupporting}">
            <label class="label" part="label" for="${x => x.controlId}" ?hidden="${x => x.inline && !x.hasLabel}">
                <slot @slotchange="${x => x.handleDefaultSlotChange()}"></slot>
            </label>
            <span
                class="supporting"
                id="${x => x.supportingTextId}"
                part="supporting-text"
                ?hidden="${x => !x.hasSupporting}"
            >
                <slot name="supporting" @slotchange="${x => x.handleSupportingSlotChange()}"></slot>
            </span>
        </span>
    </div>
`;

/**
 * Violet reusable switch primitive.
 *
 * @summary Token-driven binary switch with label, inline mode, and form participation.
 * @fires change - Emitted when the checked state changes.
 * @slot - Switch label content.
 * @slot supporting - Optional supporting copy rendered under the label.
 * @csspart root - Root switch wrapper.
 * @csspart input - Native checkbox input carrying switch semantics.
 * @csspart control - Visible switch track.
 * @csspart thumb - Switch thumb inside the track.
 * @csspart label - Primary label text wrapper.
 * @csspart supporting-text - Optional supporting text wrapper.
 */
export class VioletSwitch extends FASTElement {
    public static readonly formAssociated = true;

    readonly #internals: ElementInternals;
    #defaultChecked: boolean;

    @observable
    declare public hasSupporting: boolean;

    @observable
    declare public hasLabel: boolean;

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
    declare public name: string;
    declare public value: string;
    declare public required: boolean;

    public readonly controlId: string;
    public readonly supportingTextId: string;

    public constructor() {
        super();
        this.#internals = this.attachInternals();
        const id = violetSwitchId;
        violetSwitchId += 1;
        this.controlId = `${this.localName || "violet-switch"}-control-${id}`;
        this.supportingTextId = `${this.localName || "violet-switch"}-supporting-${id}`;
        this.hasSupporting = false;
        this.hasLabel = false;
        this.checked = false;
        this.disabled = false;
        this.inline = false;
        this.invalid = false;
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

        if (this.hasSupporting) {
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
            this.#internals.setValidity({});
            return;
        }

        if (this.invalid) {
            this.#internals.setValidity({ customError: true }, "Please correct this field.", control ?? undefined);
            return;
        }

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
attr(VioletSwitch.prototype, "name");
attr(VioletSwitch.prototype, "value");
attr({ mode: "boolean" })(VioletSwitch.prototype, "required");

if (!customElements.get("violet-switch")) {
    await FASTElement.define(VioletSwitch, {
        name: "violet-switch",
        template,
        styles,
        shadowOptions: {
            delegatesFocus: true,
        },
    });
}
