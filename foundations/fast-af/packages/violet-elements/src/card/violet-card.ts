import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;

        --_card-border-width: 1px;
        --_card-padding: var(--violet-card-padding, 0);
        --_card-radius: var(--violet-card-radius, var(--_radius-md));
        --_card-background: var(--violet-card-background, var(--_surface-card));
        --_card-border-color: var(--violet-card-border-color, transparent);
        --_card-shadow: var(--violet-card-shadow, var(--_shadow-card));
    }

    :host([padding="small"]) {
        --_card-padding: var(--violet-card-padding, var(--_space-sm));
    }

    :host([padding="medium"]) {
        --_card-padding: var(--violet-card-padding, var(--_space-md));
    }

    :host([padding="large"]) {
        --_card-padding: var(--violet-card-padding, var(--_space-lg));
    }

    :host([appearance="outline"]) {
        --_card-background: var(--violet-card-background, transparent);
        --_card-border-color: var(--violet-card-border-color, var(--_border-subtle));
        --_card-shadow: var(--violet-card-shadow, none);
    }

    :host([appearance="subtle"]) {
        --_card-background: var(--violet-card-background, var(--_surface-subtle));
        --_card-border-color: var(--violet-card-border-color, transparent);
        --_card-shadow: var(--violet-card-shadow, none);
    }

    .root {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        border: var(--_card-border-width) solid var(--_card-border-color);
        border-radius: var(--_card-radius);
        background: var(--_card-background);
        box-shadow: var(--_card-shadow);
        overflow: hidden;
        transition:
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    :host([orientation="horizontal"]) .root {
        flex-direction: row;
    }

    :host([interactive]) .root {
        cursor: pointer;
    }

    :host([interactive]) .root:hover {
        box-shadow:
            var(--_card-shadow),
            0 0 0 1px var(--_border-subtle);
        transform: translateY(-1px);
    }

    :host([interactive]) .root:active {
        transform: translateY(0);
    }

    :host([interactive]:focus-visible) .root {
        box-shadow:
            var(--_card-shadow),
            0 0 0 2px var(--_focus-ring);
    }

    .header {
        padding: var(--_card-padding);
    }

    .header[hidden] {
        display: none;
    }

    .header:not([hidden]) + .body {
        border-block-start: var(--_card-border-width) solid var(--_border-subtle);
    }

    .body {
        display: flex;
        flex-direction: column;
        padding: var(--_card-padding);
        flex: 1;
    }

    :host([orientation="horizontal"]) .body {
        flex-direction: row;
    }

    .footer {
        padding: var(--_card-padding);
    }

    .footer[hidden] {
        display: none;
    }

    .footer:not([hidden]) {
        border-block-start: var(--_card-border-width) solid var(--_border-subtle);
    }

    @media (forced-colors: active) {
        .root {
            forced-color-adjust: none;
            border: var(--_card-border-width) solid ButtonText;
            background: Canvas;
            box-shadow: none;
        }

        .header:not([hidden]) + .body {
            border-block-start-color: ButtonText;
        }

        .footer:not([hidden]) {
            border-block-start-color: ButtonText;
        }
    }
`;

const template = html<VioletCard>`
    <div class="root" part="root">
        <div class="header" part="header" ?hidden="${x => !x.hasHeader}">
            <slot name="header" @slotchange="${x => x.handleHeaderSlotChange()}"></slot>
        </div>
        <div class="body" part="body">
            <slot></slot>
        </div>
        <div class="footer" part="footer" ?hidden="${x => !x.hasFooter}">
            <slot name="footer" @slotchange="${x => x.handleFooterSlotChange()}"></slot>
        </div>
    </div>
`;

/**
 * Violet reusable card surface.
 *
 * @summary Token-driven card frame with optional padding, appearance variants, header/footer slots, and interactive mode.
 * @slot - Card body content.
 * @slot header - Optional header area rendered above the body with a separator border.
 * @slot footer - Optional footer area rendered below the body with a separator border.
 * @csspart root - Card container.
 * @csspart header - Header section wrapper.
 * @csspart body - Body section wrapper.
 * @csspart footer - Footer section wrapper.
 */
export class VioletCard extends FASTElement {
    @observable
    declare public hasHeader: boolean;

    @observable
    declare public hasFooter: boolean;

    declare public padding: string;
    declare public appearance: string;
    declare public interactive: boolean;
    declare public orientation: string;

    public constructor() {
        super();
        this.hasHeader = false;
        this.hasFooter = false;
        this.padding = "none";
        this.appearance = "filled";
        this.interactive = false;
        this.orientation = "vertical";
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.handleHeaderSlotChange();
        this.handleFooterSlotChange();
        this.#syncInteractiveState();
    }

    public interactiveChanged(): void {
        if (this.$fastController.isConnected) {
            this.#syncInteractiveState();
        }
    }

    public handleHeaderSlotChange(): void {
        const slot = this.shadowRoot?.querySelector('slot[name="header"]') as HTMLSlotElement | null;
        this.hasHeader = Boolean(this.querySelector('[slot="header"]')) || (slot?.assignedNodes({ flatten: true }) ?? []).some(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                return Boolean(node.textContent?.trim());
            }
            return true;
        });
        const header = this.shadowRoot?.querySelector(".header") as HTMLElement | null;
        if (header) {
            header.hidden = !this.hasHeader;
        }
    }

    public handleFooterSlotChange(): void {
        const slot = this.shadowRoot?.querySelector('slot[name="footer"]') as HTMLSlotElement | null;
        this.hasFooter = Boolean(this.querySelector('[slot="footer"]')) || (slot?.assignedNodes({ flatten: true }) ?? []).some(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                return Boolean(node.textContent?.trim());
            }
            return true;
        });
        const footer = this.shadowRoot?.querySelector(".footer") as HTMLElement | null;
        if (footer) {
            footer.hidden = !this.hasFooter;
        }
    }

    #syncInteractiveState(): void {
        if (this.interactive) {
            if (!this.hasAttribute("tabindex")) {
                this.setAttribute("tabindex", "0");
            }
            if (!this.hasAttribute("role")) {
                this.setAttribute("role", "group");
            }
        } else {
            if (this.getAttribute("tabindex") === "0") {
                this.removeAttribute("tabindex");
            }
            if (this.getAttribute("role") === "group") {
                this.removeAttribute("role");
            }
        }
    }
}

export type VioletCardPadding = "none" | "small" | "medium" | "large";
export type VioletCardAppearance = "filled" | "outline" | "subtle";
export type VioletCardOrientation = "vertical" | "horizontal";

attr(VioletCard.prototype, "padding");
attr(VioletCard.prototype, "appearance");
attr({ mode: "boolean" })(VioletCard.prototype, "interactive");
attr(VioletCard.prototype, "orientation");

if (!customElements.get("violet-card")) {
    await FASTElement.define(VioletCard, {
        name: "violet-card",
        template,
        styles,
        shadowOptions: {
            delegatesFocus: true,
        },
    });
}
