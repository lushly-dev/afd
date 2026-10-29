import { FASTElement, attr, css, html } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

let violetPopoverId = 0;

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: inline-block;
        position: relative;

        --_popover-padding: var(--violet-popover-padding, var(--_space-md));
        --_popover-min-inline: var(--violet-popover-min-inline-size, 16rem);
        --_popover-max-inline: var(--violet-popover-max-inline-size, min(24rem, calc(100vw - 24px)));
        --_popover-radius: var(--violet-popover-radius, calc(var(--_radius-md) * 2));
        --_popover-background: var(--violet-popover-background, var(--_surface-card));
        --_popover-shadow: var(--violet-popover-shadow, var(--_shadow-floating));
        --_popover-border: var(--violet-popover-border, var(--_border-subtle));
        --_popover-gap: var(--violet-popover-gap, var(--_space-sm));
    }

    .anchor {
        display: inline-block;
        anchor-name: --violet-popover-anchor;
    }

    .surface {
        box-sizing: border-box;
        position: fixed;
        position-anchor: --violet-popover-anchor;
        inset: unset;
        margin: 0;
        min-inline-size: var(--_popover-min-inline);
        max-inline-size: var(--_popover-max-inline);
        padding: var(--_popover-padding);
        border: 1px solid var(--_popover-border);
        border-radius: var(--_popover-radius);
        background: var(--_popover-background);
        box-shadow: var(--_popover-shadow);
        color: inherit;
        font-family: inherit;
        z-index: var(--_layer-popover);

        opacity: 0;
        transform: translateY(calc(var(--_space-sm) * -0.5)) scale(0.98);
        transition:
            opacity var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard),
            display var(--_duration-fast) var(--_easing-standard) allow-discrete,
            overlay var(--_duration-fast) var(--_easing-standard) allow-discrete;
    }

    .surface:popover-open {
        opacity: 1;
        transform: translateY(0) scale(1);

        @starting-style {
            opacity: 0;
            transform: translateY(calc(var(--_space-sm) * -0.5)) scale(0.98);
        }
    }

    :host([positioning="above"]) .surface {
        position-area: block-start center;
        margin-block-end: var(--_popover-gap);
        position-try-fallbacks: flip-block;
    }

    :host([positioning="below"]) .surface {
        position-area: block-end center;
        margin-block-start: var(--_popover-gap);
        position-try-fallbacks: flip-block;
    }

    :host([positioning="before"]) .surface {
        position-area: center left;
        margin-inline-end: var(--_popover-gap);
        position-try-fallbacks: flip-inline;
    }

    :host([positioning="after"]) .surface {
        position-area: center right;
        margin-inline-start: var(--_popover-gap);
        position-try-fallbacks: flip-inline;
    }

    .surface::backdrop {
        background: transparent;
    }

    @media (forced-colors: active) {
        .surface {
            forced-color-adjust: none;
            background: Canvas;
            color: CanvasText;
            border-color: ButtonText;
            box-shadow: none;
        }
    }
`;

const template = html<VioletPopover>`
    <span class="anchor" part="anchor">
        <slot name="trigger" @click="${x => x.handleTriggerClick()}"></slot>
    </span>
    <div
        class="surface"
        part="surface"
        id="${x => x.surfaceId}"
        popover="auto"
        @toggle="${(x, c) => x.handleToggle(c.event as ToggleEvent)}"
    >
        <slot></slot>
    </div>
`;

/**
 * Generic anchored floating surface.
 *
 * @summary Token-driven popover surface built on the native HTML Popover API.
 * @fires open-change - Emitted when the popover opens or closes. Detail: `{ open: boolean }`.
 * @slot trigger - Optional trigger element that toggles the popover.
 * @slot - Popover body content.
 * @csspart anchor - The wrapper around the trigger slot used as the anchor.
 * @csspart surface - The floating surface container.
 */
export class VioletPopover extends FASTElement {
    declare public open: boolean;
    declare public positioning: string;
    declare public anchor: string;

    public readonly surfaceId: string;

    #externalAnchor: HTMLElement | null = null;
    #externalListenersAttached = false;

    public constructor() {
        super();
        const id = violetPopoverId;
        violetPopoverId += 1;
        this.surfaceId = `violet-popover-${id}`;
        this.open = false;
        this.positioning = "below";
        this.anchor = "";
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.resolveExternalAnchor();

        if (this.open) {
            this.show();
        }
    }

    public disconnectedCallback(): void {
        super.disconnectedCallback();
        this.detachExternalAnchor();
    }

    public openChanged(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        if (this.open) {
            this.show();
        } else {
            this.hide();
        }
    }

    public anchorChanged(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        this.detachExternalAnchor();
        this.resolveExternalAnchor();
    }

    public show(): void {
        this.surfaceElement?.showPopover();
    }

    public hide(): void {
        if (this.surfaceElement?.matches(":popover-open")) {
            this.surfaceElement.hidePopover();
        }
    }

    public toggle(): void {
        this.surfaceElement?.togglePopover();
    }

    public handleTriggerClick(): void {
        this.toggle();
    }

    public handleToggle(event: ToggleEvent): void {
        const isOpen = event.newState === "open";
        this.open = isOpen;
        this.$emit("open-change", { open: isOpen });
    }

    private get surfaceElement(): HTMLElement | null {
        return this.shadowRoot?.querySelector(".surface") ?? null;
    }

    private resolveExternalAnchor(): void {
        if (!this.anchor) {
            return;
        }

        const element = document.getElementById(this.anchor);
        if (!(element instanceof HTMLElement)) {
            return;
        }

        this.#externalAnchor = element;
        element.style.setProperty("anchor-name", "--violet-popover-anchor");
        element.addEventListener("click", this.handleTriggerClickBound);
        this.#externalListenersAttached = true;
    }

    private detachExternalAnchor(): void {
        if (!this.#externalListenersAttached || !this.#externalAnchor) {
            return;
        }

        this.#externalAnchor.removeEventListener("click", this.handleTriggerClickBound);
        this.#externalAnchor.style.removeProperty("anchor-name");
        this.#externalAnchor = null;
        this.#externalListenersAttached = false;
    }

    private readonly handleTriggerClickBound = (): void => {
        this.handleTriggerClick();
    };
}

attr({ mode: "boolean" })(VioletPopover.prototype, "open");
attr(VioletPopover.prototype, "positioning");
attr(VioletPopover.prototype, "anchor");

if (!customElements.get("violet-popover")) {
    await FASTElement.define(VioletPopover, {
        name: "violet-popover",
        template,
        styles,
    });
}
