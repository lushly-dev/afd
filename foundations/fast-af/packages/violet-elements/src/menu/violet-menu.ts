import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import { violetActionTokenDefaults } from "../theme/violet-token-defaults";
import type { VioletMenuItem } from "./violet-menu-item";

let violetMenuId = 0;

/* ------------------------------------------------------------------ */
/*  Styles                                                            */
/* ------------------------------------------------------------------ */

const styles = css`
    ${violetActionTokenDefaults}

    :host {
        display: inline-flex;
        vertical-align: middle;
        --_panel-min-inline: var(--violet-menu-min-inline-size, 180px);
        --_panel-max-inline: var(--violet-menu-max-inline-size, 320px);
        --_panel-max-block: var(--violet-menu-max-height, 360px);
        --_panel-padding: var(--violet-menu-padding, var(--_space-sm));
        --_panel-radius: var(--violet-menu-radius, calc(var(--_radius-md) * 2));
        --_panel-gap: var(--violet-menu-gap, var(--_space-sm));
        --_panel-background: var(--violet-menu-background, var(--_surface-card));
        --_panel-shadow: var(--violet-menu-shadow, var(--_shadow-floating));
        --_panel-border-color: var(--violet-menu-border-color, var(--_border-subtle));
    }

    .panel {
        box-sizing: border-box;
        min-inline-size: var(--_panel-min-inline);
        max-inline-size: var(--_panel-max-inline);
        max-block-size: min(var(--_panel-max-block), 80vh);
        overflow-y: auto;
        overscroll-behavior: contain;
        /* Override popover UA defaults (inset:0 margin:auto) */
        inset: unset;
        margin: 0;
        padding: var(--_panel-padding);
        border: thin solid var(--_panel-border-color);
        border-radius: var(--_panel-radius);
        background: var(--_panel-background);
        box-shadow: var(--_panel-shadow);
        color: inherit;
        font-family: inherit;
        font-size: var(--_control-type-size);
        line-height: var(--_type-body-line, 20px);
        z-index: var(--_layer-popover);
    }

    .panel::backdrop {
        background: transparent;
    }

    /* Separator styling for slotted <hr> elements */
    ::slotted(hr) {
        border: none;
        block-size: thin;
        margin-block: var(--_space-sm);
        margin-inline: calc(var(--_space-sm) * 2);
        background: var(--_border-subtle);
    }

    @media (forced-colors: active) {
        .panel {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: ButtonText;
        }
    }
`;

/* ------------------------------------------------------------------ */
/*  Template                                                          */
/* ------------------------------------------------------------------ */

const template = html<VioletMenu>`
    <slot
        name="trigger"
        @click="${x => x.handleTriggerClick()}"
        @keydown="${(x, c) => x.handleTriggerKeydown(c.event as KeyboardEvent)}"
    ></slot>
    <div
        class="panel"
        part="panel"
        id="${x => x.panelId}"
        popover="auto"
        role="menu"
        aria-label="${x => x.label || null}"
        @keydown="${(x, c) => x.handlePanelKeydown(c.event as KeyboardEvent)}"
        @toggle="${(x, c) => x.handleToggle(c.event as ToggleEvent)}"
    >
        <slot @slotchange="${x => x.handleItemsSlotChange()}"></slot>
    </div>
`;

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

/**
 * Violet reusable menu primitive.
 *
 * Combines a trigger button (slotted) with a floating action menu panel.
 * Uses the native HTML Popover API for light dismiss, Escape handling,
 * top-layer rendering, and focus return. CSS Anchor Positioning places
 * the panel relative to the trigger with automatic flip fallbacks.
 * Full WAI-ARIA APG Menu Button keyboard navigation is implemented.
 *
 * @summary Token-driven action menu with popover, anchor positioning, and full keyboard support.
 * @fires open-change - Emitted when the menu opens or closes. Detail: `{ open: boolean }`.
 * @slot trigger - The button element that toggles the menu. Must be a focusable element.
 * @slot - Menu content: `<violet-menu-item>` elements and optional `<hr>` separators.
 * @csspart panel - Floating menu panel container.
 */
export class VioletMenu extends FASTElement {
    /**
     * Whether the menu is currently open.
     */
    @observable
    declare public open: boolean;

    /**
     * Accessible label for the menu panel. Falls back to the trigger's
     * text content when not set.
     */
    declare public label: string;

    /**
     * Unique ID for the menu panel, used for anchor positioning.
     */
    public readonly panelId: string;

    #id: number;
    #activeIndex = -1;
    #searchBuffer = "";
    #searchTimer = 0;

    public constructor() {
        super();
        this.#id = violetMenuId;
        violetMenuId += 1;
        this.panelId = `violet-menu-panel-${this.#id}`;
        this.open = false;
        this.label = "";
    }

    /* -------------------------------------------------------------- */
    /*  Lifecycle                                                     */
    /* -------------------------------------------------------------- */

