import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import { violetActionTokenDefaults } from "../theme/violet-token-defaults";

export type VioletButtonAppearance = "primary" | "secondary" | "quiet" | "transparent" | "danger";

const styles = css`
    ${violetActionTokenDefaults}

    :host {
        display: inline-flex;
        vertical-align: middle;
        --_space-inline-sm: var(--space-inline-sm, 4px);
        --_space-inline-md: var(--space-inline-md, 8px);
        --_space-stack-sm: var(--space-stack-sm, 8px);
        --_type-body-line: var(--type-body-md-line, 20px);
    }

    .control {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        /* The target size is a floor: wrapped or text-zoomed labels grow the control. */
        align-self: flex-start;
        min-block-size: var(--_target-size);
        min-inline-size: var(--_target-size);
        padding-inline: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
        /* A one-line label fills the target exactly; extra lines keep this inset. */
        padding-block: max(0px, calc((var(--_target-size) - var(--_type-body-line)) / 2 - 1px));
        border: thin solid transparent;
        border-radius: var(--_radius-md);
        background: transparent;
        color: inherit;
        box-shadow: none;
        cursor: pointer;
        font-family: inherit;
        font-size: var(--_control-type-size);
        line-height: var(--_type-body-line);
        font-weight: 500;
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            color var(--_duration-fast) var(--_easing-standard),
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .control:hover {
        transform: translateY(-1px);
        box-shadow: var(--_shadow-control);
    }

    .control:active {
        transform: translateY(0);
    }

    .control:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: calc(var(--_space-inline-sm) / 2);
    }

    .control[data-appearance="primary"] {
        background: var(--_action-primary-background);
        color: var(--_action-primary-text);
    }

    .control[data-appearance="primary"]:hover {
        background: var(--_action-primary-hover);
    }

    .control[data-appearance="primary"]:active {
        background: var(--_action-primary-pressed);
    }

    .control[data-appearance="secondary"] {
        background: var(--_action-secondary-background);
        color: var(--_action-secondary-text);
        border-color: var(--_action-secondary-border);
    }

    .control[data-appearance="secondary"]:hover {
        background: var(--_action-secondary-hover);
    }

    .control[data-appearance="secondary"]:active {
        background: var(--_action-secondary-pressed);
    }

    .control[data-appearance="quiet"] {
        color: var(--_text-secondary);
        border-color: var(--_border-subtle);
        background: transparent;
    }

    .control[data-appearance="quiet"]:hover {
        background: var(--_action-secondary-background);
    }

    .control[data-appearance="quiet"]:active {
        background: var(--_action-secondary-pressed);
    }

    .control[data-appearance="danger"] {
        background: var(--_action-danger-background);
        color: var(--_action-danger-text);
    }

    .control[data-appearance="danger"]:hover {
        background: var(--_action-danger-hover);
    }

    .control[data-appearance="danger"]:active {
        background: var(--_action-danger-pressed);
    }

    .control[disabled] {
        opacity: 0.55;
        cursor: not-allowed;
        box-shadow: none;
        transform: none;
    }

    .label {
        display: inline-flex;
        align-items: center;
        text-align: center;
    }

    slot[name="before"],
    slot[name="after"] {
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
    }

    ::slotted([slot="before"]) {
        margin-inline-end: var(--_space-inline-sm);
    }

    ::slotted([slot="after"]) {
        margin-inline-start: var(--_space-inline-sm);
    }

    .control[data-appearance="transparent"] {
        color: var(--_text-secondary);
        border-color: transparent;
        background: transparent;
        box-shadow: none;
    }

    .control[data-appearance="transparent"]:hover {
        background: var(--_action-secondary-background);
    }

    .control[data-appearance="transparent"]:active {
        background: var(--_action-secondary-pressed);
    }
`;

const template = html<VioletButton>`
    <button
        class="control"
        part="control"
        type="${x => x.type}"
        data-appearance="${x => x.appearance}"
        ?disabled="${x => x.disabled}"
        aria-label="${x => x.ariaLabel || null}"
        aria-labelledby="${x => x.ariaLabelledby || null}"
        aria-describedby="${x => x.ariaDescribedby || null}"
        aria-errormessage="${x => x.ariaErrormessage || null}"
        aria-controls="${x => x.ariaControls}"
        aria-expanded="${x => x.ariaExpanded}"
        aria-haspopup="${x => x.ariaHasPopup}"
        aria-pressed="${x => x.ariaPressed}"
    >
        <slot name="before" part="before"></slot>
        <span class="label" part="label"><slot></slot></span>
        <slot name="after" part="after"></slot>
    </button>
`;

