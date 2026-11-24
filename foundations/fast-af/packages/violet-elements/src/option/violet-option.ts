import { FASTElement, Observable, attr, css, html, observable, type PartialFASTElementDefinition, type FASTElementExtension } from "@lushly-dev/fast-element";

import { observeAttribute, reflectStringAttribute } from "../listbox/violet-selection-helpers";
import { violetActionTokenDefaults } from "../theme/violet-token-defaults";

let violetOptionId = 0;

const styles = css`
    ${violetActionTokenDefaults}

    /* An author style beats the user agent's [hidden] rule, so a filtered-out option needs its own. */
    :host([hidden]) {
        display: none;
    }

    :host {
        display: block;
        --_surface-hover: var(--violet-color-surface-subtle, #e9e5de);
        --_surface-active: var(--violet-color-surface-subtle, #e9e5de);
        --_surface-selected: var(--violet-color-surface-selected, #dfecf4);
        --_option-mark: var(--violet-color-control-selected-foreground, #1b5f80);
        --_option-mark-size: 0.6875rem;
        --_focus-ring-width: var(--violet-size-focus-ring-width, 2px);
        --_control-caption-size: var(--violet-control-caption-size, var(--violet-type-caption-xs-size, 12px));
        --_type-caption-line: var(--violet-type-caption-xs-line, 16px);
        --_option-padding-inline-start: var(--violet-option-padding-inline-start, calc(var(--_space-inline-md) * 1.5));
        --_option-padding-inline-end: var(--violet-option-padding-inline-end, calc(var(--_space-inline-md) * 1.5));
    }

    .control {
        box-sizing: border-box;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--_space-inline-sm);
        position: relative;
        min-block-size: var(--_target-size);
        padding-inline-start: var(--_option-padding-inline-start);
        /* Room for the mark, so choosing a row does not move its text. */
        padding-inline-end: calc(var(--_option-padding-inline-end) + 1.25rem);
        padding-block: var(--_space-inline-sm);
        border: 1px solid transparent;
        border-radius: var(--_radius-md);
        background: transparent;
        color: inherit;
        cursor: pointer;
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-fast) var(--_easing-standard);
    }

    /*
     * The row the keys are on is tinted. Its ring is drawn when the list that holds it says
     * the keyboard is there (--_option-active-ring), or when an author overrides
     * --violet-option-active-ring on the option or any ancestor.
     */
    :host([active]) .control {
        background: var(--violet-option-active-background, var(--_surface-active));
        box-shadow: inset 0 0 0 var(--_focus-ring-width) var(--violet-option-active-ring, var(--_option-active-ring, transparent));
    }

    :host([selected]) .control {
        background: var(--_surface-selected);
    }

    /* When an option is both active and selected, an explicit active-background hook wins;
       otherwise keep the selected fill so the committed choice stays recognizable. */
    :host([active][selected]) .control {
        background: var(--violet-option-active-background, var(--_surface-selected));
    }

    /* Chosen is marked, not only tinted. */
    :host([selected]) .control::after {
        content: "";
        position: absolute;
        inset-inline-end: calc(var(--_option-padding-inline-end) - 2px);
        inset-block-start: calc(var(--_space-inline-sm) + (var(--_type-body-line) - var(--_option-mark-size)) / 2);
        inline-size: var(--_option-mark-size);
        block-size: var(--_option-mark-size);
        background: var(--_option-mark);
        clip-path: polygon(14% 44%, 0 59%, 37% 100%, 100% 16%, 84% 0, 35% 62%);
    }

    .control:not(.disabled):hover {
        background: var(--_surface-hover);
    }

    /* Hovering the active row keeps an explicit active-background hook instead of replacing it. */
    :host([active]) .control:not(.disabled):hover {
        background: var(--violet-option-active-background, var(--_surface-hover));
    }

    .control.disabled {
        color: var(--_text-secondary);
        cursor: not-allowed;
        opacity: 0.5;
    }

    .before,
    .after {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-inline-size: 0;
    }

    .content {
        display: grid;
        min-inline-size: 0;
    }

    .label {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
    }

    .description {
        color: var(--_text-muted);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    /* Muted text fails 4.5:1 on the tinted selected surface; use secondary text there. */
    :host([selected]) .description {
        color: var(--_text-secondary);
    }

    @media (forced-colors: active) {
        .control {
            forced-color-adjust: none;
            border-color: transparent;
            background: Canvas;
            color: ButtonText;
        }

        :host([active]) .control,
        :host([active][selected]) .control,
        :host([active]) .control:not(.disabled):hover,
        :host([selected]) .control {
            border-color: Highlight;
            background: Highlight;
            box-shadow: none;
            color: HighlightText;
        }

        :host([selected]) .control::after {
            background: HighlightText;
        }

        .control.disabled {
            color: GrayText;
        }
    }
`;

const template = html<VioletOption>`
    <div
        class="${x => `control${x.active ? " active" : ""}${x.selected ? " selected" : ""}${x.isDisabled ? " disabled" : ""}`}"
        part="control"
        @click="${(x, c) => x.handleClick(c.event)}"
    >
        <span class="before" part="before"><slot name="before"></slot></span>
        <span class="content" part="content">
            <span class="label" part="label"><slot></slot></span>
            <span class="description" part="description" ?hidden="${x => !x.hasDescription}">
                <slot name="description" @slotchange="${x => x.handleDescriptionSlotChange()}"></slot>
            </span>
        </span>
        <span class="after" part="after"><slot name="after"></slot></span>
    </div>
`;