    public connectedCallback(): void {
        super.connectedCallback();
        this.#syncTriggerAria();
    }

    public disconnectedCallback(): void {
        this.#clearTypeAhead();
        super.disconnectedCallback();
    }

    /* -------------------------------------------------------------- */
    /*  Public API                                                    */
    /* -------------------------------------------------------------- */

    /**
     * Toggle the menu open/closed.
     */
    public toggle(): void {
        this.#panel?.togglePopover();
    }

    /**
     * Show the menu.
     */
    public show(): void {
        this.#panel?.showPopover();
    }

    /**
     * Hide the menu.
     */
    public hide(): void {
        if (this.#panel?.matches(":popover-open")) {
            this.#panel.hidePopover();
        }
    }

    /* -------------------------------------------------------------- */
    /*  Event handlers                                                */
    /* -------------------------------------------------------------- */

    /**
     * Handles click on the trigger slot. Toggles the menu.
     */
    public handleTriggerClick(): void {
        this.#panel?.togglePopover();
    }

    /**
     * Handles keydown on the trigger. Opens the menu with arrow keys.
     * Returns `true` for other keys so the template binding keeps their default action.
     */
    public handleTriggerKeydown(event: KeyboardEvent): boolean {
        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                this.#openAndFocus("first");
                return false;
            case "ArrowUp":
                event.preventDefault();
                this.#openAndFocus("last");
                return false;
        }