/**
 * Violet reusable button primitive.
 *
 * @summary Token-driven action button for primary, secondary, quiet, transparent, and danger actions.
 * @slot before - Leading inline content such as an icon.
 * @slot - Button label content.
 * @slot after - Trailing inline content such as a status glyph.
 * @csspart control - Native button control element.
 * @csspart before - Leading slot wrapper.
 * @csspart label - Inline label wrapper.
 * @csspart after - Trailing slot wrapper.
 */
export class VioletButton extends FASTElement {
    /**
     * Visual emphasis variant for the button.
     */
    declare public appearance: VioletButtonAppearance;

    /**
     * Native button type forwarded to the internal control.
     */
    declare public type: "button" | "submit" | "reset";

    /**
     * Disables the button.
     */
    declare public disabled: boolean;

    /**
     * Optional accessible name override forwarded to the inner button.
     */
    declare public ariaLabel: string;

    /**
     * Optional labelledby reference forwarded to the inner button.
     */
    declare public ariaLabelledby: string;

    /**
     * Optional describedby reference forwarded to the inner button.
     */
    declare public ariaDescribedby: string;

    /**
     * Optional errormessage reference forwarded to the inner button.
     */
    declare public ariaErrormessage: string;

    /**
     * Optional controls reference forwarded to the inner button.
     */
    declare public ariaControls: string | null;

    /**
     * Optional expanded state forwarded to the inner button.
     */
    declare public ariaExpanded: string | null;

    /**
     * Optional popup type forwarded to the inner button.
     */
    declare public ariaHasPopup: string | null;

    /**
     * Optional pressed state ("true", "false" or "mixed") forwarded to the inner button for toggle buttons.
     */
    declare public ariaPressed: string | null;

    public constructor() {
        super();
        this.appearance = "primary";
        this.type = "button";
        this.disabled = false;
        this.ariaLabel = "";
        this.ariaLabelledby = "";
        this.ariaDescribedby = "";
        this.ariaErrormessage = "";
    }

    private ariaControlsChanged(_previous: string | null, next: string | null): void {
        this.#forwardAriaAttribute("aria-controls", next);
    }

    private ariaExpandedChanged(_previous: string | null, next: string | null): void {
        this.#forwardAriaAttribute("aria-expanded", next);
    }

    private ariaHasPopupChanged(_previous: string | null, next: string | null): void {
        this.#forwardAriaAttribute("aria-haspopup", next);
    }

    private ariaPressedChanged(_previous: string | null, next: string | null): void {
        this.#forwardAriaAttribute("aria-pressed", next);
    }

    #forwardAriaAttribute(name: string, value: string | null): void {
        const control = this.shadowRoot?.querySelector("button");
        if (!control) {
            return;
        }

        if (value === null) {
            control.removeAttribute(name);
        } else {
            control.setAttribute(name, value);
        }
    }
}

attr(VioletButton.prototype, "appearance");
attr(VioletButton.prototype, "type");
attr({ mode: "boolean" })(VioletButton.prototype, "disabled");
observable(VioletButton.prototype, "ariaLabel");
observable(VioletButton.prototype, "ariaLabelledby");
observable(VioletButton.prototype, "ariaDescribedby");
observable(VioletButton.prototype, "ariaErrormessage");
attr({ attribute: "aria-controls" })(VioletButton.prototype, "ariaControls");
attr({ attribute: "aria-expanded" })(VioletButton.prototype, "ariaExpanded");
attr({ attribute: "aria-haspopup" })(VioletButton.prototype, "ariaHasPopup");
attr({ attribute: "aria-pressed" })(VioletButton.prototype, "ariaPressed");

if (!customElements.get("violet-button")) {
    await FASTElement.define(VioletButton, {
        name: "violet-button",
        template,
        styles,
        shadowOptions: {
            delegatesFocus: true,
        },
    });
}
