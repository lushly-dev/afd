import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

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
        --_surface-hover: var(--color-surface-subtle, #e9e5de);
        --_surface-active: var(--color-surface-subtle, #e9e5de);
        --_surface-selected: var(--color-surface-selected, #dfeae3);
        --_option-mark: var(--color-control-selected-foreground, #2c5e4b);
        --_option-mark-size: 0.6875rem;
        --_control-caption-size: var(--violet-control-caption-size, var(--type-caption-xs-size, 12px));
        --_type-caption-line: var(--type-caption-xs-line, 16px);
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
     * The row the keys are on is tinted. Its ring is drawn only when the list that holds it says
     * the keyboard is there (--violet-option-active-ring), not on a list at rest.
     */
    .control.active {
        background: var(--_surface-active);
        box-shadow: inset 0 0 0 1px var(--violet-option-active-ring, transparent);
    }

    :host([selected]) .control {
        background: var(--_surface-selected);
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

        .control.active,
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
 */
export class VioletOption extends FASTElement {
    @observable
    declare public active: boolean;

    @observable
    declare public hasDescription: boolean;

    @observable
    declare public groupDisabled: boolean;

    declare public value: string;
    declare public label: string;
    declare public selected: boolean;
    declare public disabled: boolean;

    public readonly optionId: string;

    public constructor() {
        super();
        violetOptionId += 1;
        this.optionId = `violet-option-${violetOptionId}`;
        this.value = "";
        this.label = "";
        this.selected = false;
        this.active = false;
        this.disabled = false;
        this.groupDisabled = false;
        this.hasDescription = false;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.id ||= this.optionId;
        this.setAttribute("role", "option");
        this.#syncAriaState();
        this.handleDescriptionSlotChange();
        this.#syncDerivedValue();
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
        this.#syncDerivedValue();
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

    #syncDerivedValue(): void {
        if (!this.value) {
            this.value = this.labelText;
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

attr(VioletOption.prototype, "value");
attr(VioletOption.prototype, "label");
attr({ mode: "boolean" })(VioletOption.prototype, "selected");
attr({ mode: "boolean" })(VioletOption.prototype, "disabled");

if (!customElements.get("violet-option")) {
    await FASTElement.define(VioletOption, {
        name: "violet-option",
        template,
        styles,
    });
}
