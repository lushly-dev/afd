import { FASTElement, attr, css, html, observable, when } from "@lushly-dev/fast-element";

import "../segment/violet-segment";
import type { VioletSegment } from "../segment/violet-segment";
import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";
import { installFormDisabled } from "../foundations/violet-form-disabled";
import { logicalArrowKey } from "../foundations/violet-direction";

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
        display: inline-flex;
        align-items: stretch;
        gap: 2px;
        padding: 2px;
        border: 1px solid var(--_border-subtle);
        border-radius: var(--_radius-lg);
        background: var(--_surface-subtle);
        box-shadow: var(--_shadow-control);
        min-inline-size: 0;
    }

    :host([disabled]) .group,
    :host(:disabled) .group {
        opacity: 0.7;
    }

    :host([invalid]) .group {
        border-color: var(--_danger-border);
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

    @media (forced-colors: active) {
        .group {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: ButtonText;
            box-shadow: none;
        }
    }
`;

const template = html<VioletSegmentedControl>`
    <div class="field" part="field">
        ${when(
            x => Boolean(x.label),
            html<VioletSegmentedControl>`
                <div class="label" part="label">${x => x.label}</div>
            `,
        )}
        <div class="group" part="group">
            <slot @slotchange="${x => x.handleSlotChange()}"></slot>
        </div>
        ${when(
            x => Boolean(x.supportingText),
            html<VioletSegmentedControl>`
                <p class="supporting" part="supporting-text">${x => x.supportingText}</p>
            `,
        )}
        ${when(
            x => Boolean(x.validationMessageText),
            html<VioletSegmentedControl>`
                <p class="error" part="error-message">${x => x.validationMessageText}</p>
            `,
        )}
    </div>
`;

/**
 * Violet segmented control.
 *
 * @summary Token-driven single-selection choice group composed from `violet-segment` items.
 * @fires change - Emitted when the selected value changes.
 * @slot - `violet-segment` options rendered inside the group.
 * @csspart field - Field wrapper.
 * @csspart label - Group label text element.
 * @csspart group - Segmented surface wrapper.
 * @csspart supporting-text - Supporting text element.
 */
export class VioletSegmentedControl extends FASTElement {
    public static readonly formAssociated = true;

    readonly #internals: ElementInternals;
    #defaultValue: string;
    #synchronizing: boolean;

    @observable
    declare public segments: VioletSegment[];

    @observable
    declare public validationMessageText: string;

    declare public label: string;
    declare public supportingText: string;
    declare public errorText: string;
    declare public value: string;
    declare public name: string;
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
    declare public required: boolean;

    public constructor() {
        super();
        this.#internals = this.attachInternals();
        this.#internals.role = "radiogroup";
        this.#defaultValue = "";
        this.#synchronizing = false;
        this.segments = [];
        this.validationMessageText = "";
        this.label = "";
        this.supportingText = "";
        this.errorText = "";
        this.value = "";
        this.name = "";
        this.disabled = false;
        this.invalid = false;
        this.required = false;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        if (this.name && this.getAttribute("name") !== this.name) {
            this.setAttribute("name", this.name);
        }
        this.addEventListener("select-request", this.handleSelectRequest as EventListener);
        this.addEventListener("disabled-change", this.handleSegmentDisabledChange as EventListener);
        this.addEventListener("keydown", this.handleKeydown as EventListener);
        this.handleSlotChange();
        this.#defaultValue = this.value;
        this.#syncAccessibilityState();
        this.#syncFormState();
    }

    public disconnectedCallback(): void {
        this.removeEventListener("select-request", this.handleSelectRequest as EventListener);
        this.removeEventListener("disabled-change", this.handleSegmentDisabledChange as EventListener);
        this.removeEventListener("keydown", this.handleKeydown as EventListener);
        super.disconnectedCallback();
    }

    public formStateRestoreCallback(state: File | string | FormData | null): void {
        if (typeof state === "string") {
            this.value = state;
        }
    }

    public formResetCallback(): void {
        this.value = this.#defaultValue;
        this.#synchronizeSegments();
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

    public handleSlotChange(): void {
        this.segments = this.#ownedSegments();
        this.#synchronizeSegments();
    }

    public valueChanged(): void {
        if (!this.#synchronizing) {
            this.#synchronizeSegments();
        }
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

    public nameChanged(): void {
        if (this.$fastController.isConnected && this.name && this.getAttribute("name") !== this.name) {
            this.setAttribute("name", this.name);
        }
        this.#syncFormState();
    }

    public disabledChanged(): void {
        this.#synchronizeSegments();
    }

    public invalidChanged(): void {
        this.#syncAccessibilityState();
        this.#syncFormState();
    }

    public requiredChanged(): void {
        this.#syncFormState();
    }

    public handleSelectRequest(event: CustomEvent<{ value: string }>): void {
        const segment = event.target as VioletSegment | null;
        if (!segment || !this.segments.includes(segment)) {
            return;
        }

        this.value = event.detail?.value ?? segment.value;
        this.#synchronizeSegments();
        this.$emit("change");
    }

    /**
     * A segment's own `disabled` changed after render, which can move the group's Tab stop.
     */
    public handleSegmentDisabledChange(event: Event): void {
        const segment = event.target as VioletSegment | null;
        if (segment && this.segments.includes(segment)) {
            this.#synchronizeSegments();
        }
    }

    public handleKeydown(event: KeyboardEvent): void {
        const currentSegment = event.composedPath().find(
            value => value instanceof HTMLElement && value.tagName.toLowerCase() === "violet-segment",
        ) as VioletSegment | undefined;

        if (!currentSegment) {
            return;
        }

        const enabledSegments = this.segments.filter(segment => !segment.effectiveDisabled);
        const currentIndex = enabledSegments.indexOf(currentSegment);
        if (currentIndex < 0) {
            return;
        }

        let target: VioletSegment | undefined;
        switch (logicalArrowKey(event.key, this)) {
            case "ArrowRight":
            case "ArrowDown":
                target = enabledSegments[(currentIndex + 1) % enabledSegments.length];
                break;
            case "ArrowLeft":
            case "ArrowUp":
                target = enabledSegments[(currentIndex - 1 + enabledSegments.length) % enabledSegments.length];
                break;
            case "Home":
                target = enabledSegments[0];
                break;
            case "End":
                target = enabledSegments.at(-1);
                break;
            default:
                return;
        }

        event.preventDefault();
        if (!target) {
            return;
        }

        const previousValue = this.value;
        this.value = target.value;
        this.#synchronizeSegments();
        target.focusButton();
        // Arrow selection is user selection, as in a native radio group.
        if (this.value !== previousValue) {
            this.$emit("change");
        }
    }

    #synchronizeSegments(): void {
        this.#synchronizing = true;
        const segments = this.#ownedSegments();
        this.segments = segments;

        const isChecked = (segment: VioletSegment) => Boolean(this.value) && segment.value === this.value;
        // One Tab stop per group: the checked segment, or the first enabled one when none is checked.
        const enabledSegments = this.effectiveDisabled ? [] : segments.filter(segment => !segment.disabled);
        const tabStop = enabledSegments.find(isChecked) ?? enabledSegments[0];

        for (const segment of segments) {
            segment.toggleAttribute("checked", isChecked(segment));
            // Segments may not be upgraded yet; the slotchange pass re-synchronizes once they are.
            segment.setGroupDisabled?.(this.effectiveDisabled);
            segment.setManagedTabIndex?.(segment === tabStop ? 0 : -1);
        }

        this.#synchronizing = false;
        this.#syncAccessibilityState();
        this.#syncFormState();
    }

    #syncAccessibilityState(): void {
        const descriptions: string[] = [];
        if (this.supportingText) {
            descriptions.push("supporting-text");
        }
        if (this.invalid && this.validationMessageText) {
            descriptions.push("error-message");
        }

        this.#internals.ariaLabel = this.label || null;
        this.#internals.ariaDisabled = this.effectiveDisabled ? "true" : null;
        this.#internals.ariaRequired = this.required ? "true" : null;
        this.#internals.ariaInvalid = this.invalid ? "true" : null;
        this.#internals.ariaDescribedByElements = descriptions
            .map(part => this.shadowRoot?.querySelector(`[part="${part}"]`))
            .filter((element): element is Element => element instanceof Element);
    }

    #syncFormState(): void {
        if (this.invalid) {
            this.validationMessageText = this.errorText || "Please choose an option.";
        } else if (this.required && !this.value) {
            this.validationMessageText = this.errorText || "Please choose an option.";
        } else {
            this.validationMessageText = "";
        }

        const shouldBeInvalid = this.invalid || (this.required && !this.value);
        if (shouldBeInvalid) {
            this.#internals.setValidity({ valueMissing: !this.value }, this.validationMessageText);
        } else {
            this.#internals.setValidity({});
        }

        this.#internals.setFormValue(this.value || null, this.value || null);
    }

    #ownedSegments(): VioletSegment[] {
        return Array.from(this.querySelectorAll("violet-segment")).filter(
            segment => segment.closest("violet-segmented-control") === this,
        ) as VioletSegment[];
    }
}

attr(VioletSegmentedControl.prototype, "label");
attr({ attribute: "supporting-text" })(VioletSegmentedControl.prototype, "supportingText");
attr({ attribute: "error-text" })(VioletSegmentedControl.prototype, "errorText");
attr(VioletSegmentedControl.prototype, "value");
attr(VioletSegmentedControl.prototype, "name");
attr({ mode: "boolean" })(VioletSegmentedControl.prototype, "disabled");
installFormDisabled(VioletSegmentedControl.prototype);
attr({ mode: "boolean" })(VioletSegmentedControl.prototype, "invalid");
attr({ mode: "boolean" })(VioletSegmentedControl.prototype, "required");

if (!customElements.get("violet-segmented-control")) {
    await FASTElement.define(VioletSegmentedControl, {
        name: "violet-segmented-control",
        template,
        styles,
    });
}
