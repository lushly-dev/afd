import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import { violetFieldTokenDefaults, violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";
import type { VioletTab } from "../tab/violet-tab";
import type { VioletTabPanel } from "../tab-panel/violet-tab-panel";

export type VioletTabsAppearance = "open" | "closed" | "mixed";
export type VioletTabsOrientation = "horizontal" | "vertical";

let violetTabsId = 0;

const styles = css`
    ${violetFieldTokenDefaults}
    ${violetSurfaceTokenDefaults}

    :host {
        display: grid;
        gap: var(--_space-stack-sm);
        color: var(--_text-primary, var(--color-text-primary, #18181b));

        --_panel-background: var(--_surface-page);
        --_panel-border: color-mix(in srgb, var(--_border-subtle) 92%, transparent);
        --_panel-shadow: var(--_shadow-control);
        --_panel-padding: var(--_space-lg, 24px);
        --_tablist-divider: color-mix(in srgb, var(--_border-subtle) 92%, transparent);
    }

    :host([appearance="closed"]),
    :host([appearance="mixed"]) {
        gap: 0;
    }

    :host([orientation="vertical"]) {
        grid-template-columns: minmax(max-content, 16rem) minmax(0, 1fr);
        align-items: start;
        gap: var(--_space-md, 12px);
    }

    .tablist-shell {
        min-inline-size: 0;
        border-block-end: 1px solid var(--_tablist-divider);
    }

    :host([appearance="closed"]) .tablist-shell,
    :host([appearance="mixed"]) .tablist-shell {
        border-block-end: 0;
    }

    .tablist {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--_space-inline-sm);
        min-inline-size: 0;
    }

    :host([appearance="closed"]) .tablist {
        gap: var(--_space-stack-2xs);
    }

    :host([orientation="vertical"]) .tablist-shell {
        border-block-end: 0;
        padding-inline-end: var(--_space-inline-sm);
    }

    :host([orientation="vertical"]) .tablist {
        flex-direction: column;
        align-items: stretch;
    }

    .panel-region {
        min-inline-size: 0;
    }

    :host([appearance="open"]) .panel-region {
        padding-block-start: var(--_space-stack-xs);
    }

    :host([appearance="closed"]) .panel-region,
    :host([appearance="mixed"]) .panel-region {
        padding: var(--_panel-padding);
        border: 1px solid var(--_panel-border);
        border-radius: var(--_radius-lg, 6px);
        background: var(--_panel-background);
        box-shadow: var(--_panel-shadow);
    }

    :host([orientation="horizontal"][appearance="closed"]) .panel-region,
    :host([orientation="horizontal"][appearance="mixed"]) .panel-region {
        border-start-start-radius: 0;
    }

    :host([orientation="vertical"][appearance="closed"]) .panel-region,
    :host([orientation="vertical"][appearance="mixed"]) .panel-region {
        border-start-start-radius: 0;
    }
`;

const template = html<VioletTabs>`
    <div class="tablist-shell" part="tablist-shell">
        <div class="tablist" part="tablist" role="tablist" aria-orientation="${x => x.orientation}">
            <slot name="tab" @slotchange="${x => x.handleTabSlotChange()}"></slot>
        </div>
    </div>
    <div class="panel-region" part="panel-region" ?hidden="${x => !x.hasPanels}">
        <slot name="tabpanel" @slotchange="${x => x.handlePanelSlotChange()}"></slot>
    </div>
`;

function isVioletTab(element: Element): element is VioletTab {
    return element.tagName === "VIOLET-TAB";
}

function isVioletTabPanel(element: Element): element is VioletTabPanel {
    return element.tagName === "VIOLET-TAB-PANEL";
}

/**
 * Violet reusable tabs composite.
 *
 * @summary Token-driven tabs with automatic activation, panel linkage, and open or closed visual treatments.
 * @slot tab - Tab items.
 * @slot tabpanel - Panels paired to tabs in source order.
 * @fires change - Emitted when the active tab changes.
 * @csspart tablist-shell - Wrapper around the tablist and divider.
 * @csspart tablist - Element carrying the tablist role.
 * @csspart panel-region - Wrapper around the active tab panels.
 */
export class VioletTabs extends FASTElement {
    @observable
    declare public tabs: VioletTab[];

    @observable
    declare public panels: VioletTabPanel[];

    @observable
    declare public hasPanels: boolean;

    /**
     * Visual treatment for the tab rail.
     */
    declare public appearance: VioletTabsAppearance;

    /**
     * Disables tab interaction.
     */
    declare public disabled: boolean;

    /**
     * Orientation for the tablist keyboard and layout framing.
     */
    declare public orientation: VioletTabsOrientation;

    /**
     * Active tab id.
     */
    declare public activeid: string;

    public activetab: VioletTab | null;

    readonly #handleTabClick = (event: Event): void => {
        if (this.disabled) {
            return;
        }

        const tab = event.currentTarget as VioletTab | null;
        if (!tab || this.#isTabDisabled(tab)) {
            return;
        }

        tab.focus();
        this.activeid = tab.id;
    };

    readonly #handleTabKeydown = (event: Event): void => {
        if (this.disabled) {
            return;
        }

        const keyboardEvent = event as KeyboardEvent;
        const currentTab = keyboardEvent.currentTarget as VioletTab | null;
        if (!currentTab || this.#isTabDisabled(currentTab)) {
            return;
        }

        switch (keyboardEvent.key) {
            case "ArrowLeft":
                if (this.orientation === "horizontal") {
                    keyboardEvent.preventDefault();
                    this.#moveSelection(this.#isRtl() ? 1 : -1);
                }
                break;
            case "ArrowRight":
                if (this.orientation === "horizontal") {
                    keyboardEvent.preventDefault();
                    this.#moveSelection(this.#isRtl() ? -1 : 1);
                }
                break;
            case "ArrowUp":
                if (this.orientation === "vertical") {
                    keyboardEvent.preventDefault();
                    this.#moveSelection(-1);
                }
                break;
            case "ArrowDown":
                if (this.orientation === "vertical") {
                    keyboardEvent.preventDefault();
                    this.#moveSelection(1);
                }
                break;
            case "Home":
                keyboardEvent.preventDefault();
                this.#moveToBoundary("start");
                break;
            case "End":
                keyboardEvent.preventDefault();
                this.#moveToBoundary("end");
                break;
            case "Enter":
            case " ":
                keyboardEvent.preventDefault();
                this.activeid = currentTab.id;
                break;
        }
    };

    public constructor() {
        super();
        this.tabs = [];
        this.panels = [];
        this.hasPanels = false;
        this.appearance = "open";
        this.disabled = false;
        this.orientation = "horizontal";
        this.activeid = "";
        this.activetab = null;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.#syncTabs();
        this.#syncPanels();
        this.#applyState(false);
    }

    public disconnectedCallback(): void {
        this.#detachListeners(this.tabs);
        super.disconnectedCallback();
    }

    public appearanceChanged(): void {
        if (this.$fastController.isConnected) {
            this.#applyState(false);
        }
    }

    public disabledChanged(): void {
        if (this.$fastController.isConnected) {
            this.#applyState(false);
        }
    }

    public orientationChanged(): void {
        if (this.$fastController.isConnected) {
            this.#applyState(false);
        }
    }

    public activeidChanged(previous: string, next: string): void {
        if (this.$fastController.isConnected) {
            this.#applyState(previous !== next);
        }
    }

    public handleTabSlotChange(): void {
        this.#syncTabs();
        this.#applyState(false);
    }

    public handlePanelSlotChange(): void {
        this.#syncPanels();
        this.#applyState(false);
    }

    #syncTabs(): void {
        const nextTabs = Array.from(this.children).filter(isVioletTab);
        nextTabs.forEach(tab => {
            if (tab.slot !== "tab") {
                tab.slot = "tab";
            }
        });
        this.#detachListeners(this.tabs);
        this.tabs = nextTabs;
        this.#attachListeners(this.tabs);
    }

    #syncPanels(): void {
        this.panels = Array.from(this.children).filter(isVioletTabPanel);
        this.panels.forEach(panel => {
            if (panel.slot !== "tabpanel") {
                panel.slot = "tabpanel";
            }
        });
        this.hasPanels = this.panels.length > 0;
    }

    #attachListeners(tabs: VioletTab[]): void {
        tabs.forEach(tab => {
            tab.addEventListener("click", this.#handleTabClick);
            tab.addEventListener("keydown", this.#handleTabKeydown);
        });
    }

    #detachListeners(tabs: VioletTab[]): void {
        tabs.forEach(tab => {
            tab.removeEventListener("click", this.#handleTabClick);
            tab.removeEventListener("keydown", this.#handleTabKeydown);
        });
    }

    #applyState(emitChange: boolean): void {
        if (this.tabs.length === 0) {
            this.activetab = null;
            this.hasPanels = this.panels.length > 0;
            return;
        }

        const activeIndex = this.#resolveActiveIndex();
        const activeTab = this.tabs[activeIndex] ?? null;
        this.activetab = activeTab;

        const pairCount = Math.min(this.tabs.length, this.panels.length);

        this.tabs.forEach((tab, index) => {
            if (!tab.id) {
                tab.id = `violet-tab-${++violetTabsId}`;
            }

            if (tab.slot !== "tab") {
                tab.slot = "tab";
            }

            tab.setAttribute("role", "tab");

            const pairedPanel = index < pairCount ? this.panels[index] : null;
            if (pairedPanel && !pairedPanel.id) {
                pairedPanel.id = `violet-tab-panel-${++violetTabsId}`;
            }

            if (pairedPanel && pairedPanel.slot !== "tabpanel") {
                pairedPanel.slot = "tabpanel";
            }

            if (pairedPanel) {
                pairedPanel.setAttribute("role", "tabpanel");
            }

            const isSelected = index === activeIndex;
            const isDisabled = this.#isTabDisabled(tab);
            const isFocusable = isSelected && !isDisabled;

            tab.syncPresentation(this.#resolveTabAppearance(isSelected), this.orientation);
            tab.setDisabledFromTabs(this.disabled);
            tab.setAttribute("aria-disabled", isDisabled ? "true" : "false");
            tab.setAttribute("aria-selected", isSelected ? "true" : "false");
            tab.tabIndex = isFocusable ? 0 : -1;

            if (pairedPanel) {
                tab.setAttribute("aria-controls", pairedPanel.id);
                pairedPanel.setAttribute("aria-labelledby", tab.id);
                pairedPanel.hidden = !isSelected;
                pairedPanel.tabIndex = 0;
                pairedPanel.setAttribute("data-orientation", this.orientation);
                pairedPanel.setAttribute("data-appearance", this.appearance);
            } else {
                tab.removeAttribute("aria-controls");
            }
        });

        this.panels.forEach((panel, index) => {
            if (index >= pairCount) {
                panel.hidden = true;
            }
        });

        if (activeTab && this.activeid !== activeTab.id) {
            this.activeid = activeTab.id;
            return;
        }

        this.hasPanels = this.panels.length > 0;

        if (emitChange && activeTab) {
            this.$emit("change", activeTab);
        }
    }

    #resolveActiveIndex(): number {
        const requestedIndex = this.tabs.findIndex(tab => tab.id === this.activeid && !this.#isTabDisabled(tab));
        if (requestedIndex >= 0) {
            return requestedIndex;
        }

        const selectedIndex = this.tabs.findIndex(
            tab => tab.getAttribute("aria-selected") === "true" && !this.#isTabDisabled(tab),
        );
        if (selectedIndex >= 0) {
            return selectedIndex;
        }

        const firstEnabledIndex = this.tabs.findIndex(tab => !this.#isTabDisabled(tab));
        return firstEnabledIndex >= 0 ? firstEnabledIndex : 0;
    }

    #resolveTabAppearance(isSelected: boolean): VioletTabsAppearance {
        if (this.appearance === "mixed") {
            return isSelected ? "mixed" : "open";
        }

        return this.appearance;
    }

    #moveSelection(delta: number): void {
        const focusableTabs = this.tabs.filter(tab => !this.#isTabDisabled(tab));
        if (focusableTabs.length === 0) {
            return;
        }

        const currentIndex = this.activetab ? focusableTabs.indexOf(this.activetab) : 0;
        const nextIndex = (currentIndex + delta + focusableTabs.length) % focusableTabs.length;
        const nextTab = focusableTabs[nextIndex];
        if (!nextTab) {
            return;
        }

        nextTab.focus();
        this.activeid = nextTab.id;
    }

    #moveToBoundary(position: "start" | "end"): void {
        const focusableTabs = this.tabs.filter(tab => !this.#isTabDisabled(tab));
        if (focusableTabs.length === 0) {
            return;
        }

        const nextTab = position === "start" ? focusableTabs[0] : focusableTabs[focusableTabs.length - 1];
        if (!nextTab) {
            return;
        }

        nextTab.focus();
        this.activeid = nextTab.id;
    }

    #isTabDisabled(tab: VioletTab): boolean {
        return this.disabled || tab.disabled;
    }

    #isRtl(): boolean {
        return getComputedStyle(this).direction === "rtl";
    }
}

attr(VioletTabs.prototype, "appearance");
attr({ mode: "boolean" })(VioletTabs.prototype, "disabled");
attr(VioletTabs.prototype, "orientation");
attr(VioletTabs.prototype, "activeid");

if (!customElements.get("violet-tabs")) {
    await FASTElement.define(VioletTabs, {
        name: "violet-tabs",
        template,
        styles,
    });
}
