import { FASTElement, attr, css, html, type PartialFASTElementDefinition } from "@lushly-dev/fast-element";

import { violetActionTokenDefaults } from "../theme/violet-token-defaults";

const styles = css`
    ${violetActionTokenDefaults}

    :host {
        display: flex;
        --_surface-hover: var(--violet-color-surface-subtle, #e9e5de);
        --_surface-pressed: var(--violet-color-surface-pressed, #d8dcd6);
    }

    .control {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: calc(var(--_space-inline-sm) * 2);
        inline-size: 100%;
        min-block-size: var(--_target-size);
        padding-inline: var(--_space-inline-md);
        padding-block: 0;
        border: none;
        border-radius: var(--_radius-md);
        background: transparent;
        color: inherit;
        cursor: pointer;
        font-family: inherit;
        font-size: var(--_control-type-size);
        line-height: var(--_type-body-line);
        text-align: start;
        white-space: nowrap;
        transition: background-color var(--_duration-fast) var(--_easing-standard);
    }

    .control:hover:not([aria-disabled="true"]) {
        background: var(--_surface-hover);
    }

    .control:active:not([aria-disabled="true"]) {
        background: var(--_surface-pressed);
    }

    .control:focus-visible {
        background: var(--_surface-hover);
        outline: 2px solid var(--_focus-ring);
        outline-offset: -2px;
    }

    .control[aria-disabled="true"] {
        color: var(--_text-secondary);
        cursor: not-allowed;
        opacity: 0.5;
    }

    .control[aria-disabled="true"]:hover {
        background: transparent;
    }

    slot[name="before"],
    slot[name="after"] {
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
    }

    .label {
        flex: 1 1 auto;
        min-inline-size: 0;
    }

    @media (forced-colors: active) {
        .control:hover:not([aria-disabled="true"]) {
            forced-color-adjust: none;
            background: Highlight;
            color: HighlightText;
        }

        .control:focus-visible {
            outline-color: Highlight;
        }

        .control[aria-disabled="true"] {
            color: GrayText;
        }
    }
`;

const template = html<VioletMenuItem>`
    <div
        class="control"
        part="control"
        role="menuitem"
        tabindex="-1"
        aria-disabled="${x => (x.disabled ? "true" : "false")}"
        @click="${(x, c) => x.handleClick(c.event)}"
    >
        <slot name="before" part="before"></slot>
        <span class="label" part="label"><slot></slot></span>
        <slot name="after" part="after"></slot>
    </div>
`;

/**
 * Violet reusable menu item primitive.
 *
 * @summary Token-driven menu item with leading/trailing slot support and disabled state.
 * @fires invoke - Emitted when the item is activated (click, Enter, or Space). Not fired when disabled.
 * @slot before - Leading inline content such as an icon.
 * @slot - Item label content.
 * @slot after - Trailing inline content such as a keyboard shortcut hint.
 * @csspart control - Interactive menuitem element.
 * @csspart before - Leading slot wrapper.
 * @csspart label - Inline label wrapper.
 * @csspart after - Trailing slot wrapper.
 */
export class VioletMenuItem extends FASTElement {
    /**
     * Disables the menu item. Disabled items remain focusable per WAI-ARIA APG
     * but cannot be activated.
     */
    declare public disabled: boolean;

    public constructor() {
        super();
        this.disabled = false;
    }

    /**
     * Handles click on the item. Emits `invoke` unless disabled.
     */
    public handleClick(event: Event): void {
        if (this.disabled) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        this.$emit("invoke");
    }

    /**
     * Returns the trimmed text content of this item for type-ahead matching.
     */
    public get labelText(): string {
        return this.textContent?.trim() ?? "";
    }
}

attr({ mode: "boolean" })(VioletMenuItem.prototype, "disabled");

/** The FAST definition of `<violet-menu-item>`; `defineVioletMenuItem` in `./violet-menu-item.define` registers it. */
export const violetMenuItemDefinition = {
    name: "violet-menu-item",
    template,
    styles,
    shadowOptions: {
        delegatesFocus: true,
    },
} satisfies PartialFASTElementDefinition;