        return true;
    }

    /**
     * Handles keydown inside the menu panel.
     * Returns `true` for keys it leaves to the browser, such as Tab.
     */
    public handlePanelKeydown(event: KeyboardEvent): boolean {
        const items = this.#items;
        if (items.length === 0) {
            return true;
        }

        switch (event.key) {
            case "ArrowDown": {
                event.preventDefault();
                this.#focusItem(this.#nextIndex(this.#activeIndex, 1, items));
                return false;
            }

            case "ArrowUp": {
                event.preventDefault();
                this.#focusItem(this.#nextIndex(this.#activeIndex, -1, items));
                return false;
            }

            case "Home": {
                event.preventDefault();
                this.#focusItem(0);
                return false;
            }

            case "End": {
                event.preventDefault();
                this.#focusItem(items.length - 1);
                return false;
            }

            case "Enter":
            case " ": {
                event.preventDefault();
                const active = items[this.#activeIndex];
                if (active && !active.disabled) {
                    active.$emit("invoke");
                    this.hide();
                }
                return false;
            }

            case "Escape": {
                event.preventDefault();
                this.hide();
                this.#trigger?.focus();
                return false;
            }

            case "Tab": {
                // Let Tab close the menu and move focus naturally.
                // Don't prevent default.
                this.hide();
                return true;
            }

            default: {
                // Type-ahead: single printable character
                if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                    this.#handleTypeAhead(event.key, items);
                    break;
                }
                return true;
            }
        }

        return false;
    }

    /**
     * Handles the native popover `toggle` event.
     */
    public handleToggle(event: ToggleEvent): void {
        const isOpen = event.newState === "open";
        this.open = isOpen;

        if (isOpen) {
            this.#positionPanel();
            // Focus first item on next frame so the panel is rendered, unless a keyboard open
            // (or a key pressed since) already placed focus; the toggle event is async and
            // would otherwise override it.
            requestAnimationFrame(() => {
                if (this.open && this.#activeIndex === -1) {
                    this.#focusItem(0);
                }
            });
        } else {
            this.#activeIndex = -1;
            this.#clearTypeAhead();
        }

        this.#syncTriggerAria();
        this.$emit("open-change", { open: isOpen });
    }

    /**
     * Handles slotchange on the default slot (menu items).
     */
    public handleItemsSlotChange(): void {
        this.#wireItemEvents();
    }

    /* -------------------------------------------------------------- */
    /*  Property change handlers                                      */
    /* -------------------------------------------------------------- */

    public openChanged(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        const panel = this.#panel;
        if (!panel) {
            return;
        }

        const isCurrentlyOpen = panel.matches(":popover-open");
        if (this.open && !isCurrentlyOpen) {
            panel.showPopover();
        } else if (!this.open && isCurrentlyOpen) {
            panel.hidePopover();
        }

        this.#syncTriggerAria();
    }

    /* -------------------------------------------------------------- */
    /*  Private helpers                                                */
    /* -------------------------------------------------------------- */

    get #panel(): HTMLElement | null {
        return this.shadowRoot?.querySelector(".panel") ?? null;
    }

    get #trigger(): HTMLElement | null {
        const slot = this.shadowRoot?.querySelector('slot[name="trigger"]') as HTMLSlotElement | null;
        const assigned = slot?.assignedElements({ flatten: true }) ?? [];
        return (assigned[0] as HTMLElement) ?? null;
    }

    /**
     * Returns all `violet-menu-item` children (including disabled, per APG).
     */
    get #items(): VioletMenuItem[] {
        return Array.from(this.querySelectorAll("violet-menu-item"));
    }

    /**
     * Positions the panel below (or above) the trigger using fixed coordinates.
     */
    #positionPanel(): void {
        const panel = this.#panel;
        if (!panel) {
            return;
        }

        const rect = (this.#trigger ?? this).getBoundingClientRect();
        const gap = Number.parseFloat(
            getComputedStyle(this).getPropertyValue("--_panel-gap"),
        ) || 4;

        panel.style.position = "fixed";
        panel.style.top = `${rect.bottom + gap}px`;
        panel.style.left = `${rect.left}px`;

        // Flip if overflowing viewport
        requestAnimationFrame(() => {
            const panelRect = panel.getBoundingClientRect();
            if (panelRect.bottom > window.innerHeight) {
                panel.style.top = `${rect.top - panelRect.height - gap}px`;
            }

            if (panelRect.right > window.innerWidth) {
                panel.style.left = `${rect.right - panelRect.width}px`;
            }
        });
    }

    /**
     * Syncs aria-haspopup and aria-expanded on the trigger element.
     */
    #syncTriggerAria(): void {
        const trigger = this.#trigger;
        if (!trigger) {
            return;
        }

        trigger.setAttribute("aria-haspopup", "menu");
        trigger.setAttribute("aria-expanded", String(this.open));
        trigger.setAttribute("aria-controls", this.panelId);
    }

    /**
     * Opens the menu and focuses the first or last item.
     */
    #openAndFocus(position: "first" | "last"): void {
        const panel = this.#panel;
        if (!panel) {
            return;
        }

        const items = this.#items;
        if (panel.matches(":popover-open")) {
            // The panel is open but focus is still on the trigger (for example, a pointer open
            // whose deferred first-item focus has not landed): move through the items instead of
            // dropping the key.
            const direction = position === "first" ? 1 : -1;
            this.#focusItem(
                this.#activeIndex === -1
                    ? position === "first" ? 0 : items.length - 1
                    : this.#nextIndex(this.#activeIndex, direction, items),
            );
            return;
        }

        panel.showPopover();

        // Focus synchronously, so a key pressed before the next frame already reaches the panel.
        // handleToggle's deferred first-item focus then sees an active item and stands down.
        this.#focusItem(position === "first" ? 0 : items.length - 1);
    }

    /**
     * Moves focus to the item at the given index.
     */
    #focusItem(index: number): void {
        const items = this.#items;
        if (index < 0 || index >= items.length) {
            return;
        }

        this.#activeIndex = index;
        items[index]?.focus();
    }

    /**
     * Returns the next valid index in the given direction (wrapping).
     */
    #nextIndex(current: number, direction: 1 | -1, items: VioletMenuItem[]): number {
        const len = items.length;
        if (len === 0) {
            return -1;
        }

        let next = current + direction;
        if (next < 0) {
            next = len - 1;
        } else if (next >= len) {
            next = 0;
        }

        return next;
    }

    /**
     * Type-ahead: matches items by their label text.
     * Characters typed within 500ms are buffered together.
     */
    #handleTypeAhead(char: string, items: VioletMenuItem[]): void {
        if (this.#searchTimer) {
            clearTimeout(this.#searchTimer);
        }

        this.#searchBuffer += char.toLowerCase();

        this.#searchTimer = window.setTimeout(() => {
            this.#clearTypeAhead();
        }, 500);

        const startIndex = this.#activeIndex + 1;
        for (let i = 0; i < items.length; i++) {
            const index = (startIndex + i) % items.length;
            const item = items[index];
            if (item && item.labelText.toLowerCase().startsWith(this.#searchBuffer)) {
                this.#focusItem(index);
                return;
            }
        }
    }

    #clearTypeAhead(): void {
        this.#searchBuffer = "";
        if (this.#searchTimer) {
            clearTimeout(this.#searchTimer);
            this.#searchTimer = 0;
        }
    }

    /**
     * Listens for `invoke` events from menu items to auto-close.
     */
    #wireItemEvents(): void {
        for (const item of this.#items) {
            // Remove previous listener to avoid duplicates
            item.removeEventListener("invoke", this.#handleItemInvoke);
            item.addEventListener("invoke", this.#handleItemInvoke);
        }
    }

    #handleItemInvoke = (): void => {
        // Preserve a destination opened by the action (for example a dialog),
        // but return menu focus to its trigger when the action stays in place.
        const root = this.getRootNode() as Document | ShadowRoot;
        const restoreTrigger = this.contains(root.activeElement) || this.matches(":focus-within");
        this.hide();
        if (restoreTrigger) {
            this.#trigger?.focus();
        }
    };
}

attr(VioletMenu.prototype, "label");

if (!customElements.get("violet-menu")) {
    await FASTElement.define(VioletMenu, {
        name: "violet-menu",
        template,
        styles,
    });
}
