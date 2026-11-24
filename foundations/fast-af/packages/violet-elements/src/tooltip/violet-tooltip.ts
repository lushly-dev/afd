import { FASTElement, attr, css, html, observable, type PartialFASTElementDefinition } from "@lushly-dev/fast-element";

import {
    LazyFallbackPositionController,
    bindOverlayAnchor,
    createAnchorName,
} from "../shared/overlay-anchor";
import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

let violetTooltipId = 0;

function describedBy(element: Element): string[] {
    return (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
}

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: inline-block;
        position: relative;

        --_tooltip-border-width: var(--violet-tooltip-border-width, var(--_card-border-width, 1px));
        --_tooltip-font-size: var(--violet-tooltip-font-size, 12px);
        --_tooltip-line-height: var(--violet-tooltip-line-height, 16px);
        --_tooltip-max-width: var(--violet-tooltip-max-width, 240px);
        --_tooltip-gap: var(--violet-tooltip-gap, var(--_space-sm));
        --_tooltip-radius: var(--violet-tooltip-radius, calc(var(--_radius-md) - 2px));
        /* A tooltip is the one inverted surface: the primary action's fill and text. */
        --_tooltip-background: var(
            --violet-tooltip-background,
            var(--violet-color-action-primary-background, var(--_surface-card))
        );
        --_tooltip-shadow: var(--violet-tooltip-shadow, var(--_shadow-card));
        --_tooltip-border-color: var(--violet-tooltip-border-color, transparent);
    }

    .anchor {
        display: inline-block;
    }

    .tooltip {
        box-sizing: border-box;
        position: fixed;
        inset: unset;
        margin: 0;
        /* The position area is as wide as the anchor, so the tip sizes to its text, up to the maximum. */
        inline-size: max-content;
        padding: calc(var(--_space-sm) / 2) var(--_space-sm);
        border: var(--_tooltip-border-width) solid var(--_tooltip-border-color);
        border-radius: var(--_tooltip-radius);
        background: var(--_tooltip-background);
        box-shadow: var(--_tooltip-shadow);
        color: var(--violet-color-action-primary-text, #f4f0ea);
        font-family: inherit;
        font-size: var(--_tooltip-font-size);
        line-height: var(--_tooltip-line-height);
        max-inline-size: var(--_tooltip-max-width);
        pointer-events: none;
        z-index: var(--_layer-popover);
        opacity: 0;
        transform: scale(0.96);
        transition:
            opacity var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard),
            display var(--_duration-fast) var(--_easing-standard) allow-discrete,
            overlay var(--_duration-fast) var(--_easing-standard) allow-discrete;
    }

    .tooltip:popover-open {
        opacity: 1;
        transform: scale(1);
        pointer-events: auto;

        @starting-style {
            opacity: 0;
            transform: scale(0.96);
        }
    }

    @supports (anchor-name: --violet-anchor) and (position-area: block-end center) and (position-try-fallbacks: flip-block) {
        :host([positioning="above"]) .tooltip,
        :host(:not([positioning])) .tooltip {
            position-area: block-start center;
            margin-block-end: var(--_tooltip-gap);
            position-try-fallbacks: flip-block;
        }

        :host([positioning="below"]) .tooltip {
            position-area: block-end center;
            margin-block-start: var(--_tooltip-gap);
            position-try-fallbacks: flip-block;
        }

        :host([positioning="before"]) .tooltip {
            position-area: center left;
            margin-inline-end: var(--_tooltip-gap);
            position-try-fallbacks: flip-inline;
        }

        :host([positioning="after"]) .tooltip {
            position-area: center right;
            margin-inline-start: var(--_tooltip-gap);
            position-try-fallbacks: flip-inline;
        }
    }

    @media (forced-colors: active) {
        .tooltip {
            forced-color-adjust: none;
            border: var(--_tooltip-border-width) solid ButtonText;
            background: Canvas;
            color: CanvasText;
            box-shadow: none;
        }
    }
`;

const template = html<VioletTooltip>`
    <span class="anchor" part="anchor">
        <slot @slotchange="${x => x.handleSlotChange()}"></slot>
    </span>
    <div
        class="tooltip"
        part="tooltip"
        id="${x => x.tooltipId}"
        role="tooltip"
        popover="hint"
    >
        <slot name="content" @slotchange="${x => x.syncDescription()}">${x => x.content}</slot>
    </div>