/**
 * Violet reusable option primitive.
 *
 * @summary One choice inside a violet-select, violet-combobox or violet-listbox.
 * @attr {string} value - Submitted value. Defaults to the option's label text when omitted; an explicit empty string is kept.
 * @slot - The option's label text.
 * @slot before - Leading content such as an icon.
 * @slot description - Secondary text under the label.
 * @slot after - Trailing content such as a shortcut or count.
 * @fires request-select - Emitted when the option is chosen, for the list that owns it.
 * @csspart control - The option row.
 * @csspart before - Leading slot wrapper.
 * @csspart content - Wrapper around the label and description.
 * @csspart label - Label wrapper.
 * @csspart description - Description wrapper.
 * @csspart after - Trailing slot wrapper.
 * @cssproperty --violet-option-active-background - Background color of the active option row.
 * @cssproperty --violet-option-active-ring - Inset ring color of the active option row when keyboard navigation is active.
 */
export class VioletOption extends FASTElement {
    #explicitValue: string | null = null;
    #reflectingValue = false;

    @observable
    declare public hasDescription: boolean;

    @observable
    declare public groupDisabled: boolean;

    declare public label: string;
    declare public selected: boolean;
    declare public active: boolean;
    declare public disabled: boolean;

    public readonly optionId: string;

    public constructor() {
        super();
        violetOptionId += 1;
        this.optionId = `violet-option-${violetOptionId}`;
        this.label = "";
        this.selected = false;
        this.active = false;
        this.disabled = false;
        this.groupDisabled = false;
        this.hasDescription = false;
    }

    public get value(): string {
        Observable.track(this, "value");
        return this.#explicitValue ?? this.labelText;
    }

    public set value(next: string) {
        const normalized = next === null || next === undefined ? null : String(next);
        const previous = this.#explicitValue ?? this.labelText;
        this.#explicitValue = normalized;
        this.#reflectValueAttribute(normalized);
        if (previous !== (this.#explicitValue ?? this.labelText)) {
            Observable.notify(this, "value");
        }
    }

    public override attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        if (name === "value") {
            if (!this.#reflectingValue) {
                const previous = this.#explicitValue ?? this.labelText;
                this.#explicitValue = newValue;
                if (previous !== (this.#explicitValue ?? this.labelText)) {
                    Observable.notify(this, "value");
                }
            }
            return;
        }
        super.attributeChangedCallback(name, oldValue, newValue);
    }

    public connectedCallback(): void {
        super.connectedCallback();
        if (this.#explicitValue === null && this.hasAttribute("value")) {
            this.#explicitValue = this.getAttribute("value");
        } else if (this.#explicitValue !== null) {
            this.#reflectValueAttribute(this.#explicitValue);
        }
        this.id ||= this.optionId;
        this.setAttribute("role", "option");
        this.#syncAriaState();
        this.handleDescriptionSlotChange();
    }

    public selectedChanged(): void {
        this.#syncAriaState();
    }

    public disabledChanged(): void {
        this.#syncAriaState();
    }

    public groupDisabledChanged(): void {
        this.#syncAriaState();
    }

    public labelChanged(): void {
        if (this.#explicitValue === null) {
            Observable.notify(this, "value");
        }
    }

    public handleDescriptionSlotChange(): void {
        const slot = this.shadowRoot?.querySelector('slot[name="description"]') as HTMLSlotElement | null;
        const assigned = slot?.assignedNodes({ flatten: true }).some((node: Node) => node.textContent?.trim());

        this.hasDescription = Boolean(assigned);
    }

    public handleClick(event: Event): void {
        if (this.isDisabled) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        this.$emit("request-select", { value: this.value });
    }

    public get labelText(): string {
        if (this.label) {
            return this.label;
        }

        const unlottedText = Array.from(this.childNodes)
            .filter(node => !(node instanceof HTMLElement && node.slot))
            .map(node => node.textContent ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

        return unlottedText;
    }

    public get isDisabled(): boolean {
        return this.disabled || this.groupDisabled;
    }

    #reflectValueAttribute(next: string | null): void {
        this.#reflectingValue = true;
        try {
            reflectStringAttribute(this, "value", next);
        } finally {
            this.#reflectingValue = false;
        }
    }

    #syncAriaState(): void {
        if (!this.isConnected) {
            return;
        }

        this.setAttribute("aria-selected", String(this.selected));
        // An enabled option states nothing, so a disabled listbox's state reaches it.
        if (this.isDisabled) {
            this.setAttribute("aria-disabled", "true");
        } else {
            this.removeAttribute("aria-disabled");
        }
    }
}

attr(VioletOption.prototype, "label");
attr({ mode: "boolean" })(VioletOption.prototype, "selected");
attr({ mode: "boolean" })(VioletOption.prototype, "active");
attr({ mode: "boolean" })(VioletOption.prototype, "disabled");

/** The FAST definition of `<violet-option>`; `defineVioletOption` in `./violet-option.define` registers it. */
export const violetOptionDefinition = {
    name: "violet-option",
    template,
    styles,
} satisfies PartialFASTElementDefinition;

/** The FAST extensions `<violet-option>` is defined with. */
export const violetOptionExtensions: FASTElementExtension[] = [observeAttribute("value")];
