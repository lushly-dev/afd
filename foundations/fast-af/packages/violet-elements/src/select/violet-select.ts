import { attr, css, FASTElement, html, observable, when } from "@lushly-dev/fast-element";

import "../option/violet-option";
import {
    getEnabledOptions,
    getNextEnabledIndex,
    getOwnedOptions,
    getSelectedOption,
    normalizeMatchText,
    syncOptionSelection,
} from "../listbox/violet-selection-helpers";
import type { VioletOption } from "../option/violet-option";
import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";
import { installFormDisabled } from "../foundations/violet-form-disabled";

let violetSelectCount = 0;

function isComposingKeyboardEvent(event: KeyboardEvent): boolean {
    return event.isComposing || event.keyCode === 229;
}

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        position: relative;
        display: grid;
    }

    .field {
        display: grid;
        gap: 0;
    }

    .control-shell {
        position: relative;
        display: grid;
    }

    .control-shell.open {
        z-index: var(--_layer-raised);
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin-block-end: var(--_space-stack-xs);
    }

    .trigger {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: var(--_space-inline-sm);
        inline-size: 100%;
        min-block-size: var(--_target-size);
        padding-inline: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
        border: 1px solid var(--_border-subtle);
        border-radius: var(--_radius-md);
        background: var(--_surface-page);
        color: var(--color-text-primary, #18181b);
        box-shadow: var(--_shadow-control);
        cursor: pointer;
        font-family: inherit;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        text-align: start;
        transition:
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .trigger:hover {
        border-color: var(--color-field-border-hover, rgba(28, 26, 13, 0.48));
    }

    .trigger:focus-visible,
    .control-shell.open .trigger {
        outline: none;
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px var(--_focus-ring);
        transform: translateY(calc(var(--_space-inline-sm) / -4));
    }

    :host([disabled]) .trigger,
    :host(:disabled) .trigger {
        opacity: 0.65;
        cursor: not-allowed;
    }

    :host([invalid]) .trigger {
        border-color: var(--_danger-border);
    }

    .value {
        flex: 1 1 auto;
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .value[data-placeholder="true"] {
        color: var(--_text-muted);
    }

    .caret {
        inline-size: 0.5rem;
        block-size: 0.5rem;
        flex: 0 0 auto;
        border-inline-end: 1.5px solid currentColor;
        border-block-end: 1.5px solid currentColor;
        transform: translateY(-1px) rotate(45deg);
        opacity: 0.8;
    }

    .panel {
        box-sizing: border-box;
        position: fixed;
        inset: unset;
        z-index: var(--_layer-popover);
        inline-size: var(--_panel-inline-size, auto);
        max-inline-size: calc(100vw - 8px);
        max-block-size: min(18rem, 60vh);
        padding: var(--_space-inline-sm);
        border: thin solid var(--_border-subtle);
        border-radius: calc(var(--_radius-md) * 2);
        overflow: hidden;
        background: var(--_surface-card);
        box-shadow: var(--_shadow-floating);
        color: inherit;
    }

    .panel[hidden] {
        display: none;
    }

    .listbox {
        display: grid;
        gap: 2px;
        max-block-size: inherit;
        overflow: auto;
        outline: none;
    }

    .listbox:focus-visible {
        outline: none;
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
        .trigger,
        .panel {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: ButtonText;
            box-shadow: none;
        }

        .trigger:focus-visible,
        .control-shell.open .trigger {
            box-shadow: 0 0 0 2px Highlight;
            border-color: Highlight;
        }
    }
`;

const template = html<VioletSelect>`
    <div class="field" part="field">
        ${when(
            x => Boolean(x.label),
            html<VioletSelect>`
                <div class="label" part="label" id="${x => x.labelId}">${x => x.label}</div>
            `
        )}
        <div
            class="control-shell"
            part="control-shell"
            @focusout="${(x, c) => x.handleControlFocusOut(c.event as FocusEvent)}"
        >
            <button
                id="${x => x.triggerId}"
                class="trigger"
                part="trigger"
                type="button"
                ?disabled="${x => x.effectiveDisabled}"
                aria-haspopup="listbox"
                aria-expanded="false"
                aria-controls="${x => x.listboxId}"
                aria-labelledby="${x => x.label ? `${x.labelId} ${x.valueId}` : x.valueId}"
                aria-describedby="${x => x.describedBy || null}"
                aria-invalid="${x => x.invalid ? "true" : "false"}"
                @click="${x => x.handleTriggerClick()}"
                @keydown="${(x, c) => x.handleTriggerKeydown(c.event as KeyboardEvent)}"
            >
                <span id="${x => x.valueId}" class="value" data-placeholder="${x => String(!x.selectedLabel && !x.value)}">
                    ${x => x.selectedLabel || x.value || x.placeholder || "Select an option"}
                </span>
                <span class="caret" part="caret" aria-hidden="true"></span>
            </button>

            <div class="panel" part="panel" hidden>
                <div
                    id="${x => x.listboxId}"
                    class="listbox"
                    part="listbox"
                    role="listbox"
                    tabindex="-1"
                    aria-labelledby="${x => x.label ? `${x.labelId} ${x.valueId}` : x.valueId}"
                    @keydown="${(x, c) => x.handleListboxKeydown(c.event as KeyboardEvent)}"
                >
                    <slot @slotchange="${x => x.handleSlotChange()}"></slot>
                </div>
            </div>
        </div>

        ${when(
            x => Boolean(x.supportingText),
            html<VioletSelect>`
                <p class="supporting" part="supporting-text" id="${x => x.supportingId}">${x => x.supportingText}</p>
            `
        )}
        ${when(
            x => Boolean(x.displayErrorText),
            html<VioletSelect>`
                <p class="error" part="error-message" id="${x => x.errorId}">${x => x.displayErrorText}</p>
            `
        )}
    </div>
`;

export class VioletSelect extends FASTElement {
    public static readonly formAssociated = true;

    readonly #internals: ElementInternals;
    #defaultValue: string;
    #typeaheadBuffer = "";
    #typeaheadTimer = 0;

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

    readonly #handleFocusOut = (event: FocusEvent) => {
        this.handleControlFocusOut(event);
    };

    @observable
    declare public open: boolean;

    @observable
    declare public validationMessageText: string;

    @observable
    declare public activeValue: string;

    declare public label: string;
    declare public placeholder: string;
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

    public readonly triggerId: string;
    public readonly labelId: string;
    public readonly valueId: string;
    public readonly listboxId: string;
    public readonly supportingId: string;
    public readonly errorId: string;

    public constructor() {
        super();
        this.#internals = this.attachInternals();
        this.#defaultValue = "";
        this.open = false;
        this.validationMessageText = "";
        this.label = "";
        this.placeholder = "";
        this.supportingText = "";
        this.errorText = "";
        this.value = "";
        this.activeValue = "";
        this.name = "";
        this.required = false;
        this.disabled = false;
        this.invalid = false;

        violetSelectCount += 1;
        this.triggerId = `violet-select-trigger-${violetSelectCount}`;
        this.labelId = `violet-select-label-${violetSelectCount}`;
        this.valueId = `violet-select-value-${violetSelectCount}`;
        this.listboxId = `violet-select-listbox-${violetSelectCount}`;
        this.supportingId = `violet-select-supporting-${violetSelectCount}`;
        this.errorId = `violet-select-error-${violetSelectCount}`;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        if (this.name && this.getAttribute("name") !== this.name) {
            this.setAttribute("name", this.name);
        }
        this.addEventListener("request-select", this.handleRequestSelect as EventListener);
        this.addEventListener("focusout", this.#handleFocusOut);
        this.ownerDocument.addEventListener("pointerdown", this.#handleDocumentPointerDown, true);
        window.addEventListener("resize", this.#handleViewportChange);
        window.addEventListener("scroll", this.#handleViewportChange, true);
        this.handleSlotChange();
        this.#defaultValue = this.value;
        this.#syncFormState();
        this.openChanged();
    }

    public disconnectedCallback(): void {
        this.removeEventListener("request-select", this.handleRequestSelect as EventListener);
        this.removeEventListener("focusout", this.#handleFocusOut);
        this.ownerDocument.removeEventListener("pointerdown", this.#handleDocumentPointerDown, true);
        window.removeEventListener("resize", this.#handleViewportChange);
        window.removeEventListener("scroll", this.#handleViewportChange, true);
        super.disconnectedCallback();
    }

    public get options(): VioletOption[] {
        return getOwnedOptions(this);
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

    public get selectedLabel(): string {
        return this.options.find(option => option.value === this.value)?.labelText ?? "";
    }

    public get activeOptionId(): string {
        return this.options.find(option => option.value === this.activeValue)?.optionId ?? "";
    }

    public get describedBy(): string {
        return [this.supportingText ? this.supportingId : "", this.displayErrorText ? this.errorId : ""]
            .filter(Boolean)
            .join(" ");
    }

    public get displayErrorText(): string {
        return !this.effectiveDisabled && (this.invalid || (this.required && !this.value))
            ? this.errorText || "Please select an option."
            : "";
    }

    public formStateRestoreCallback(state: File | string | FormData | null): void {
        if (typeof state === "string") {
            this.value = state;
        }
    }

    public formResetCallback(): void {
        this.value = this.#defaultValue;
        this.handleSlotChange();
    }

    public handleSlotChange(): void {
        const selected = getSelectedOption(this.options, this.value);
        const enabled = getEnabledOptions(this.options);

        if (!this.value) {
            this.value = selected?.value ?? "";
        }

        if (!this.activeValue || !enabled.some(option => option.value === this.activeValue)) {
            this.activeValue = selected?.value ?? enabled[0]?.value ?? "";
        }

        this.#syncOptions();
        this.#syncFormState();
    }

    public handleTriggerClick(): void {
        if (this.effectiveDisabled) {
            return;
        }

        this.open ? this.hide() : this.show();
    }

    public handleTriggerKeydown(event: KeyboardEvent): boolean {
        if (isComposingKeyboardEvent(event)) {
            return true;
        }

        if (this.effectiveDisabled) {
            return true;
        }

        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                this.show();
                this.#moveActive(1);
                return false;
            case "ArrowUp":
                event.preventDefault();
                this.show();
                this.#moveActive(-1);
                return false;
            case "Enter":
            case " ": {
                event.preventDefault();
                this.show();
                return false;
            }
            default:
                if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
                    this.#queueTypeahead(event.key);
                }
                return true;
        }
    }

    public handleListboxKeydown(event: KeyboardEvent): boolean {
        if (isComposingKeyboardEvent(event) || !this.open) {
            return true;
        }

        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                this.#moveActive(1);
                return false;
            case "ArrowUp":
                event.preventDefault();
                this.#moveActive(-1);
                return false;
            case "Home":
                event.preventDefault();
                this.#setActive(getEnabledOptions(this.options)[0]?.value ?? "");
                return false;
            case "End": {
                event.preventDefault();
                const enabled = getEnabledOptions(this.options);
                this.#setActive(enabled.at(-1)?.value ?? "");
                return false;
            }
            case "Enter":
            case " ": {
                const active = getEnabledOptions(this.options).find(option => option.value === this.activeValue);
                if (!active) {
                    return true;
                }

                event.preventDefault();
                this.selectValue(active.value);
                return false;
            }
            case "Escape":
                event.preventDefault();
                this.hide();
                this.#focusTrigger();
                return false;
            case "Tab":
                return true;
            default:
                if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
                    this.#queueTypeahead(event.key);
                }
                return true;
        }
    }

    public handleControlFocusOut(event: FocusEvent): boolean {
        const relatedTarget = event.relatedTarget as Node | null;
        if (
            relatedTarget &&
            (relatedTarget === this || this.shadowRoot?.contains(relatedTarget) || this.contains(relatedTarget))
        ) {
            return true;
        }

        this.hide();
        return true;
    }

    public handleRequestSelect(event: CustomEvent<{ value?: string }>): void {
        event.stopPropagation();
        const nextValue = event.detail?.value ?? "";
        this.selectValue(nextValue);
    }

    public valueChanged(): void {
        this.#syncOptions();
        this.#syncFormState();
    }

    public nameChanged(): void {
        if (this.$fastController.isConnected && this.name && this.getAttribute("name") !== this.name) {
            this.setAttribute("name", this.name);
        }
    }

    public openChanged(): void {
        const shell = this.#controlShell;
        const panel = this.#panel;
        const trigger = this.#trigger;
        const listbox = this.#listbox;

        shell?.classList.toggle("open", this.open);
        panel?.toggleAttribute("hidden", !this.open);
        trigger?.setAttribute("aria-expanded", String(this.open));
        if (trigger) {
            trigger.tabIndex = this.open ? -1 : 0;
        }

        if (!listbox) {
            return;
        }

        listbox.tabIndex = this.open ? 0 : -1;

        if (this.open) {
            requestAnimationFrame(() => {
                this.#positionPanel();
                this.#listbox?.focus();
                this.#scrollActiveIntoView();
            });
        }
    }

    public requiredChanged(): void {
        this.#syncFormState();
    }

    public disabledChanged(): void {
        this.#syncFormState();
    }

    public invalidChanged(): void {
        this.#syncFormState();
    }

    public errorTextChanged(): void {
        this.#syncFormState();
    }

    public show(): void {
        if (this.effectiveDisabled || this.open) {
            return;
        }

        this.open = true;
        this.activeValue = this.value || getEnabledOptions(this.options)[0]?.value || "";
    }

    public hide(): void {
        this.open = false;
    }

    public selectValue(nextValue: string): void {
        const option = getEnabledOptions(this.options).find(candidate => candidate.value === nextValue) ?? null;
        if (!option) {
            return;
        }

        this.value = option.value;
        this.activeValue = option.value;
        this.hide();
        this.#syncOptions();
        this.#syncFormState();
        this.$emit("input", { value: this.value });
        this.$emit("change", { value: this.value });
        this.#focusTrigger();
    }

    #focusTrigger(): void {
        this.#trigger?.focus();
    }

    #moveActive(step: 1 | -1): void {
        const options = this.options;
        const currentIndex = options.findIndex(option => option.value === this.activeValue);
        const nextIndex = getNextEnabledIndex(options, currentIndex < 0 ? (step === 1 ? -1 : 0) : currentIndex, step);
        this.#setActive(options[nextIndex]?.value ?? "");
    }

    #setActive(nextValue: string): void {
        this.activeValue = nextValue;
        this.#syncOptions();
        this.#scrollActiveIntoView();
    }

    #queueTypeahead(key: string): void {
        window.clearTimeout(this.#typeaheadTimer);
        this.#typeaheadBuffer = `${this.#typeaheadBuffer}${key.toLowerCase()}`;
        const options = getEnabledOptions(this.options);
        const currentIndex = options.findIndex(option => option.value === this.activeValue);
        const ordered = currentIndex >= 0 ? [...options.slice(currentIndex + 1), ...options.slice(0, currentIndex + 1)] : options;
        const match = ordered.find(option => normalizeMatchText(option.labelText).startsWith(normalizeMatchText(this.#typeaheadBuffer)));

        if (match) {
            if (this.open) {
                this.#setActive(match.value);
            } else {
                this.selectValue(match.value);
            }
        }

        this.#typeaheadTimer = window.setTimeout(() => {
            this.#typeaheadBuffer = "";
        }, 500);
    }

    #scrollActiveIntoView(): void {
        const active = this.options.find(option => option.value === this.activeValue);
        active?.shadowRoot?.querySelector('[part="control"]')?.scrollIntoView({ block: "nearest" });
    }

    #positionPanel(): void {
        const panel = this.#panel;
        const trigger = this.#trigger;
        if (!panel || !trigger) {
            return;
        }

        const rect = trigger.getBoundingClientRect();
        const viewportPadding = 4;
        const gap = -1;

        let left = rect.left;
        let top = rect.bottom + gap;
        const width = Math.min(rect.width, window.innerWidth - viewportPadding * 2);

        panel.style.width = `${width}px`;
        panel.style.left = `${Math.max(viewportPadding, left)}px`;
        panel.style.top = `${Math.max(viewportPadding, top)}px`;

        requestAnimationFrame(() => {
            const panelRect = panel.getBoundingClientRect();

            if (panelRect.right > window.innerWidth - viewportPadding) {
                left = Math.max(viewportPadding, window.innerWidth - panelRect.width - viewportPadding);
            }

            if (panelRect.bottom > window.innerHeight - viewportPadding) {
                top = Math.max(viewportPadding, rect.top - panelRect.height + 1);
            }

            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
        });
    }

    get #controlShell(): HTMLElement | null {
        return this.shadowRoot?.querySelector(".control-shell") ?? null;
    }

    get #panel(): HTMLElement | null {
        return this.shadowRoot?.querySelector(".panel") ?? null;
    }

    get #listbox(): HTMLElement | null {
        return this.shadowRoot?.querySelector('[role="listbox"]') ?? null;
    }

    get #trigger(): HTMLButtonElement | null {
        return this.shadowRoot?.querySelector(".trigger") ?? null;
    }

    #syncOptions(): void {
        syncOptionSelection(this.options, this.value, this.activeValue);
        const listbox = this.#listbox;
        if (listbox) {
            listbox.ariaActiveDescendantElement =
                this.options.find(option => option.value === this.activeValue) ?? null;
        }
    }

    #syncFormState(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        const control = this.shadowRoot?.querySelector(".trigger") as HTMLButtonElement | null;
        const message = this.displayErrorText || this.errorText || "Please select an option.";
        const invalid = !this.effectiveDisabled && Boolean(this.displayErrorText);

        this.validationMessageText = this.displayErrorText;
        this.#internals.ariaInvalid = invalid ? "true" : "false";
        this.#internals.setFormValue(this.effectiveDisabled ? null : this.value || null, this.effectiveDisabled ? null : this.value || null);

        if (this.effectiveDisabled) {
            this.#internals.setValidity({});
            return;
        }

        if (this.invalid) {
            this.#internals.setValidity({ customError: true }, message, control ?? undefined);
            return;
        }

        if (this.required && !this.value) {
            this.#internals.setValidity({ valueMissing: true }, message, control ?? undefined);
            return;
        }

        this.#internals.setValidity({});
    }
}

attr(VioletSelect.prototype, "label");
attr(VioletSelect.prototype, "placeholder");
attr({ attribute: "supporting-text" })(VioletSelect.prototype, "supportingText");
attr({ attribute: "error-text" })(VioletSelect.prototype, "errorText");
attr(VioletSelect.prototype, "value");
attr(VioletSelect.prototype, "name");
attr({ mode: "boolean" })(VioletSelect.prototype, "required");
attr({ mode: "boolean" })(VioletSelect.prototype, "disabled");
installFormDisabled(VioletSelect.prototype);
attr({ mode: "boolean" })(VioletSelect.prototype, "invalid");
attr({ mode: "boolean" })(VioletSelect.prototype, "open");

if (!customElements.get("violet-select")) {
    await FASTElement.define(VioletSelect, {
        name: "violet-select",
        template,
        styles,
        shadowOptions: {
            delegatesFocus: true,
        },
    });
}
