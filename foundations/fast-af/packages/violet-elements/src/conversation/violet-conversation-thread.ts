import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: flex;
        flex-direction: column;
        min-block-size: 0;
        position: relative;
        overflow: hidden;
    }

    .scroll-region {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        scroll-behavior: smooth;
        overscroll-behavior-y: contain;
    }

    .scroll-region:focus-visible {
        outline: none;
        box-shadow: inset 0 0 0 2px var(--_focus-ring);
    }

    .content {
        display: flex;
        flex-direction: column;
        gap: var(--_space-sm);
        padding: var(--_space-sm);
    }

    .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: 1;
        padding: var(--_space-lg);
        color: var(--_text-secondary, #414651);
        text-align: center;
    }

    .empty[hidden] {
        display: none;
    }

    .scroll-anchor {
        block-size: 0;
        overflow: hidden;
    }
`;

const template = html<VioletConversationThread>`
    <div class="empty" part="empty" ?hidden="${x => !x.empty}">
        <slot name="empty"></slot>
    </div>
    <div
        class="scroll-region"
        part="scroll-region"
        role="log"
        aria-live="${x => x.busy ? "off" : "polite"}"
        aria-busy="${x => x.busy ? "true" : "false"}"
        tabindex="0"
        ?hidden="${x => x.empty}"
        @scroll="${(x, c) => x.handleScroll(c.event)}"
        @wheel="${x => x.cancelAutoScroll()}"
        @touchstart="${x => x.cancelAutoScroll()}"
        @pointerdown="${x => x.cancelAutoScroll()}"
        @keydown="${x => x.cancelAutoScroll()}"
    >
        <div class="content" part="content">
            <slot></slot>
        </div>
        <div class="scroll-anchor" id="scroll-anchor"></div>
    </div>
`;

/**
 * Violet conversation thread container.
 *
 * @summary Semantic transcript container with scroll management, live region
 *          semantics, and auto-scroll behavior for chat message display.
 * @slot - Message children (violet-message elements).
 * @slot empty - Content shown when the empty attribute is set.
 * @csspart scroll-region - The scrollable container.
 * @csspart content - The inner content wrapper with spacing.
 * @csspart empty - The empty state container.
 */
export class VioletConversationThread extends FASTElement {
    declare public busy: boolean;
    declare public empty: boolean;

    @observable
    declare public isOverflowing: boolean;

    @observable
    declare public userScrolledAway: boolean;

    public constructor() {
        super();
        this.busy = false;
        this.empty = false;
        this.isOverflowing = false;
        this.userScrolledAway = false;
    }

    get #scrollRegion(): HTMLElement | null {
        return this.shadowRoot?.querySelector(".scroll-region") ?? null;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.#observeContent();
        this.#observeResize();
        this.#scheduleOverflowSync();
    }

    public scrollToBottom(): void {
        const region = this.#scrollRegion;
        if (!region) {
            return;
        }

        region.scrollTop = region.scrollHeight;
        this.userScrolledAway = false;
        // With `scroll-behavior: smooth` the browser fires scroll events mid-animation while still far from the
        // bottom; ignore those until the animation lands or the user takes over.
        this.#autoScrolling = region.scrollHeight - region.scrollTop - region.clientHeight > 1;
    }

    /** User input takes over from a programmatic scroll. Returns true so the default action is kept. */
    public cancelAutoScroll(): boolean {
        this.#autoScrolling = false;
        return true;
    }

    #autoScrolling = false;

    public handleScroll(_event: Event): void {
        const region = this.#scrollRegion;
        if (!region) {
            return;
        }

        const distanceFromBottom = region.scrollHeight - region.scrollTop - region.clientHeight;
        if (this.#autoScrolling) {
            if (distanceFromBottom <= 1) {
                this.#autoScrolling = false;
            }
            return;
        }
        this.userScrolledAway = distanceFromBottom > 50;
    }

    #observer: MutationObserver | null = null;
    #resizeObserver: ResizeObserver | null = null;

    #observeContent(): void {
        this.#observer = new MutationObserver(() => {
            this.#scheduleOverflowSync();
            if (!this.userScrolledAway) {
                requestAnimationFrame(() => this.scrollToBottom());
            }
        });

        const slot = this.shadowRoot?.querySelector("slot:not([name])") as HTMLSlotElement | null;
        if (slot) {
            slot.addEventListener("slotchange", () => {
                this.#scheduleOverflowSync();
                if (!this.userScrolledAway) {
                    requestAnimationFrame(() => this.scrollToBottom());
                }
            });
        }

        this.#observer.observe(this, { childList: true, subtree: true, characterData: true });
    }

    #observeResize(): void {
        const region = this.#scrollRegion;
        if (!region || typeof ResizeObserver === "undefined") {
            return;
        }

        this.#resizeObserver = new ResizeObserver(() => {
            this.#scheduleOverflowSync();
        });
        this.#resizeObserver.observe(region);
    }

    #scheduleOverflowSync(): void {
        requestAnimationFrame(() => this.#updateOverflowState());
    }

    #updateOverflowState(): void {
        const region = this.#scrollRegion;
        if (!region || this.empty) {
            this.isOverflowing = false;
            return;
        }

        this.isOverflowing = region.scrollHeight - region.clientHeight > 1;
    }

    public disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#observer?.disconnect();
        this.#observer = null;
        this.#resizeObserver?.disconnect();
        this.#resizeObserver = null;
    }
}

attr({ mode: "boolean" })(VioletConversationThread.prototype, "busy");
attr({ mode: "boolean" })(VioletConversationThread.prototype, "empty");

if (!customElements.get("violet-conversation-thread")) {
    await FASTElement.define(VioletConversationThread, {
        name: "violet-conversation-thread",
        template,
        styles,
    });
}
