import { FASTElement, attr, css, html, observable, when } from "@lushly-dev/fast-element";

import "../calendar/violet-calendar";
import type { VioletCalendar } from "../calendar/violet-calendar";
import "../icon/violet-icon";
import { registerSystemCalendarIcon } from "../icon/generated/icons/system-calendar";
import { formatDisplayDate, parseIsoDate } from "../date-time/violet-date-utils";
import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";
import { installFormDisabled } from "../foundations/violet-form-disabled";

export type VioletDatePickerSize = "compact" | "natural" | "comfortable";

let violetDatePickerCount = 0;
registerSystemCalendarIcon();

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        position: relative;
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
        margin-block-end: var(--_space-stack-xs);
    }

    .control-shell {
        position: relative;
        display: grid;
    }

    .control-shell.open {
        z-index: var(--_layer-raised);
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
        border: 1px solid var(--_field-border);
        border-radius: var(--_radius-md);
        background: var(--_surface-page);
        color: var(--color-text-primary, #18181b);
        box-shadow: var(--_shadow-control);
        transition:
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .control-frame:hover {
        border-color: var(--_field-border-hover);
    }

    .control-frame:focus-within,
    .control-shell.open .control-frame {
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px var(--_focus-ring);
        transform: translateY(calc(var(--_space-inline-sm) / -4));
    }

    :host([disabled]) .control-frame,
    :host(:disabled) .control-frame {
        opacity: 0.65;
        cursor: not-allowed;
    }

    :host([invalid]) .control-frame {
        border-color: var(--_danger-border);
    }

    .input {
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

    .input::-webkit-calendar-picker-indicator {
        display: none;
    }

    .toggle {
        display: inline-grid;
        place-items: center;
        inline-size: calc(var(--_target-size) * 0.75);
        block-size: calc(var(--_target-size) * 0.75);
        padding: 0;
        border: 1px solid transparent;
        border-radius: var(--_radius-round, 9999px);
        background: transparent;
        color: inherit;
        cursor: pointer;
    }

    .toggle:hover {
        background: color-mix(in srgb, var(--_focus-ring) 10%, transparent);
    }

    .toggle:focus-visible {
        outline: none;
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 35%, transparent);
    }

    .icon {
        display: inline-grid;
        place-items: center;
    }

    .icon violet-icon {
        --violet-icon-size: max(0.9rem, calc(var(--_target-size) * 0.33));
    }

    .display {
        display: none;
    }

    .panel {
        box-sizing: border-box;
        position: fixed;
        inset: unset;
        z-index: var(--_layer-popover);
        inline-size: var(--_panel-inline-size, auto);
        max-inline-size: calc(100vw - 8px);
        padding: 0;
        border: 0;
        background: transparent;
    }

    .panel[hidden] {
        display: none;
    }

    .supporting,
    .error {
        margin: 0;
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    .supporting {
        color: var(--_text-muted);
        margin-block-start: var(--_space-stack-2xs);
    }

    .error {
        color: var(--color-state-danger-foreground, #b42318);
        margin-block-start: var(--_space-stack-2xs);
    }

    .control-shell.open ~ .supporting,
    .control-shell.open ~ .error {
        visibility: hidden;
    }

    @media (forced-colors: active) {
        .control-frame {
            border-color: ButtonText;
        }

        .control-frame:focus-within,
        .control-shell.open .control-frame {
            outline: 2px solid Highlight;
            outline-offset: 1px;
        }

        .toggle:focus-visible {
            outline: 2px solid Highlight;
            outline-offset: 1px;
        }

        :host([disabled]) .control-frame,
        :host(:disabled) .control-frame {
            border-color: GrayText;
        }
    }
`;

const template = html<VioletDatePicker>`
    <div class="field" part="field">
        ${when(
            x => Boolean(x.label),
            html<VioletDatePicker>`<label class="label" part="label" for="${x => x.inputId}">${x => x.label}</label>`,
        )}
        <div class="${x => `control-shell${x.open ? " open" : ""}`}" part="control-shell">
            <div class="control-frame" part="control-frame">
                <input
                    id="${x => x.inputId}"
                    class="input"
                    part="input"
                    type="date"
                    name="${x => x.name}"
                    :value="${x => x.value}"
                    min="${x => x.min}"
                    max="${x => x.max}"
                    ?disabled="${x => x.effectiveDisabled}"
                    ?required="${x => x.required}"
                    aria-describedby="${x => x.describedBy || null}"
                    aria-invalid="${x => x.invalid ? "true" : "false"}"
                    @input="${(x, c) => x.handleInput(c.event)}"
                    @change="${(x, c) => x.handleCommit(c.event)}"
                    @keydown="${(x, c) => x.handleInputKeydown(c.event as KeyboardEvent)}"
                />
                <button
                    class="toggle"
                    part="toggle"
                    type="button"
                    ?disabled="${x => x.effectiveDisabled}"
                    aria-label="${x => (x.value ? "Change date" : "Choose date")}"
                    aria-haspopup="dialog"
                    aria-expanded="${x => String(x.open)}"
                    aria-controls="${x => x.panelId}"
                    @click="${x => x.toggleOpen()}"
                >
                    <span class="icon" aria-hidden="true">
                        <violet-icon icon="system/calendar" decorative></violet-icon>
                    </span>
                </button>
            </div>

            <div
                id="${x => x.panelId}"
                class="panel"
                part="panel"
                hidden
                @keydown="${(x, c) => x.handlePanelKeydown(c.event as KeyboardEvent)}"
            >
                <violet-calendar
                    selection-mode="single"
                    locale="${x => x.locale}"
                    value="${x => x.value}"
                    min="${x => x.min}"
                    max="${x => x.max}"
                    @input="${(x, c) => x.handleCalendarInput(c.event)}"
                    @change="${(x, c) => x.handleCalendarChange(c.event as CustomEvent<{ value?: string }>)}"
                ></violet-calendar>
            </div>
        </div>
        ${when(
            x => Boolean(x.supportingText),
            html<VioletDatePicker>`<p class="supporting" part="supporting-text" id="${x => x.supportingId}">${x => x.supportingText}</p>`,
        )}
        ${when(
            x => Boolean(x.displayErrorText),
            html<VioletDatePicker>`<p class="error" part="error-message" id="${x => x.errorId}">${x => x.displayErrorText}</p>`,
        )}
    </div>
`;

/**
 * Locale-aware date field with calendar popup selection.
 *
 * @summary Violet date picker composed from the field shell and calendar primitive.
 * @fires input - Emitted when the date value changes while editing or selecting.
 * @fires change - Emitted when the date value is committed.
 * @fires open-change - Emitted when the calendar popup opens or closes.
 */
export class VioletDatePicker extends FASTElement {
    public static readonly formAssociated = true;

    readonly #internals: ElementInternals;
    #defaultValue = "";

    readonly #handleViewportChange = () => {
        if (this.open) {
            this.#positionPanel();
        }
    };

    readonly #handleDocumentPointerDown = (event: PointerEvent) => {
        if (!this.open) {
            return;
        }

        if (event.composedPath().includes(this)) {
            return;
        }

        this.hide();
    };

    @observable
    declare public open: boolean;

    @observable
    declare public validationMessageText: string;

    declare public label: string;
    declare public supportingText: string;
    declare public errorText: string;
    declare public value: string;
    declare public name: string;
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
    declare public min: string;
    declare public max: string;
    declare public locale: string;
    declare public size: VioletDatePickerSize;

    public readonly inputId: string;
    public readonly supportingId: string;
    public readonly errorId: string;
    public readonly panelId: string;

    public constructor() {
        super();
        this.#internals = this.attachInternals();
        this.open = false;
        this.validationMessageText = "";
        this.label = "";
        this.supportingText = "";
        this.errorText = "";
        this.value = "";
        this.name = "";
        this.required = false;
        this.disabled = false;
        this.invalid = false;
        this.min = "";
        this.max = "";
        this.locale = "";
        this.size = "natural";

        violetDatePickerCount += 1;
        this.inputId = `violet-date-picker-input-${violetDatePickerCount}`;
        this.supportingId = `violet-date-picker-supporting-${violetDatePickerCount}`;
        this.errorId = `violet-date-picker-error-${violetDatePickerCount}`;
        this.panelId = `violet-date-picker-panel-${violetDatePickerCount}`;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.ownerDocument.addEventListener("pointerdown", this.#handleDocumentPointerDown, true);
        window.addEventListener("resize", this.#handleViewportChange);
        window.addEventListener("scroll", this.#handleViewportChange, true);
        this.#defaultValue = this.value;
        this.#syncFormState();
        this.openChanged();
    }

    public disconnectedCallback(): void {
        this.ownerDocument.removeEventListener("pointerdown", this.#handleDocumentPointerDown, true);
        window.removeEventListener("resize", this.#handleViewportChange);
        window.removeEventListener("scroll", this.#handleViewportChange, true);
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

    public get displayValue(): string {
        return this.value ? formatDisplayDate(this.locale, this.value) : "";
    }

    public get describedBy(): string {
        const ids = [
            this.supportingText ? this.supportingId : "",
            this.displayErrorText ? this.errorId : "",
        ].filter(Boolean);
        return ids.join(" ");
    }

    public get displayErrorText(): string {
        return this.validationMessageText || this.errorText;
    }

    public valueChanged(): void {
        this.#syncInputElement();
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

    public openChanged(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        const panel = this.panelElement;
        if (!panel) {
            return;
        }

        panel.hidden = !this.open;
        const shell = this.shadowRoot?.querySelector(".control-shell") as HTMLElement | null;
        shell?.classList.toggle("open", this.open);

        if (this.open) {
            this.#positionPanel();
            requestAnimationFrame(() => {
                (this.calendarElement?.shadowRoot?.querySelector('[tabindex="0"]') as HTMLElement | null)?.focus();
            });
        }

        this.$emit("open-change", { open: this.open });
    }

    public handleInput(event: Event): void {
        const control = event.currentTarget as HTMLInputElement | null;
        this.value = control?.value ?? "";
        this.#syncFormState();
        this.$emit("input", { value: this.value });
    }

    public handleCommit(event: Event): void {
        const control = event.currentTarget as HTMLInputElement | null;
        this.value = control?.value ?? "";
        this.#syncFormState();
        this.$emit("change", { value: this.value });
    }

    public handleInputKeydown(event: KeyboardEvent): boolean {
        if (this.effectiveDisabled) {
            return true;
        }

        if (event.key === "ArrowDown") {
            event.preventDefault();
            this.show();
            return false;
        }

        if (event.key === "Escape" && this.open) {
            event.preventDefault();
            this.hide();
            return false;
        }

        // Let every other key (typing, Tab, ...) reach the native input.
        return true;
    }

    /**
     * Dismisses the popup when Escape is pressed from anywhere inside the calendar and returns
     * focus to the input. A handled Escape is stopped so it does not also close an ancestor
     * dialog; Escape while closed and every other key are left alone.
     */
    public handlePanelKeydown(event: KeyboardEvent): boolean {
        if (event.key === "Escape" && this.open) {
            event.preventDefault();
            event.stopPropagation();
            this.hide();
            this.inputElement?.focus();
            return false;
        }

        return true;
    }

    /** The picker emits its own `input`; keep the calendar's composed one from escaping the shadow root. */
    public handleCalendarInput(event: Event): void {
        event.stopPropagation();
    }

    public handleCalendarChange(event: CustomEvent<{ value?: string }>): void {
        event.stopPropagation();
        const nextValue = event.detail?.value ?? "";
        if (!nextValue) {
            return;
        }

        this.value = nextValue;
        this.#syncFormState();
        this.hide();
        this.$emit("input", { value: this.value });
        this.$emit("change", { value: this.value });
        this.inputElement?.focus();
    }

    public show(): void {
        if (this.effectiveDisabled) {
            return;
        }

        this.open = true;
    }

    public hide(): void {
        this.open = false;
    }

    public toggleOpen(): void {
        this.open ? this.hide() : this.show();
    }

    public formStateRestoreCallback(state: File | string | FormData | null): void {
        if (typeof state === "string") {
            this.value = state;
        }
    }

    public formResetCallback(): void {
        this.value = this.#defaultValue;
        this.#syncFormState();
    }

    public checkValidity(): boolean {
        return this.#internals.checkValidity();
    }

    public reportValidity(): boolean {
        return this.#internals.reportValidity();
    }

    private get inputElement(): HTMLInputElement | null {
        return this.shadowRoot?.querySelector(".input") as HTMLInputElement | null;
    }

    private get panelElement(): HTMLElement | null {
        return this.shadowRoot?.querySelector(".panel") as HTMLElement | null;
    }

    private get calendarElement(): VioletCalendar | null {
        return this.shadowRoot?.querySelector("violet-calendar") as VioletCalendar | null;
    }

    #syncInputElement(): void {
        const input = this.inputElement;
        if (input && input.value !== this.value) {
            input.value = this.value;
        }
    }

    #syncFormState(): void {
        const input = this.inputElement;
        const valueMissing = this.required && !this.value;
        const customError = this.invalid ? this.errorText || "Select a valid date." : "";
        const nativeBadInput = this.value ? !parseIsoDate(this.value) : false;

        const parsedValue = this.value && !nativeBadInput;
        const rangeUnderflow = Boolean(parsedValue && parseIsoDate(this.min) && this.value < this.min);
        const rangeOverflow = Boolean(parsedValue && parseIsoDate(this.max) && this.value > this.max);

        this.validationMessageText =
            customError ||
            (valueMissing
                ? "Please choose a date."
                : nativeBadInput
                  ? "Enter a valid date."
                  : rangeUnderflow
                    ? `Choose a date on or after ${this.min}.`
                    : rangeOverflow
                      ? `Choose a date on or before ${this.max}.`
                      : "");

        this.#internals.setFormValue(this.value || null);
        this.#internals.setValidity(
            {
                valueMissing,
                customError: Boolean(customError),
                badInput: nativeBadInput,
                rangeUnderflow,
                rangeOverflow,
            },
            this.validationMessageText,
            input ?? undefined,
        );
    }

    #positionPanel(): void {
        const panel = this.panelElement;
        const frame = this.shadowRoot?.querySelector(".control-frame") as HTMLElement | null;
        if (!panel || !frame) {
            return;
        }

        const rect = frame.getBoundingClientRect();
        const inlineSize = Math.max(rect.width, 280);
        panel.style.inlineSize = `${inlineSize}px`;
        panel.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - inlineSize - 4))}px`;
        panel.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 320)}px`;
    }
}

attr({ mode: "boolean" })(VioletDatePicker.prototype, "open");
attr(VioletDatePicker.prototype, "label");
attr({ attribute: "supporting-text" })(VioletDatePicker.prototype, "supportingText");
attr({ attribute: "error-text" })(VioletDatePicker.prototype, "errorText");
attr(VioletDatePicker.prototype, "value");
attr(VioletDatePicker.prototype, "name");
attr({ mode: "boolean" })(VioletDatePicker.prototype, "required");
attr({ mode: "boolean" })(VioletDatePicker.prototype, "disabled");
installFormDisabled(VioletDatePicker.prototype);
attr({ mode: "boolean" })(VioletDatePicker.prototype, "invalid");
attr(VioletDatePicker.prototype, "min");
attr(VioletDatePicker.prototype, "max");
attr(VioletDatePicker.prototype, "locale");
attr(VioletDatePicker.prototype, "size");

if (!customElements.get("violet-date-picker")) {
    await FASTElement.define(VioletDatePicker, {
        name: "violet-date-picker",
        template,
        styles,
    });
}
