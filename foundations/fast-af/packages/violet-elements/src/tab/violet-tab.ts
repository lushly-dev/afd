import { FASTElement, attr, css, html } from "@lushly-dev/fast-element";

import { violetFieldTokenDefaults, violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

type VioletTabInternalAppearance = "open" | "closed" | "mixed";
type VioletTabInternalOrientation = "horizontal" | "vertical";

const styles = css`
    ${violetFieldTokenDefaults}
    ${violetSurfaceTokenDefaults}

    :host {
        display: inline-flex;
        position: relative;
        box-sizing: border-box;
        align-items: center;
        justify-content: center;
        min-block-size: var(--_target-size);
        min-inline-size: max-content;
        max-inline-size: 100%;
        border: 1px solid transparent;
        border-radius: 0;
        background: transparent;
        color: var(--_text-secondary);
        cursor: pointer;
        font-family: inherit;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        outline: none;
        user-select: none;
        white-space: nowrap;
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            color var(--_duration-fast) var(--_easing-standard),
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);

        --_selection-text: var(--color-control-selected-foreground, #244635);
        --_tab-border: color-mix(in srgb, var(--_border-subtle) 88%, transparent);
        --_tab-hover: color-mix(in srgb, var(--_surface-subtle) 42%, white);
        --_tab-closed-resting: color-mix(in srgb, var(--_surface-card) 86%, white);
        --_tab-indicator-thickness: 2px;
        --_tab-selected-accent-thickness: var(--_tab-indicator-thickness);
    }

    :host([hidden]) {
        display: none;
    }

    :host([aria-selected="true"]) {
        color: var(--_text-primary, var(--color-text-primary, #18181b));
    }

    :host([disabled]),
    :host([aria-disabled="true"]) {
        cursor: not-allowed;
        opacity: 0.55;
    }

    :host(:focus-visible) {
        box-shadow: 0 0 0 2px var(--_focus-ring);
        z-index: 3;
    }

    .surface {
        position: relative;
        display: inline-flex;
        box-sizing: border-box;
        align-items: center;
        justify-content: center;
        gap: var(--_space-inline-sm);
        min-block-size: inherit;
        min-inline-size: 0;
        max-inline-size: 100%;
        padding-inline: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
        padding-block: calc(var(--_space-inline-sm) + 2px) var(--_space-inline-sm);
    }

    .label {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .indicator {
        position: absolute;
        inset: auto;
        inline-size: 0;
        block-size: 0;
        border-radius: var(--_radius-round);
        background: var(--_selection-text);
        opacity: 0;
        pointer-events: none;
        transform: none;
        transform-origin: center;
        transition:
            opacity var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    :host([data-appearance="open"]:not([aria-selected="true"]):not([aria-disabled="true"]):hover),
    :host([data-appearance="mixed"]:not([aria-selected="true"]):not([aria-disabled="true"]):hover) {
        background: var(--_tab-hover);
        color: var(--_text-primary, var(--color-text-primary, #18181b));
    }

    :host([data-appearance="open"][aria-selected="true"]) .indicator {
        inset-inline: 0;
        inset-block-end: calc(var(--_space-inline-sm) * -1);
        inline-size: auto;
        block-size: var(--_tab-indicator-thickness);
        opacity: 1;
        transform: scaleX(1);
    }

    :host([data-appearance="open"]:not([aria-selected="true"])) .indicator,
    :host([data-appearance="mixed"]:not([aria-selected="true"])) .indicator {
        transform: scaleX(0.72);
    }

    :host([data-appearance="closed"]),
    :host([data-appearance="mixed"][aria-selected="true"]) {
        margin-block-end: -1px;
        border-color: var(--_tab-border);
        border-radius: calc(var(--_radius-md) + 2px) calc(var(--_radius-md) + 2px) 0 0;
    }

    :host([data-appearance="closed"]) {
        background: var(--_tab-closed-resting);
    }

    :host([data-appearance="closed"]:not([aria-selected="true"]):not([aria-disabled="true"]):hover) {
        background: color-mix(in srgb, var(--_surface-page) 90%, var(--_tab-closed-resting));
        color: var(--_text-primary, var(--color-text-primary, #18181b));
    }

    :host([data-appearance="closed"][aria-selected="true"]),
    :host([data-appearance="mixed"][aria-selected="true"]) {
        background: var(--_surface-page);
        border-block-end-width: 0;
        border-block-end-color: transparent;
        z-index: 1;
        box-shadow: none;
    }

    :host([data-appearance="closed"][aria-selected="true"]) .indicator,
    :host([data-appearance="mixed"][aria-selected="true"]) .indicator {
        inset-inline: 0;
        inset-block-start: auto;
        inset-block-end: 0;
        inline-size: auto;
        block-size: var(--_tab-selected-accent-thickness);
        opacity: 1;
        transform: none;
    }

    :host([data-orientation="vertical"]) {
        justify-content: flex-start;
        text-align: start;
        white-space: normal;
    }

    :host([data-orientation="vertical"]) .surface {
        inline-size: 100%;
        justify-content: flex-start;
        padding-inline-start: var(--_space-inline-md);
        padding-inline-end: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
    }

    :host([data-orientation="vertical"][data-appearance="open"]),
    :host([data-orientation="vertical"][data-appearance="mixed"]:not([aria-selected="true"])) {
        border-radius: var(--_radius-md);
    }

    :host([data-orientation="vertical"][data-appearance="open"][aria-selected="true"]) .indicator {
        inset-inline-start: calc(var(--_space-inline-md) * -0.5);
        inset-inline-end: auto;
        inset-block: 0;
        inline-size: var(--_tab-indicator-thickness);
        block-size: auto;
        transform: scaleY(1);
    }

    :host([data-orientation="vertical"][data-appearance="open"]:not([aria-selected="true"])) .indicator,
    :host([data-orientation="vertical"][data-appearance="mixed"]:not([aria-selected="true"])) .indicator {
        transform: scaleY(0.72);
    }

    :host([data-orientation="vertical"][data-appearance="closed"]),
    :host([data-orientation="vertical"][data-appearance="mixed"][aria-selected="true"]) {
        margin-block-end: 0;
        margin-inline-end: -1px;
        border-radius: calc(var(--_radius-md) + 2px) 0 0 calc(var(--_radius-md) + 2px);
    }

    :host([data-orientation="vertical"][data-appearance="closed"][aria-selected="true"]),
    :host([data-orientation="vertical"][data-appearance="mixed"][aria-selected="true"]) {
        border-inline-end-width: 0;
        border-inline-end-color: transparent;
        box-shadow: none;
    }

    :host([data-orientation="vertical"][data-appearance="closed"][aria-selected="true"]) .indicator,
    :host([data-orientation="vertical"][data-appearance="mixed"][aria-selected="true"]) .indicator {
        inset-inline-start: 0;
        inset-inline-end: auto;
        inset-block: 0;
        inline-size: var(--_tab-selected-accent-thickness);
        block-size: auto;
        opacity: 1;
        transform: none;
    }
`;

const template = html<VioletTab>`
    <div class="surface" part="root">
        <span class="label" part="label"><slot></slot></span>
        <span class="indicator" part="indicator" aria-hidden="true"></span>
    </div>
`;

/**
 * Violet reusable tab primitive.
 *
 * @summary Token-driven tab item managed by violet-tabs for selection, keyboarding, and panel linkage.
 * @slot - Tab label content.
 * @csspart root - Visible tab surface.
 * @csspart label - Tab label wrapper.
 * @csspart indicator - Underline indicator used by open tab presentation.
 */
export class VioletTab extends FASTElement {
    #disabledFromTabs = false;

    /**
     * Disables the individual tab.
     */
    declare public disabled: boolean;

    public get effectiveDisabled(): boolean {
        return this.disabled || this.#disabledFromTabs;
    }

    public setDisabledFromTabs(disabled: boolean): void {
        this.#disabledFromTabs = disabled;
    }

    public syncPresentation(appearance: VioletTabInternalAppearance, orientation: VioletTabInternalOrientation): void {
        this.setAttribute("data-appearance", appearance);
        this.setAttribute("data-orientation", orientation);
    }
}

attr({ mode: "boolean" })(VioletTab.prototype, "disabled");

if (!customElements.get("violet-tab")) {
    await FASTElement.define(VioletTab, {
        name: "violet-tab",
        template,
        styles,
    });
}
