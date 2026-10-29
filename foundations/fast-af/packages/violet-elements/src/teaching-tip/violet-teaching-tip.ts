import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import "../icon/violet-icon";
import "../icon-button/violet-icon-button";
import { registerSystemCloseIcon } from "../icon/generated";
import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

registerSystemCloseIcon();

let violetTeachingTipId = 0;

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: inline-block;
        position: relative;

        --_tip-border-width: var(--violet-teaching-tip-border-width, var(--_card-border-width, 1px));
        --_tip-padding: var(--violet-teaching-tip-padding, var(--_space-md));
        --_tip-max-width: var(--violet-teaching-tip-max-width, 320px);
        --_tip-radius: var(--violet-teaching-tip-radius, var(--_radius-lg));
        --_tip-gap: var(--violet-teaching-tip-gap, var(--_space-sm));
        --_tip-background: var(--violet-teaching-tip-background, var(--_surface-card));
        --_tip-shadow: var(--violet-teaching-tip-shadow, var(--_shadow-floating));
        --_tip-border-color: var(--violet-teaching-tip-border-color, var(--_border-subtle));
    }

    .anchor {
        display: inline-block;
        anchor-name: --violet-teaching-tip-anchor;
    }

    .tip {
        box-sizing: border-box;
        position: fixed;
        position-anchor: --violet-teaching-tip-anchor;
        margin: 0;
        padding: 0;
        border: var(--_tip-border-width) solid var(--_tip-border-color);
        border-radius: var(--_tip-radius);
        background: var(--_tip-background);
        box-shadow: var(--_tip-shadow);
        color: inherit;
        font-family: inherit;
        max-inline-size: var(--_tip-max-width);
        inline-size: var(--_tip-max-width);
        z-index: var(--_layer-popover);

        opacity: 0;
        transform: scale(0.96);
        transition:
            opacity var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard),
            display var(--_duration-fast) var(--_easing-standard) allow-discrete,
            overlay var(--_duration-fast) var(--_easing-standard) allow-discrete;
    }

    .tip:popover-open {
        opacity: 1;
        transform: scale(1);

        @starting-style {
            opacity: 0;
            transform: scale(0.96);
        }
    }

    :host([positioning="above"]) .tip {
        position-area: block-start center;
        margin-block-end: var(--_tip-gap);
        position-try-fallbacks: flip-block;
    }

    :host([positioning="below"]) .tip {
        position-area: block-end center;
        margin-block-start: var(--_tip-gap);
        position-try-fallbacks: flip-block;
    }

    :host([positioning="before"]) .tip {
        position-area: center left;
        margin-inline-end: var(--_tip-gap);
        position-try-fallbacks: flip-inline;
    }

    :host([positioning="after"]) .tip {
        position-area: center right;
        margin-inline-start: var(--_tip-gap);
        position-try-fallbacks: flip-inline;
    }

    .header {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        padding: var(--_tip-padding);
        padding-block-end: 0;
    }

    .header[hidden] {
        display: none;
    }

    .title {
        flex: 1;
        font-weight: 600;
        font-size: 13px;
        min-inline-size: 0;
    }

    .close-button {
        flex-shrink: 0;
        margin-inline-start: auto;
    }

    .body {
        padding: var(--_tip-padding);
        font-size: 12px;
        line-height: 16px;
    }

    .footer {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        padding: var(--_tip-padding);
        padding-block-start: 0;
    }

    .footer[hidden] {
        display: none;
    }

    .step-indicator {
        font-size: 11px;
        color: var(--_text-secondary, #414651);
        margin-inline-end: auto;
    }

    .step-indicator[hidden] {
        display: none;
    }

    @media (forced-colors: active) {
        .tip {
            forced-color-adjust: none;
            border: var(--_tip-border-width) solid ButtonText;
            background: Canvas;
            box-shadow: none;
        }
    }
`;

const template = html<VioletTeachingTip>`
    <span class="anchor" part="anchor">
        <slot @slotchange="${x => x.handleSlotChange()}"></slot>
    </span>
    <div
        class="tip"
        part="tip"
        id="${x => x.tipId}"
        role="dialog"
        aria-labelledby="${x => x.hasTitle ? x.titleId : undefined}"
        aria-label="${x => x.hasTitle ? undefined : "Teaching tip"}"
        popover="auto"
    >
        <div class="header" part="header" ?hidden="${x => !x.hasTitle && x.noCloseButton}">
            <span class="title" part="title" id="${x => x.titleId}">
                <slot name="title" @slotchange="${x => x.handleTitleSlotChange()}"></slot>
            </span>
            <violet-icon-button
                class="close-button"
                part="close-button"
                ?hidden="${x => x.noCloseButton}"
                appearance="quiet"
                label="Dismiss tip"
                @click="${x => x.hide()}"
            >
                <violet-icon icon="system/close" decorative></violet-icon>
            </violet-icon-button>
        </div>
        <div class="body" part="body">
            <slot name="body">${x => x.content}</slot>
        </div>
        <div class="footer" part="footer" ?hidden="${x => !x.hasFooter && !x.totalSteps}">
            <span
                class="step-indicator"
                part="step-indicator"
                ?hidden="${x => !x.totalSteps}"
            >${x => x.totalSteps ? `${x.currentStep} of ${x.totalSteps}` : ""}</span>
            <slot name="footer" @slotchange="${x => x.handleFooterSlotChange()}"></slot>
        </div>
    </div>
`;

/**
 * Violet reusable teaching tip.
 *
 * @summary Positioned onboarding overlay anchored to a trigger element with title,
 *          body content, optional step indicators, and a close button.
 * @fires open-change - Emitted when the teaching tip opens or closes. Detail: `{ open: boolean }`.
 * @fires dismiss - Emitted when the teaching tip is closed by the user.
 * @slot - Trigger element that the teaching tip anchors to.
 * @slot title - Teaching tip title text.
 * @slot body - Teaching tip body content (alternative to the content attribute).
 * @slot footer - Action buttons area (e.g., Next, Back, Done).
 * @csspart anchor - The wrapper around the trigger slot.
 * @csspart tip - The teaching tip popup element.
 * @csspart header - Header section wrapper.
 * @csspart title - Title text wrapper.
 * @csspart close-button - The dismiss button.
 * @csspart body - Body section wrapper.
 * @csspart footer - Footer section wrapper.
 * @csspart step-indicator - The step counter text.
 */
export class VioletTeachingTip extends FASTElement {
    @observable
    declare public hasTitle: boolean;

    @observable
    declare public hasFooter: boolean;

    declare public content: string;
    declare public positioning: string;
    declare public open: boolean;
    declare public anchor: string;
    declare public noCloseButton: boolean;
    declare public currentStep: number;
    declare public totalSteps: number;

    public readonly tipId: string;
    public readonly titleId: string;

    #triggerElement: Element | null = null;
    #externalAnchor: HTMLElement | null = null;
    #externalListenersAttached = false;

    public constructor() {
        super();
        this.hasTitle = false;
        this.hasFooter = false;
        this.content = "";
        this.positioning = "below";
        this.open = false;
        this.noCloseButton = false;
        this.currentStep = 0;
        this.totalSteps = 0;

        const id = violetTeachingTipId;
        violetTeachingTipId += 1;
        this.tipId = `violet-teaching-tip-${id}`;
        this.titleId = `violet-teaching-tip-title-${id}`;
    }

    get #tipElement(): HTMLElement | null {
        return this.shadowRoot?.querySelector(".tip") ?? null;
    }

    public show(): void {
        this.open = true;
    }

    public hide(): void {
        this.open = false;
    }

    public connectedCallback(): void {
        super.connectedCallback();

        const tip = this.#tipElement;
        if (tip) {
            tip.addEventListener("toggle", this.#handleToggle);
        }

        this.#resolveExternalAnchor();
        this.#syncTriggerAria();

        if (this.open) {
            this.#showTip();
        }
    }

    public disconnectedCallback(): void {
        super.disconnectedCallback();

        const tip = this.#tipElement;
        if (tip) {
            tip.removeEventListener("toggle", this.#handleToggle);
        }

        this.#detachExternalListeners();
    }

    public openChanged(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        if (this.open) {
            this.#showTip();
        } else {
            this.#hideTip();
        }

        this.#syncTriggerAria();
    }

    public anchorChanged(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        this.#detachExternalListeners();
        this.#resolveExternalAnchor();
        this.#syncTriggerAria();
    }

    public handleSlotChange(): void {
        const slot = this.shadowRoot?.querySelector("slot:not([name])") as HTMLSlotElement | null;
        const assigned = slot?.assignedElements({ flatten: true }) ?? [];
        if (this.#triggerElement instanceof HTMLElement && !this.#externalListenersAttached) {
            this.#clearTriggerAria(this.#triggerElement);
        }
        this.#triggerElement = assigned[0] ?? null;
        this.#syncTriggerAria();
    }

    public handleTitleSlotChange(): void {
        const slot = this.shadowRoot?.querySelector('slot[name="title"]') as HTMLSlotElement | null;
        this.hasTitle = (slot?.assignedNodes({ flatten: true }) ?? []).some(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                return Boolean(node.textContent?.trim());
            }
            return true;
        });
    }

    public handleFooterSlotChange(): void {
        const slot = this.shadowRoot?.querySelector('slot[name="footer"]') as HTMLSlotElement | null;
        this.hasFooter = (slot?.assignedNodes({ flatten: true }) ?? []).some(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                return Boolean(node.textContent?.trim());
            }
            return true;
        });
    }

    #handleToggle = (event: Event): void => {
        const toggle = event as ToggleEvent;
        const isOpen = toggle.newState === "open";
        this.open = isOpen;
        this.#syncTriggerAria();
        this.$emit("open-change", { open: isOpen });
        if (!isOpen) {
            this.$emit("dismiss");
        }
    };

    #resolveExternalAnchor(): void {
        if (!this.anchor) {
            return;
        }

        const external = document.getElementById(this.anchor);
        if (!(external instanceof HTMLElement)) {
            return;
        }

        this.#externalAnchor = external;
        this.#triggerElement = external;
        external.style.setProperty("anchor-name", "--violet-teaching-tip-anchor");
        this.#externalListenersAttached = true;
    }

    #detachExternalListeners(): void {
        if (!this.#externalListenersAttached || !this.#externalAnchor) {
            return;
        }

        this.#clearTriggerAria(this.#externalAnchor);
        this.#externalAnchor.style.removeProperty("anchor-name");
        this.#externalAnchor = null;
        this.#externalListenersAttached = false;
    }

    #syncTriggerAria(): void {
        if (!(this.#triggerElement instanceof HTMLElement)) {
            return;
        }

        this.#triggerElement.setAttribute("aria-haspopup", "dialog");
        this.#triggerElement.setAttribute("aria-expanded", String(this.open));
        this.#triggerElement.setAttribute("aria-controls", this.tipId);
    }

    #clearTriggerAria(element: HTMLElement): void {
        element.removeAttribute("aria-haspopup");
        element.removeAttribute("aria-expanded");
        element.removeAttribute("aria-controls");
    }

    #showTip(): void {
        const tip = this.#tipElement;
        if (!tip) {
            return;
        }

        try {
            tip.showPopover();
        } catch {
            tip.toggleAttribute("popover-open", true);
            tip.style.display = "block";
        }
    }

    #hideTip(): void {
        const tip = this.#tipElement;
        if (!tip) {
            return;
        }

        try {
            tip.hidePopover();
        } catch {
            tip.removeAttribute("popover-open");
            tip.style.display = "";
        }
    }
}

export type VioletTeachingTipPositioning = "above" | "below" | "before" | "after";

attr(VioletTeachingTip.prototype, "content");
attr(VioletTeachingTip.prototype, "positioning");
attr({ mode: "boolean" })(VioletTeachingTip.prototype, "open");
attr(VioletTeachingTip.prototype, "anchor");
attr({ attribute: "no-close-button", mode: "boolean" })(VioletTeachingTip.prototype, "noCloseButton");
attr({ attribute: "current-step", converter: { fromView: (val: string) => Number.parseInt(val, 10) || 0, toView: (val: number) => String(val) } })(VioletTeachingTip.prototype, "currentStep");
attr({ attribute: "total-steps", converter: { fromView: (val: string) => Number.parseInt(val, 10) || 0, toView: (val: number) => String(val) } })(VioletTeachingTip.prototype, "totalSteps");

if (!customElements.get("violet-teaching-tip")) {
    await FASTElement.define(VioletTeachingTip, {
        name: "violet-teaching-tip",
        template,
        styles,
    });
}
