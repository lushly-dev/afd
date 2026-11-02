import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";

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
        --_radius-full: 999px;
        --_size-font-md: var(--size-font-md, 14px);
        --_control-size: max(var(--_size-font-md), calc(var(--_target-size) * 0.5));
        --_dot-size: max(8px, calc(var(--_control-size) * 0.5));
        --_type-body-line: var(--type-body-md-line, 20px);
        --_type-caption-line: var(--type-caption-xs-line, 14px);
    }

    :host([inline]) {
        --_target-size: var(--violet-radio-inline-target-size, var(--_target-size-compact));
        --_space-inline-sm: var(--violet-radio-inline-gap, 4px);
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

    .control {
        box-sizing: border-box;
        position: relative;
        display: inline-grid;
        place-items: center;
        inline-size: var(--_control-size);
        block-size: var(--_control-size);
        border: 1px solid var(--_border-strong);
        border-radius: var(--_radius-full);
        background: var(--_surface-card);
        box-shadow: var(--_shadow-control);
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .dot {
        position: absolute;
        inset-inline-start: 50%;
        inset-block-start: 50%;
        inline-size: var(--_dot-size);
        block-size: var(--_dot-size);
        border-radius: var(--_radius-full);
        background: var(--_selection-text);
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.72);
        transform-origin: center;
        transition:
            opacity var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    :host([checked]) .control {
        background: var(--_selection-background);
        border-color: var(--_selection-border);
    }

    :host([checked]) .dot {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
    }

    :host(:focus-visible) .control {
        box-shadow:
            var(--_shadow-control),
            0 0 0 2px var(--_focus-ring);
    }

    :host([invalid]) .control {
        border-color: var(--_danger-border);
    }

    :host([disabled]) .root,
    :host([aria-disabled="true"]) .root {
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
        .control {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            box-shadow: none;
        }

        :host([checked]) .control {
            border-color: Highlight;
        }

        .dot {
            forced-color-adjust: none;
            background: Highlight;
        }

        :host(:focus-visible) .control {
            outline: 2px solid Highlight;
            outline-offset: 2px;
        }

        :host([disabled]) .control,
        :host([aria-disabled="true"]) .control {
            border-color: GrayText;
        }

        :host([disabled]) .dot,
        :host([aria-disabled="true"]) .dot {
            background: GrayText;
        }
    }
`;

const template = html<VioletRadio>`
    <div class="root" part="root" @click="${(x, c) => x.handleClick(c.event)}">
        <span class="control-shell">
            <span class="control" part="control" aria-hidden="true">
                <span class="dot" part="mark"></span>
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
    </div>
`;

/**
 * Violet reusable radio primitive.
 *
 * @summary Token-driven radio option with label and optional supporting text.
 * @fires change - Emitted when the radio becomes checked through user interaction.
 * @slot - Radio label content.
 * @slot supporting - Optional supporting copy rendered under the label.
 * @csspart root - Root label wrapper.
 * @csspart control - Visible radio control.
 * @csspart mark - Selection dot inside the control.
 * @csspart label - Primary label text wrapper.
 * @csspart supporting-text - Optional supporting text wrapper.
 */
export class VioletRadio extends FASTElement {
    readonly #internals: ElementInternals;
    #managedTabIndex: number | null;
    #disabledFromGroup: boolean;

    @observable
    declare public hasSupporting: boolean;

    @observable
    declare public hasLabel: boolean;

    /**
     * Checked state for the radio.
     */
    declare public checked: boolean;

    /**
     * Disables the radio.
     */
    declare public disabled: boolean;

    /**
     * Presents a compact inline layout that can collapse to the control only.
     */
    declare public inline: boolean;

    /**
     * Marks the radio as invalid.
     */
    declare public invalid: boolean;

    /**
     * Native group name forwarded from a parent radio group when available.
     */
    declare public name: string;

    /**
     * Submitted value associated with this radio.
     */
    declare public value: string;

    public constructor() {
        super();
        this.#internals = this.attachInternals();
        this.#internals.role = "radio";
        this.#managedTabIndex = null;
        this.#disabledFromGroup = false;
        this.hasSupporting = false;
        this.hasLabel = false;
        this.checked = false;
        this.disabled = false;
        this.inline = false;
        this.invalid = false;
        this.name = "";
        this.value = "on";
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.setAttribute("role", "radio");
        this.addEventListener("keydown", this.handleKeydown as EventListener);
        this.#syncLabelState();
        this.#syncSupportingState();
        this.#syncAccessibilityState();
        this.#syncTabIndex();
    }

    public disconnectedCallback(): void {
        this.removeEventListener("keydown", this.handleKeydown as EventListener);
        super.disconnectedCallback();
    }

    public get effectiveDisabled(): boolean {
        return this.disabled || this.#disabledFromGroup;
    }

    public setCheckedFromGroup(checked: boolean): void {
        this.checked = checked;
    }

    public setGroupDisabled(disabled: boolean): void {
        this.#disabledFromGroup = disabled;
        this.#syncAccessibilityState();
        this.#syncTabIndex();
    }

    public setManagedTabIndex(tabIndex: number | null): void {
        this.#managedTabIndex = tabIndex;
        this.#syncTabIndex();
    }

    public handleClick(event: Event): void {
        event.preventDefault();
        this.#activateFromUser();
    }

    public handleDefaultSlotChange(): void {
        this.#syncLabelState();
        this.#syncAccessibilityState();
    }

    public handleSupportingSlotChange(): void {
        this.#syncSupportingState();
    }

    public checkedChanged(): void {
        this.#syncAccessibilityState();
        this.#syncTabIndex();
    }

    public disabledChanged(): void {
        this.#syncAccessibilityState();
        this.#syncTabIndex();
    }

    public invalidChanged(): void {
        this.#syncAccessibilityState();
    }

    public valueChanged(): void {
        this.#syncAccessibilityState();
    }

    public get controlAriaLabel(): string | null {
        const explicitLabel = this.getAttribute("aria-label");
        if (explicitLabel) {
            return explicitLabel;
        }

        const visibleLabel = this.#defaultSlotText();
        return visibleLabel || null;
    }

    #activateFromUser(): void {
        if (this.effectiveDisabled) {
            return;
        }

        this.focus();

        if (this.checked) {
            return;
        }

        this.checked = true;
        this.$emit("change", { checked: true, value: this.value });
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

    #syncAccessibilityState(): void {
        this.#internals.ariaChecked = this.checked ? "true" : "false";
        this.#internals.ariaDisabled = this.effectiveDisabled ? "true" : "false";
        this.#internals.ariaInvalid = this.invalid ? "true" : "false";

        const labelElement = this.shadowRoot?.querySelector(".label:not([hidden])");
        const supportingElement = this.shadowRoot?.querySelector(".supporting:not([hidden])");

        if (labelElement instanceof Element) {
            this.#internals.ariaLabelledByElements = [labelElement];
            this.#internals.ariaLabel = null;
        } else {
            this.#internals.ariaLabelledByElements = null;
            this.#internals.ariaLabel = this.controlAriaLabel ?? null;
        }

        this.#internals.ariaDescribedByElements = supportingElement instanceof Element ? [supportingElement] : null;

        if (this.$fastController.isConnected) {
            this.setAttribute("aria-checked", this.checked ? "true" : "false");
        }

        if (this.effectiveDisabled) {
            this.setAttribute("aria-disabled", "true");
        } else {
            this.removeAttribute("aria-disabled");
        }
    }

    #syncTabIndex(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        if (this.effectiveDisabled) {
            this.tabIndex = -1;
            return;
        }

        this.tabIndex = this.#managedTabIndex ?? 0;
    }

    handleKeydown = (event: KeyboardEvent): void => {
        if (event.defaultPrevented) {
            return;
        }

        if (event.key !== " " && event.key !== "Enter") {
            return;
        }

        if (this.closest("violet-radio-group")) {
            return;
        }

        event.preventDefault();
        this.#activateFromUser();
    };
}

attr({ mode: "boolean" })(VioletRadio.prototype, "checked");
attr({ mode: "boolean" })(VioletRadio.prototype, "disabled");
attr({ mode: "boolean" })(VioletRadio.prototype, "inline");
attr({ mode: "boolean" })(VioletRadio.prototype, "invalid");
attr(VioletRadio.prototype, "name");
attr(VioletRadio.prototype, "value");

if (!customElements.get("violet-radio")) {
    await FASTElement.define(VioletRadio, {
        name: "violet-radio",
        template,
        styles,
    });
}