`;

/**
 * Violet reusable tooltip.
 *
 * @summary Token-driven tooltip using popover="hint" and CSS Anchor Positioning.
 *          Wraps a trigger element (default slot) and shows supplemental text on hover/focus.
 * @slot - Trigger element that the tooltip anchors to.
 * @slot content - Rich tooltip content (alternative to the content attribute).
 * @csspart anchor - The wrapper around the trigger slot that serves as the CSS anchor.
 * @csspart tooltip - The tooltip popup element.
 */
export class VioletTooltip extends FASTElement {
    declare public content: string;
    declare public positioning: string;
    declare public delay: number;
    declare public open: boolean;

    @observable
    declare public anchor: string;

    public readonly tooltipId: string;
    public readonly anchorName: string;

    #showTimeout: ReturnType<typeof setTimeout> | null = null;
    #hideTimeout: ReturnType<typeof setTimeout> | null = null;
    #triggerElement: Element | null = null;
    #externalAnchor: HTMLElement | null = null;
    #externalListenersAttached = false;
    #fallbackPosition = new LazyFallbackPositionController();
    /** The ids this tooltip added to its trigger's aria-describedby, so it removes only those. */
    #describedByIds: string[] = [];
    /** The aria-description this tooltip set on its trigger. */
    #description: string | null = null;

    public constructor() {
        super();
        this.content = "";
        this.positioning = "above";
        this.delay = 250;
        this.open = false;

        const id = violetTooltipId;
        violetTooltipId += 1;
        this.tooltipId = `violet-tooltip-${id}`;
        this.anchorName = createAnchorName("violet-tooltip", id);
    }

    get #tooltipElement(): HTMLElement | null {
        return this.shadowRoot?.querySelector(".tooltip") ?? null;
    }

    get #anchorElement(): HTMLElement | null {
        return this.shadowRoot?.querySelector(".anchor") ?? null;
    }

    get #activeAnchorElement(): HTMLElement | null {
        return this.#externalAnchor ?? this.#anchorElement;
    }

    public connectedCallback(): void {
        super.connectedCallback();

        const anchorEl = this.#anchorElement;
        if (anchorEl) {
            anchorEl.addEventListener("mouseenter", this.#handleMouseEnter);
            anchorEl.addEventListener("mouseleave", this.#handleMouseLeave);
            anchorEl.addEventListener("focusin", this.#handleFocusIn);
            anchorEl.addEventListener("focusout", this.#handleFocusOut);
        }

        const tooltip = this.#tooltipElement;
        if (tooltip) {
            tooltip.addEventListener("mouseenter", this.#handleTooltipMouseEnter);
            tooltip.addEventListener("mouseleave", this.#handleTooltipMouseLeave);
            tooltip.addEventListener("toggle", this.#handleToggle);
        }

        this.#resolveExternalAnchor();
        this.#syncAnchoring();

        if (this.open) {
            this.#showTooltip();
        }
    }

    public disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#clearTimers();
        this.#fallbackPosition.stop(this.#tooltipElement);
        this.#detachExternalListeners();
    }

    public openChanged(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        if (this.open) {
            this.#showTooltip();
        } else {
            this.#hideTooltip();
        }
    }

    public positioningChanged(): void {
        if (this.open) {
            this.#fallbackPosition.update();
        }
    }

    public anchorChanged(): void {
        if (this.$fastController.isConnected) {
            this.#detachExternalListeners();
            this.#resolveExternalAnchor();
            this.#syncAnchoring();
            if (!this.#externalListenersAttached) {
                this.handleSlotChange();
            }
            if (this.open) {
                this.#startFallbackPosition();
            }
        }
    }

    public contentChanged(): void {
        this.syncDescription();
    }

    public handleSlotChange(): void {
        if (this.#externalListenersAttached) {
            return;
        }
        const slot = this.shadowRoot?.querySelector("slot:not([name])") as HTMLSlotElement | null;
        const assigned = slot?.assignedElements({ flatten: true }) ?? [];
        this.#clearDescription();
        this.#triggerElement = assigned[0] ?? null;
        this.syncDescription();
    }

    /**
     * Describes the trigger with content in the trigger's own tree, since an id inside this
     * tooltip's shadow root does not resolve from outside it: elements slotted into `content` are
     * named in aria-describedby, and the `content` attribute alone becomes aria-description.
     */
    public syncDescription(): void {
        const trigger = this.#triggerElement;
        this.#clearDescription();
        if (!trigger) {
            return;
        }

        const slot = this.shadowRoot?.querySelector('slot[name="content"]') as HTMLSlotElement | null;
        const slotted = slot?.assignedElements({ flatten: true }) ?? [];
        if (slotted.length > 0) {
            const ids = slotted.map((element, index) => {
                if (!element.id) {
                    element.id = `${this.tooltipId}-content-${index}`;
                }
                return element.id;
            });
            const own = describedBy(trigger).filter(id => !ids.includes(id));
            trigger.setAttribute("aria-describedby", [...own, ...ids].join(" "));
            this.#describedByIds = ids;
        } else if (this.content) {
            trigger.setAttribute("aria-description", this.content);
            this.#description = this.content;
        }
    }

    #clearDescription(): void {
        const trigger = this.#triggerElement;
        if (trigger && this.#describedByIds.length > 0) {
            const rest = describedBy(trigger).filter(id => !this.#describedByIds.includes(id));
            if (rest.length > 0) {
                trigger.setAttribute("aria-describedby", rest.join(" "));
            } else {
                trigger.removeAttribute("aria-describedby");
            }
        }
        if (trigger && this.#description !== null && trigger.getAttribute("aria-description") === this.#description) {
            trigger.removeAttribute("aria-description");
        }
        this.#describedByIds = [];
        this.#description = null;
    }

    #syncAnchoring(): void {
        bindOverlayAnchor(this.#anchorElement, this.#externalAnchor, this.#tooltipElement, this.anchorName);
    }

    #resolveExternalAnchor(): void {
        if (!this.anchor) {
            return;
        }

        const external = document.getElementById(this.anchor);
        if (!(external instanceof HTMLElement)) {
            return;
        }

        this.#clearDescription();
        this.#externalAnchor = external;
        this.#triggerElement = external;
        this.syncDescription();

        external.addEventListener("mouseenter", this.#handleMouseEnter);
        external.addEventListener("mouseleave", this.#handleMouseLeave);
        external.addEventListener("focusin", this.#handleFocusIn);
        external.addEventListener("focusout", this.#handleFocusOut);
        this.#externalListenersAttached = true;
    }

    #detachExternalListeners(): void {
        if (!this.#externalListenersAttached || !this.#triggerElement || !this.#externalAnchor) {
            return;
        }

        this.#triggerElement.removeEventListener("mouseenter", this.#handleMouseEnter);
        this.#triggerElement.removeEventListener("mouseleave", this.#handleMouseLeave);
        this.#triggerElement.removeEventListener("focusin", this.#handleFocusIn);
        this.#triggerElement.removeEventListener("focusout", this.#handleFocusOut);
        this.#clearDescription();
        this.#externalAnchor = null;
        this.#triggerElement = null;
        this.#externalListenersAttached = false;
    }

    #handleMouseEnter = (): void => {
        this.#clearTimers();
        this.#showTimeout = setTimeout(() => {
            this.open = true;
        }, this.delay);
    };

    #handleMouseLeave = (): void => {
        this.#clearTimers();
        this.#hideTimeout = setTimeout(() => {
            this.open = false;
        }, 100);
    };

    #handleTooltipMouseEnter = (): void => {
        if (this.#hideTimeout) {
            clearTimeout(this.#hideTimeout);
            this.#hideTimeout = null;
        }
    };

    #handleTooltipMouseLeave = (): void => {
        this.#hideTimeout = setTimeout(() => {
            this.open = false;
        }, 100);
    };

    /**
     * The browser closes a hint popover itself, on Escape or a light dismiss. Follow it, so `open`
     * says what is shown and the next hover or focus shows the tooltip again.
     */
    #handleToggle = (event: Event): void => {
        if ((event as ToggleEvent).newState === "closed" && this.open) {
            this.#clearTimers();
            this.open = false;
        }
    };

    #handleFocusIn = (): void => {
        this.#clearTimers();
        this.open = true;
    };

    #handleFocusOut = (): void => {
        this.#clearTimers();
        this.open = false;
    };

    #showTooltip(): void {
        const tooltip = this.#tooltipElement;
        if (!tooltip) {
            return;
        }

        try {
            tooltip.showPopover();
        } catch {
            // popover="hint" not supported — fall back to manual toggle
            tooltip.toggleAttribute("popover-open", true);
            tooltip.style.display = "block";
        }
        this.#syncAnchoring();
        this.#startFallbackPosition();
    }

    #startFallbackPosition(): void {
        this.#fallbackPosition.start(
            () => this.#activeAnchorElement,
            () => this.#tooltipElement,
            () => [this.positioning, "above", "center", getComputedStyle(this).getPropertyValue("--_tooltip-gap"), this, 8],
            Boolean(this.#externalAnchor),
        );
    }

    #hideTooltip(): void {
        const tooltip = this.#tooltipElement;
        if (!tooltip) {
            return;
        }

        this.#fallbackPosition.stop(tooltip);
        try {
            tooltip.hidePopover();
        } catch {
            tooltip.removeAttribute("popover-open");
            tooltip.style.display = "";
        }
    }

    #clearTimers(): void {
        if (this.#showTimeout) {
            clearTimeout(this.#showTimeout);
            this.#showTimeout = null;
        }
        if (this.#hideTimeout) {
            clearTimeout(this.#hideTimeout);
            this.#hideTimeout = null;
        }
    }
}

export type VioletTooltipPositioning = "above" | "below" | "before" | "after";

attr(VioletTooltip.prototype, "content");
attr(VioletTooltip.prototype, "positioning");
attr({ converter: { fromView: (val: string) => Number.parseInt(val, 10) || 250, toView: (val: number) => String(val) } })(VioletTooltip.prototype, "delay");
attr({ mode: "boolean" })(VioletTooltip.prototype, "open");
attr(VioletTooltip.prototype, "anchor");

/** The FAST definition of `<violet-tooltip>`; `defineVioletTooltip` in `./violet-tooltip.define` registers it. */
export const violetTooltipDefinition = {
    name: "violet-tooltip",
    template,
    styles,
} satisfies PartialFASTElementDefinition;
