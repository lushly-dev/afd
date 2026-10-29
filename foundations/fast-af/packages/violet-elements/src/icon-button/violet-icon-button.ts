import { FASTElement, attr, css, html } from "@lushly-dev/fast-element";

import { violetActionTokenDefaults } from "../theme/violet-token-defaults";

export type VioletIconButtonAppearance = "primary" | "secondary" | "quiet" | "transparent";

const styles = css`
    ${violetActionTokenDefaults}

    :host {
        display: inline-flex;
        vertical-align: middle;
        --_space-inline-sm: var(--space-inline-sm, 4px);
        --_icon-size: clamp(16px, calc(var(--_target-size) * 0.6667), 20px);
    }

    .control {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: var(--_target-size);
        block-size: var(--_target-size);
        padding: 0;
        border: thin solid transparent;
        border-radius: var(--_radius-md);
        background: transparent;
        color: inherit;
        box-shadow: none;
        cursor: pointer;
        font-family: inherit;
        font-size: var(--_control-type-size);
        line-height: 1;
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

    .control[disabled] {
        opacity: 0.55;
        cursor: not-allowed;
        box-shadow: none;
        transform: none;
    }

    .icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: var(--_icon-size);
        block-size: var(--_icon-size);
        min-inline-size: var(--_icon-size);
        min-block-size: var(--_icon-size);
        flex: 0 0 auto;
        line-height: 0;
    }

    ::slotted(*) {
        max-inline-size: 100%;
        max-block-size: 100%;
    }

    ::slotted(img),
    ::slotted(svg),
    ::slotted(violet-icon) {
        display: block;
        inline-size: 100%;
        block-size: 100%;
    }

    ::slotted(violet-icon) {
        --violet-icon-size: var(--_icon-size);
        color: inherit;
    }

    ::slotted(img) {
        object-fit: cover;
    }
`;

const template = html<VioletIconButton>`
    <button
        class="control"
        part="control"
        type="${x => x.type}"
        data-appearance="${x => x.appearance}"
        aria-label="${x => x.label}"
        title="${x => x.label}"
        ?disabled="${x => x.disabled}"
    >
        <span class="icon" part="icon"><slot></slot></span>
    </button>
`;

/**
 * Violet reusable icon button primitive.
 *
 * @summary Token-driven icon-only button for toolbar, utility, and standalone actions.
 * @slot - Icon or image content for the button.
 * @csspart control - Native button control element.
 * @csspart icon - Inline wrapper for the slotted icon content.
 */
export class VioletIconButton extends FASTElement {
    /**
     * Visual emphasis variant for the button.
     */
    declare public appearance: VioletIconButtonAppearance;

    /**
     * Accessible name used for the internal button label.
     */
    declare public label: string;

    /**
     * Native button type forwarded to the internal control.
     */
    declare public type: "button" | "submit" | "reset";

    /**
     * Disables the button.
     */
    declare public disabled: boolean;

    public constructor() {
        super();
        this.appearance = "secondary";
        this.label = "";
        this.type = "button";
        this.disabled = false;
    }
}

attr(VioletIconButton.prototype, "appearance");
attr(VioletIconButton.prototype, "label");
attr(VioletIconButton.prototype, "type");
attr({ mode: "boolean" })(VioletIconButton.prototype, "disabled");

if (!customElements.get("violet-icon-button")) {
    await FASTElement.define(VioletIconButton, {
        name: "violet-icon-button",
        template,
        styles,
        shadowOptions: {
            delegatesFocus: true,
        },
    });
}
