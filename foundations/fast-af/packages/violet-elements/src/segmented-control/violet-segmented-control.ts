import { FASTElement, Updates, attr, css, html, observable, when, type PartialFASTElementDefinition } from "@lushly-dev/fast-element";

import type { VioletSegment } from "../segment/violet-segment";
import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";
import { installFormDisabled } from "../foundations/violet-form-disabled";
import { logicalArrowKey } from "../foundations/violet-direction";
import { resolveFieldErrorText } from "../shared/field-error";

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        display: grid;
        /* The track is a well: a wash of the text colour, with the chosen segment raised out of it. */
        --_well: color-mix(in srgb, var(--violet-color-text-primary, #181b1a) 7%, transparent);
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
        margin-block-end: var(--_space-field-gap);
    }

    .group {
        display: inline-flex;
        align-items: stretch;
        gap: 2px;
        padding: 2px;
        border-radius: var(--_radius-md);
        background: var(--_well);
        min-inline-size: 0;
    }

    :host([disabled]) .group,
    :host(:disabled) .group {
        opacity: 0.5;
    }

    :host([invalid]) .group {
        box-shadow: inset 0 0 0 1px var(--_danger-border);
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
        color: var(--_danger-text);
        margin-block-start: var(--_space-stack-2xs);
    }

    @media (forced-colors: active) {
        .group {
            forced-color-adjust: none;
            border: 1px solid ButtonText;
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
            x => Boolean(x.supportingText) && !x.displayErrorText,
            html<VioletSegmentedControl>`
                <p class="supporting" part="supporting-text">${x => x.supportingText}</p>
            `,
        )}
        ${when(
            x => Boolean(x.displayErrorText),
            html<VioletSegmentedControl>`
                <p class="error" part="error-message" role="alert">${x => x.displayErrorText}</p>
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
 * @csspart error-message - Error message element shown while invalid.
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
        // Segments render their buttons after this, so anchor validation to the Tab stop once they have.
        Updates.enqueue(() => this.#syncFormState());
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

    /** Focuses the group's Tab stop: the checked segment, or the first enabled one when none is checked. */
    public override focus(options?: FocusOptions): void {
        this.#tabStop()?.focusButton(options);
    }

    // `segments` is refreshed on slotchange, so a segment removed in this update may still be listed; the
    // validation anchor must be inside the host, so only a segment still in it counts.
    #tabStop(): VioletSegment | undefined {
        return this.segments.find(
            segment => this.contains(segment) && segment.buttonTabIndex === 0 && !segment.effectiveDisabled,
        );
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
        this.#scheduleAccessibilitySync();
    }

    public supportingTextChanged(): void {
        this.#scheduleAccessibilitySync();
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

    public get displayErrorText(): string {
        return resolveFieldErrorText({
            invalid: this.invalid,
            disabled: this.effectiveDisabled,
            errorText: this.errorText,
            fallbackValidationMessage: this.required && !this.value ? "Please choose an option." : "",
        });
    }

    #syncAccessibilityState(): void {
        const captionPart = this.displayErrorText
            ? "error-message"
            : this.supportingText
              ? "supporting-text"
              : null;
        const captionElement = captionPart ? this.shadowRoot?.querySelector(`[part="${captionPart}"]`) : null;

        this.#internals.ariaLabel = this.label || null;
        this.#internals.ariaDisabled = this.effectiveDisabled ? "true" : null;
        this.#internals.ariaRequired = this.required ? "true" : null;
        this.#internals.ariaInvalid = !this.effectiveDisabled && this.invalid ? "true" : null;
        this.#internals.ariaDescribedByElements = captionElement instanceof Element ? [captionElement] : null;
    }

    #scheduleAccessibilitySync(): void {
        // Attribute change callbacks run before FAST queues template binding updates, so a
        // nested enqueue guarantees the caption swap has patched the shadow DOM first.
        Updates.enqueue(() => Updates.enqueue(() => this.#syncAccessibilityState()));
    }

    #syncFormState(): void {
        if (this.effectiveDisabled) {
            this.validationMessageText = "";
            this.#internals.setValidity({});
            this.#internals.setFormValue(null);
            this.#scheduleAccessibilitySync();
            return;
        }

        this.validationMessageText = this.displayErrorText;
        const shouldBeInvalid = this.invalid || (this.required && !this.value);
        if (shouldBeInvalid) {
            // `invalid` is the author's verdict, so it fails validation whatever the value is.
            const validationMessage = this.displayErrorText || (this.errorText ?? "").trim() || "Please choose an option.";
            this.#internals.setValidity(
                { customError: this.invalid, valueMissing: this.required && !this.value },
                validationMessage,
                // A failed form submission focuses the group's Tab stop. The anchor must itself be focusable,
                // which a delegating segment host is not, so it is the segment's button.
                this.#tabStop()?.shadowRoot?.querySelector("button") ?? undefined,
            );
        } else {
            this.#internals.setValidity({});
        }

        this.#internals.setFormValue(this.value || null, this.value || null);
        this.#scheduleAccessibilitySync();
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

/** The FAST definition of `<violet-segmented-control>`; `defineVioletSegmentedControl` in `./violet-segmented-control.define` registers it. */
export const violetSegmentedControlDefinition = {
    name: "violet-segmented-control",
    template,
    styles,
} satisfies PartialFASTElementDefinition;
